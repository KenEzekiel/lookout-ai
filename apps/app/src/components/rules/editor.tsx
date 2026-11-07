import { useState } from "react";
import { Button } from "@/components/ui/button";
import { request } from "@/lib/api";
import {
  type OperatorConfiguration,
  type Rule,
  ruleInputSchema,
  ruleSchema,
  ruleTemplates,
  conditionText,
} from "@/lib/rules";
import { ActionForm } from "@/components/access/forms";

const control =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring";

export function RuleEditor({
  configuration,
  rule,
  onSaved,
  onCancel,
}: {
  configuration: OperatorConfiguration;
  rule?: Rule;
  onSaved: (rule: Rule) => void;
  onCancel: () => void;
}) {
  const [condition, setCondition] = useState<Rule["definition"]["condition"]>(
    rule?.definition.condition ?? { kind: "template", template: "fall" },
  );
  const [name, setName] = useState(rule?.definition.name ?? ruleTemplates.fall.name);
  const defaultRecipient = configuration.recipients.find((person) => person.role === "owner");
  return (
    <section aria-label="Trigger editor">
      <ActionForm
        submit="Save trigger"
        pendingLabel="Saving trigger…"
        action={async (data) => {
          const parsed = ruleInputSchema.safeParse({
            sourceId: data.get("sourceId"),
            enabled: data.get("enabled") === "on",
            definition: {
              name,
              condition,
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
        <label className="grid gap-2 text-sm font-medium">
          Start from
          <select
            className={control}
            value={condition.kind === "template" ? condition.template : "custom"}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "custom") {
                setCondition({ kind: "custom", text: "" });
                setName("");
              } else if (value === "fall" || value === "crash") {
                setCondition({ kind: "template", template: value });
                setName(ruleTemplates[value].name);
              }
            }}
          >
            {Object.entries(ruleTemplates).map(([key, template]) => (
              <option key={key} value={key}>
                {template.name}
              </option>
            ))}
            <option value="custom">Custom description</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Trigger name
          <input
            className={control}
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {condition.kind === "custom" ? (
          <label className="grid gap-2 text-sm font-medium">
            Observable event
            <textarea
              className={control}
              required
              minLength={10}
              maxLength={1000}
              rows={3}
              value={condition.text}
              onChange={(event) => setCondition({ kind: "custom", text: event.target.value })}
            />
          </label>
        ) : (
          <p className="rounded-md bg-muted p-3 text-sm">{conditionText(condition)}</p>
        )}
        <label className="grid gap-2 text-sm font-medium">
          Source
          <select
            className={control}
            name="sourceId"
            required
            defaultValue={rule?.sourceId ?? configuration.sources[0]?.id ?? ""}
          >
            <option value="" disabled>
              Choose a source
            </option>
            {configuration.sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name} ({source.kind === "camera" ? "Live camera" : "Replayed footage"})
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            Severity
            <select
              className={control}
              name="severity"
              defaultValue={rule?.definition.severity ?? "critical"}
            >
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Duration condition (seconds, optional)
            <input
              className={control}
              name="duration"
              type="number"
              min={1}
              max={3600}
              step={1}
              defaultValue={rule?.definition.durationSeconds ?? ""}
            />
          </label>
        </div>
        <p className="text-sm text-muted-foreground">
          Leave duration empty for an immediate event such as a fall or crash.
        </p>
        <fieldset className="grid gap-3 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">Alert recipients</legend>
          {configuration.recipients.map((person) => (
            <label key={person.userId} className="flex min-h-9 items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="recipientIds"
                value={person.userId}
                defaultChecked={
                  rule
                    ? rule.definition.recipientIds.includes(person.userId)
                    : person.userId === defaultRecipient?.userId
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
          Escalation delay (seconds)
          <input
            className={control}
            name="escalationDelay"
            type="number"
            required
            min={1}
            max={3600}
            step={1}
            defaultValue={rule?.definition.escalationDelaySeconds ?? 60}
          />
        </label>
        <p className="text-sm text-muted-foreground">
          One follow-up to these recipients if nobody acknowledges. Alert delivery is not connected
          yet.
        </p>
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={rule?.enabled ?? true}
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
