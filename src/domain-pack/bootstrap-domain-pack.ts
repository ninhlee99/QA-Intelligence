/**
 * Writes or updates a product `domain-knowledge/` pack from templates +
 * request context. Used by Expert G0d so hosts need not `cp` manually.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type BootstrapDomainPackInput = Readonly<{
  /** Absolute path to product workspace root (app under test). */
  product_root: string;
  /** Optional: URL / ticket / AC summary used to seed stubs. */
  request_context?: string;
  /** Prefer domain-knowledge/ (default) or .qa-domain/ */
  pack_dirname?: "domain-knowledge" | ".qa-domain";
  /** Template root; defaults to hosts/templates/domain-knowledge in this repo. */
  template_root?: string;
}>;

export type BootstrapDomainPackResult = Readonly<{
  ok: true;
  pack_path: string;
  created: boolean;
  updated_files: readonly string[];
  notes: readonly string[];
}> | Readonly<{
  ok: false;
  message: string;
}>;

export function defaultDomainPackTemplateRoot(): string {
  // dist/src/domain-pack/... → repo root
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../../hosts/templates/domain-knowledge");
}

export function bootstrapDomainPack(input: BootstrapDomainPackInput): BootstrapDomainPackResult {
  const root = input.product_root.trim();
  if (!isAbsolute(root)) {
    return { ok: false, message: "product_root must be an absolute path to the product workspace." };
  }
  if (!existsSync(root)) {
    return { ok: false, message: `product_root does not exist: ${root}` };
  }

  const packName = input.pack_dirname ?? "domain-knowledge";
  const packPath = join(root, packName);
  const templateRoot = input.template_root ?? defaultDomainPackTemplateRoot();
  if (!existsSync(templateRoot)) {
    return { ok: false, message: `Template root missing: ${templateRoot}` };
  }

  const created = !existsSync(join(packPath, "INDEX.md"));
  mkdirSync(packPath, { recursive: true });

  const updated: string[] = [];
  const notes: string[] = [];
  const context = (input.request_context ?? "").trim();
  const lower = context.toLowerCase();

  let templateFiles: string[] = [];
  try {
    templateFiles = readdirSync(templateRoot).filter((name) => name.endsWith(".md"));
  } catch (error) {
    return { ok: false, message: `Cannot read templates: ${(error as Error).message}` };
  }

  for (const file of templateFiles) {
    const dest = join(packPath, file);
    if (!existsSync(dest)) {
      let body = readFileSync(join(templateRoot, file), "utf8");
      if (file === "INDEX.md" && context.length > 0) {
        body = body
          .replace("<!-- name -->", extractProductHint(context) || "<!-- name -->")
          .replace("<!-- YYYY-MM-DD -->", new Date().toISOString().slice(0, 10));
      }
      if (file === "permissions.md" && /(role|admin|permission|authz|rbac)/i.test(context)) {
        body += `\n\n## From request (auto)\n\n- Context mentioned roles/auth — confirm matrix before release.\n- Request snippet: ${truncate(context, 400)}\n`;
        notes.push("permission risk flagged from request keywords");
      }
      if (file === "money-flows.md" && /(pay|money|charge|invoice|billing|refund|price)/i.test(lower)) {
        body += `\n\n## From request (auto)\n\n- Money-related wording detected — tag money; human confirm oracles.\n- Request snippet: ${truncate(context, 400)}\n`;
        notes.push("money risk flagged from request keywords");
      }
      if (file === "business.md" && context.length > 0) {
        body += `\n\n## From this test request (auto)\n\n${truncate(context, 800)}\n`;
      }
      writeFileSync(dest, body, "utf8");
      updated.push(file);
    }
  }

  if (!created && context.length > 0) {
    const businessPath = join(packPath, "business.md");
    if (existsSync(businessPath)) {
      const append = `\n\n## Update ${new Date().toISOString().slice(0, 10)} (auto)\n\n${truncate(context, 500)}\n`;
      writeFileSync(businessPath, readFileSync(businessPath, "utf8") + append, "utf8");
      updated.push("business.md");
      notes.push("appended request context to existing business.md");
    }
  }

  if (created) notes.push("pack created from templates");
  if (updated.length === 0) notes.push("pack already complete — no file writes");

  return {
    ok: true,
    pack_path: packPath,
    created,
    updated_files: updated,
    notes,
  };
}

function extractProductHint(context: string): string {
  const urlMatch = context.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    try {
      return new URL(urlMatch[0]).hostname;
    } catch {
      return urlMatch[0].slice(0, 80);
    }
  }
  return context.split("\n")[0]?.slice(0, 80) ?? "";
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
