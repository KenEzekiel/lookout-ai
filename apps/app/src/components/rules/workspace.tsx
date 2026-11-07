import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ActionForm, Field } from "@/components/access/forms";
import { request, message } from "@/lib/api";
import {
  type OperatorConfiguration,
  type Rule,
  operatorConfigurationSchema,
  sourceSchema,
} from "@/lib/rules";
import { RuleEditor, RuleSummary } from "./editor";

export function RuleWorkspace() {
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const [configuration, setConfiguration] = useState<OperatorConfiguration>();
  const [editor, setEditor] = useState<
    { kind: "closed" } | { kind: "new" } | { kind: "edit"; rule: Rule }
  >({ kind: "closed" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function reload() {
    const next = await request("/api/config/operator", operatorConfigurationSchema);
    setConfiguration(next);
    setEditor({ kind: "closed" });
    setError("");
  }
  useEffect(() => {
    let active = true;
    void request("/api/config/operator", operatorConfigurationSchema)
      .then((next) => {
        if (active) setConfiguration(next);
      })
      .catch((error) => {
        if (active) setError(message(error));
      });
    return () => {
      active = false;
    };
  }, []);
  function saved(rule: Rule) {
    setConfiguration(
      (current) =>
        current && {
          ...current,
          rules: current.rules.some((item) => item.id === rule.id)
            ? current.rules.map((item) => (item.id === rule.id ? rule : item))
            : [...current.rules, rule],
        },
    );
    setEditor({ kind: "closed" });
    setNotice(
      `${rule.definition.name} saved. ${rule.enabled ? "Enabled" : "Disabled"} at version ${rule.version}.`,
    );
  }
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Triggers</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Define what matters for each source in your workspace.
          </p>
        </div>
        <div className="flex gap-3">
          <ActionForm submit="Reload triggers" pendingLabel="Reloading triggers…" action={reload} />
          <Button
            disabled={!configuration}
            onClick={(event) => {
              editorTrigger.current = event.currentTarget;
              setEditor({ kind: "new" });
              setNotice("");
            }}
          >
            New trigger
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!configuration && !error && <output>Loading triggers…</output>}
      {notice && (
        <output className="rounded-md border border-border bg-card p-4 text-sm">{notice}</output>
      )}
      {configuration && (
        <>
          <details
            open={configuration.sources.length === 0}
            className="rounded-xl border border-border bg-card p-6"
          >
            <summary className="cursor-pointer font-medium">
              Sources ({configuration.sources.length})
            </summary>
            <p className="my-4 text-sm text-muted-foreground">
              Name a source for its trigger settings. Capture station uses its own camera or video
              selection for now.
            </p>
            <ul className="mb-5 grid gap-2 text-sm">
              {configuration.sources.map((source) => (
                <li key={source.id}>
                  {source.name} · {source.kind === "camera" ? "Live camera" : "Replayed footage"}
                </li>
              ))}
            </ul>
            <ActionForm
              submit="Add source"
              pendingLabel="Adding source…"
              action={async (data) => {
                const source = await request("/api/config/sources", sourceSchema, {
                  name: data.get("name"),
                  kind: data.get("kind"),
                });
                setConfiguration(
                  (current) => current && { ...current, sources: [...current.sources, source] },
                );
                setNotice(`${source.name} added. You can now create its trigger.`);
              }}
            >
              <Field label="Source name" name="name" maxLength={80} />
              <div className="grid gap-2 text-sm font-medium">
                <label htmlFor="rule-source-type">Source type</label>
                <Select
                  items={{ camera: "Live camera", replay: "Replayed footage" }}
                  name="kind"
                  defaultValue="camera"
                >
                  <SelectTrigger
                    id="rule-source-type"
                    className="h-11 w-full rounded-md border border-input bg-background px-3"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="camera">Live camera</SelectItem>
                    <SelectItem value="replay">Replayed footage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </ActionForm>
          </details>
          {configuration.rules.length === 0 && editor.kind === "closed" && (
            <p className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
              No triggers yet.{" "}
              {configuration.sources.length
                ? "Choose New trigger to define an event and its recipients."
                : "Choose New trigger to define an incident and add its source."}
            </p>
          )}
          {editor.kind !== "closed" && (
            <Dialog
              open
              onOpenChange={(open) => {
                if (!open) setEditor({ kind: "closed" });
              }}
            >
              <DialogContent
                finalFocus={editorTrigger}
                className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:max-w-xl"
              >
                <DialogTitle className="pr-6 text-xl font-semibold">
                  {editor.kind === "edit" ? "Edit trigger" : "New trigger"}
                </DialogTitle>
                <DialogDescription>
                  Define the incident, choose a source, and review who should receive the alert.
                </DialogDescription>
                <RuleEditor
                  key={editor.kind === "edit" ? editor.rule.id : "new"}
                  configuration={configuration}
                  rule={editor.kind === "edit" ? editor.rule : undefined}
                  onSourceAdded={(source) =>
                    setConfiguration(
                      (current) => current && { ...current, sources: [...current.sources, source] },
                    )
                  }
                  onSaved={saved}
                  onCancel={() => setEditor({ kind: "closed" })}
                />
              </DialogContent>
            </Dialog>
          )}
          <div className="grid items-start gap-6 md:grid-cols-2">
            {configuration.rules.map((rule) => (
              <RuleSummary
                key={rule.id}
                rule={rule}
                configuration={configuration}
                onEdit={(trigger) => {
                  editorTrigger.current = trigger;
                  setEditor({ kind: "edit", rule });
                  setNotice("");
                }}
                onDisabled={saved}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
