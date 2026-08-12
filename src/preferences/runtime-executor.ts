import type { AgentRunExecutor, AgentRunExecutorInput, AgentRunExecutorResult } from "../runtime/executor.js";
import type { VersionReference } from "../requirement-review/public.js";
import { failure } from "../runtime/executor-support.js";
import type { FileBackedUserPreferences } from "./user-preferences.js";

export type UserPreferenceRuntimeExecutorDependencies = Readonly<{
  preferences: FileBackedUserPreferences;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  mode: "set" | "get";
}>;

export class UserPreferenceRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: UserPreferenceRuntimeExecutorDependencies;

  constructor(dependencies: UserPreferenceRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const { expected_agent, expected_skill, preferences, mode } = this.#dependencies;

    if (input.start_request.agent.id !== expected_agent.id) {
      return { ok: false, failure: failure("policy", "authorization_denied", "User preference Skill is not present in retained Skill authority.") };
    }

    const agentVersion = `${expected_agent.id}@${expected_agent.version}`;
    const skillVersion = `${expected_skill.id}@${expected_skill.version}`;
    const baseValue = {
      output_validated: true,
      satisfied_evidence_requirements: [],
      resolved_versions: { agent: agentVersion, skill: skillVersion },
      rule_results: [] as readonly string[],
      skill_usage: [skillVersion] as readonly string[],
      tool_usage: [] as readonly string[],
      citations: ["user-prefs:.qa-user-prefs.json"] as readonly string[],
      uncertainty: { level: "none" as const, reasons: [] as readonly string[] },
      policy_events: [] as readonly string[],
      usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
      evidence: [] as readonly string[],
      cleanup_status: "not_required" as const,
      knowledge_candidates: [] as readonly string[],
    };

    if (mode === "set") {
      const raw = input.start_request.input as Record<string, unknown>;
      const language = typeof raw["language"] === "string" ? raw["language"].trim() : undefined;

      if (!language) {
        return {
          ok: false,
          failure: failure(
            "orchestration",
            "invalid_request",
            'Missing required field "language". Example: "Vietnamese", "English", "日本語", "vi", "en", "ja".',
          ),
        };
      }

      preferences.set({ language });

      return {
        ok: true,
        value: {
          ...baseValue,
          output: {
            saved: true,
            language,
            note: `Language preference saved. All future MCP tool responses and Claude/AI answers will be in ${language}. No need to set again unless you want to change it.`,
            language_instruction: preferences.languageInstruction() ?? null,
          },
          evidence: [`language:${language}`],
        },
      };
    }

    // mode === "get"
    const prefs = preferences.get();
    return {
      ok: true,
      value: {
        ...baseValue,
        output: {
          language: prefs.language ?? null,
          language_instruction: preferences.languageInstruction() ?? null,
          note: prefs.language
            ? `Current language: ${prefs.language}. Use set_user_preference to change.`
            : 'No language preference set. Call set_user_preference with {"language": "Vietnamese"} to configure.',
        },
      },
    };
  }
}
