import assert from "node:assert/strict";
import test from "node:test";
import { chromium, type Browser } from "playwright";

import { extractRawDom } from "../../../src/adapters/playwright/extract-raw-dom.js";
import type { RawDomNode } from "../../../src/dom-cleaner/public.js";

function findByNameAndRole(node: RawDomNode, name: string, role: string): RawDomNode | undefined {
  if (node.accessible_name === name && node.accessible_role === role) return node;
  for (const child of node.children) {
    const found = findByNameAndRole(child, name, role);
    if (found) return found;
  }
  return undefined;
}

const OPEN_SHADOW_PAGE = `data:text/html,${encodeURIComponent(`
<html><body>
  <login-widget></login-widget>
  <script>
    class LoginWidget extends HTMLElement {
      connectedCallback() {
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML =
          '<label for="u">Shadow Username</label>' +
          '<input id="u" aria-label="Shadow Username"/>' +
          '<button aria-label="Shadow Sign In">Shadow Sign In</button>';
      }
    }
    customElements.define("login-widget", LoginWidget);
  </script>
</body></html>
`)}`;

const CLOSED_SHADOW_PAGE = `data:text/html,${encodeURIComponent(`
<html><body>
  <closed-widget></closed-widget>
  <script>
    class ClosedWidget extends HTMLElement {
      connectedCallback() {
        const root = this.attachShadow({ mode: "closed" });
        root.innerHTML = '<input aria-label="Closed Field"/>';
      }
    }
    customElements.define("closed-widget", ClosedWidget);
  </script>
</body></html>
`)}`;

const SAME_ORIGIN_IFRAME_PAGE = `data:text/html,${encodeURIComponent(`
<html><body>
  <iframe id="frame"></iframe>
  <script>
    const doc = document.getElementById("frame").contentDocument;
    doc.open();
    doc.write('<input aria-label="Iframe Username"/><button aria-label="Iframe Submit">Submit</button>');
    doc.close();
  </script>
</body></html>
`)}`;

test("extractRawDom sees into an open Shadow DOM's rendered content", async () => {
  const browser: Browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(OPEN_SHADOW_PAGE);
    const raw = await extractRawDom(page);

    const field = findByNameAndRole(raw, "Shadow Username", "textbox");
    const action = findByNameAndRole(raw, "Shadow Sign In", "button");

    assert.ok(field, "expected to find the field inside the open shadow root");
    assert.equal(field!.accessible_role, "textbox");
    assert.ok(action, "expected to find the action inside the open shadow root");
    assert.equal(action!.accessible_role, "button");
  } finally {
    await browser.close();
  }
});

test("extractRawDom does not error on a closed Shadow DOM (correctly unreachable, not a bug)", async () => {
  const browser: Browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(CLOSED_SHADOW_PAGE);
    const raw = await extractRawDom(page);

    const field = findByNameAndRole(raw, "Closed Field", "textbox");
    assert.equal(field, undefined, "a closed shadow root's content is correctly unreachable, not a crash");
  } finally {
    await browser.close();
  }
});

test("extractRawDom sees into a same-origin iframe's rendered content", async () => {
  const browser: Browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(SAME_ORIGIN_IFRAME_PAGE);
    const raw = await extractRawDom(page);

    const field = findByNameAndRole(raw, "Iframe Username", "textbox");
    const action = findByNameAndRole(raw, "Iframe Submit", "button");

    assert.ok(field, "expected to find the field inside the same-origin iframe");
    assert.equal(field!.accessible_role, "textbox");
    assert.ok(action, "expected to find the action inside the same-origin iframe");
  } finally {
    await browser.close();
  }
});
