import assert from "node:assert/strict";
import test from "node:test";

import {
  hasExactResolvedVersions,
  isExactVersionReference,
  isJsonObject,
  isSemanticVersion,
  parseVersionReference,
  readEnum,
  readObject,
  readString,
  readStrings,
  unique,
} from "../../src/shared/rule-engine-support.js";
import type { JsonObject } from "../../src/requirement-review/public.js";

test("readObject returns the nested object only when it is a plain object", () => {
  const source: JsonObject = { a: { b: 1 }, c: [1, 2], d: "x" };
  assert.deepEqual(readObject(source, "a"), { b: 1 });
  assert.equal(readObject(source, "c"), undefined);
  assert.equal(readObject(source, "d"), undefined);
  assert.equal(readObject(source, "missing"), undefined);
});

test("readString returns a non-empty string only", () => {
  const source: JsonObject = { a: "hello", b: "", c: 1, d: null };
  assert.equal(readString(source, "a"), "hello");
  assert.equal(readString(source, "b"), undefined);
  assert.equal(readString(source, "c"), undefined);
  assert.equal(readString(source, "d"), undefined);
  assert.equal(readString(source, "missing"), undefined);
});

test("readStrings filters to non-empty strings only, dropping other types", () => {
  const source: JsonObject = { a: ["x", "", 1, null, "y"], b: "not-an-array" };
  assert.deepEqual(readStrings(source, "a"), ["x", "y"]);
  assert.deepEqual(readStrings(source, "b"), []);
  assert.deepEqual(readStrings(source, "missing"), []);
});

test("readEnum returns the value only when it is a member of the allowed set", () => {
  const source: JsonObject = { a: "high", b: "extreme" };
  assert.equal(readEnum(source, "a", ["low", "medium", "high"] as const), "high");
  assert.equal(readEnum(source, "b", ["low", "medium", "high"] as const), undefined);
  assert.equal(readEnum(source, "missing", ["low", "medium", "high"] as const), undefined);
});

test("isJsonObject distinguishes plain objects from arrays, null, and primitives", () => {
  assert.equal(isJsonObject({}), true);
  assert.equal(isJsonObject([]), false);
  assert.equal(isJsonObject(null), false);
  assert.equal(isJsonObject("x"), false);
  assert.equal(isJsonObject(undefined), false);
});

test("unique deduplicates while preserving first-seen order", () => {
  assert.deepEqual(unique(["a", "b", "a", "c", "b"]), ["a", "b", "c"]);
});

test("parseVersionReference splits on the LAST @ so an id is recoverable even if it contains one", () => {
  assert.deepEqual(parseVersionReference("assess-requirement-quality@1.0.0"), {
    id: "assess-requirement-quality",
    version: "1.0.0",
  });
  assert.deepEqual(parseVersionReference("@scope/pkg@2.1.0"), { id: "@scope/pkg", version: "2.1.0" });
});

test("parseVersionReference falls back to 'unresolved' for a malformed reference", () => {
  assert.deepEqual(parseVersionReference("no-at-sign"), { id: "no-at-sign", version: "unresolved" });
  assert.deepEqual(parseVersionReference("trailing-at@"), { id: "trailing-at@", version: "unresolved" });
});

test("isExactVersionReference requires an id, an @, and a semantic version", () => {
  assert.equal(isExactVersionReference("skill@1.0.0"), true);
  assert.equal(isExactVersionReference("skill@1.0.0-beta.1"), true);
  assert.equal(isExactVersionReference("skill@latest"), false);
  assert.equal(isExactVersionReference("skill"), false);
});

test("isSemanticVersion accepts x.y.z with an optional prerelease suffix only", () => {
  assert.equal(isSemanticVersion("1.0.0"), true);
  assert.equal(isSemanticVersion("1.0.0-rc.1"), true);
  assert.equal(isSemanticVersion("1.0"), false);
  assert.equal(isSemanticVersion("skill@1.0.0"), false);
});

test("hasExactResolvedVersions requires every core field to be an exact pin", () => {
  const complete = {
    agent: "agent@1.0.0",
    skill: "skill@1.0.0",
    rule_set: "rule-set@1.0.0",
    knowledge_snapshot: "1.0.0",
    policy: "policy@1.0.0",
    input_schema: "input.schema.json@1.0.0",
    output_schema: "output.schema.json@1.0.0",
  };
  assert.equal(hasExactResolvedVersions(complete), true);
  assert.equal(hasExactResolvedVersions({ ...complete, agent: "latest" }), false);
  assert.equal(hasExactResolvedVersions({ ...complete, knowledge_snapshot: "not-semver" }), false);
});
