/**
 * File-backed user preference store. One JSON file per persist root dir:
 *   <persistBaseDir>/.qa-user-prefs.json
 *
 * Currently stores:
 *   language — BCP-47 tag or natural name ("vi", "en", "ja", "Vietnamese", …)
 *              Used to instruct both MCP tool output and Claude/AI responses.
 *
 * Write once via `set_user_preference` MCP tool; read on every tool call.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface UserPreferences {
  /** BCP-47 tag or natural language name, e.g. "vi", "en", "ja", "Vietnamese". */
  language?: string;
}

const PREFS_FILENAME = ".qa-user-prefs.json";

export class FileBackedUserPreferences {
  readonly #path: string;
  #cache: UserPreferences | undefined;

  constructor(persistBaseDir: string) {
    this.#path = join(persistBaseDir, PREFS_FILENAME);
  }

  get(): UserPreferences {
    if (this.#cache !== undefined) return this.#cache;
    if (!existsSync(this.#path)) return (this.#cache = {});
    try {
      const raw = readFileSync(this.#path, "utf8");
      this.#cache = JSON.parse(raw) as UserPreferences;
      return this.#cache;
    } catch {
      return (this.#cache = {});
    }
  }

  set(prefs: Partial<UserPreferences>): void {
    const current = this.get();
    const updated: UserPreferences = { ...current, ...prefs };
    mkdirSync(dirname(this.#path), { recursive: true });
    writeFileSync(this.#path, JSON.stringify(updated, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    this.#cache = updated;
  }

  /** Instruction string to embed in MCP tool output / skill prompts. */
  languageInstruction(): string | undefined {
    const lang = this.get().language;
    if (!lang) return undefined;
    return `Respond in ${lang}. All messages, rationale, and report text must be in ${lang}.`;
  }
}
