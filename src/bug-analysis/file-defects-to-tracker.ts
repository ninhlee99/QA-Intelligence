/**
 * Optional tracker filing seam (Jira REST / Linear GraphQL / generic webhook).
 * Default is dry-run: returns the outbound payload without POSTing.
 * Real filing requires confirm_file=true + bearer via secret_ref — never silent.
 */
import type { Defect } from "./public.js";
import { formatDefectsForTracker } from "./format-defects-for-tracker.js";

export type DefectTrackerProvider = "jira_rest" | "linear_graphql" | "webhook";

export type FileDefectsToTrackerInput = Readonly<{
  defects: readonly Defect[];
  provider: DefectTrackerProvider;
  /** Jira/Linear/webhook base, e.g. https://example.atlassian.net or https://api.linear.app */
  base_url: string;
  /** Bearer token — never logged. Prefer resolving via secret_ref before call. */
  bearer_token: string;
  /**
   * Jira: project key (e.g. QA). Linear: team UUID. Webhook: ignored.
   */
  project_or_team: string;
  /** Must be true to perform HTTP — otherwise dry-run only. */
  confirm_file?: boolean;
  /** Optional issue type name for Jira (default Bug). */
  jira_issue_type?: string;
  fetchImpl?: typeof fetch;
}>;

export type FiledDefectResult = Readonly<{
  defect_id: string;
  ok: boolean;
  remote_id?: string;
  remote_url?: string;
  message: string;
  status?: number;
}>;

export type FileDefectsToTrackerResult = Readonly<{
  dry_run: boolean;
  provider: DefectTrackerProvider;
  base_url: string;
  payloads: readonly JsonPayload[];
  results: readonly FiledDefectResult[];
  honesty: string;
}>;

type JsonPayload = Readonly<{
  defect_id: string;
  method: "POST";
  url: string;
  body: unknown;
}>;

export function buildTrackerPayloads(input: Readonly<{
  defects: readonly Defect[];
  provider: DefectTrackerProvider;
  base_url: string;
  project_or_team: string;
  jira_issue_type?: string;
}>): readonly JsonPayload[] {
  const base = input.base_url.replace(/\/+$/, "");
  return input.defects.map((defect) => {
    if (input.provider === "jira_rest") {
      const description = formatDefectsForTracker([defect], "jira_description");
      return {
        defect_id: defect.id,
        method: "POST" as const,
        url: `${base}/rest/api/2/issue`,
        body: {
          fields: {
            project: { key: input.project_or_team },
            summary: defect.summary.slice(0, 255),
            description,
            issuetype: { name: input.jira_issue_type?.trim() || "Bug" },
          },
        },
      };
    }
    if (input.provider === "linear_graphql") {
      const description = formatDefectsForTracker([defect], "markdown");
      return {
        defect_id: defect.id,
        method: "POST" as const,
        url: `${base}/graphql`,
        body: {
          query:
            "mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id url } } }",
          variables: {
            input: {
              teamId: input.project_or_team,
              title: defect.summary.slice(0, 255),
              description,
            },
          },
        },
      };
    }
    return {
      defect_id: defect.id,
      method: "POST" as const,
      url: base,
      body: {
        source: "qa-intelligence",
        defect,
        formatted_markdown: formatDefectsForTracker([defect], "markdown"),
      },
    };
  });
}

export async function fileDefectsToTracker(input: FileDefectsToTrackerInput): Promise<
  | Readonly<{ ok: true; value: FileDefectsToTrackerResult }>
  | Readonly<{ ok: false; message: string }>
> {
  if (input.defects.length === 0) {
    return { ok: false, message: "file_defects_to_tracker requires a non-empty defects array." };
  }
  const base = input.base_url.trim();
  if (!/^https?:\/\//i.test(base)) {
    return { ok: false, message: "base_url must be an http(s) URL." };
  }
  if (input.bearer_token.trim().length === 0) {
    return { ok: false, message: "bearer_token is required (resolve from secret_ref — never invent)." };
  }
  if (input.project_or_team.trim().length === 0 && input.provider !== "webhook") {
    return { ok: false, message: "project_or_team is required for jira_rest and linear_graphql." };
  }

  const payloads = buildTrackerPayloads({
    defects: input.defects,
    provider: input.provider,
    base_url: base,
    project_or_team: input.project_or_team,
    ...(input.jira_issue_type !== undefined ? { jira_issue_type: input.jira_issue_type } : {}),
  });

  const dryRun = input.confirm_file !== true;
  if (dryRun) {
    return {
      ok: true,
      value: {
        dry_run: true,
        provider: input.provider,
        base_url: base,
        payloads,
        results: payloads.map((payload) => ({
          defect_id: payload.defect_id,
          ok: true,
          message: "Dry-run only — re-call with confirm_file=true to POST.",
        })),
        honesty:
          "Dry-run: no tracker API called. Set confirm_file=true explicitly to file. Tokens never appear in this output.",
      },
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const results: FiledDefectResult[] = [];
  for (const payload of payloads) {
    try {
      const response = await fetchImpl(payload.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.bearer_token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload.body),
      });
      const text = await response.text();
      let remote_id: string | undefined;
      let remote_url: string | undefined;
      try {
        const json = JSON.parse(text) as Record<string, unknown>;
        if (input.provider === "jira_rest") {
          remote_id = typeof json["key"] === "string" ? json["key"] : undefined;
          if (remote_id) remote_url = `${base}/browse/${remote_id}`;
        } else if (input.provider === "linear_graphql") {
          const data = json["data"] as Record<string, unknown> | undefined;
          const create = data?.["issueCreate"] as Record<string, unknown> | undefined;
          const issue = create?.["issue"] as Record<string, unknown> | undefined;
          remote_id = typeof issue?.["id"] === "string" ? issue["id"] : undefined;
          remote_url = typeof issue?.["url"] === "string" ? issue["url"] : undefined;
        }
      } catch {
        // Non-JSON body — keep status only.
      }
      results.push({
        defect_id: payload.defect_id,
        ok: response.ok,
        ...(remote_id !== undefined ? { remote_id } : {}),
        ...(remote_url !== undefined ? { remote_url } : {}),
        message: response.ok ? "Filed." : `Tracker HTTP ${response.status}.`,
        status: response.status,
      });
    } catch (error) {
      results.push({
        defect_id: payload.defect_id,
        ok: false,
        message: `Transport failure: ${(error as Error).message}`,
      });
    }
  }

  return {
    ok: true,
    value: {
      dry_run: false,
      provider: input.provider,
      base_url: base,
      payloads: payloads.map((payload) => ({
        defect_id: payload.defect_id,
        method: payload.method,
        url: payload.url,
        // Omit bodies after live file to avoid leaking defect text into logs twice;
        // dry-run already showed shape.
        body: { omitted_after_live_file: true },
      })),
      results,
      honesty:
        "Live file attempted. Review results[].ok / remote_id. Never invent confirmed_cause from tracker acceptance.",
    },
  };
}
