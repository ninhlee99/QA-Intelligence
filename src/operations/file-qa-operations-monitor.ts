import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { QaOperationalEvent } from "../observability/qa-operations.js";

export type QaOperationRecord = Readonly<{ event: QaOperationalEvent; occurred_at: string; workspace_id: string; detail?: string }>;

export class FileQaOperationsMonitor {
  constructor(private readonly options: Readonly<{ path: string; max_failure_rate: number }>) {}
  async record(record: QaOperationRecord): Promise<void> {
    await mkdir(dirname(this.options.path), { recursive: true });
    const safe = { ...record, ...(record.detail === undefined ? {} : { detail: redact(record.detail) }) };
    await appendFile(this.options.path, `${JSON.stringify(safe)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  async health(): Promise<Readonly<{ healthy: boolean; completed: number; failure_rate: number; max_failure_rate: number }>> {
    let text = "";
    try { text = await readFile(this.options.path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const records = text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as QaOperationRecord);
    const passed = records.filter((item) => item.event === "run_passed").length;
    const failed = records.filter((item) => item.event === "run_failed").length;
    const completed = passed + failed;
    const failureRate = completed === 0 ? 0 : failed / completed;
    return { healthy: completed > 0 && failureRate <= this.options.max_failure_rate, completed, failure_rate: failureRate, max_failure_rate: this.options.max_failure_rate };
  }
}

function redact(value: string): string {
  return value
    .replace(/\b(password|passcode|secret|token|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
}
