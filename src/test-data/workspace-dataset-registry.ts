/**
 * SPEC-208 thin create/registry: Workspace-scoped TestDataset metadata.
 * Optional synthetic field_samples (validated) — never credential-shaped
 * values. Prefer FileBackedWorkspaceDatasetRegistry for MCP durability.
 */
import type { TestDataClassification, TestDataset } from "./public.js";
import { validateSyntheticFieldSamples } from "./validate-field-samples.js";

export type RegisterTestDatasetInput = Readonly<{
  workspace_id: string;
  purpose: string;
  classification?: TestDataClassification;
  traced_test_refs?: readonly string[];
  owner?: string;
  environment_scope?: string;
  schema_ref?: string;
  id?: string;
  /** Synthetic accessible_name → value fills only. */
  field_samples?: Readonly<Record<string, string>>;
}>;

export type RegisterTestDatasetResult =
  | Readonly<{ ok: true; dataset: TestDataset }>
  | Readonly<{ ok: false; code: "invalid_input"; message: string }>;

export class InMemoryWorkspaceDatasetRegistry {
  readonly #byWorkspace = new Map<string, Map<string, TestDataset>>();
  readonly #clock: { now(): Date };

  constructor(clock: { now(): Date } = { now: () => new Date() }) {
    this.#clock = clock;
  }

  register(input: RegisterTestDatasetInput): RegisterTestDatasetResult {
    if (input.workspace_id.trim().length === 0) {
      return { ok: false, code: "invalid_input", message: "workspace_id is required." };
    }
    if (input.purpose.trim().length === 0) {
      return { ok: false, code: "invalid_input", message: "purpose is required." };
    }

    const classification = input.classification ?? "synthetic";
    const samplesCheck = validateSyntheticFieldSamples({
      classification,
      field_samples: input.field_samples,
    });
    if (!samplesCheck.ok) {
      return { ok: false, code: "invalid_input", message: samplesCheck.message };
    }
    const fieldSamples =
      Object.keys(samplesCheck.samples).length > 0 ? samplesCheck.samples : undefined;

    const id = input.id?.trim() || `dataset:${input.workspace_id}:${this.#clock.now().valueOf().toString(36)}`;
    const dataset: TestDataset = {
      id,
      version: "0.1.0-draft",
      status: "draft",
      owner: input.owner?.trim() || "QA Intelligence dataset registry",
      purpose: input.purpose.trim(),
      traced_test_refs: input.traced_test_refs ?? [],
      schema_ref: input.schema_ref?.trim() || "schemas/test-dataset.schema.json@1.0.0",
      source: "workspace-dataset-registry",
      generation_method: "manual_register_stub",
      classification,
      workspace_scope: input.workspace_id,
      environment_scope: input.environment_scope?.trim() || "registered-environments-only",
      validity_constraints: [
        "No production PII unless classification and controls are updated.",
        "field_samples are synthetic fills only — secrets stay in credential registry.",
      ],
      setup: "Resolve dataset id via resolve_test_dataset_fields; inject field_values into execution plans.",
      teardown: "No persistent side effects for synthetic registry entries.",
      retention: "Session/dev process lifetime unless file-backed under .qa-test-datasets/.",
      disposal: "Drop registry entry; never log sample secret-like values.",
      contains_sensitive_fields: false,
      ...(fieldSamples !== undefined ? { field_samples: fieldSamples } : {}),
    };

    let bucket = this.#byWorkspace.get(input.workspace_id);
    if (bucket === undefined) {
      bucket = new Map();
      this.#byWorkspace.set(input.workspace_id, bucket);
    }
    bucket.set(id, dataset);
    return { ok: true, dataset };
  }

  list(workspaceId: string): readonly TestDataset[] {
    const bucket = this.#byWorkspace.get(workspaceId);
    if (bucket === undefined) return [];
    return [...bucket.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(workspaceId: string, id: string): TestDataset | undefined {
    return this.#byWorkspace.get(workspaceId)?.get(id);
  }

  /** Replace an already-validated dataset (file-backed load path). */
  put(dataset: TestDataset): void {
    let bucket = this.#byWorkspace.get(dataset.workspace_scope);
    if (bucket === undefined) {
      bucket = new Map();
      this.#byWorkspace.set(dataset.workspace_scope, bucket);
    }
    bucket.set(dataset.id, dataset);
  }
}
