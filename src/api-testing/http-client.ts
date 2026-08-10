/**
 * Minimal HTTP client for API smoke (Phase 8). Uses undici/fetch built into
 * Node 24. Isolates network I/O so the Skill can treat DNS/timeout as
 * infrastructure_error rather than product failed (SPEC-210 §4).
 */
export type HttpRequest = Readonly<{
  url: string;
  method: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
  timeout_ms: number;
  signal?: AbortSignal;
}>;

export type HttpResponse = Readonly<{
  ok: true;
  status: number;
  headers: Readonly<Record<string, string>>;
  body_text: string;
  duration_ms: number;
}> | Readonly<{
  ok: false;
  class: "infrastructure";
  message: string;
  duration_ms: number;
  evidence: readonly string[];
}>;

export interface HttpClient {
  request(input: HttpRequest): Promise<HttpResponse>;
}

export class FetchHttpClient implements HttpClient {
  async request(input: HttpRequest): Promise<HttpResponse> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeout_ms);
    const onAbort = (): void => controller.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: { ...input.headers },
        ...(input.body !== undefined ? { body: input.body } : {}),
        signal: controller.signal,
        redirect: "manual",
      });
      const body_text = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      return {
        ok: true,
        status: response.status,
        headers,
        body_text,
        duration_ms: Date.now() - started,
      };
    } catch (error) {
      const duration_ms = Date.now() - started;
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : String(error);
      const aborted = name === "AbortError" || input.signal?.aborted === true;
      return {
        ok: false,
        class: "infrastructure",
        message: aborted
          ? `HTTP request timed out or was cancelled after ${input.timeout_ms}ms: ${message}`
          : `HTTP transport failure: ${message}`,
        duration_ms,
        evidence: [
          `http:infrastructure:${aborted ? "timeout_or_cancel" : "transport"}`,
          `url:${input.url}`,
          `method:${input.method}`,
        ],
      };
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
    }
  }
}
