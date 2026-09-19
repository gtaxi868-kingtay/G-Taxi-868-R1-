// Schema validation for G's propose_action payloads and g_execute_action's
// handler inputs. Closes a real gap: validation before this was manual
// field-presence checks only ("is this key present and non-empty?"), with
// no type/shape checking — an LLM tool-call could put a string where a
// dollar amount belongs, or a malformed value where a foreign-key id
// belongs, and nothing caught it before it reached a real RPC.
//
// This does not attempt a full per-action-type schema (that would need
// g_action_types.payload_schema to carry real type info, not just a
// required-keys list — a bigger migration than this pass is scoped for).
// Instead it validates the two shapes that actually matter for safety
// everywhere they appear, by naming convention already used consistently
// across this codebase's payloads: any `*_cents` key is a real amount, any
// `*_id` key is a real foreign-key reference.
import { z } from "https://esm.sh/zod@3.23.8";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const proposeActionInputSchema = z.object({
  action_type: z.string().min(1),
  title: z.string().min(1),
  reasoning: z.string().min(1),
  category: z.enum(["money", "people", "public", "config", "other"]),
  amount_cents: z.number().finite().nonnegative().optional(),
  payload: z.record(z.unknown()).default({}),
});

/**
 * Validates payload values against their key's naming convention. Returns a
 * list of human-readable violations (empty = valid). Not exhaustive by
 * design — it only checks the two conventions ("*_cents" is money,
 * "*_id" is a foreign key) that are safety-relevant everywhere they occur,
 * not every field's exact business meaning.
 */
export function validateActionPayloadShape(payload: Record<string, unknown>): string[] {
  const violations: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) continue;

    if (key.endsWith("_cents")) {
      if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
        violations.push(`${key} must be a whole number of cents, got ${JSON.stringify(value)}`);
      } else if (value < 0) {
        violations.push(`${key} must not be negative, got ${value}`);
      }
    }

    if (key.endsWith("_id") && key !== "action_type_id") {
      if (typeof value !== "string" || !UUID_RE.test(value)) {
        violations.push(`${key} must be a valid UUID, got ${JSON.stringify(value)}`);
      }
    }
  }
  return violations;
}
