import { LogIn, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { mutate } from "@/lib/api";
import { ActionForm, Field, Panel } from "./forms";

export function Account({
  onSignedIn,
  invitation,
}: {
  onSignedIn: () => Promise<void>;
  invitation?: string;
}) {
  const [register, setRegister] = useState(false);
  return (
    <Panel title={register ? "Create your account" : "Welcome back"}>
      <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
        {invitation
          ? "Sign in or create an account to accept your invitation."
          : register
            ? "A place for your team and monitoring devices."
            : "Sign in to manage your workspace."}
      </p>
      <ActionForm
        key={register ? "register" : "signin"}
        icon={register ? UserPlus : LogIn}
        submit={register ? "Create account" : "Sign in"}
        pendingLabel={register ? "Creating account…" : "Signing in…"}
        action={async (data) => {
          await mutate(`/api/auth/${register ? "sign-up" : "sign-in"}/email`, {
            email: data.get("email"),
            password: data.get("password"),
            ...(register ? { name: data.get("name") } : {}),
          });
          await onSignedIn();
        }}
      >
        {register && <Field label="Your name" name="name" autoComplete="name" maxLength={80} />}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={register ? "new-password" : "current-password"}
          minLength={8}
          maxLength={128}
          hint={
            register
              ? "Use at least 8 characters. Password reset is not available yet, so keep your password safe."
              : undefined
          }
        />
      </ActionForm>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {register ? "Already have an account?" : "New to Lookout?"}{" "}
        <Button
          variant="link"
          size="inline"
          icon={register ? LogIn : UserPlus}
          className="text-signal"
          onClick={() => setRegister(!register)}
        >
          {register ? "Sign in" : "Create an account"}
        </Button>
      </p>
      <div className="mt-10 border-t border-border pt-6 text-center text-sm">
        <Link to="/monitor" className="text-muted-foreground hover:text-foreground">
          Set up this device
        </Link>
      </div>
    </Panel>
  );
}
