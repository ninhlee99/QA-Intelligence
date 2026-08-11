/**
 * Runtime adapter for ExecuteExploratorySession (Phase 9).
 */
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";
import { isBrowserName, type BrowserName } from "../adapters/playwright/browser-launcher.js";
import type { ExecuteExploratorySession } from "./execute-exploratory-session.js";
import type { ExploratoryCharter } from "./generate-exploratory-charter.js";
import type { ExploratorySessionFailure } from "./execute-exploratory-session.js";

export type ExploratorySessionRuntimeExecutorDependencies = Readonly<{
  skill: ExecuteExploratorySession;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class ExploratorySessionRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: ExploratorySessionRuntimeExecutorDependencies;

  constructor(dependencies: ExploratorySessionRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const raw = input.start_request.input;
    const url = typeof raw["url"] === "string" ? raw["url"].trim() : "";
    const objective = typeof raw["objective"] === "string" ? raw["objective"] : undefined;
    const requirement_ref = typeof raw["requirement_ref"] === "string" ? raw["requirement_ref"] : undefined;
    const browsersRaw = raw["browsers"];
    const browserFallback = raw["browser"];
    const browsers = parseBrowsers(
      Array.isArray(browsersRaw) && browsersRaw.length > 0 ? browsersRaw : browserFallback,
    );
    if (!browsers.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", browsers.message) };
    }

    let charter: ExploratoryCharter | undefined;
    const charterRaw = raw["charter"];
    if (charterRaw !== undefined && !(typeof charterRaw === "object" && charterRaw !== null && !Array.isArray(charterRaw) && Object.keys(charterRaw as object).length === 0)) {
      if (typeof charterRaw !== "object" || charterRaw === null || Array.isArray(charterRaw)) {
        return { ok: false, failure: failure("orchestration", "invalid_request", "charter must be an object.") };
      }
      charter = charterRaw as unknown as ExploratoryCharter;
    }

    if (!url && charter?.source_url === undefined) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "execute_exploratory_session requires url or charter.source_url.",
        ),
      };
    }

    const includeLiveProbes = readIncludeLiveProbes(raw["include_live_probes"]);

    const run = await this.#dependencies.skill.run({
      operation_id: input.execution.operation_id,
      workspace_id: input.reference.workspace_id,
      context: input.execution.workspace_context,
      ...(url ? { url } : {}),
      ...(charter !== undefined ? { charter } : {}),
      ...(objective !== undefined && objective.trim() ? { objective } : {}),
      ...(requirement_ref !== undefined && requirement_ref.trim() ? { requirement_ref } : {}),
      browsers: browsers.value,
      include_live_probes: includeLiveProbes,
    });
    if (!run.ok) return { ok: false, failure: mapSkillFailure(run.failure) };

    const session = run.value;
    const evidence = unique([...session.evidence, `exploratory-session:${session.id}`]);
    return {
      ok: true,
      value: {
        output: sessionToJson(session),
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: session.captures.map((c) => `browser:${c.browser}`),
        citations: evidence,
        uncertainty: {
          level: session.observations.some((o) => o.status === "manual_follow_up") ? "medium" : "none",
          reasons: session.observations.some((o) => o.status === "manual_follow_up")
            ? ["Some charter oracles/focus areas require manual follow-up within the time box."]
            : [],
        },
        policy_events: [],
        usage: {
          steps: session.captures.length,
          duration_seconds: session.timing.duration_seconds,
          tool_calls: session.captures.length,
          retries: 0,
        },
        evidence,
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

/** Default true when omitted — MCP sessions get bounded probes when runner is wired. */
function readIncludeLiveProbes(raw: JsonValue | undefined): boolean {
  if (raw === false || raw === "false" || raw === 0) return false;
  if (raw === true || raw === "true" || raw === 1) return true;
  return true;
}

function parseBrowsers(
  raw: JsonValue | undefined,
): Readonly<{ ok: true; value: readonly BrowserName[] }> | Readonly<{ ok: false; message: string }> {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: ["chromium"] };
  }
  if (typeof raw === "string") {
    const name = raw.trim().toLowerCase();
    if (!isBrowserName(name)) {
      return { ok: false, message: `browser must be chromium|firefox|webkit (got "${raw}").` };
    }
    return { ok: true, value: [name] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, message: "browsers must be a string or array of browser names." };
  }
  const names: BrowserName[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !isBrowserName(item.trim().toLowerCase())) {
      return { ok: false, message: `Invalid browser name in browsers[]: ${JSON.stringify(item)}.` };
    }
    names.push(item.trim().toLowerCase() as BrowserName);
  }
  if (names.length === 0) return { ok: false, message: "browsers must not be empty." };
  return { ok: true, value: names };
}

function sessionToJson(session: import("./execute-exploratory-session.js").ExploratorySessionResult): JsonObject {
  return {
    id: session.id,
    outcome: session.outcome,
    browsers: [...session.browsers],
    charter: {
      schema_version: session.charter.schema_version,
      title: session.charter.title,
      objective: session.charter.objective,
      source_url: session.charter.source_url ?? null,
      time_box_minutes: session.charter.time_box_minutes,
      focus_areas: [...session.charter.focus_areas],
      oracles: [...session.charter.oracles],
      risks_to_probe: [...session.charter.risks_to_probe],
      out_of_scope: [...session.charter.out_of_scope],
      notes_for_tester: [...session.charter.notes_for_tester],
    },
    captures: session.captures.map((c) => ({
      browser: c.browser,
      source_url: c.source_url,
      capture_id: c.capture_id,
      field_count: c.field_count,
      action_count: c.action_count,
      unlabeled_count: c.unlabeled_count,
      outcome: c.outcome,
      message: c.message ?? null,
    })),
    observations: session.observations.map((o) => ({
      id: o.id,
      browser: o.browser,
      kind: o.kind,
      subject: o.subject,
      status: o.status,
      note: o.note,
      evidence: [...o.evidence],
    })),
    evidence: [...session.evidence],
    timing: { ...session.timing },
  };
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: ExploratorySessionRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the exploratory session executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Exploratory session Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function mapSkillFailure(skillFailure: ExploratorySessionFailure): AgentRunFailure {
  if (skillFailure.class === "authorization") {
    return failure("policy", "authorization_denied", skillFailure.message, skillFailure.retryable, skillFailure.evidence);
  }
  if (skillFailure.class === "infrastructure") {
    return failure("infrastructure", "infrastructure_failure", skillFailure.message, skillFailure.retryable, skillFailure.evidence);
  }
  return failure("orchestration", "invalid_request", skillFailure.message, skillFailure.retryable, skillFailure.evidence);
}
