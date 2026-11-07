import { LoadingStatus } from "@/components/ui/loading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "@tanstack/react-router";
import { Activity, Camera, Clock3, FileVideo, Play, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MonitoringControls } from "@/components/device-monitoring";
import { type DeviceMonitoring } from "@/lib/device-monitoring";
import { LiveSource } from "@/components/live-source";
import { Brand } from "@/components/access/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SourcePreviewFrame } from "@/components/source-preview-frame";
import {
  CaptureSession,
  initialCaptureSnapshot,
  type CaptureIdentity,
  type CaptureSnapshot,
} from "@/lib/capture-session";
import { cn } from "@/lib/utils";

type SourceChoice = "camera" | "file";

const panelClass = "rounded-[18px] bg-card p-5 ring-1 ring-white/[0.07]";
const selectClass = cn(
  "h-10 w-full rounded-xl border border-border bg-surface-raised px-3",
  "text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

export function DeviceScreen({ deviceId, workspaceId }: CaptureIdentity) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<CaptureSession | null>(null);
  const monitoringRef = useRef<DeviceMonitoring | null>(null);
  const onMonitoringController = useCallback((controller: DeviceMonitoring | null) => {
    monitoringRef.current = controller;
  }, []);
  const [snapshot, setSnapshot] = useState<CaptureSnapshot>(initialCaptureSnapshot);
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>("camera");
  const [cameraFacing, setCameraFacing] = useState<"user" | "environment">("environment");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const running = snapshot.state === "running";
  const paused = snapshot.state === "paused";
  const starting = snapshot.state === "starting";
  const hasError = snapshot.state === "error";

  useEffect(() => {
    if (!videoRef.current) return;
    const session = new CaptureSession(
      videoRef.current,
      (next) => {
        monitoringRef.current?.captureChanged();
        setSnapshot(next);
      },
      { deviceId, workspaceId },
    );
    sessionRef.current = session;
    const stopWhenHidden = () => {
      if (document.hidden) session.stop();
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", stopWhenHidden);
      session.dispose();
      sessionRef.current = null;
    };
  }, [deviceId, workspaceId]);

  function changeSource(next: SourceChoice) {
    sessionRef.current?.stop();
    setSourceChoice(next);
    setSelectedFile(null);
  }

  function start() {
    if (sourceChoice === "camera") void sessionRef.current?.startCamera(cameraFacing);
    else if (selectedFile) void sessionRef.current?.startFile(selectedFile);
  }

  const statusTitle = hasError
    ? "Source needs attention"
    : running
      ? "Capture running"
      : paused
        ? "Playback paused"
        : starting
          ? "Connecting source"
          : "Capture stopped";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/[0.07] bg-background">
        <div className="mx-auto flex h-[76px] max-w-[1680px] items-center px-5 sm:px-9">
          <Link
            to="/"
            aria-label="Lookout home"
            className={cn(
              "inline-flex items-center gap-2.5 text-[23px] font-semibold tracking-[-0.055em]",
              "text-foreground focus-visible:outline-2 focus-visible:outline-ring",
            )}
          >
            <Brand />
          </Link>
          <span className="mx-6 hidden h-6 w-px bg-white/10 sm:block" />
          <span className="hidden text-sm text-muted-foreground sm:block">Operational device</span>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-4 pt-7 pb-10 sm:px-6 sm:pt-9 lg:px-9">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-page-title">Capture station</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Connect a camera or play a local video on this device.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.94fr)_minmax(330px,1fr)]">
          <section className="min-w-0" aria-label="Source preview">
            <div className="mb-3.5 flex min-h-[30px] items-center gap-2.5">
              <span className="grid size-7 place-items-center rounded-lg bg-surface-raised text-muted-foreground">
                <Camera size={17} />
              </span>
              <h2 className="text-panel-title">Source preview</h2>
              <span className="rounded-lg bg-surface-raised px-2 py-1 text-xs text-muted-foreground">
                {sourceChoice === "camera"
                  ? running
                    ? "Live camera"
                    : "Camera"
                  : "Replay · local video"}
              </span>
            </div>

            <SourcePreviewFrame className="aspect-video min-h-[180px]">
              <video
                ref={videoRef}
                aria-label="Source video"
                playsInline
                muted
                controls={sourceChoice === "file" && (running || paused)}
                className={cn(
                  "absolute inset-0 h-full w-full bg-black object-contain",
                  running || paused || starting ? "block" : "hidden",
                )}
              />
              {!running && !paused && !starting && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-7 text-center">
                  <span className="grid size-16 place-items-center rounded-[20px] bg-white/10 text-muted-foreground ring-1 ring-white/10">
                    {sourceChoice === "camera" ? <Camera size={27} /> : <FileVideo size={27} />}
                  </span>
                  <strong className="mt-2 text-xl font-semibold tracking-[-0.025em]">
                    {hasError ? "Source unavailable" : "No source running"}
                  </strong>
                  <span className="max-w-sm text-sm leading-relaxed text-[#bec8cb]">
                    {hasError
                      ? snapshot.error
                      : sourceChoice === "camera"
                        ? "Start capture to preview a permitted camera."
                        : "Choose a local video, then start playback."}
                  </span>
                </div>
              )}
              {starting && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center">
                  <LoadingStatus label="Connecting source…" />
                  <p className="max-w-xs text-sm text-muted-foreground">
                    {sourceChoice === "camera"
                      ? "Allow camera access if your browser asks. You can stop while connecting."
                      : "Opening your local video. You can stop while connecting."}
                  </p>
                </div>
              )}
              <div
                className={cn(
                  "absolute top-4 right-4 z-10 rounded-lg border border-white/10",
                  "bg-[#0d1114]/75 px-3 py-2 text-xs text-white backdrop-blur-sm",
                )}
              >
                {starting
                  ? "Connecting source"
                  : running
                    ? "Capture running"
                    : paused
                      ? "Playback paused"
                      : "Capture stopped"}
              </div>
            </SourcePreviewFrame>

            <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="grid size-9 place-items-center rounded-xl bg-surface-raised">
                {sourceChoice === "camera" ? <Camera size={18} /> : <FileVideo size={18} />}
              </span>
              <div className="flex flex-col gap-0.5">
                <strong className="font-medium text-foreground">
                  {sourceChoice === "camera"
                    ? "Browser camera"
                    : (selectedFile?.name ?? "Local video")}
                </strong>
                <span>
                  {running
                    ? "Captured on this device"
                    : paused
                      ? "Playback paused"
                      : "Not monitoring"}
                </span>
              </div>
            </div>
          </section>

          <aside
            className="grid min-w-0 gap-4 md:grid-cols-2 lg:mt-11 lg:flex lg:flex-col"
            aria-label="Capture controls and status"
          >
            <section className={panelClass}>
              <MonitoringControls
                session={sessionRef}
                snapshot={snapshot}
                onController={onMonitoringController}
              />
            </section>
            <section className={panelClass}>
              <div className="flex items-center gap-2.5 text-muted-foreground">
                <Activity size={16} />
                <h2 className="text-panel-title text-foreground">Capture controls</h2>
              </div>
              <div className="mt-6 flex items-center justify-between gap-3">
                <strong key={statusTitle} className="motion-feedback text-panel-title">
                  {statusTitle}
                </strong>
                <Badge
                  className={cn(
                    "h-[23px] px-2 text-xs",
                    running
                      ? "bg-resolved/10 text-resolved"
                      : hasError
                        ? "bg-critical/10 text-critical"
                        : paused
                          ? "bg-incident/10 text-incident"
                          : "bg-muted text-muted-foreground",
                  )}
                >
                  {running
                    ? "Running"
                    : hasError
                      ? "Error"
                      : paused
                        ? "Paused"
                        : starting
                          ? "Starting"
                          : "Stopped"}
                </Badge>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {running
                  ? "Authorized operators can view the active source. Choose an assigned source to enable AI monitoring."
                  : paused
                    ? "Playback is paused. Resume in the video controls or stop capture."
                    : (snapshot.error ?? "Select a source and start capture when it is ready.")}
              </p>

              <div className="mt-5 flex flex-col gap-2">
                <label className="text-sm text-muted-foreground" htmlFor="source-kind">
                  Source type
                </label>
                <Select<SourceChoice>
                  items={{ camera: "Camera", file: "Local video" }}
                  value={sourceChoice}
                  onValueChange={(value) => {
                    if (value) changeSource(value);
                  }}
                >
                  <SelectTrigger id="source-kind" className={selectClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="camera">Camera</SelectItem>
                    <SelectItem value="file">Local video</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {sourceChoice === "camera" && (
                <div className="mt-4 flex flex-col gap-2">
                  <label className="text-xs text-muted-foreground" htmlFor="camera-facing">
                    Camera direction
                  </label>
                  <Select<"user" | "environment">
                    value={cameraFacing}
                    items={{ environment: "Rear camera", user: "Front camera" }}
                    onValueChange={(value) => {
                      if (!value) return;
                      setCameraFacing(value);
                      if (running || starting) void sessionRef.current?.startCamera(value);
                    }}
                  >
                    <SelectTrigger id="camera-facing" className={selectClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="environment">Rear camera</SelectItem>
                      <SelectItem value="user">Front camera</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Switching restarts capture. If unavailable, your browser uses another camera.
                  </p>
                </div>
              )}
              {sourceChoice === "file" && (
                <div className="motion-reveal mt-4 flex flex-col gap-2">
                  <label className="text-sm text-muted-foreground" htmlFor="video-file">
                    Video file
                  </label>
                  <input
                    id="video-file"
                    type="file"
                    accept="video/*"
                    className={cn(
                      "w-full rounded-xl border border-border bg-surface-raised p-2 text-xs text-foreground",
                      "file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-1.5",
                      "file:text-xs file:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                    onChange={(event) => {
                      sessionRef.current?.stop();
                      setSelectedFile(event.target.files?.[0] ?? null);
                    }}
                  />
                </div>
              )}

              <div className="mt-5">
                {running || paused || starting ? (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => sessionRef.current?.stop()}
                  >
                    <Square aria-hidden="true" fill="currentColor" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    disabled={sourceChoice === "file" && !selectedFile}
                    onClick={start}
                  >
                    <Play aria-hidden="true" fill="currentColor" />
                    Start
                  </Button>
                )}
              </div>
              {hasError && (
                <p role="alert" className="mt-3 text-xs text-critical">
                  {snapshot.error}
                </p>
              )}
            </section>

            <LiveSource session={sessionRef} snapshot={snapshot} />
            <section className={panelClass}>
              <div className="flex items-center gap-2.5 text-muted-foreground">
                <Clock3 size={16} />
                <h2 className="text-panel-title text-foreground">Recent footage</h2>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                Kept in this browser while capture runs.
              </p>
              <div className="mt-5 flex flex-col gap-3 text-xs">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Capture run</span>
                  <strong className="font-medium tabular-nums">{snapshot.epoch || "—"}</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Samples retained</span>
                  <strong className="font-medium tabular-nums">{snapshot.sampleCount}</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Last sample</span>
                  <strong className="font-medium tabular-nums">
                    {snapshot.lastSampleAt
                      ? new Date(snapshot.lastSampleAt).toLocaleTimeString()
                      : "—"}
                  </strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Recent video</span>
                  <strong className="font-medium tabular-nums">
                    {snapshot.bufferedSeconds.toFixed(0)}s / 30s
                  </strong>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
