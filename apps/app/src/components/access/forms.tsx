import { useId, useState, type ReactNode, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { message } from "@/lib/api";

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-sm py-8 sm:py-14">
      <h1 className="mb-3 text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </section>
  );
}
export function Field({
  label,
  hint,
  ...props
}: ComponentProps<"input"> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        required
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
        className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm transition-colors placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
export function ActionForm({
  children,
  submit,
  pendingLabel,
  action,
  variant = "default",
  compact = false,
}: {
  children?: ReactNode;
  submit: string;
  pendingLabel: string;
  action: (data: FormData) => Promise<void>;
  variant?: ComponentProps<typeof Button>["variant"];
  compact?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="grid gap-5"
      aria-busy={pending}
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
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        variant={variant}
        disabled={pending}
        className={compact ? "h-9 px-3" : "h-11 px-4"}
      >
        {pending ? pendingLabel : submit}
      </Button>
    </form>
  );
}
