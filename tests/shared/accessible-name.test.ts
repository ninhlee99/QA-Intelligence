import assert from "node:assert/strict";
import test from "node:test";

import { accessibleNamesMatch } from "../../src/shared/accessible-name.js";

test("matches identical names", () => {
  assert.equal(accessibleNamesMatch("Username", "Username"), true);
});

test("matches regardless of case", () => {
  assert.equal(accessibleNamesMatch("Username", "USERNAME"), true);
  assert.equal(accessibleNamesMatch("username", "Username"), true);
});

test("matches with surrounding whitespace trimmed", () => {
  assert.equal(accessibleNamesMatch(" Username ", "Username"), true);
  assert.equal(accessibleNamesMatch("Username", "\tUsername\n"), true);
});

test("does not collapse internal whitespace", () => {
  assert.equal(accessibleNamesMatch("Sign  in", "Sign in"), false);
});

test("does not match genuinely different names", () => {
  assert.equal(accessibleNamesMatch("Username", "Password"), false);
});

test("never matches when either side is undefined", () => {
  assert.equal(accessibleNamesMatch(undefined, "Username"), false);
  assert.equal(accessibleNamesMatch("Username", undefined), false);
  assert.equal(accessibleNamesMatch(undefined, undefined), false);
});

test("does not match two empty strings as if they were named", () => {
  assert.equal(accessibleNamesMatch("", ""), false);
  assert.equal(accessibleNamesMatch("  ", " "), false);
});
