import { Link } from "@tanstack/react-router";
import { Monitor } from "lucide-react";
import { useState } from "react";
import { type Member } from "@/lib/access";
import { Button, buttonVariants } from "@/components/ui/button";
import { WorkspaceActions } from "./workspace-actions";

export function DeviceModeAction({
  actor,
  onActivated,
}: {
  actor: Member;
  onActivated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  if (actor.role === "operator") {
    return (
      <Link to="/monitor" className={buttonVariants({ variant: "secondary", size: "sm" })}>
        <Monitor aria-hidden="true" />
        Switch to device mode
      </Link>
    );
  }
  return (
    <>
      <Button variant="secondary" size="sm" icon={Monitor} onClick={() => setOpen(true)}>
        Switch to device mode
      </Button>
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
