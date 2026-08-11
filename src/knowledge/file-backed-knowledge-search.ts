/**
 * File-backed Knowledge Search seed for the dev MCP slice. Loads/saves
 * `InMemoryKnowledgeRecord[]` under `.qa-knowledge/<workspace>/records.json`
 * so product-context hits survive restart. Not a multi-tenant Knowledge Store.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  InMemoryKnowledgeSearch,
  type InMemoryKnowledgeRecord,
  type InMemoryKnowledgeSearchOptions,
} from "../adapters/memory/knowledge-search.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
} from "../requirement-review/public.js";

export type FileBackedKnowledgeSearchOptions = Readonly<{
  rootDir: string;
  workspace_id: string;
  knowledge_snapshot: string;
  projection_freshness: string;
  /** Seeded when the file is missing / empty. */
  seed_records?: readonly InMemoryKnowledgeRecord[];
}>;

export class FileBackedKnowledgeSearch implements KnowledgeSearch {
  readonly #rootDir: string;
  readonly #workspaceId: string;
  readonly #snapshot: string;
  readonly #freshness: string;
  #inner: InMemoryKnowledgeSearch;

  constructor(options: FileBackedKnowledgeSearchOptions) {
    this.#rootDir = options.rootDir;
    this.#workspaceId = options.workspace_id;
    this.#snapshot = options.knowledge_snapshot;
    this.#freshness = options.projection_freshness;
    const loaded = loadRecords(this.#recordsPath());
    const records =
      loaded.length > 0 ? loaded : [...(options.seed_records ?? [])];
    if (loaded.length === 0 && (options.seed_records?.length ?? 0) > 0) {
      this.#persist(records);
    }
    this.#inner = new InMemoryKnowledgeSearch(this.#options(records));
  }

  get rootDir(): string {
    return this.#rootDir;
  }

  search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult> {
    return this.#inner.search(request);
  }

  /** Append/replace a record by knowledge_ref; persists to disk. */
  upsertRecord(record: InMemoryKnowledgeRecord): Readonly<{ ok: true; persisted_path: string; count: number }> | Readonly<{ ok: false; message: string }> {
    if (record.workspace_id !== this.#workspaceId) {
      return { ok: false, message: "Record workspace_id must match the Knowledge Search Workspace." };
    }
    const current = loadRecords(this.#recordsPath());
    const next = [...current.filter((item) => item.knowledge_ref !== record.knowledge_ref), record];
    const path = this.#persist(next);
    this.#inner = new InMemoryKnowledgeSearch(this.#options(next));
    return { ok: true, persisted_path: path, count: next.length };
  }

  listRecords(): readonly InMemoryKnowledgeRecord[] {
    return loadRecords(this.#recordsPath());
  }

  #options(records: readonly InMemoryKnowledgeRecord[]): InMemoryKnowledgeSearchOptions {
    return {
      workspace_id: this.#workspaceId,
      knowledge_snapshot: this.#snapshot,
      projection_freshness: this.#freshness,
      records,
    };
  }

  #recordsPath(): string {
    const safe = this.#workspaceId.replace(/[^A-Za-z0-9._-]/g, "_");
    return join(this.#rootDir, safe, "records.json");
  }

  #persist(records: readonly InMemoryKnowledgeRecord[]): string {
    const path = this.#recordsPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(records, null, 2), "utf8");
    return path;
  }
}

function loadRecords(path: string): InMemoryKnowledgeRecord[] {
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    const out: InMemoryKnowledgeRecord[] = [];
    for (const entry of raw) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
      const obj = entry as Record<string, unknown>;
      if (typeof obj["workspace_id"] !== "string") continue;
      if (typeof obj["knowledge_ref"] !== "string") continue;
      if (typeof obj["title"] !== "string") continue;
      if (typeof obj["excerpt"] !== "string") continue;
      out.push({
        workspace_id: obj["workspace_id"],
        knowledge_snapshot: typeof obj["knowledge_snapshot"] === "string" ? obj["knowledge_snapshot"] : "0.1.0",
        knowledge_ref: obj["knowledge_ref"],
        title: obj["title"],
        excerpt: obj["excerpt"],
        authority_status: typeof obj["authority_status"] === "string" ? obj["authority_status"] : "accepted",
        scopes: Array.isArray(obj["scopes"]) ? obj["scopes"].filter((s): s is string => typeof s === "string") : [],
        applicability: typeof obj["applicability"] === "object" && obj["applicability"] !== null && !Array.isArray(obj["applicability"])
          ? (obj["applicability"] as InMemoryKnowledgeRecord["applicability"])
          : {},
        provenance: Array.isArray(obj["provenance"])
          ? obj["provenance"].filter((s): s is string => typeof s === "string")
          : [],
        evidence: Array.isArray(obj["evidence"]) ? obj["evidence"].filter((s): s is string => typeof s === "string") : [],
      });
    }
    return out;
  } catch {
    return [];
  }
}
