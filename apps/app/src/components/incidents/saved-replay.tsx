import { RotateCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LoadingStatus } from "@/components/ui/loading";

export function SavedReplay({ id }: { id: string }) {
  const [state, setState] = useState<"loading" | "ready" | "buffering" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="grid w-full gap-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
        <video
          key={`${id}-${attempt}`}
          controls
          aria-label="Event clip replay"
          preload="metadata"
          className="h-full w-full"
          src={`/api/incidents/evidence/${encodeURIComponent(id)}`}
          onLoadedMetadata={() => setState("ready")}
          onCanPlay={() => setState("ready")}
          onPlaying={() => setState("ready")}
          onWaiting={() => setState("buffering")}
          onError={() => setState("error")}
        >
          <track kind="captions" src="data:text/vtt,WEBVTT" />
          Your browser cannot play this video.
        </video>
        {(state === "loading" || state === "buffering") && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/80 p-5">
            <LoadingStatus label={state === "loading" ? "Loading replay…" : "Buffering replay…"} />
          </div>
        )}
      </div>
      {state === "error" && (
        <div className="grid justify-items-center gap-3">
          <p role="alert" className="text-sm text-destructive">
            The replay could not load. You can still respond to this incident.
          </p>
          <Button
            icon={RotateCw}
            variant="secondary"
            onClick={() => {
              setState("loading");
              setAttempt((value) => value + 1);
            }}
          >
            Retry replay
          </Button>
        </div>
      )}
    </div>
  );
}
