/**
 * Durable CandidateRepository: same SPEC-403 lifecycle as
 * InMemoryCandidateRepository, but persists each candidate JSON under a
 * Workspace directory so MCP restarts do not wipe Learning candidates.
 * Dev tracer — not a multi-tenant DB / Vault.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { InMemoryCandidateRepository } from "./in-memory-candidate-repository.js";
import type {
  AppendCandidateEvidenceRequest,
  CandidateQueryFilter,
  CandidateRepository,
  CandidateRepositoryResult,
  CreateCandidateRequest,
  LinkCandidatePromotionResultRequest,
  RecordCandidateValidationResultRequest,
  ReviseCandidateProposalRequest,
  ReviveCandidateRequest,
  TransitionCandidateLifecycleRequest,
} from "../../candidate-repository/public.js";
import type { KnowledgeCandidate, KnowledgeLifecycleEvent } from "../../knowledge/public.js";
import type { WorkspaceContext } from "../../requirement-review/public.js";

type PersistedCandidateRecord = Readonly<{
  candidate: KnowledgeCandidate;
  idempotency_key: string;
}>;

export class FileBackedCandidateRepository implements CandidateRepository {
  readonly #inner: InMemoryCandidateRepository;
  readonly #rootDir: string;
  readonly #loaded = new Set<string>();
  readonly #idempotencyByCandidate = new Map<string, string>();

  constructor(clock: { now(): Date }, rootDir: string) {
    this.#inner = new InMemoryCandidateRepository(clock);
    this.#rootDir = rootDir;
  }

  get rootDir(): string {
    return this.#rootDir;
  }

  async createIdempotent(request: CreateCandidateRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>> {
    this.#ensureWorkspaceLoaded(request.context.workspace_id);
    const result = await this.#inner.createIdempotent(request);
    if (result.ok) {
      this.#idempotencyByCandidate.set(result.value.id, request.idempotency_key);
      this.#persist(result.value, request.idempotency_key);
    }
    return result;
  }

  async reviseProposal(request: ReviseCandidateProposalRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>> {
    this.#ensureWorkspaceLoaded(request.context.workspace_id);
    const result = await this.#inner.reviseProposal(request);
    if (result.ok) this.#persistKnown(result.value);
    return result;
  }

  async appendEvidence(request: AppendCandidateEvidenceRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>> {
    this.#ensureWorkspaceLoaded(request.context.workspace_id);
    const result = await this.#inner.appendEvidence(request);
    if (result.ok) this.#persistKnown(result.value);
    return result;
  }

  async recordValidationResult(
    request: RecordCandidateValidationResultRequest,
  ): Promise<CandidateRepositoryResult<KnowledgeCandidate>> {
    this.#ensureWorkspaceLoaded(request.context.workspace_id);
    const result = await this.#inner.recordValidationResult(request);
    if (result.ok) this.#persistKnown(result.value);
    return result;
  }

  async transitionLifecycle(
    request: TransitionCandidateLifecycleRequest,
  ): Promise<CandidateRepositoryResult<KnowledgeCandidate>> {
    this.#ensureWorkspaceLoaded(request.context.workspace_id);
    const result = await this.#inner.transitionLifecycle(request);
    if (result.ok) this.#persistKnown(result.value);
    return result;
  }

  async revive(request: ReviveCandidateRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>> {
    this.#ensureWorkspaceLoaded(request.context.workspace_id);
    const result = await this.#inner.revive(request);
    if (result.ok) this.#persistKnown(result.value);
    return result;
  }

  async linkPromotionResult(
    request: LinkCandidatePromotionResultRequest,
  ): Promise<CandidateRepositoryResult<KnowledgeCandidate>> {
    this.#ensureWorkspaceLoaded(request.context.workspace_id);
    const result = await this.#inner.linkPromotionResult(request);
    if (result.ok) this.#persistKnown(result.value);
    return result;
  }

  async query(filter: CandidateQueryFilter): Promise<CandidateRepositoryResult<readonly KnowledgeCandidate[]>> {
    this.#ensureWorkspaceLoaded(filter.context.workspace_id);
    return this.#inner.query(filter);
  }

  async appendLifecycleEvent(event: KnowledgeLifecycleEvent): Promise<CandidateRepositoryResult<KnowledgeLifecycleEvent>> {
    return this.#inner.appendLifecycleEvent(event);
  }

  eventsFor(aggregateId: string): readonly KnowledgeLifecycleEvent[] {
    return this.#inner.eventsFor(aggregateId);
  }

  #ensureWorkspaceLoaded(workspaceId: string): void {
    if (this.#loaded.has(workspaceId)) return;
    this.#loaded.add(workspaceId);
    const dir = this.#workspaceDir(workspaceId);
    if (!existsSync(dir)) return;
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((name) => name.endsWith(".json"));
    } catch {
      return;
    }
    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as PersistedCandidateRecord;
        if (
          raw.candidate === undefined ||
          raw.candidate.workspace_id !== workspaceId ||
          typeof raw.idempotency_key !== "string"
        ) {
          continue;
        }
        const { status: _ignoredStatus, ...withoutStatus } = raw.candidate;
        void _ignoredStatus;
        void this.#inner.createIdempotent({
          context: stubContext(workspaceId),
          candidate: withoutStatus,
          idempotency_key: raw.idempotency_key,
        });
        this.#idempotencyByCandidate.set(raw.candidate.id, raw.idempotency_key);
      } catch {
        // Skip corrupt files — fail soft.
      }
    }
  }

  #persistKnown(candidate: KnowledgeCandidate): void {
    const key = this.#idempotencyByCandidate.get(candidate.id) ?? `persisted:${candidate.id}`;
    this.#persist(candidate, key);
  }

  #persist(candidate: KnowledgeCandidate, idempotencyKey: string): void {
    try {
      mkdirSync(this.#workspaceDir(candidate.workspace_id), { recursive: true });
      const record: PersistedCandidateRecord = { candidate, idempotency_key: idempotencyKey };
      writeFileSync(this.#candidatePath(candidate.workspace_id, candidate.id), JSON.stringify(record, null, 2), "utf8");
    } catch {
      // Best-effort durability — in-memory still holds the candidate.
    }
  }

  #workspaceDir(workspaceId: string): string {
    return join(this.#rootDir, safe(workspaceId));
  }

  #candidatePath(workspaceId: string, candidateId: string): string {
    return join(this.#workspaceDir(workspaceId), `${safe(candidateId)}.json`);
  }
}

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** Minimal context for hydrate-only createIdempotent — authorizer not consulted by in-memory create. */
function stubContext(workspaceId: string): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: workspaceId,
    actor_id: "file-backed-candidate-hydrate",
    actor_type: "service",
    roles: ["system"],
    permissions: [],
    policy_version: "policy@hydrate",
    request_id: "hydrate",
    correlation_id: "hydrate",
    audience: ["qa-intelligence"],
    environment: "development",
    issued_at: "1970-01-01T00:00:00.000Z",
    expires_at: "9999-01-01T00:00:00.000Z",
    issuer: "file-backed-candidate-repository",
    integrity_proof: "hydrate",
  };
}
