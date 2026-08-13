import { resolve } from "node:path";

import type { VersionReference, WorkspaceAuthorizer } from "../requirement-review/public.js";
import type { AgentRunExecutor, AgentRunExecutorInput, AgentRunExecutorResult } from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import { applyEvidenceRetention } from "./evidence-retention.js";

export class EvidenceLifecycleRuntimeExecutor implements AgentRunExecutor {
  constructor(private readonly dependencies: Readonly<{
    authorizer: WorkspaceAuthorizer;
    expected_agent: VersionReference;
    expected_skill: VersionReference;
    artifact_root: string;
    clock: { now(): Date };
  }>) {}

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const { expected_agent: agent, expected_skill: skill } = this.dependencies;
    if (input.start_request.agent.id !== agent.id || !(input.start_request.allowed_skills ?? []).some((item) => item.id === skill.id && item.version === skill.version)) {
      return { ok: false, failure: failure("policy", "authorization_denied", "Evidence lifecycle Skill is not present in retained authority.") };
    }
    const raw = input.start_request.input;
    const manifest = typeof raw["manifest_path"] === "string" ? raw["manifest_path"].trim() : "";
    if (!manifest) return { ok: false, failure: failure("orchestration", "invalid_request", "manifest_path is required.") };
    const confirm = raw["confirm_purge"] === true;
    const authorization = await this.dependencies.authorizer.authorize({
      operation_id: input.execution.operation_id,
      context: input.execution.workspace_context,
      purpose: confirm ? "purge retained QA evidence" : "preview QA evidence retention",
      consequence_class: confirm ? "high_consequence" : "advisory",
      required_permissions: [confirm ? "evidence:delete" : "execution:read"],
      resource_refs: [`workspace:${input.reference.workspace_id}`, `evidence-manifest:${manifest}`],
    });
    if (!authorization.ok) return { ok: false, failure: failure("policy", "authorization_denied", authorization.failure.message) };
    const number = (name: string, fallback: number): number => typeof raw[name] === "number" ? raw[name] : fallback;
    const result = await applyEvidenceRetention({
      manifest_path: manifest,
      allowed_roots: [resolve(this.dependencies.artifact_root)],
      now: this.dependencies.clock.now().toISOString(),
      policy: { passed_days: number("passed_days", 7), failed_days: number("failed_days", 30), flaky_days: number("flaky_days", 30), other_days: number("other_days", 14) },
      confirm_purge: confirm,
      legal_hold: raw["legal_hold"] === true,
    });
    if (!result.ok) return { ok: false, failure: failure("orchestration", "invalid_request", result.message) };
    const skillRef = `${skill.id}@${skill.version}`;
    return { ok: true, value: {
      output: { ...result, deleted_count: result.deleted.length, candidate_count: result.candidates.length }, output_validated: true,
      satisfied_evidence_requirements: [], resolved_versions: { agent: `${agent.id}@${agent.version}`, skill: skillRef }, rule_results: [],
      skill_usage: [skillRef], tool_usage: [], citations: [`manifest:${manifest}`], uncertainty: { level: "none", reasons: [] },
      policy_events: [`evidence-retention:${result.mode}`], usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
      evidence: [`manifest:${manifest}`, ...result.deleted.map((path) => `deleted:${path}`)], cleanup_status: "not_required", knowledge_candidates: [],
    } };
  }
}
