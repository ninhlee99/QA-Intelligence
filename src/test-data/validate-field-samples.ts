/**
 * Validate synthetic field_samples for TestDataset registry.
 * Rejects credential-shaped keys/values; samples allowed only for synthetic class.
 */
import type { TestDataClassification } from "./public.js";

const SENSITIVE_KEY =
  /password|passwd|secret|token|api[_-]?key|credential|bearer|private[_-]?key|auth[_-]?header|session[_-]?id/i;

const SECRET_PREFIX =
  /^(sk-|ghp_|xox[baprs]-|AKIA|ya29\.|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)/;

export type FieldSamplesValidation =
  | Readonly<{ ok: true; samples: Readonly<Record<string, string>> }>
  | Readonly<{ ok: false; message: string }>;

export function validateSyntheticFieldSamples(input: Readonly<{
  classification: TestDataClassification;
  field_samples: Readonly<Record<string, string>> | undefined;
}>): FieldSamplesValidation {
  if (input.field_samples === undefined) {
    return { ok: true, samples: {} };
  }
  const entries = Object.entries(input.field_samples);
  if (entries.length === 0) {
    return { ok: true, samples: {} };
  }
  if (input.classification !== "synthetic") {
    return {
      ok: false,
      message:
        "field_samples only allowed when classification is synthetic (no secret/PII rows in registry).",
    };
  }
  if (entries.length > 40) {
    return { ok: false, message: "field_samples capped at 40 fields." };
  }

  const samples: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    if (key.length === 0) {
      return { ok: false, message: "field_samples keys must be non-empty accessible names." };
    }
    if (typeof rawValue !== "string") {
      return { ok: false, message: `field_samples["${key}"] must be a string.` };
    }
    const value = rawValue;
    if (value.length > 500) {
      return { ok: false, message: `field_samples["${key}"] exceeds 500 characters.` };
    }
    if (SENSITIVE_KEY.test(key)) {
      return {
        ok: false,
        message: `field_samples key "${key}" looks credential-shaped — use register_workspace_secret + field_secret_refs instead.`,
      };
    }
    if (SENSITIVE_KEY.test(value) || SECRET_PREFIX.test(value.trim())) {
      return {
        ok: false,
        message: `field_samples["${key}"] value looks secret-shaped — refuse to store; use secret refs.`,
      };
    }
    samples[key] = value;
  }
  return { ok: true, samples };
}
