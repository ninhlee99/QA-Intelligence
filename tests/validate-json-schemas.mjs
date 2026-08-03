import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

const validPairs = {
  "examples/agents/requirement-review-agent.example.json":
    "schemas/agent-definition.schema.json",
  "examples/skills/assess-requirement-quality.example.json":
    "schemas/skill-definition.schema.json",
  "examples/evaluations/skill-core-suite.example.json":
    "schemas/evaluation-suite.schema.json",
  "examples/evaluations/skill-negative-trigger.example.json":
    "schemas/evaluation-case.schema.json",
  "examples/evaluations/skill-positive-rule-only.example.json":
    "schemas/evaluation-case.schema.json",
  "examples/evaluations/skill-ambiguous-reasoning.example.json":
    "schemas/evaluation-case.schema.json",
  "examples/evaluations/skill-prompt-injection.example.json":
    "schemas/evaluation-case.schema.json",
  "examples/evaluations/skill-cross-workspace.example.json":
    "schemas/evaluation-case.schema.json",
  "examples/evaluations/agent-budget-no-progress.example.json":
    "schemas/evaluation-case.schema.json",
  "examples/evaluations/agent-provider-failure.example.json":
    "schemas/evaluation-case.schema.json",
  "examples/evaluations/agent-evidence-completeness.example.json":
    "schemas/evaluation-case.schema.json",
  "examples/prompts/requirement-assessment.example.json":
    "schemas/prompt-template.schema.json",
  "examples/tools/knowledge-search.example.json":
    "schemas/tool-definition.schema.json",
  "examples/tools/knowledge-search-input.example.json":
    "schemas/knowledge-search-input.schema.json",
  "examples/tools/knowledge-search-result.example.json":
    "schemas/knowledge-search-result.schema.json",
  "examples/assessments/requirement-assessment.example.json":
    "schemas/requirement-assessment.schema.json",
  "examples/runtime/agent-run-start.example.json":
    "schemas/agent-run-start.schema.json",
  "examples/runtime/agent-run-snapshot.example.json":
    "schemas/agent-run-snapshot.schema.json",
  "examples/runtime/agent-run-result.example.json":
    "schemas/agent-run-result.schema.json",
  "examples/runtime/agent-run-event-payload.example.json":
    "schemas/agent-run-event-payload.schema.json",
  "examples/runtime/agent-run-event.example.json":
    "schemas/agent-run-event.schema.json",
};

const invalidPairs = {
  "examples/invalid/agent-definition.invalid.json":
    "schemas/agent-definition.schema.json",
  "examples/invalid/skill-definition.invalid.json":
    "schemas/skill-definition.schema.json",
  "examples/invalid/evaluation-suite.invalid.json":
    "schemas/evaluation-suite.schema.json",
  "examples/invalid/evaluation-case.invalid.json":
    "schemas/evaluation-case.schema.json",
  "examples/invalid/prompt-template.invalid.json":
    "schemas/prompt-template.schema.json",
  "examples/invalid/tool-definition.invalid.json":
    "schemas/tool-definition.schema.json",
  "examples/invalid/requirement-assessment.invalid.json":
    "schemas/requirement-assessment.schema.json",
  "examples/invalid/knowledge-search-input.invalid.json":
    "schemas/knowledge-search-input.schema.json",
  "examples/invalid/knowledge-search-result.invalid.json":
    "schemas/knowledge-search-result.schema.json",
  "examples/invalid/agent-run-start.invalid.json":
    "schemas/agent-run-start.schema.json",
  "examples/invalid/agent-run-snapshot.invalid.json":
    "schemas/agent-run-snapshot.schema.json",
  "examples/invalid/agent-run-result.invalid.json":
    "schemas/agent-run-result.schema.json",
  "examples/invalid/agent-run-event-payload.invalid.json":
    "schemas/agent-run-event-payload.schema.json",
  "examples/invalid/agent-run-event.invalid.json":
    "schemas/agent-run-event.schema.json",
};

const schemaDirectory = path.join(root, "schemas");
const schemaPaths = fs
  .readdirSync(schemaDirectory)
  .filter((name) => name.endsWith(".schema.json"))
  .sort()
  .map((name) => `schemas/${name}`);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const validators = new Map();
for (const schemaPath of schemaPaths) {
  const schema = readJson(schemaPath);
  validators.set(schemaPath, ajv.compile(schema));
}

const failures = [];
for (const [examplePath, schemaPath] of Object.entries(validPairs)) {
  const validate = validators.get(schemaPath);
  if (!validate(readJson(examplePath))) {
    failures.push({ examplePath, expected: "valid", errors: validate.errors });
  }
}

for (const [examplePath, schemaPath] of Object.entries(invalidPairs)) {
  const validate = validators.get(schemaPath);
  if (validate(readJson(examplePath))) {
    failures.push({ examplePath, expected: "invalid", errors: [] });
  }
}

const report = {
  outcome: failures.length === 0 ? "pass" : "fail",
  draft: "2020-12",
  schemasCompiled: schemaPaths.length,
  validExamplesAccepted: Object.keys(validPairs).length,
  invalidExamplesRejected: Object.keys(invalidPairs).length,
  failures,
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
