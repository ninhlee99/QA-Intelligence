/**
 * Optional git blast-radius hints for Expert session — when product_root
 * is a git checkout, summarize changed paths so the tester can aim retest.
 * Never invents product risk from filenames alone.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { JsonObject } from "../requirement-review/public.js";

const execFileAsync = promisify(execFile);

export type GitBlastRadius = Readonly<{
  schema_version: "1.0.0";
  available: boolean;
  message: string;
  changed_files: readonly string[];
  hotspots: readonly string[];
  suggested_retest_focus: readonly string[];
}>;

export async function assessGitBlastRadius(productRoot: string | undefined): Promise<GitBlastRadius> {
  if (productRoot === undefined || productRoot.trim().length === 0) {
    return empty("product_root not supplied — no blast-radius scan.");
  }
  const root = productRoot.trim();
  if (!existsSync(join(root, ".git"))) {
    return empty(`No .git under ${root} — skip blast-radius.`);
  }

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--name-only", "HEAD", "--", "."],
      { cwd: root, timeout: 8_000, maxBuffer: 1024 * 1024 },
    );
    let files = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (files.length === 0) {
      const staged = await execFileAsync("git", ["diff", "--name-only", "--cached"], {
        cwd: root,
        timeout: 8_000,
        maxBuffer: 1024 * 1024,
      });
      files = staged.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    }

    if (files.length === 0) {
      // Unpushed commits vs upstream if any
      try {
        const vsUpstream = await execFileAsync(
          "git",
          ["diff", "--name-only", "@{upstream}...HEAD"],
          { cwd: root, timeout: 8_000, maxBuffer: 1024 * 1024 },
        );
        files = vsUpstream.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
      } catch {
        /* no upstream */
      }
    }

    if (files.length === 0) {
      return {
        schema_version: "1.0.0",
        available: true,
        message: "Git repo clean vs HEAD/upstream — no path blast-radius from diff.",
        changed_files: [],
        hotspots: [],
        suggested_retest_focus: [],
      };
    }

    const hotspots = files.filter((f) =>
      /(auth|login|pay|billing|permission|admin|security|password|token|checkout)/i.test(f),
    );
    const suggested = suggestFocus(files);

    return {
      schema_version: "1.0.0",
      available: true,
      message: `${files.length} changed path(s) — Expert should aim retest at hotspots, not only AC text.`,
      changed_files: files.slice(0, 40),
      hotspots: hotspots.slice(0, 20),
      suggested_retest_focus: suggested,
    };
  } catch (error) {
    return empty(`git blast-radius failed: ${(error as Error).message}`);
  }
}

export function gitBlastRadiusJson(value: GitBlastRadius): JsonObject {
  return {
    schema_version: value.schema_version,
    available: value.available,
    message: value.message,
    changed_files: [...value.changed_files],
    hotspots: [...value.hotspots],
    suggested_retest_focus: [...value.suggested_retest_focus],
  };
}

function empty(message: string): GitBlastRadius {
  return {
    schema_version: "1.0.0",
    available: false,
    message,
    changed_files: [],
    hotspots: [],
    suggested_retest_focus: [],
  };
}

function suggestFocus(files: readonly string[]): string[] {
  const focus: string[] = [];
  if (files.some((f) => /auth|login|session/i.test(f))) focus.push("Re-run session-gated login path + role compare if roles matter.");
  if (files.some((f) => /pay|billing|invoice|checkout/i.test(f))) {
    focus.push("Re-run money AC with expected_network; confirm ledger oracles with human.");
  }
  if (files.some((f) => /api|openapi|controller|route/i.test(f))) {
    focus.push("Re-run OpenAPI smoke + authz negatives for touched routes.");
  }
  if (files.some((f) => /permission|rbac|role|policy/i.test(f))) {
    focus.push("Re-run dual-role UI compare and wrong-role API cases.");
  }
  if (focus.length === 0) {
    focus.push("Map changed paths to screens/AC manually — filenames are hints, not oracles.");
  }
  return focus;
}
