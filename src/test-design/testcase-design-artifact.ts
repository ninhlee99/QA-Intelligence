import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { TestCase, TestCaseGeneratedAssertion, TestCaseGenerationFinding } from "./public.js";

export type TestcaseDesignArtifactInput = Readonly<{
  output_dir: string;
  workspace_id: string;
  requirement_ref: string;
  generated_at: string;
  test_cases: readonly TestCase[];
  generated_assertions: readonly TestCaseGeneratedAssertion[];
  findings: readonly TestCaseGenerationFinding[];
}>;

type ArtifactBody = Readonly<{
  schema_version: "1.0.0";
  artifact_kind: "qa_testcase_design";
  workspace_id: string;
  requirement_ref: string;
  generated_at: string;
  test_cases: readonly TestCase[];
  generated_assertions: readonly TestCaseGeneratedAssertion[];
  findings: readonly TestCaseGenerationFinding[];
}>;

export async function writeTestcaseDesignArtifact(input: TestcaseDesignArtifactInput): Promise<
  Readonly<{ ok: true; path: string; sha256: string }> | Readonly<{ ok: false; message: string }>
> {
  const body: ArtifactBody = {
    schema_version: "1.0.0",
    artifact_kind: "qa_testcase_design",
    workspace_id: input.workspace_id,
    requirement_ref: input.requirement_ref,
    generated_at: input.generated_at,
    test_cases: input.test_cases,
    generated_assertions: input.generated_assertions,
    findings: input.findings,
  };
  const sha256 = digest(body);
  const path = join(input.output_dir, "testcase-design.json");
  const temporary = `${path}.tmp`;
  try {
    await mkdir(input.output_dir, { recursive: true });
    await writeFile(temporary, `${JSON.stringify({ ...body, integrity: { algorithm: "sha256", digest: sha256 } }, null, 2)}\n`, "utf8");
    await rename(temporary, path);
    return { ok: true, path, sha256 };
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    return { ok: false, message: `Failed to write testcase design artifact: ${(error as Error).message}` };
  }
}

export async function loadTestcaseDesignCase(input: Readonly<{
  artifact_path: string;
  allowed_root: string;
  workspace_id: string;
  test_case_id: string;
}>): Promise<
  | Readonly<{ ok: true; test_case: TestCase; generated_assertion: TestCaseGeneratedAssertion; artifact_sha256: string }>
  | Readonly<{ ok: false; message: string }>
> {
  try {
    const root = await realpath(resolve(input.allowed_root));
    const requested = resolve(root, input.artifact_path);
    const path = await realpath(requested);
    if (!isWithin(root, path)) return { ok: false, message: "testcase_file must stay within the configured testcase artifact root." };

    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed) || parsed["schema_version"] !== "1.0.0" || parsed["artifact_kind"] !== "qa_testcase_design") {
      return { ok: false, message: "testcase_file is not a supported qa_testcase_design@1.0.0 artifact." };
    }
    if (parsed["workspace_id"] !== input.workspace_id) return { ok: false, message: "testcase_file belongs to a different Workspace." };
    const integrity = parsed["integrity"];
    if (!isRecord(integrity) || integrity["algorithm"] !== "sha256" || typeof integrity["digest"] !== "string") {
      return { ok: false, message: "testcase_file has no valid SHA-256 integrity declaration." };
    }
    const { integrity: _integrity, ...body } = parsed;
    if (digest(body) !== integrity["digest"]) return { ok: false, message: "testcase_file integrity verification failed." };
    if (!Array.isArray(parsed["test_cases"]) || !Array.isArray(parsed["generated_assertions"])) {
      return { ok: false, message: "testcase_file must contain test_cases and generated_assertions arrays." };
    }
    const testCase = parsed["test_cases"].find((value) => isRecord(value) && value["id"] === input.test_case_id);
    const assertion = parsed["generated_assertions"].find((value) => isRecord(value) && value["test_case_id"] === input.test_case_id);
    if (!isRecord(testCase)) return { ok: false, message: `testcase_file has no testcase ${JSON.stringify(input.test_case_id)}.` };
    if (!isRecord(assertion)) return { ok: false, message: `testcase_file has no generated assertion for ${JSON.stringify(input.test_case_id)}.` };
    return {
      ok: true,
      test_case: testCase as unknown as TestCase,
      generated_assertion: assertion as unknown as TestCaseGeneratedAssertion,
      artifact_sha256: integrity["digest"],
    };
  } catch (error) {
    return { ok: false, message: `Failed to load testcase_file: ${(error as Error).message}` };
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
