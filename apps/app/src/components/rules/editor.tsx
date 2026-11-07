import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { request } from "@/lib/api";
import {
  type OperatorConfiguration,
  type Rule,
  ruleInputSchema,
  ruleSchema,
  sourceSchema,
  conditionText,
} from "@/lib/rules";
import { ActionForm } from "@/components/access/forms";

const control =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring";

export function RuleEditor({
  configuration,
  rule,
  onSaved,
  onSourceAdded,
  onCancel,
}: {
  configuration: OperatorConfiguration;
  rule?: Rule;
  onSaved: (rule: Rule) => void;
  onSourceAdded: (source: OperatorConfiguration["sources"][number]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(
    rule
      ? rule.definition.condition.kind === "custom"
        ? rule.definition.condition.text
        : conditionText(rule.definition.condition)
      : "",
  );
  const [exclusions, setExclusions] = useState(
    rule?.definition.condition.kind === "custom"
      ? (rule.definition.condition.exclusions ?? "")
      : "",
  );
  const [name, setName] = useState(rule?.definition.name ?? "");
  const [sourceId, setSourceId] = useState(rule?.sourceId ?? configuration.sources[0]?.id ?? "");
  const [sourceName, setSourceName] = useState("");
  const [sourceKind, setSourceKind] = useState<"camera" | "replay">("camera");
  const [addingSource, setAddingSource] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [showSource, setShowSource] = useState(configuration.sources.length === 0);
  const [severity, setSeverity] = useState(rule?.definition.severity ?? "critical");
  const [duration, setDuration] = useState(String(rule?.definition.durationSeconds ?? ""));
  const [delay, setDelay] = useState(String(rule?.definition.escalationDelaySeconds ?? 60));
  const [recipients, setRecipients] = useState(
    rule?.definition.recipientIds ??
      configuration.recipients
        .filter((person) => person.role === "owner")
        .map((person) => person.userId),
  );
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const sources = configuration.sources.map((source) => ({
    value: source.id,
    label: `${source.name} (${source.kind === "camera" ? "Live camera" : "Replayed footage"})`,
  }));

  return (
    <section aria-label="Trigger editor">
      <ActionForm
        submit={enabled ? "Save enabled" : "Save disabled"}
        pendingLabel="Saving trigger…"
        action={async (data) => {
          const parsed = ruleInputSchema.safeParse({
            sourceId,
            enabled,
            definition: {
              name,
              condition: { kind: "custom", text, exclusions },
              durationSeconds: data.get("duration") ? Number(data.get("duration")) : null,
              severity: data.get("severity"),
              recipientIds: data.getAll("recipientIds"),
              escalationDelaySeconds: Number(data.get("escalationDelay")),
            },
          });
          if (!parsed.success) {
            const first = parsed.error.issues[0];
            const detail = first?.path.includes("recipientIds")
              ? "Choose at least one alert recipient."
              : "Check the trigger fields. Custom descriptions need at least 10 characters.";
            throw new Error(detail);
          }
          const saved = await request(
            rule ? "/api/config/rules/update" : "/api/config/rules/create",
            ruleSchema,
            rule ? { ...parsed.data, id: rule.id, version: rule.version } : parsed.data,
          );
          onSaved(saved);
        }}
      >
        <h3 className="text-base font-semibold">1. Define the incident</h3>
        <label className="grid gap-2 text-sm font-medium">
          Incident name
          <input
            className={control}
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Give this incident a name"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          What should count?
          <textarea
            className={control}
            required
            minLength={10}
            maxLength={1000}
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Describe the action and visible evidence that distinguish it from normal activity."
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          What should not count? (optional)
          <textarea
            className={control}
            maxLength={1000}
            rows={3}
            value={exclusions}
            onChange={(event) => setExclusions(event.target.value)}
            placeholder="Describe similar-looking situations to exclude."
          />
        </label>
        <details className="text-sm text-muted-foreground">
          <summary>How this definition is assessed</summary>
          <p className="mt-2">
            The planned assessment combines your definition and exclusions with the observed frame
            sequence, checks for the event and ambiguous evidence, then reviews candidates before
            confirming an incident. Assessment is not connected yet.
          </p>
        </details>
        <h3 className="border-t pt-5 text-base font-semibold">2. Choose where</h3>
        <div className="grid gap-2 text-sm font-medium">
          <label htmlFor="rule-source">Source</label>
          <Select
            items={sources}
            name="sourceId"
            required
            value={sourceId || null}
            onValueChange={(value) => setSourceId(value ?? "")}
          >
            <SelectTrigger id="rule-source" className={control}>
              <SelectValue placeholder="Choose a source" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">
          Source settings only. Connecting a camera is a separate step.
        </p>
        <details open={showSource} onToggle={(event) => setShowSource(event.currentTarget.open)}>
          <summary className="text-sm">Add a source</summary>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-2 text-sm font-medium">
              Source name
              <input
                className={control}
                maxLength={80}
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
              />
            </label>
            <label htmlFor="inline-source-kind" className="text-sm font-medium">
              Source type
            </label>
            <Select
              items={{ camera: "Live camera", replay: "Replayed footage" }}
              value={sourceKind}
              onValueChange={(value) => {
                if (value === "camera" || value === "replay") setSourceKind(value);
              }}
            >
              <SelectTrigger id="inline-source-kind" className={control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="camera">Live camera</SelectItem>
                <SelectItem value="replay">Replayed footage</SelectItem>
              </SelectContent>
            </Select>
            {sourceError && (
              <p role="alert" className="text-sm text-destructive">
                {sourceError}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={addingSource}
              onClick={async () => {
                if (!sourceName.trim()) {
                  setSourceError("Enter a source name.");
                  return;
                }
                setAddingSource(true);
                setSourceError("");
                try {
                  const source = await request("/api/config/sources", sourceSchema, {
                    name: sourceName,
                    kind: sourceKind,
                  });
                  onSourceAdded(source);
                  setSourceId(source.id);
                  setSourceName("");
                  setShowSource(false);
                } catch (error) {
                  setSourceError(error instanceof Error ? error.message : "Could not add source.");
                } finally {
                  setAddingSource(false);
                }
              }}
            >
              {addingSource ? "Adding source…" : "Add source"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Adding a source saves it to the workspace even if you cancel this trigger.
            </p>
          </div>
        </details>
        <h3 className="border-t pt-5 text-base font-semibold">3. Choose who gets notified</h3>
        <fieldset className="grid gap-3 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">Alert recipients</legend>
          {configuration.recipients.map((person) => (
            <label key={person.userId} className="flex min-h-9 items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="recipientIds"
                value={person.userId}
                checked={recipients.includes(person.userId)}
                onChange={(event) =>
                  setRecipients((current) =>
                    event.target.checked
                      ? [...current, person.userId]
                      : current.filter((id) => id !== person.userId),
                  )
                }
                className="size-4 accent-primary"
              />
              {person.name} ({person.role})
            </label>
          ))}
          {rule?.definition.recipientIds.some(
            (id) => !configuration.recipients.some((person) => person.userId === id),
          ) && (
            <p className="text-sm text-destructive">
              A previous recipient left this workspace. Review recipients before enabling.
            </p>
          )}
        </fieldset>
        <label className="grid gap-2 text-sm font-medium">
          Notify again if nobody acknowledges (seconds)
          <input
            className={control}
            name="escalationDelay"
            type="number"
            required
            min={1}
            max={3600}
            step={1}
            value={delay}
            onChange={(event) => setDelay(event.target.value)}
          />
        </label>
        <p className="text-sm text-muted-foreground">
          One follow-up to these recipients if nobody acknowledges. Follow-up delivery is not
          connected yet.
        </p>
        <details>
          <summary className="text-sm">Timing and urgency</summary>
          <div className="mt-3 grid gap-3">
            {" "}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2 text-sm font-medium">
                <label htmlFor="rule-severity">Severity</label>
                <Select
                  items={{ warning: "Warning", critical: "Critical" }}
                  name="severity"
                  value={severity}
                  onValueChange={(value) => {
                    if (value === "critical" || value === "warning") setSeverity(value);
                  }}
                >
                  <SelectTrigger id="rule-severity" className={control}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="grid gap-2 text-sm font-medium">
                Duration condition (seconds, optional)
                <input
                  className={control}
                  name="duration"
                  type="number"
                  min={1}
                  max={3600}
                  step={1}
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                />
              </label>
            </div>
            <p className="text-sm text-muted-foreground">
              Leave duration empty for an immediate event such as a fall or crash.
            </p>
          </div>
        </details>
        <section aria-label="Review trigger" className="grid gap-3 rounded-lg bg-muted p-4 text-sm">
          <h3 className="font-semibold">4. Review</h3>
          <p aria-live="polite">
            {name.trim()
              ? `When “${name}” is confirmed at ${configuration.sources.find((source) => source.id === sourceId)?.name ?? "your selected source"}, create a ${severity} incident and notify ${
                  configuration.recipients
                    .filter((person) => recipients.includes(person.userId))
                    .map((person) => person.name)
                    .join(", ") || "your selected recipients"
                }.`
              : "Your incident definition will appear here as you write it."}
          </p>
          <p className="whitespace-pre-wrap break-words">{text || "No incident defined yet."}</p>
          {exclusions && <p className="whitespace-pre-wrap break-words">Exclude: {exclusions}</p>}
          <p>{duration ? `Required duration: ${duration} seconds.` : "No minimum duration."}</p>
          <p>One follow-up after {delay || "…"} seconds without acknowledgment.</p>
          <p className="text-muted-foreground">
            Saving configures this trigger. It does not start capture, assessment, or alert
            delivery.
          </p>
        </section>
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            name="enabled"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="size-4 accent-primary"
          />
          Enable this trigger
        </label>
      </ActionForm>
      <Button variant="ghost" className="mt-3 w-full" onClick={onCancel}>
        Cancel editing
      </Button>
    </section>
  );
}

export function RuleSummary({
  rule,
  configuration,
  onEdit,
  onDisabled,
}: {
  rule: Rule;
  configuration: OperatorConfiguration;
  onEdit: (trigger: HTMLButtonElement) => void;
  onDisabled: (rule: Rule) => void;
}) {
  const source = configuration.sources.find((source) => source.id === rule.sourceId);
  return (
    <article
      aria-label={rule.definition.name}
      className="grid gap-4 rounded-xl border border-border bg-card p-6"
    >
      <div className="flex flex-wrap justify-between gap-3">
        <h3 className="font-semibold">{rule.definition.name}</h3>
        <span className="text-sm">
          {rule.enabled ? "Enabled" : "Disabled"} · Version {rule.version}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {source?.name} · {source?.kind === "camera" ? "Live camera" : "Replayed footage"}
      </p>
      <p className="text-sm">{conditionText(rule.definition.condition)}</p>
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="inline text-muted-foreground">Severity </dt>
          <dd className="inline capitalize">{rule.definition.severity}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Recipients </dt>
          <dd className="inline">
            {rule.definition.recipientIds
              .map(
                (id) =>
                  configuration.recipients.find((person) => person.userId === id)?.name ??
                  "Unavailable recipient",
              )
              .join(", ")}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Duration </dt>
          <dd className="inline">
            {rule.definition.durationSeconds === null
              ? "No duration condition"
              : `${rule.definition.durationSeconds} seconds`}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Follow-up </dt>
          <dd className="inline">
            After {rule.definition.escalationDelaySeconds} seconds without acknowledgment
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={(event) => onEdit(event.currentTarget)}
          aria-label={`Edit ${rule.definition.name}`}
        >
          Edit
        </Button>
        {rule.enabled && (
          <ActionForm
            submit={`Disable ${rule.definition.name}`}
            pendingLabel="Disabling trigger…"
            action={async () => {
              onDisabled(
                await request("/api/config/rules/disable", ruleSchema, {
                  id: rule.id,
                  version: rule.version,
                }),
              );
            }}
          />
        )}
      </div>
    </article>
  );
}
