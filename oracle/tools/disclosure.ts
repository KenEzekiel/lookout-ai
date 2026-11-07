import { readFile } from "node:fs/promises";
import { z } from "zod";
import { BoundaryError } from "../session/domain.js";

const policySchema = z.object({ blockedTerms: z.array(z.string().min(3).max(500)).max(2000) });
const rules = [
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/i,
  /\bxapp-[A-Za-z0-9-]{10,}/i,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:^|[\s"'`(])\/(?:Users|home|private|var|tmp|etc|opt|Volumes|mnt|root|srv|workspace)\/[\w./ -]+/im,
  /\b[A-Za-z]:\\(?:[^\s\\]+\\)+[^\s]*/,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*["']?[A-Za-z0-9_+/=-]{16,}/i,
];

export interface Disclosure {
  findings(text: string): readonly string[];
  assert(text: string): string;
}

export function createDisclosure(blockedTerms: readonly string[] = []): Disclosure {
  const terms = blockedTerms.map((term) => term.normalize("NFKC").toLowerCase());
  const findings = (text: string): readonly string[] => {
    const normalized = text.normalize("NFKC").toLowerCase();
    const matches = rules.flatMap((rule, index) =>
      rule.test(text) ? [`pattern_${index + 1}`] : [],
    );
    if (terms.some((term) => normalized.includes(term))) matches.push("blocked_term");
    return matches;
  };
  return {
    findings,
    assert(text) {
      if (findings(text).length > 0) throw new BoundaryError("disclosure_refused");
      return text;
    },
  };
}

export async function loadDisclosure(
  path: string,
  secrets: readonly string[] = [],
): Promise<Disclosure> {
  try {
    const policy = policySchema.parse(JSON.parse(await readFile(path, "utf8")));
    return createDisclosure([...policy.blockedTerms, ...secrets]);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return createDisclosure(secrets);
    }
    throw new BoundaryError("disclosure_policy_invalid");
  }
}
