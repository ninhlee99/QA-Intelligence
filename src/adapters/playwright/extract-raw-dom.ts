import type { Page } from "playwright";

import type { RawDomNode } from "../../dom-cleaner/public.js";

/**
 * Serializes a real Playwright page's DOM into the `RawDomNode` shape
 * `DomCleaner` (SPEC-302) already accepts, so a real browser capture feeds
 * the exact same deterministic cleaning/analysis/extraction pipeline
 * (`DeterministicDomCleaner` -> `DeterministicSemanticAnalyzer` ->
 * `DeterministicFeatureExtractor`) already proven against synthetic
 * fixtures — this function's only job is producing real input for that
 * pipeline, not reimplementing it.
 *
 * `accessible_role`/`accessible_name` here are a bounded approximation
 * (explicit `role`/`aria-label` attributes, or a small implicit-role table
 * for common interactive tags, or `textContent` as a name fallback) — not
 * a full ARIA accessibility-tree computation, which Playwright's own
 * `page.accessibility.snapshot()` can provide separately where a caller
 * needs exact browser-computed semantics rather than this pipeline's own
 * deterministic interpretation of raw attributes.
 */
// Playwright's page.evaluate() callback runs inside the browser, not
// Node.js — it has no access to this repository's own tsconfig `lib`
// (deliberately Node-only, per ADR-011, so the rest of the codebase never
// sees DOM globals). Rather than add "dom" to the global tsconfig lib
// (which would leak `window`/`document` into every other file), the
// callback below never references the ambient `Element`/`Node`/`document`
// type names — its parameter is typed `unknown` and narrowed with `any`
// internally, so it typechecks under the Node-only `lib` while still
// running as a real in-browser function (not a source string: Playwright
// 1.62's string-form `page.evaluate()` was found to silently resolve to
// `undefined` instead of executing, so this uses the function form, which
// works, and passes `document.body` in as the seed argument instead of
// referencing `document` from inside the callback).
function walkForRawDom(root: unknown): RawDomNode {
  const IMPLICIT_ROLES: Record<string, string> = {
    button: "button",
    a: "link",
    input: "textbox",
    textarea: "textbox",
    select: "listbox",
    option: "option",
    nav: "navigation",
    main: "main",
    header: "banner",
    footer: "contentinfo",
  };

  function walk(element: any): RawDomNode {
    const tag = element.tagName.toLowerCase();
    const attributes: Record<string, string> = {};
    for (const attribute of Array.from(element.attributes) as any[]) {
      attributes[attribute.name] = attribute.value;
    }

    const role = element.getAttribute("role") || IMPLICIT_ROLES[tag];
    const ariaLabel = element.getAttribute("aria-label");
    const directText = Array.from(element.childNodes as any[])
      .filter((node: any) => node.nodeType === 3)
      .map((node: any) => (node.textContent || "").trim())
      .filter((text: string) => text.length > 0)
      .join(" ");
    const name = ariaLabel || (directText.length > 0 ? directText : undefined);

    const children = Array.from(element.children as any[]).map((child: any) => walk(child));

    const result: RawDomNode = { tag, attributes, children };
    if (directText.length > 0) (result as any).text = directText;
    if (role !== undefined) (result as any).accessible_role = role;
    if (name !== undefined) (result as any).accessible_name = name;
    return result;
  }

  return walk(root);
}

export async function extractRawDom(page: Page): Promise<RawDomNode> {
  const bodyHandle = await page.evaluateHandle("document.body");
  return page.evaluate(walkForRawDom, bodyHandle);
}
