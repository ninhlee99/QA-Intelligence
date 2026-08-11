/**
 * Durable TestDataset registry under `.qa-test-datasets/<workspace>/`.
 * Same contract as in-memory; survives MCP restart.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  InMemoryWorkspaceDatasetRegistry,
  type RegisterTestDatasetInput,
  type RegisterTestDatasetResult,
} from "./workspace-dataset-registry.js";
import type { TestDataset } from "./public.js";

export type FileRegisterTestDatasetResult =
  | Readonly<{ ok: true; dataset: TestDataset; persisted_path: string }>
  | Readonly<{ ok: false; code: "invalid_input" | "persist_failed"; message: string }>;

export class FileBackedWorkspaceDatasetRegistry {
  readonly #memory: InMemoryWorkspaceDatasetRegistry;
  readonly #rootDir: string;
  readonly #loaded = new Set<string>();

  constructor(clock: { now(): Date } = { now: () => new Date() }, rootDir: string) {
    this.#memory = new InMemoryWorkspaceDatasetRegistry(clock);
    this.#rootDir = rootDir;
  }

  get rootDir(): string {
    return this.#rootDir;
  }

  register(input: RegisterTestDatasetInput): FileRegisterTestDatasetResult {
    this.#ensureWorkspaceLoaded(input.workspace_id);
    const registered = this.#memory.register(input);
    if (!registered.ok) return registered;
    try {
      const path = this.#datasetPath(input.workspace_id, registered.dataset.id);
      mkdirSync(this.#workspaceDir(input.workspace_id), { recursive: true });
      writeFileSync(path, JSON.stringify(registered.dataset, null, 2), "utf8");
      return { ok: true, dataset: registered.dataset, persisted_path: path };
    } catch (error) {
      return {
        ok: false,
        code: "persist_failed",
        message: `Dataset registered in-memory but failed to persist: ${(error as Error).message}`,
      };
    }
  }

  list(workspaceId: string): readonly TestDataset[] {
    this.#ensureWorkspaceLoaded(workspaceId);
    return this.#memory.list(workspaceId);
  }

  get(workspaceId: string, id: string): TestDataset | undefined {
    this.#ensureWorkspaceLoaded(workspaceId);
    return this.#memory.get(workspaceId, id);
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
        const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as TestDataset;
        if (raw.workspace_scope !== workspaceId || typeof raw.id !== "string") continue;
        if (typeof raw.purpose !== "string") continue;
        this.#memory.put(raw);
      } catch {
        continue;
      }
    }
  }

  #workspaceDir(workspaceId: string): string {
    const safe = workspaceId.replace(/[^A-Za-z0-9._-]/g, "_");
    return join(this.#rootDir, safe);
  }

  #datasetPath(workspaceId: string, id: string): string {
    const safeId = id.replace(/[^A-Za-z0-9._-]/g, "_");
    return join(this.#workspaceDir(workspaceId), `${safeId}.json`);
  }
}

export type WorkspaceDatasetRegistry =
  | InMemoryWorkspaceDatasetRegistry
  | FileBackedWorkspaceDatasetRegistry;
