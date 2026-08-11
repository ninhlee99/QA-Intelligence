/**
 * Persist / compare Semantic UI element arrays as release-over-release
 * baselines (named-control drift). Reuses compareUiSurfaces.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { compareUiSurfaces, type UiSurfaceCompareResult } from "./compare-ui-surfaces.js";
import type { SemanticUiElement } from "./public.js";

export type SurfaceBaselineRecord = Readonly<{
  baseline_id: string;
  workspace_id: string;
  label: string;
  source_url?: string;
  captured_at: string;
  elements: readonly SemanticUiElement[];
}>;

export type RegisterSurfaceBaselineInput = Readonly<{
  rootDir: string;
  workspace_id: string;
  baseline_id: string;
  label?: string;
  source_url?: string;
  elements: readonly SemanticUiElement[];
  now?: () => Date;
}>;

export type RegisterSurfaceBaselineResult =
  | Readonly<{ ok: true; record: SurfaceBaselineRecord; persisted_path: string }>
  | Readonly<{ ok: false; message: string }>;

export type CompareSurfaceToBaselineInput = Readonly<{
  rootDir: string;
  workspace_id: string;
  baseline_id: string;
  label?: string;
  elements: readonly SemanticUiElement[];
}>;

export type CompareSurfaceToBaselineResult =
  | Readonly<{ ok: true; baseline_label: string; live_label: string; diff: UiSurfaceCompareResult }>
  | Readonly<{ ok: false; message: string }>;

export function registerUiSurfaceBaseline(input: RegisterSurfaceBaselineInput): RegisterSurfaceBaselineResult {
  if (input.elements.length === 0) {
    return { ok: false, message: "elements must be non-empty." };
  }
  const record: SurfaceBaselineRecord = {
    baseline_id: input.baseline_id,
    workspace_id: input.workspace_id,
    label: input.label?.trim() || input.baseline_id,
    ...(input.source_url !== undefined ? { source_url: input.source_url } : {}),
    captured_at: (input.now ?? (() => new Date()))().toISOString(),
    elements: input.elements,
  };
  try {
    const path = surfacePath(input.rootDir, input.workspace_id, input.baseline_id);
    mkdirSync(join(input.rootDir, safe(input.workspace_id)), { recursive: true });
    writeFileSync(path, JSON.stringify(record, null, 2), "utf8");
    return { ok: true, record, persisted_path: path };
  } catch (error) {
    return { ok: false, message: `Failed to persist surface baseline: ${(error as Error).message}` };
  }
}

export function compareUiSurfaceToBaseline(
  input: CompareSurfaceToBaselineInput,
): CompareSurfaceToBaselineResult {
  const path = surfacePath(input.rootDir, input.workspace_id, input.baseline_id);
  if (!existsSync(path)) {
    return {
      ok: false,
      message: `No surface baseline "${input.baseline_id}" — run register_ui_surface_baseline first.`,
    };
  }
  let record: SurfaceBaselineRecord;
  try {
    record = JSON.parse(readFileSync(path, "utf8")) as SurfaceBaselineRecord;
  } catch (error) {
    return { ok: false, message: `Failed to read surface baseline: ${(error as Error).message}` };
  }
  const liveLabel = input.label?.trim() || "live";
  const diff = compareUiSurfaces({
    label_a: record.label,
    label_b: liveLabel,
    elements_a: record.elements,
    elements_b: input.elements,
  });
  return {
    ok: true,
    baseline_label: record.label,
    live_label: liveLabel,
    diff: {
      ...diff,
      // Remap naming for caller clarity: only_in_a = baseline-only, only_in_b = live-only
      summary: `baseline(${record.label}) vs live(${liveLabel}): ${diff.only_in_a.length} only-baseline, ${diff.only_in_b.length} only-live, ${diff.shared.length} shared.`,
    },
  };
}

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function surfacePath(rootDir: string, workspaceId: string, baselineId: string): string {
  return join(rootDir, safe(workspaceId), `${safe(baselineId)}.json`);
}
