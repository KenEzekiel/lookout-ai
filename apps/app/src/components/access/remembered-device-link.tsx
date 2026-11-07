import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { rememberedDeviceSchema, type DevicePrincipal } from "@/lib/access";
import { request, message } from "@/lib/api";
import { LoadingStatus } from "@/components/ui/loading";
import { Button, buttonVariants } from "@/components/ui/button";

export function RememberedDeviceLink() {
  const [device, setDevice] = useState<DevicePrincipal | null>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void request(
      "/api/access/devices/remembered",
      rememberedDeviceSchema,
      undefined,
      controller.signal,
    )
      .then(({ device }) => {
        setDevice(device);
        setError("");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => controller.abort();
  }, [attempt]);
  if (error)
    return (
      <div className="mt-4">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        <Button
          variant="link"
          onClick={() => {
            setError("");
            setAttempt(attempt + 1);
          }}
        >
          Check saved device again
        </Button>
      </div>
    );
  if (device === undefined)
    return (
      <div className="mt-4">
        <LoadingStatus label="Checking saved device…" />
      </div>
    );
  return (
    device && (
      <Link
        to="/device"
        className={buttonVariants({ variant: "secondary", className: "mt-4 flex" })}
      >
        Resume {device.name}
      </Link>
    )
  );
}
