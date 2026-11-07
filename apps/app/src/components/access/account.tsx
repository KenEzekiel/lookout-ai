import { useState } from "react";
import { Button } from "@/components/ui/button";
import { mutate } from "@/lib/api";
import { ActionForm, Field, Panel } from "./forms";

export function Account({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [register, setRegister] = useState(false);
  return (
    <div className="mx-auto max-w-md">
      <Panel title={register ? "Create your account" : "Sign in to your workspace"}>
        <p className="mb-6 text-sm text-muted-foreground">
          {register
            ? "Create a workspace or join your team after signing up. This demo does not offer password recovery."
            : "Manage your team and authorize monitoring devices."}
        </p>
        <ActionForm
          submit={register ? "Create account" : "Sign in"}
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
          <Field label="Email" name="email" type="email" autoComplete="email" />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            minLength={8}
            maxLength={128}
          />
        </ActionForm>
        <Button className="mt-4 w-full" variant="ghost" onClick={() => setRegister(!register)}>
          {register ? "Already have an account? Sign in" : "New here? Create an account"}
        </Button>
      </Panel>
    </div>
  );
}
