/** Provider-neutral contracts for the API testing tracer (Phase 8 / SPEC-001). */
import type { ExecutionOutcome } from "../execution/public.js";
import type { JsonObject, StableResult } from "../requirement-review/public.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

/** Expected assertions for one HTTP call — never invents expected values. */
export type ApiSmokeExpectation = Readonly<{
  /** Exact status, or any-of list. Required for a conclusive product verdict. */
  status?: number | readonly number[];
  /** Substring that must appear in the response body text. */
  body_includes?: string;
  /** Response header name (case-insensitive) that must equal `equals` or contain `includes`. */
  header?: Readonly<{
    name: string;
    equals?: string;
    includes?: string;
  }>;
}>;

export type ApiSmokeCase = Readonly<{
  id: string;
  method: HttpMethod;
  /** Path relative to base_url, or absolute URL when it starts with http(s)://. */
  path: string;
  headers?: Readonly<Record<string, string>>;
  body?: string | JsonObject;
  expect: ApiSmokeExpectation;
  /** Optional AC / requirement pin for citations — never invented. */
  requirement_ref?: string;
}>;

export type ApiSmokeCaseResult = Readonly<{
  case_id: string;
  outcome: ExecutionOutcome;
  evidence: readonly string[];
  status?: number;
  duration_ms: number;
  message: string;
  requirement_ref?: string;
}>;

export type ApiSmokeSuiteResult = Readonly<{
  id: string;
  workspace_id: string;
  base_url: string;
  outcome: ExecutionOutcome;
  cases: readonly ApiSmokeCaseResult[];
  evidence: readonly string[];
  timing: Readonly<{ started_at: string; completed_at: string; duration_seconds: number }>;
  engine_ref: string;
}>;

export type ApiSmokeFailure = Readonly<{
  class: "configuration" | "authorization" | "infrastructure";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type ApiSmokeResult = StableResult<ApiSmokeSuiteResult, ApiSmokeFailure>;
