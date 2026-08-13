import assert from "node:assert/strict";
import test from "node:test";

import {
  createLaunchBrowser,
  headedFromInput,
  isHeadedFromEnv,
  resolveHeaded,
} from "../../../src/adapters/playwright/browser-launcher.js";

test("resolveHeaded: explicit true/false wins over env", () => {
  const previous = process.env["QA_INTELLIGENCE_HEADED"];
  try {
    process.env["QA_INTELLIGENCE_HEADED"] = "1";
    assert.equal(resolveHeaded(false), false);
    assert.equal(resolveHeaded(true), true);
    delete process.env["QA_INTELLIGENCE_HEADED"];
    assert.equal(resolveHeaded(true), true);
    assert.equal(resolveHeaded(undefined), false);
  } finally {
    if (previous === undefined) delete process.env["QA_INTELLIGENCE_HEADED"];
    else process.env["QA_INTELLIGENCE_HEADED"] = previous;
  }
});

test("isHeadedFromEnv accepts 1/true/yes", () => {
  const previous = process.env["QA_INTELLIGENCE_HEADED"];
  try {
    process.env["QA_INTELLIGENCE_HEADED"] = "true";
    assert.equal(isHeadedFromEnv(), true);
    process.env["QA_INTELLIGENCE_HEADED"] = "yes";
    assert.equal(isHeadedFromEnv(), true);
    process.env["QA_INTELLIGENCE_HEADED"] = "0";
    assert.equal(isHeadedFromEnv(), false);
    delete process.env["QA_INTELLIGENCE_HEADED"];
    assert.equal(isHeadedFromEnv(), false);
  } finally {
    if (previous === undefined) delete process.env["QA_INTELLIGENCE_HEADED"];
    else process.env["QA_INTELLIGENCE_HEADED"] = previous;
  }
});

test("headedFromInput maps MCP booleans", () => {
  assert.equal(headedFromInput(true), true);
  assert.equal(headedFromInput(false), false);
  assert.equal(headedFromInput(undefined), undefined);
  assert.equal(headedFromInput("true"), undefined);
});

test("createLaunchBrowser launches headless Chromium (CI-safe smoke)", async () => {
  const launch = createLaunchBrowser("chromium", { headed: false });
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<h1>qa-intelligence</h1>");
    const text = await page.locator("h1").innerText();
    assert.equal(text, "qa-intelligence");
  } finally {
    await browser.close();
  }
});
