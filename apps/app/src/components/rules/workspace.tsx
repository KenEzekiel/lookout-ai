import { useEffect, useState } from "react";
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
          <ActionForm submit="Reload triggers" action={reload} />
          <Button
            disabled={!configuration?.sources.length}
            onClick={() => {
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
              <label className="grid gap-2 text-sm font-medium">
                Source type
                <select
                  name="kind"
                  className="h-11 rounded-md border border-input bg-background px-3"
                >
                  <option value="camera">Live camera</option>
                  <option value="replay">Replayed footage</option>
                </select>
              </label>
            </ActionForm>
          </details>
          {configuration.rules.length === 0 && editor.kind === "closed" && (
            <p className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
              No triggers yet.{" "}
              {configuration.sources.length
                ? "Choose New trigger to define an event and its recipients."
                : "Add a source to create your first trigger."}
            </p>
          )}
          {editor.kind !== "closed" && (
            <RuleEditor
              key={editor.kind === "edit" ? editor.rule.id : "new"}
              configuration={configuration}
              rule={editor.kind === "edit" ? editor.rule : undefined}
              onSaved={saved}
              onCancel={() => setEditor({ kind: "closed" })}
            />
          )}
          <div className="grid items-start gap-6 md:grid-cols-2">
            {configuration.rules.map((rule) => (
              <RuleSummary
                key={rule.id}
                rule={rule}
                configuration={configuration}
                onEdit={() => {
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
