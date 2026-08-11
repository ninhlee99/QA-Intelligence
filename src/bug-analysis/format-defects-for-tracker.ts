/**
 * Export SPEC-211 Defect drafts into tracker-friendly text (Markdown /
 * Jira-ish description). Does NOT call Jira/Linear APIs — Host pastes or
 * files via its own integration.
 */
import type { Defect } from "./public.js";
import { buildDefectEvidencePack } from "./defect-evidence-pack.js";

export type DefectExportFormat = "markdown" | "jira_description";

export function formatDefectsForTracker(
  defects: readonly Defect[],
  format: DefectExportFormat = "markdown",
): string {
  if (defects.length === 0) return format === "markdown" ? "_No defect drafts._" : "No defect drafts.";
  return defects.map((defect, index) => formatOne(defect, format, index + 1)).join("\n\n---\n\n");
}

function formatOne(defect: Defect, format: DefectExportFormat, ordinal: number): string {
  const pack = buildDefectEvidencePack(defect);
  const evidenceLines =
    format === "markdown"
      ? pack.markdown_attachment_section.split("\n")
      : [
          "h3. Evidence pack",
          ...pack.entries.map((entry) => `- *${entry.kind}:* ${entry.readable_label} (${entry.ref})`),
          "",
          "*confirmed_cause:* null",
          `*suspected_cause (NOT confirmed):* ${defect.suspected_cause}`,
        ];
  const lines = [
    format === "markdown" ? `## ${ordinal}. ${defect.summary}` : `h2. ${ordinal}. ${defect.summary}`,
    "",
    `*ID:* ${defect.id} @ ${defect.version}`,
    `*Status:* ${defect.status}`,
    `*Severity:* ${defect.severity} (${defect.severity_rationale})`,
    `*Priority:* ${defect.priority}`,
    `*Classification:* ${defect.classification}`,
    `*Environment:* ${defect.environment_ref}`,
    `*Workspace:* ${defect.workspace_scope}`,
    "",
    format === "markdown" ? "### Observed" : "h3. Observed",
    defect.observed_behavior,
    "",
    format === "markdown" ? "### Expected" : "h3. Expected",
    defect.expected_behavior,
    `Authority: ${defect.expected_behavior_authority}`,
    "",
    format === "markdown" ? "### Reproduction" : "h3. Reproduction",
    ...defect.reproduction_conditions.map((step, i) => `${i + 1}. ${step}`),
    "",
    ...evidenceLines,
    "",
    `Related tests: ${(defect.related_test_refs ?? []).join(", ") || "(none)"}`,
    `Related executions: ${(defect.related_execution_refs ?? []).join(", ") || "(none)"}`,
  ];
  return lines.join("\n");
}
