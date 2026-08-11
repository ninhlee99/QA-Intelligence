/**
 * Classify defect evidence refs into a triage-friendly pack for tracker export.
 * Never invents refs — only labels what already exists on the Defect.
 */
import type { Defect } from "./public.js";

export type DefectEvidenceKind =
  | "screenshot"
  | "capture"
  | "outcome"
  | "test_case"
  | "execution"
  | "other";

export type DefectEvidenceEntry = Readonly<{
  kind: DefectEvidenceKind;
  ref: string;
  readable_label: string;
}>;

export type DefectEvidencePack = Readonly<{
  entries: readonly DefectEvidenceEntry[];
  markdown_attachment_section: string;
  confirmed_cause: null;
  suspected_cause: string;
}>;

export function buildDefectEvidencePack(defect: Defect): DefectEvidencePack {
  const entries = defect.evidence.map((ref) => classifyEvidence(ref));
  const lines = [
    "### Evidence pack",
    ...entries.map((entry) => `- **${entry.kind}:** ${entry.readable_label} (\`${entry.ref}\`)`),
    "",
    "*confirmed_cause:* null (AI MUST NOT invent a confirmed cause)",
    `*suspected_cause (NOT confirmed):* ${defect.suspected_cause ?? "(none)"}`,
  ];
  return {
    entries,
    markdown_attachment_section: lines.join("\n"),
    confirmed_cause: null,
    suspected_cause: defect.suspected_cause ?? "(none recorded)",
  };
}

function classifyEvidence(ref: string): DefectEvidenceEntry {
  const lower = ref.toLowerCase();
  if (lower.endsWith(".png") || lower.includes("screenshot") || lower.includes(".qa-screenshots/")) {
    return { kind: "screenshot", ref, readable_label: "Failure screenshot" };
  }
  if (ref.startsWith("capture:") || lower.includes("capture:")) {
    return { kind: "capture", ref, readable_label: "DOM / Semantic UI capture id" };
  }
  if (ref.startsWith("outcome:") || lower.startsWith("api-outcome:")) {
    return { kind: "outcome", ref, readable_label: "Run outcome marker" };
  }
  if (ref.startsWith("test-case:") || ref.startsWith("test_case:")) {
    return { kind: "test_case", ref, readable_label: "Related test case" };
  }
  if (ref.startsWith("execution:") || lower.includes("execution")) {
    return { kind: "execution", ref, readable_label: "Execution / attempt ref" };
  }
  return { kind: "other", ref, readable_label: "Evidence ref" };
}
