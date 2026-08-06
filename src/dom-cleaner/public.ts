import type { WorkspaceContext } from "../requirement-review/public.js";

/**
 * SPEC-302 (DOM Cleaner Architecture): "transforms authorized UI captures
 * into a minimal, safe, deterministic structural representation suitable
 * for semantic analysis." This is a pure data transformation over an
 * already-captured DOM tree (e.g. serialized HTML or an accessibility
 * tree snapshot) — it never drives a live browser, so it needs no
 * Playwright or other execution-technology dependency (that remains
 * SPEC-407/SPEC-504's separate, still-blocked scope). The DOM Cleaner is
 * the first stage of the Semantic UI pipeline SPEC-301 (Semantic
 * Analyzer) and SPEC-303 (Feature Extractor) build on.
 */
export type UrlClassification = "internal" | "external" | "unknown";

/** SPEC-302 §3: "Input SHALL include capture ID, URL classification, Workspace, actor role, environment, timestamp, raw content reference, redaction policy, and capture authorization." */
export type RawDomNode = Readonly<{
  tag: string;
  attributes: Readonly<Record<string, string>>;
  text?: string;
  children: readonly RawDomNode[];
  /** Accessible role/name/state, when the capture already resolved them (e.g. from an accessibility tree snapshot). */
  accessible_role?: string;
  accessible_name?: string;
}>;

export type RedactionRule = Readonly<{
  attribute_pattern: string;
  reason: string;
}>;

export type RedactionPolicy = Readonly<{
  rules: readonly RedactionRule[];
  redact_text_matching: readonly string[];
}>;

export type DomCleanerLimits = Readonly<{
  max_bytes: number;
  max_depth: number;
  max_nodes: number;
  max_attribute_length: number;
  max_text_length: number;
}>;

export type DomCleanRequest = Readonly<{
  capture_id: string;
  url_classification: UrlClassification;
  context: WorkspaceContext;
  actor_role: string;
  environment: string;
  captured_at: string;
  raw_content_ref: string;
  raw: RawDomNode;
  redaction_policy: RedactionPolicy;
  limits: DomCleanerLimits;
  /** Whether the capture itself was authorized to be taken (SPEC-302 §3 "capture authorization") — the Cleaner does not decide this, only checks it. */
  capture_authorized: boolean;
}>;

/** SPEC-302 §2: scripts, styles, hidden noise, trackers, and unstable runtime data are removed; accessible names/roles/labels/hierarchy/state/interaction hints are retained. */
export type CleanedDomNode = Readonly<{
  node_id: string;
  tag: string;
  retained_attributes: Readonly<Record<string, string>>;
  text?: string;
  accessible_role?: string;
  accessible_name?: string;
  interaction_hint?: "clickable" | "editable" | "selectable" | "navigable" | "none";
  children: readonly CleanedDomNode[];
}>;

export type RedactionEvent = Readonly<{
  node_id: string;
  attribute_or_text: string;
  reason: string;
}>;

/** SPEC-302 §4: "source-node mapping" — a cleaned node's id back to a stable path in the original raw tree, so later stages can trace evidence without re-parsing. */
export type SourceNodeMapping = Readonly<{
  node_id: string;
  raw_path: readonly number[];
}>;

export type DomCleanerFailureCode =
  | "malformed_input"
  | "excessive_size"
  | "unsafe_encoding"
  | "policy_failure"
  | "unsupported_content"
  | "redaction_uncertainty"
  | "capture_unauthorized";

export type DomCleanerFailure = Readonly<{
  code: DomCleanerFailureCode;
  message: string;
}>;

export type DomCleanValue = Readonly<{
  sanitized_tree: CleanedDomNode;
  redaction_events: readonly RedactionEvent[];
  source_node_mapping: readonly SourceNodeMapping[];
  capture_id: string;
  cleaner_version: string;
  warnings: readonly string[];
  /** SPEC-302 §7: lossy transformations SHALL be recorded — coverage is what fraction of raw nodes survived cleaning, not a quality judgment. */
  coverage: Readonly<{ raw_node_count: number; retained_node_count: number }>;
}>;

export type DomCleanResult =
  | Readonly<{ ok: true; value: DomCleanValue }>
  | Readonly<{ ok: false; failure: DomCleanerFailure }>;

/**
 * Provider-neutral DOM Cleaner seam (SPEC-302 §5 pipeline, §9 "The public
 * analyzer interface SHALL remain provider-neutral; parsers... SHALL be
 * replaceable by deterministic fixtures"). A production adapter parses a
 * real browser's DOM/accessibility tree without executing any active
 * content (SPEC-302 §6); a deterministic adapter operates on an
 * already-typed `RawDomNode` tree, which is what this interface itself
 * takes as input.
 */
export interface DomCleaner {
  clean(request: DomCleanRequest): Promise<DomCleanResult>;
}
