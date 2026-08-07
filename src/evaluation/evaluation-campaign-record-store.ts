import type {
  EvaluationCampaignRecord,
  EvaluationCampaignReference,
} from "./evaluation-campaign-repository.js";

export type EvaluationCampaignMutationKind =
  | "create"
  | "transition"
  | "trial_boundary"
  | "recovery";

export type EvaluationCampaignMutationCommand = Readonly<{
  kind: EvaluationCampaignMutationKind;
  idempotency_key: string;
  request_digest: string;
}>;

export type EvaluationCampaignOutboxIntent = Readonly<{
  event_id: string;
  event_type: string;
  schema_version: "1.0.0";
  producer_id: string;
  producer_version: string;
  correlation_id: string;
  causation_id: string;
  classification: string;
}>;

export type RetainEvaluationCampaignMutationRequest = Readonly<{
  record: EvaluationCampaignRecord;
  expected_revision: number | null;
  command: EvaluationCampaignMutationCommand;
  outbox: EvaluationCampaignOutboxIntent;
}>;

export type PeekEvaluationCampaignCommandRequest = Readonly<{
  workspace_id: string;
  campaign_id: string;
  kind: EvaluationCampaignMutationKind;
  idempotency_key: string;
}>;

export type EvaluationCampaignCommandPeek = Readonly<{
  request_digest: string;
  record: EvaluationCampaignRecord;
}>;

export type EvaluationCampaignRecordStoreFailureCode =
  | "invalid_request"
  | "not_found"
  | "workspace_denied"
  | "idempotency_conflict"
  | "stale_revision"
  | "persistence_corrupt"
  | "persistence_unavailable";

export type EvaluationCampaignRecordStoreResult =
  | Readonly<{ ok: true; value: EvaluationCampaignRecord }>
  | Readonly<{
      ok: false;
      failure: Readonly<{
        code: EvaluationCampaignRecordStoreFailureCode;
        message: string;
      }>;
    }>;

/** Provider-neutral retained campaign storage seam. */
export interface EvaluationCampaignRecordStore {
  retainMutation(
    request: RetainEvaluationCampaignMutationRequest,
  ): Promise<EvaluationCampaignRecordStoreResult>;
  load(
    reference: EvaluationCampaignReference,
  ): Promise<EvaluationCampaignRecordStoreResult>;
  /**
   * Returns the durably retained result of a prior command, if any, without
   * attempting a mutation. Callers that must decide idempotent-replay vs.
   * stale-revision before computing a new record (e.g. a Repository built
   * on top of this seam) call this first, exactly as retainMutation does
   * internally before applying a mutation.
   */
  peekCommand(
    request: PeekEvaluationCampaignCommandRequest,
  ): Promise<EvaluationCampaignCommandPeek | undefined>;
}
