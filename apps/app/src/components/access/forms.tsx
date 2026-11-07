import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { message } from "@/lib/api";

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  pattern,
  maxLength,
  minLength,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  pattern?: string;
  maxLength?: number;
  minLength?: number;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        pattern={pattern}
        maxLength={maxLength}
        minLength={minLength}
        className="h-11 w-full rounded-md border border-input bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}
export function ActionForm({
  children,
  submit,
  action,
}: {
  children?: ReactNode;
  submit: string;
  action: (data: FormData) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        const form = event.currentTarget;
        const data = new FormData(form);
        setPending(true);
        setError("");
        try {
          await action(data);
          form.reset();
        } catch (error) {
          setError(message(error));
        } finally {
          setPending(false);
        }
      }}
    >
      {children}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Working…" : submit}
      </Button>
    </form>
  );
}
