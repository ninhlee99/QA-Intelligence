import type {
  JsonObject,
  JsonValue,
  KnowledgeSearch as KnowledgeSearchPort,
  KnowledgeSearchFailure,
  KnowledgeSearchHit,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
} from "../../requirement-review/public.js";

export type InMemoryKnowledgeRecord = Readonly<{
  workspace_id: string;
  knowledge_snapshot: string;
  knowledge_ref: string;
  title: string;
  excerpt: string;
  authority_status: string;
  scopes: readonly string[];
  applicability: JsonObject;
  provenance: readonly string[];
  evidence: readonly string[];
}>;

export type InMemoryKnowledgeSearchOptions = Readonly<{
  workspace_id: string;
  knowledge_snapshot: string;
  projection_freshness: string;
  availability?: "available" | "unavailable";
  records: readonly InMemoryKnowledgeRecord[];
}>;

/** Immutable, deterministic adapter for the SPEC-501 Knowledge Search seam. */
export class InMemoryKnowledgeSearch implements KnowledgeSearchPort {
  readonly #workspaceId: string;
  readonly #knowledgeSnapshot: string;
  readonly #projectionFreshness: string;
  readonly #availability: "available" | "unavailable";
  readonly #records: readonly InMemoryKnowledgeRecord[];

  constructor(options: InMemoryKnowledgeSearchOptions) {
    this.#workspaceId = options.workspace_id;
    this.#knowledgeSnapshot = options.knowledge_snapshot;
    this.#projectionFreshness = options.projection_freshness;
    this.#availability = options.availability ?? "available";
    this.#records = Object.freeze(options.records.map(copyRecord));
  }

  search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult> {
    const applicableWorkspace = request.applicability["workspace_id"];
    if (
      request.context.workspace_id !== this.#workspaceId ||
      (typeof applicableWorkspace === "string" &&
        applicableWorkspace !== this.#workspaceId)
    ) {
      return Promise.resolve(
        failure(
          request.operation_id,
          "forbidden",
          "Knowledge snapshot is outside the authorized Workspace.",
          false,
          "workspace-mismatch",
        ),
      );
    }

    if (request.knowledge_snapshot !== this.#knowledgeSnapshot) {
      return Promise.resolve(
        failure(
          request.operation_id,
          "stale_projection",
          "The requested Knowledge snapshot is not the current immutable snapshot.",
          true,
          "snapshot-version-mismatch",
        ),
      );
    }

    if (this.#availability === "unavailable") {
      return Promise.resolve(
        failure(
          request.operation_id,
          "unavailable",
          "Knowledge Search is temporarily unavailable.",
          true,
          "adapter-unavailable",
        ),
      );
    }

    if (
      !Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > 100 ||
      request.query.trim().length === 0 ||
      request.query.length > 1_000
    ) {
      return Promise.resolve(
        failure(
          request.operation_id,
          "invalid",
          "Knowledge Search requires a non-empty query and an integer limit from 1 to 100.",
          false,
          "invalid-search-input",
        ),
      );
    }

    const snapshotRecords = this.#records.filter(
      (record) =>
        record.workspace_id === this.#workspaceId &&
        record.knowledge_snapshot === this.#knowledgeSnapshot &&
        record.authority_status === "accepted",
    );
    const invalidRecord = snapshotRecords.find(
      (record) =>
        !hasValues(record.provenance) || !hasValues(record.evidence),
    );
    if (invalidRecord !== undefined) {
      return Promise.resolve(
        failure(
          request.operation_id,
          "integrity_failure",
          "Accepted Knowledge is missing required provenance or evidence.",
          false,
          "accepted-knowledge-evidence-missing",
        ),
      );
    }

    const acceptedRequested = request.authority_statuses.includes("accepted");
    const queryTokens = tokens(request.query);
    const hits = acceptedRequested
      ? snapshotRecords
          .filter((record) => matchesScope(record, request.scopes))
          .filter((record) => matchesApplicability(record, request.applicability))
          .map((record) => toHit(record, queryTokens))
          .filter((hit) => hit.relevance > 0)
          .sort(compareHits)
          .slice(0, request.limit)
      : [];

    return Promise.resolve({
      ok: true,
      value: {
        hits,
        knowledge_snapshot: this.#knowledgeSnapshot,
        projection_freshness: this.#projectionFreshness,
        warnings: acceptedRequested
          ? []
          : ["accepted-authority-not-requested"],
      },
    });
  }
}

function copyRecord(record: InMemoryKnowledgeRecord): InMemoryKnowledgeRecord {
  return Object.freeze({
    workspace_id: record.workspace_id,
    knowledge_snapshot: record.knowledge_snapshot,
    knowledge_ref: record.knowledge_ref,
    title: record.title,
    excerpt: record.excerpt,
    authority_status: record.authority_status,
    scopes: Object.freeze([...record.scopes]),
    applicability: Object.freeze(cloneObject(record.applicability)),
    provenance: Object.freeze([...record.provenance]),
    evidence: Object.freeze([...record.evidence]),
  });
}

function cloneObject(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
  );
}

function cloneValue(value: JsonValue): JsonValue {
  if (isJsonArray(value)) {
    return Object.freeze(value.map(cloneValue));
  }
  if (value !== null && typeof value === "object") {
    return Object.freeze(cloneObject(value as JsonObject));
  }
  return value;
}

function matchesScope(
  record: InMemoryKnowledgeRecord,
  requestedScopes: readonly string[],
): boolean {
  return requestedScopes.some((scope) => record.scopes.includes(scope));
}

function matchesApplicability(
  record: InMemoryKnowledgeRecord,
  requested: JsonObject,
): boolean {
  return Object.entries(requested).every(([key, value]) => {
    const candidate = record.applicability[key];
    return candidate !== undefined && equalJson(candidate, value);
  });
}

function equalJson(left: JsonValue, right: JsonValue): boolean {
  if (isJsonArray(left) || isJsonArray(right)) {
    return (
      isJsonArray(left) &&
      isJsonArray(right) &&
      left.length === right.length &&
      left.every((value, index) => {
        const other = right[index];
        return other !== undefined && equalJson(value, other);
      })
    );
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const leftEntries = Object.entries(left);
    const rightKeys = Object.keys(right);
    return (
      leftEntries.length === rightKeys.length &&
      leftEntries.every(([key, value]) => {
        const other = right[key];
        return other !== undefined && equalJson(value, other);
      })
    );
  }
  return left === right;
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function tokens(value: string): readonly string[] {
  return [
    ...new Set(value.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []),
  ].sort();
}

function toHit(
  record: InMemoryKnowledgeRecord,
  queryTokens: readonly string[],
): KnowledgeSearchHit {
  const searchable = new Set(tokens(`${record.title} ${record.excerpt}`));
  const matches = queryTokens.filter((token) => searchable.has(token)).length;
  const relevance = queryTokens.length === 0 ? 0 : matches / queryTokens.length;
  return {
    knowledge_ref: record.knowledge_ref,
    title: record.title,
    excerpt: record.excerpt,
    authority_status: record.authority_status,
    provenance: [...record.provenance],
    evidence: [...record.evidence],
    relevance,
  };
}

function compareHits(left: KnowledgeSearchHit, right: KnowledgeSearchHit): number {
  const relevanceOrder = right.relevance - left.relevance;
  if (relevanceOrder !== 0) {
    return relevanceOrder;
  }
  return left.knowledge_ref < right.knowledge_ref
    ? -1
    : left.knowledge_ref > right.knowledge_ref
      ? 1
      : 0;
}

function hasValues(values: readonly string[]): boolean {
  return values.length > 0 && values.every((value) => value.trim().length > 0);
}

function failure(
  operationId: string,
  code: KnowledgeSearchFailure["code"],
  message: string,
  retryable: boolean,
  reason: string,
): KnowledgeSearchResult {
  return {
    ok: false,
    failure: {
      code,
      message,
      retryable,
      evidence: [
        "knowledge-search:deny",
        `operation:${operationId}`,
        `reason:${reason}`,
      ],
    },
  };
}
