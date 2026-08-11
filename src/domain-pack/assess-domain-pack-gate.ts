/**
 * Read-only domain pack gate assessment for Expert claim_pass.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import type { DomainPackGateInput } from "../reporting/expert-checklist.js";

export type AssessDomainPackGateInput = Readonly<{
  product_root?: string;
  pack_dirname?: "domain-knowledge" | ".qa-domain";
  acknowledge_domain_pack_absent?: boolean;
  domain_high_risk_confirmed?: boolean;
  /** Notes from bootstrap (keyword flags). */
  bootstrap_notes?: readonly string[];
}>;

export function assessDomainPackGate(input: AssessDomainPackGateInput): DomainPackGateInput {
  const root = input.product_root?.trim();
  if (root === undefined || root.length === 0 || !isAbsolute(root) || !existsSync(root)) {
    return {
      present: false,
      high_risk_unconfirmed: false,
      ...(input.acknowledge_domain_pack_absent === true ? { acknowledged_absent: true } : {}),
      notes: ["product_root missing or invalid — domain pack status unknown/absent"],
    };
  }

  const preferred = input.pack_dirname ?? "domain-knowledge";
  const candidates = preferred === ".qa-domain" ? [".qa-domain", "domain-knowledge"] : ["domain-knowledge", ".qa-domain"];
  let packPath: string | undefined;
  for (const name of candidates) {
    const path = join(root, name);
    if (existsSync(join(path, "INDEX.md"))) {
      packPath = path;
      break;
    }
  }

  if (packPath === undefined) {
    return {
      present: false,
      high_risk_unconfirmed: false,
      ...(input.acknowledge_domain_pack_absent === true ? { acknowledged_absent: true } : {}),
      notes: ["no domain-knowledge/INDEX.md or .qa-domain/INDEX.md under product_root"],
    };
  }

  const highRisk = detectHighRiskUnconfirmed(packPath, input.bootstrap_notes ?? []);
  return {
    present: true,
    high_risk_unconfirmed: highRisk.unconfirmed,
    ...(input.domain_high_risk_confirmed === true ? { high_risk_confirmed: true } : {}),
    pack_path: packPath,
    notes: highRisk.notes,
  };
}

function detectHighRiskUnconfirmed(
  packPath: string,
  bootstrapNotes: readonly string[],
): Readonly<{ unconfirmed: boolean; notes: string[] }> {
  const notes: string[] = [...bootstrapNotes];
  let unconfirmed = false;

  const keywordFlag = bootstrapNotes.some((n) => /money risk|permission risk/i.test(n));
  if (keywordFlag) {
    unconfirmed = true;
    notes.push("bootstrap flagged money/permission risk — needs human confirm");
  }

  let files: string[] = [];
  try {
    files = readdirSync(packPath).filter((name) => name.endsWith(".md"));
  } catch {
    return { unconfirmed: true, notes: [...notes, "cannot read pack files"] };
  }

  for (const file of files) {
    let body = "";
    try {
      body = readFileSync(join(packPath, file), "utf8");
    } catch {
      continue;
    }
    const lower = body.toLowerCase();
    const hasHighRiskTag =
      /\b(money|permission|legacy|pii)\b/.test(lower) ||
      /tag\s*`?(money|permission|legacy|pii)/i.test(body);
    const hasTodo =
      /<!--\s*todo/i.test(body) ||
      /\btodo:\s*confirm/i.test(lower) ||
      /confirm (with )?human/i.test(lower) ||
      /confirm matrix before release/i.test(lower) ||
      /human confirm oracles/i.test(lower);
    if (hasHighRiskTag && hasTodo) {
      unconfirmed = true;
      notes.push(`${file}: high-risk tag with TODO/confirm language`);
    }
  }

  return { unconfirmed, notes };
}
