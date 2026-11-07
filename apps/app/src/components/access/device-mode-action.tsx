import { useLocation, useNavigate } from "@tanstack/react-router";
import { Monitor } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Member, rememberedDeviceSchema } from "@/lib/access";
import { request, message } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { WorkspaceActions } from "./workspace-actions";

export function DeviceModeAction({
  actor,
  onActivated,
  label = "Switch to device mode",
  compact = true,
}: {
  actor: Member;
  onActivated: () => Promise<void>;
  label?: string;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const lookup = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [lookupState, setLookupState] = useState({ pathname, pending: false, error: "" });
  const pending = lookupState.pathname === pathname && lookupState.pending;
  const error = lookupState.pathname === pathname ? lookupState.error : "";
  useEffect(() => () => lookup.current?.abort(), [pathname]);
  return (
    <>
      <Button
        variant="secondary"
        size={compact ? "sm" : "default"}
        icon={Monitor}
        loading={pending}
        onClick={async () => {
          const controller = new AbortController();
          lookup.current = controller;
          setLookupState({ pathname, pending: true, error: "" });
          try {
            const { device } = await request(
              "/api/access/devices/remembered",
              rememberedDeviceSchema,
              undefined,
              controller.signal,
            );
            if (controller.signal.aborted) return;
            if (device) await navigate({ to: "/device" });
            else if (actor.role === "owner") setOpen(true);
            else await navigate({ to: "/monitor" });
          } catch (error) {
            if (!controller.signal.aborted)
              setLookupState({ pathname, pending: false, error: message(error) });
          } finally {
            if (!controller.signal.aborted)
              setLookupState((current) => ({ ...current, pending: false }));
          }
        }}
      >
        {pending ? "Checking saved device…" : label}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {open && (
        <WorkspaceActions
          action={{ kind: "activate" }}
          onClose={() => setOpen(false)}
          onChanged={onActivated}
          onActivated={onActivated}
        />
      )}
    </>
  );
}
