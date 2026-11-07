import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, test } from "vitest";
import { getRouter } from "../../src/router";
import { server } from "../support/server";

const originals = {
  mediaDevices: Object.getOwnPropertyDescriptor(navigator, "mediaDevices"),
  recorder: Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder"),
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
  play: HTMLMediaElement.prototype.play,
  pause: HTMLMediaElement.prototype.pause,
  load: HTMLMediaElement.prototype.load,
  width: Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "videoWidth"),
  height: Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "videoHeight"),
  context: HTMLCanvasElement.prototype.getContext,
  toDataURL: HTMLCanvasElement.prototype.toDataURL,
};

let cameraError: DOMException | null;
let tracksStopped: number;
let recordersStopped: number;
let urlsRevoked: number;
let endCameraTrack: () => void;

class BrowserRecorder {
  state: RecordingState = "inactive";
  mimeType = "video/webm";
  ondataavailable: ((event: BlobEvent) => void) | null = null;

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    recordersStopped += 1;
  }
}

beforeEach(() => {
  server.use(
    http.get("/api/access/principal", () =>
      HttpResponse.json({
        kind: "device",
        deviceId: "camera-one",
        workspaceId: "demo-workspace",
        workspaceName: "Demo workspace",
        name: "Camera one",
      }),
    ),
  );
  cameraError = null;
  tracksStopped = 0;
  recordersStopped = 0;
  urlsRevoked = 0;
  let ended: (() => void) | null = null;
  const track = {
    stop: () => {
      tracksStopped += 1;
    },
    addEventListener: (name: string, handler: () => void) => {
      if (name === "ended") ended = handler;
    },
    removeEventListener: (name: string) => {
      if (name === "ended") ended = null;
    },
  };
  endCameraTrack = () => {
    ended?.();
  };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => {
        if (cameraError) throw cameraError;
        return {
          getTracks: () => [track],
          getVideoTracks: () => [track],
        } as unknown as MediaStream;
      },
    },
  });
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: BrowserRecorder,
  });
  URL.createObjectURL = () => "blob:test-video";
  URL.revokeObjectURL = () => {
    urlsRevoked += 1;
  };
  HTMLMediaElement.prototype.play = async () => {};
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    configurable: true,
    get: () => 640,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    configurable: true,
    get: () => 360,
  });
  HTMLCanvasElement.prototype.getContext = (() =>
    ({
      drawImage: () => {},
    }) as unknown as CanvasRenderingContext2D) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,AAAA";
});

afterEach(() => {
  cleanup();
  if (originals.mediaDevices)
    Object.defineProperty(navigator, "mediaDevices", originals.mediaDevices);
  else Reflect.deleteProperty(navigator, "mediaDevices");
  if (originals.recorder) Object.defineProperty(globalThis, "MediaRecorder", originals.recorder);
  else Reflect.deleteProperty(globalThis, "MediaRecorder");
  URL.createObjectURL = originals.createObjectURL;
  URL.revokeObjectURL = originals.revokeObjectURL;
  HTMLMediaElement.prototype.play = originals.play;
  HTMLMediaElement.prototype.pause = originals.pause;
  HTMLMediaElement.prototype.load = originals.load;
  if (originals.width)
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", originals.width);
  else Reflect.deleteProperty(HTMLVideoElement.prototype, "videoWidth");
  if (originals.height)
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", originals.height);
  else Reflect.deleteProperty(HTMLVideoElement.prototype, "videoHeight");
  HTMLCanvasElement.prototype.getContext = originals.context;
  HTMLCanvasElement.prototype.toDataURL = originals.toDataURL;
});

async function renderDevice() {
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: ["/device"] }),
    scrollRestoration: false,
  });
  await router.load();
  render(<RouterProvider router={router} />, { container: document });
  await screen.findByRole("heading", { name: "Capture station" });
}

test("a camera starts, retains samples, and releases its tracks on Stop", async () => {
  await renderDevice();
  expect(await screen.findByRole("heading", { name: "Capture station" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByRole("button", { name: "Stop" })).toBeVisible();
  expect(screen.getByText("Samples retained").parentElement).toHaveTextContent("1");
  expect(screen.getByText("Last sample").parentElement).not.toHaveTextContent("—");
  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(screen.getByRole("button", { name: "Start" })).toBeVisible();
  expect(tracksStopped).toBe(1);
  expect(recordersStopped).toBe(1);
  expect(screen.getByText("Samples retained").parentElement).toHaveTextContent("0");
});

test("a local video starts and seeking or restarting creates a new capture epoch", async () => {
  await renderDevice();
  await userEvent.click(screen.getByLabelText("Source type"));
  await userEvent.click(await screen.findByRole("option", { name: "Local video" }));
  const file = new File(["video data"], "crash.mp4", { type: "video/mp4" });
  await userEvent.upload(screen.getByLabelText("Video file"), file);
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByRole("button", { name: "Stop" })).toBeVisible();
  expect(screen.getByText("crash.mp4")).toBeVisible();
  expect(screen.getByText("Capture run").parentElement).toHaveTextContent("1");

  screen.getByLabelText("Source video").dispatchEvent(new Event("pause"));
  expect(await screen.findByText("Paused")).toBeVisible();
  expect(screen.getByRole("button", { name: "Stop" })).toBeVisible();

  screen.getByLabelText("Source video").dispatchEvent(new Event("seeking"));
  await waitFor(() => expect(screen.getByText("Capture run").parentElement).toHaveTextContent("2"));
  expect(screen.getByText("Samples retained").parentElement).toHaveTextContent("0");

  screen.getByLabelText("Source video").dispatchEvent(new Event("play"));
  await waitFor(() => expect(screen.getByText("Running")).toBeVisible());

  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(screen.getByText("Capture run").parentElement).toHaveTextContent("3");
  expect(urlsRevoked).toBe(1);
});

test("permission refusal and unavailable cameras show actionable errors", async () => {
  cameraError = new DOMException("Denied", "NotAllowedError");
  await renderDevice();
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Allow access in your browser");
  expect(screen.getByText("Source unavailable")).toBeVisible();

  cameraError = new DOMException("Missing", "NotFoundError");
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No camera was found");
  expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
});

test("a disconnected camera stops monitoring and reports the failure", async () => {
  await renderDevice();
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByRole("button", { name: "Stop" })).toBeVisible();
  endCameraTrack();
  expect(await screen.findByRole("alert")).toHaveTextContent("Camera disconnected");
  expect(screen.getByRole("button", { name: "Start" })).toBeVisible();
  expect(tracksStopped).toBe(1);
});

test("an unpaired visitor cannot open the capture station", async () => {
  server.use(http.get("/api/access/principal", () => HttpResponse.json({ kind: "visitor" })));
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: ["/device"] }),
    scrollRestoration: false,
  });
  await router.load();
  render(<RouterProvider router={router} />, { container: document });
  expect(await screen.findByLabelText("Email")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
});
