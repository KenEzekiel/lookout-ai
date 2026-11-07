import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  type Address,
  assertActive,
  BoundaryError,
  type Incoming,
  type FileContext,
  type OutputFile,
  type ThreadContext,
} from "../session/domain.js";

const maxBytes = 20 * 1024 * 1024;
const fileInfoSchema = z.object({
  file: z.object({
    id: z.string(),
    name: z.string().default("attachment"),
    mimetype: z.string().default("application/octet-stream"),
    size: z.number().int().nonnegative(),
    is_external: z.boolean().optional(),
    mode: z.string().optional(),
    url_private: z.string().optional(),
    url_private_download: z.string().optional(),
  }),
});
const uploadSchema = z.object({
  upload_url: z.string().url(),
  file_id: z.string().regex(/^F[A-Z0-9]+$/),
});

function slackUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "files.slack.com" ||
    url.port ||
    url.username ||
    url.password
  )
    throw new BoundaryError("file_host_unsupported");
  return url;
}

function contained(root: string, path: string): boolean {
  const offset = relative(root, path);
  return offset !== "" && !isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`);
}

async function bytes(response: Response): Promise<Buffer> {
  if (!response.ok || !response.body) throw new BoundaryError("file_transfer_failed");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maxBytes) throw new BoundaryError("file_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createSlackFiles(options: {
  botToken: string;
  call: (method: string, args: Record<string, unknown>) => Promise<unknown>;
  fetch?: typeof fetch;
}) {
  const request = options.fetch ?? fetch;
  return {
    async prepare(input: Incoming, thread: ThreadContext, workspace: string, signal: AbortSignal) {
      const local = join(workspace, "oracle", ".local");
      await mkdir(local, { recursive: true, mode: 0o700 });
      if (!contained(await realpath(workspace), await realpath(local)))
        throw new BoundaryError("file_path_invalid");
      const turn = await mkdtemp(join(local, "slack-files-"));
      const outputDirectory = join(turn, "output");
      await mkdir(outputDirectory, { mode: 0o700 });
      const ids = [
        ...new Set([
          ...(input.files ?? []).map((file) => file.id),
          ...(thread.kind === "available"
            ? [...thread.messages]
                .reverse()
                .flatMap((message) => (message.files ?? []).map((file) => file.id))
            : []),
        ]),
      ];
      const attachments: FileContext["attachments"] = [];
      for (const [index, id] of ids.entries()) {
        assertActive(signal);
        if (index >= 10) {
          attachments.push({ id, status: "unavailable", reason: "file_count_limit" });
          continue;
        }
        try {
          const { file } = fileInfoSchema.parse(await options.call("files.info", { file: id }));
          if (file.id !== id) throw new BoundaryError("file_identity_changed");
          if (file.is_external || file.mode === "external")
            throw new BoundaryError("remote_file_unsupported");
          if (file.size > maxBytes) throw new BoundaryError("file_too_large");
          const url = slackUrl(file.url_private_download ?? file.url_private ?? "");
          const response = await request(url, {
            headers: { Authorization: `Bearer ${options.botToken}` },
            redirect: "error",
            signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
          });
          const content = await bytes(response);
          assertActive(signal);
          const name =
            basename(file.name)
              .replace(/[^a-zA-Z0-9._-]/g, "_")
              .slice(0, 160) || "attachment";
          const path = join(turn, `${id}-${name}`);
          await writeFile(path, content, { mode: 0o600, flag: "wx" });
          attachments.push({
            id,
            status: "available",
            name: file.name,
            mimetype: file.mimetype,
            path,
          });
        } catch (error) {
          assertActive(signal);
          attachments.push({
            id,
            status: "unavailable",
            reason: error instanceof BoundaryError ? error.code : "file_access_failed",
          });
        }
      }
      return { outputDirectory, attachments };
    },
    async resolveOutputs(directory: string, files: OutputFile[]): Promise<OutputFile[]> {
      const root = await realpath(directory);
      const outputs: OutputFile[] = [];
      for (const file of files) {
        const path = await realpath(resolve(root, file.path));
        if (!contained(root, path)) throw new BoundaryError("file_path_invalid");
        const info = await stat(path);
        if (!info.isFile()) throw new BoundaryError("file_path_invalid");
        if (info.size > maxBytes) throw new BoundaryError("file_too_large");
        outputs.push({ ...file, path });
      }
      return outputs;
    },
    async publish(
      address: Address,
      text: string,
      files: OutputFile[],
      signal = new AbortController().signal,
    ): Promise<void> {
      assertActive(signal);
      const contents = await Promise.all(
        files.map(async (file) => {
          const info = await stat(file.path);
          if (!info.isFile() || info.size > maxBytes) throw new BoundaryError("file_too_large");
          const content = await readFile(file.path);
          if (content.length > maxBytes) throw new BoundaryError("file_too_large");
          return { file, content };
        }),
      );
      const uploaded: { id: string; title: string }[] = [];
      for (const { file, content } of contents) {
        assertActive(signal);
        const upload = uploadSchema.parse(
          await options.call("files.getUploadURLExternal", {
            filename: basename(file.path),
            length: content.length,
          }),
        );
        const response = await request(slackUrl(upload.upload_url), {
          method: "POST",
          body: new Uint8Array(content),
          headers: { "Content-Type": "application/octet-stream" },
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        });
        if (!response.ok) throw new BoundaryError("file_upload_failed");
        await response.body?.cancel();
        uploaded.push({ id: upload.file_id, title: file.title ?? basename(file.path) });
      }
      assertActive(signal);
      await options.call("files.completeUploadExternal", {
        files: uploaded,
        channel_id: address.channel,
        thread_ts: address.rootTs,
        initial_comment: text,
      });
    },
  };
}
