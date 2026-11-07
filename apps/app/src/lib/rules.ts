import { z } from "zod";

export const ruleTemplates = {
  fall: { name: "Possible fall", text: "A person falls to the ground and may need help." },
  crash: {
    name: "Possible crash",
    text: "Vehicles collide or a vehicle crashes into an obstacle.",
  },
};
export const sourceInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["camera", "replay"]),
});
export const sourceSchema = sourceInputSchema.extend({ id: z.string().min(1) });
export const ruleDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  condition: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("template"), template: z.enum(["fall", "crash"]) }),
    z.object({
      kind: z.literal("custom"),
      text: z.string().trim().min(10).max(1000),
      exclusions: z.string().trim().max(1000).optional(),
    }),
  ]),
  durationSeconds: z.number().int().min(1).max(3600).nullable(),
  severity: z.enum(["warning", "critical"]),
  recipientIds: z
    .array(z.string().min(1))
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length),
  escalationDelaySeconds: z.number().int().min(1).max(3600),
});
export const ruleInputSchema = z.object({
  sourceId: z.string().min(1),
  enabled: z.boolean(),
  definition: ruleDefinitionSchema,
});
export const ruleVersionSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
});
export const ruleUpdateSchema = ruleInputSchema.extend(ruleVersionSchema.shape);
export const ruleSchema = ruleUpdateSchema;
export const deviceConfigurationSchema = z.object({
  sources: z.array(sourceSchema),
  rules: z.array(ruleSchema),
});
export const operatorConfigurationSchema = deviceConfigurationSchema.extend({
  recipients: z.array(
    z.object({ userId: z.string(), name: z.string(), role: z.enum(["owner", "operator"]) }),
  ),
});
export type Rule = z.infer<typeof ruleSchema>;
export type RuleInput = z.infer<typeof ruleInputSchema>;
export type DeviceConfiguration = z.infer<typeof deviceConfigurationSchema>;
export type OperatorConfiguration = z.infer<typeof operatorConfigurationSchema>;
export function conditionText(condition: Rule["definition"]["condition"]) {
  return condition.kind === "template"
    ? ruleTemplates[condition.template].text
    : [condition.text, condition.exclusions ? `Exclude: ${condition.exclusions}` : ""]
        .filter(Boolean)
        .join("\n");
}
