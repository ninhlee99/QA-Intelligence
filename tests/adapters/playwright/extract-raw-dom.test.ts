import assert from "node:assert/strict";
import test from "node:test";
import { chromium, type Browser } from "playwright";

import { extractRawDom } from "../../../src/adapters/playwright/extract-raw-dom.js";
import type { RawDomNode } from "../../../src/dom-cleaner/public.js";

function findByTag(node: RawDomNode, tag: string, predicate?: (n: RawDomNode) => boolean): RawDomNode | undefined {
  if (node.tag === tag && (predicate === undefined || predicate(node))) return node;
  for (const child of node.children) {
    const found = findByTag(child, tag, predicate);
    if (found) return found;
  }
  return undefined;
}

function findById(node: RawDomNode, id: string): RawDomNode | undefined {
  return findByTag(node, node.tag, (n) => n.attributes["id"] === id) ?? findAnyById(node, id);
}

function findAnyById(node: RawDomNode, id: string): RawDomNode | undefined {
  if (node.attributes["id"] === id) return node;
  for (const child of node.children) {
    const found = findAnyById(child, id);
    if (found) return found;
  }
  return undefined;
}

const FIXTURE_PAGE = `data:text/html,${encodeURIComponent(`
<html><body>
  <!-- aria-labelledby -->
  <span id="lbl-a">Account Number</span>
  <input id="field-labelledby" aria-labelledby="lbl-a"/>

  <!-- label for -->
  <label for="field-for">Email Address</label>
  <input id="field-for"/>

  <!-- wrapping label, no id needed -->
  <label>Phone Number <input id="field-wrapped"/></label>

  <!-- placeholder fallback -->
  <input id="field-placeholder" placeholder="Search products"/>

  <!-- title fallback -->
  <input id="field-title" title="Coupon code"/>

  <!-- disabled: SHALL NOT get an interactive role -->
  <input id="field-disabled" aria-label="Disabled field" disabled/>

  <!-- readonly: SHALL NOT get an interactive role -->
  <input id="field-readonly" aria-label="Readonly field" readonly/>

  <!-- CSS display:none: SHALL NOT get an interactive role -->
  <input id="field-display-none" aria-label="Hidden by CSS" style="display:none"/>

  <!-- CSS visibility:hidden: SHALL NOT get an interactive role -->
  <input id="field-visibility-hidden" aria-label="Invisible by CSS" style="visibility:hidden"/>

  <!-- hidden attribute: SHALL NOT get an interactive role -->
  <input id="field-hidden-attr" aria-label="Hidden by attribute" hidden/>

  <!-- type=hidden: still SHALL NOT get an interactive role (regression) -->
  <input id="field-type-hidden" type="hidden" value="csrf-token-abc123"/>

  <!-- normal, enabled, visible field: SHALL get an interactive role -->
  <input id="field-normal" aria-label="Normal field"/>
</body></html>
`)}`;

test("extractRawDom resolves accessible names via aria-labelledby, label[for], wrapping label, placeholder, and title", async () => {
  const browser: Browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(FIXTURE_PAGE);
    const raw = await extractRawDom(page);

    const labelledby = findById(raw, "field-labelledby");
    assert.equal(labelledby?.accessible_name, "Account Number");

    const forLabel = findById(raw, "field-for");
    assert.equal(forLabel?.accessible_name, "Email Address");

    const wrapped = findById(raw, "field-wrapped");
    assert.equal(wrapped?.accessible_name, "Phone Number");

    const placeholder = findById(raw, "field-placeholder");
    assert.equal(placeholder?.accessible_name, "Search products");

    const titleAttr = findById(raw, "field-title");
    assert.equal(titleAttr?.accessible_name, "Coupon code");
  } finally {
    await browser.close();
  }
});

test("extractRawDom does not assign an interactive role to disabled, readonly, CSS-invisible, hidden-attribute, or type=hidden inputs", async () => {
  const browser: Browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(FIXTURE_PAGE);
    const raw = await extractRawDom(page);

    for (const id of [
      "field-disabled",
      "field-readonly",
      "field-display-none",
      "field-visibility-hidden",
      "field-hidden-attr",
      "field-type-hidden",
    ]) {
      const node = findById(raw, id);
      assert.ok(node, `expected to find node #${id} in the raw tree`);
      assert.equal(node!.accessible_role, undefined, `#${id} should have no interactive role, got "${node!.accessible_role}"`);
    }

    const normal = findById(raw, "field-normal");
    assert.equal(normal?.accessible_role, "textbox");
  } finally {
    await browser.close();
  }
});

test("extractRawDom collapses a data: URI attribute instead of copying its full base64 payload", async () => {
  const browser: Browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const largeBase64 = "A".repeat(50_000);
    const fixture = `data:text/html,${encodeURIComponent(
      `<html><body><img id="pic" src="data:image/png;base64,${largeBase64}"/></body></html>`,
    )}`;
    await page.goto(fixture);
    const raw = await extractRawDom(page);

    const img = findById(raw, "pic");
    assert.ok(img, "expected to find the img node");
    const src = img!.attributes["src"]!;
    assert.ok(src.length < 100, `expected the collapsed src to be short, got ${src.length} chars`);
    assert.ok(src.startsWith("data:image/png;"), `expected the mime type to be preserved, got "${src}"`);
    assert.ok(!src.includes(largeBase64), "expected the actual base64 payload to be omitted entirely");
  } finally {
    await browser.close();
  }
});
