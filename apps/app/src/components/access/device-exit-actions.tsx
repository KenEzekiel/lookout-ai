import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Trash2, X } from "lucide-react";
import { useState } from "react";
import { mutate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ActionForm } from "./forms";

export function DeviceExitActions() {
  const navigate = useNavigate();
  const [forgetting, setForgetting] = useState(false);
  async function leave(path: string) {
    await mutate(path);
    await navigate({ to: "/devices" });
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionForm
        icon={ArrowLeft}
        submit="Return to workspace"
        pendingLabel="Returning…"
        variant="secondary"
        size="sm"
        action={() => leave("/api/access/devices/leave")}
      />
      <Button icon={Trash2} variant="ghost" size="sm" onClick={() => setForgetting(true)}>
        Forget this device
      </Button>
      <Dialog open={forgetting} onOpenChange={setForgetting}>
        <DialogContent>
          <DialogTitle>Forget this device?</DialogTitle>
          <DialogDescription>
            This removes the saved pairing from this browser. Your workspace login stays signed in.
            An owner must pair this browser again to resume capture.
          </DialogDescription>
          <ActionForm
            icon={Trash2}
            submit="Forget device"
            pendingLabel="Forgetting…"
            variant="destructive"
            action={() => leave("/api/access/devices/forget")}
          />
          <DialogClose render={<Button variant="ghost" icon={X} />}>Cancel</DialogClose>
        </DialogContent>
      </Dialog>
    </div>
  );
}
