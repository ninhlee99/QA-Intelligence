/** Provider-neutral public contracts for the Discovery capability (SPEC-201). */
import type {
  JsonObject,
  StableResult,
  WorkspaceContext,
} from "../requirement-review/public.js";

export type DiscoveryScope = Readonly<{
  workspace_id: string;
  /** Optional narrowing, e.g. one capability or feature area; unset means Workspace-wide. */
  capability_id?: string;
  /** Knowledge Store scopes to search, e.g. ["requirements", "architecture", "risk"]. */
  knowledge_scopes: readonly string[];
}>;

export type DiscoveryRequest = Readonly<{
  operation_id: string;
  context: WorkspaceContext;
  scope: DiscoveryScope;
  /** Free-text objective narrowing the search, per SPEC-201 §4 "user-provided objectives". */
  objective: string;
  knowledge_snapshot: string;
}>;

/** SPEC-201 §66: every output SHALL distinguish fact, inference, assumption, and question. */
export type DiscoveryFindingBasis = "fact" | "inference" | "assumption" | "question";

export type DiscoveryFinding = Readonly<{
  id: string;
  basis: DiscoveryFindingBasis;
  statement: string;
  /** Exact Knowledge Object or source references this finding is attributable to. */
  evidence: readonly string[];
  /** SPEC-201 §7: sources SHALL be ranked by authority and applicability. */
  authority_status: string;
  relevance: number;
}>;

/** SPEC-201 §9: a clarification question is asked only when discovery cannot resolve it. */
export type ClarificationQuestion = Readonly<{
  id: string;
  question: string;
  /** Why the answer is needed (SPEC-201 §9 fourth criterion). */
  reason: string;
  blocking: boolean;
}>;

export type KnownUnknownRegisterEntry = Readonly<{
  topic: string;
  status: "known" | "unknown";
  finding_ids: readonly string[];
}>;

export type ConflictRegisterEntry = Readonly<{
  topic: string;
  conflicting_finding_ids: readonly string[];
  description: string;
}>;

/** SPEC-201 §5 Discovery Report (Semantic UI Map/Product Surface Map are out of scope for this slice — no browser/Platform Plugin adapter exists yet). */
export type DiscoveryReport = Readonly<{
  schema_version: "1.0.0";
  workspace_id: string;
  scope: DiscoveryScope;
  objective: string;
  findings: readonly DiscoveryFinding[];
  known_unknown_register: readonly KnownUnknownRegisterEntry[];
  conflict_register: readonly ConflictRegisterEntry[];
  clarification_questions: readonly ClarificationQuestion[];
  knowledge_snapshot: string;
  coverage: readonly string[];
  limitations: readonly string[];
}>;

export type DiscoveryFailure = Readonly<{
  class: "configuration" | "authorization" | "knowledge";
  code: string;
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type DiscoveryResult = StableResult<DiscoveryReport, DiscoveryFailure>;

export type DiscoveryConfiguration = Readonly<{
  resolved_versions: JsonObject;
  limits: Readonly<{ hits_per_scope: number }>;
}>;
