/** Canonical SPEC-607 lifecycle shared by orchestration and persistence. */
export type EvaluationCampaignState =
  | "draft"
  | "validating"
  | "ready"
  | "running"
  | "analyzing"
  | "awaiting_review"
  | "approved"
  | "conditionally_approved"
  | "rejected"
  | "indeterminate"
  | "blocked"
  | "cancelled"
  | "failed";
