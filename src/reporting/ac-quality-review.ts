/**
 * Lightweight AC/spec pushback — Expert fuses requirement-quality smells
 * into the session without inventing product intent.
 */
import type { JsonObject } from "../requirement-review/public.js";

export type AcQualityFinding = Readonly<{
  id: string;
  severity: "high" | "medium" | "low";
  category: string;
  message: string;
}>;

export type AcQualityReview = Readonly<{
  schema_version: "1.0.0";
  finding_count: number;
  findings: readonly AcQualityFinding[];
  note: string;
}>;

export function reviewAcceptanceCriteriaQuality(
  acceptanceCriteria: readonly JsonObject[],
): AcQualityReview {
  const findings: AcQualityFinding[] = [];
  let i = 0;
  for (const ac of acceptanceCriteria) {
    i += 1;
    const id = typeof ac["id"] === "string" && ac["id"].trim() ? ac["id"].trim() : `ac-${i}`;
    const statement = typeof ac["statement"] === "string" ? ac["statement"].trim() : "";
    const hasOracle =
      typeof ac["expected_text"] === "string" ||
      typeof ac["expected_url_includes"] === "string" ||
      typeof ac["expected_title_includes"] === "string" ||
      (typeof ac["expected_network"] === "object" && ac["expected_network"] !== null) ||
      (typeof ac["expected_result_count"] === "object" && ac["expected_result_count"] !== null);

    if (statement.length === 0) {
      findings.push({
        id: `${id}:empty`,
        severity: "high",
        category: "missing_statement",
        message: `AC ${id} has empty statement — Expert cannot bind intent.`,
      });
      continue;
    }
    if (statement.length < 12 || /^(works|ok|fine|good|test)\.?$/i.test(statement)) {
      findings.push({
        id: `${id}:vague`,
        severity: "high",
        category: "vague_statement",
        message: `AC ${id} is too vague ("${truncate(statement, 60)}") — push back for observable behavior.`,
      });
    }
    if (!hasOracle) {
      findings.push({
        id: `${id}:no_oracle`,
        severity: "high",
        category: "missing_oracle",
        message: `AC ${id} lacks executable oracle (expected_text / url / title / network / expected_result_count) — generator may not_executed.`,
      });
    }
    if (/\b(should|maybe|probably|tbd|etc\.?)\b/i.test(statement)) {
      findings.push({
        id: `${id}:hedge`,
        severity: "medium",
        category: "hedged_language",
        message: `AC ${id} uses hedged language — confirm SHALL with author before release claims.`,
      });
    }
    if (/\b(and|or)\b.+\b(and|or)\b/i.test(statement) && statement.split(/\band\b/i).length > 3) {
      findings.push({
        id: `${id}:compound`,
        severity: "medium",
        category: "compound_criterion",
        message: `AC ${id} packs many conditions — Expert prefers split criteria for clear fail attribution.`,
      });
    }
  }

  return {
    schema_version: "1.0.0",
    finding_count: findings.length,
    findings,
    note: "Spec pushback heuristic — complements assess_requirement_quality when a full Requirement record exists.",
  };
}

export function acQualityPassBlockers(review: AcQualityReview): readonly string[] {
  return review.findings
    .filter((f) => f.severity === "high")
    .map((f) => `ac_quality:${f.category}:${f.id}`);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
