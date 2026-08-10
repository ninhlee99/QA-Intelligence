/**
 * Durable regression suite store: same contract as in-memory registry, but
 * persists each suite as JSON under a Workspace directory so MCP restarts
 * do not wipe packs. Dev tracer — not a multi-tenant DB.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  InMemoryRegressionSuiteRegistry,
  type RegisterRegressionSuiteInput,
  type RegressionSuite,
} from "./regression-suite-registry.js";

export class FileBackedRegressionSuiteRegistry {
  readonly #memory: InMemoryRegressionSuiteRegistry;
  readonly #rootDir: string;
  readonly #loaded = new Set<string>();

  constructor(clock: { now(): Date } = { now: () => new Date() }, rootDir: string) {
    this.#memory = new InMemoryRegressionSuiteRegistry(clock);
    this.#rootDir = rootDir;
  }

  get rootDir(): string {
    return this.#rootDir;
  }

  register(input: RegisterRegressionSuiteInput):
    | Readonly<{ ok: true; suite: RegressionSuite; persisted_path: string }>
    | Readonly<{ ok: false; code: "invalid_input" | "persist_failed"; message: string }> {
    this.#ensureWorkspaceLoaded(input.workspace_id);
    const registered = this.#memory.register(input);
    if (!registered.ok) return registered;

    try {
      const path = this.#suitePath(input.workspace_id, registered.suite.id);
      mkdirSync(this.#workspaceDir(input.workspace_id), { recursive: true });
      writeFileSync(path, JSON.stringify(registered.suite, null, 2), "utf8");
      return { ok: true, suite: registered.suite, persisted_path: path };
    } catch (error) {
      return {
        ok: false,
        code: "persist_failed",
        message: `Suite registered in-memory but failed to persist: ${(error as Error).message}`,
      };
    }
  }

  list(workspaceId: string): readonly Readonly<{ id: string; label: string; case_count: number; registered_at: string }>[] {
    this.#ensureWorkspaceLoaded(workspaceId);
    return this.#memory.list(workspaceId);
  }

  get(workspaceId: string, suiteId: string): RegressionSuite | undefined {
    this.#ensureWorkspaceLoaded(workspaceId);
    return this.#memory.get(workspaceId, suiteId);
  }

  #ensureWorkspaceLoaded(workspaceId: string): void {
    if (this.#loaded.has(workspaceId)) return;
    this.#loaded.add(workspaceId);
    const dir = this.#workspaceDir(workspaceId);
    if (!existsSync(dir)) return;
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((name) => name.endsWith(".json"));
    } catch {
      return;
    }
    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as RegressionSuite;
        if (raw.workspace_id !== workspaceId || !Array.isArray(raw.cases) || raw.cases.length === 0) continue;
        this.#memory.register({
          workspace_id: raw.workspace_id,
          id: raw.id,
          label: raw.label,
          cases: raw.cases,
          ...(raw.environment_ref !== undefined ? { environment_ref: raw.environment_ref } : {}),
          ...(raw.base_url !== undefined ? { base_url: raw.base_url } : {}),
        });
      } catch {
        // Skip corrupt files — fail open for other suites.
      }
    }
  }

  #workspaceDir(workspaceId: string): string {
    return join(this.#rootDir, sanitizeSegment(workspaceId));
  }

  #suitePath(workspaceId: string, suiteId: string): string {
    return join(this.#workspaceDir(workspaceId), `${sanitizeSegment(suiteId)}.json`);
  }
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180);
}
