/**
 * Durable Workspace credential store for the dev MCP slice. Same register/
 * list/resolve contract as `InMemoryWorkspaceCredentialRegistry`, but
 * persists values under a local directory so MCP restarts keep refs.
 *
 * Honesty: this is **not** Vault/KMS — secrets land on local disk (mode
 * 0o600 when the OS allows). Production vault adapters remain out of scope.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";

import type { WorkspaceContext } from "../requirement-review/public.js";
import {
  InMemoryWorkspaceCredentialRegistry,
  type CredentialKind,
  type CredentialRecord,
  type RegisterCredentialInput,
  type RegisterCredentialResult,
} from "./workspace-credential-registry.js";

type PersistedCredential = CredentialRecord & Readonly<{ value: string }>;

export class FileBackedWorkspaceCredentialRegistry {
  readonly #memory: InMemoryWorkspaceCredentialRegistry;
  readonly #rootDir: string;
  readonly #loaded = new Set<string>();

  constructor(clock: { now(): Date } = { now: () => new Date() }, rootDir: string) {
    this.#memory = new InMemoryWorkspaceCredentialRegistry(clock);
    this.#rootDir = rootDir;
  }

  get rootDir(): string {
    return this.#rootDir;
  }

  register(input: RegisterCredentialInput): RegisterCredentialResult & { persisted_path?: string } {
    this.#ensureWorkspaceLoaded(input.workspace_id);
    const registered = this.#memory.register(input);
    if (!registered.ok) return registered;

    try {
      const path = this.#credentialPath(input.workspace_id, registered.record.secret_ref);
      mkdirSync(this.#workspaceDir(input.workspace_id), { recursive: true });
      const payload: PersistedCredential = { ...registered.record, value: input.value };
      writeFileSync(path, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
      try {
        chmodSync(path, 0o600);
      } catch {
        // Windows / some FS ignore chmod — still persisted.
      }
      return { ok: true, record: registered.record, persisted_path: path };
    } catch {
      // In-memory still holds the secret for this process; disk durability failed.
      return { ok: true, record: registered.record };
    }
  }

  list(workspaceId: string): readonly CredentialRecord[] {
    this.#ensureWorkspaceLoaded(workspaceId);
    return this.#memory.list(workspaceId);
  }

  async resolve(secretRef: string, workspace: WorkspaceContext): Promise<string | undefined> {
    this.#ensureWorkspaceLoaded(workspace.workspace_id);
    return this.#memory.resolve(secretRef, workspace);
  }

  resolveSync(secretRef: string, workspaceId: string): string | undefined {
    this.#ensureWorkspaceLoaded(workspaceId);
    return this.#memory.resolveSync(secretRef, workspaceId);
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
        const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as PersistedCredential;
        if (raw.workspace_id !== workspaceId || typeof raw.secret_ref !== "string" || typeof raw.value !== "string") {
          continue;
        }
        this.#memory.register({
          workspace_id: raw.workspace_id,
          secret_ref: raw.secret_ref,
          value: raw.value,
          kind: (raw.kind as CredentialKind | undefined) ?? "other",
          label: raw.label,
        });
      } catch {
        // Skip corrupt files — do not invent credentials.
      }
    }
  }

  #workspaceDir(workspaceId: string): string {
    const safe = workspaceId.replace(/[^A-Za-z0-9._-]/g, "_");
    return join(this.#rootDir, safe);
  }

  #credentialPath(workspaceId: string, secretRef: string): string {
    const leaf = secretRef.replace(/^workspace-secret:/, "").replace(/[^A-Za-z0-9._-]/g, "_");
    return join(this.#workspaceDir(workspaceId), `${leaf}.json`);
  }
}
