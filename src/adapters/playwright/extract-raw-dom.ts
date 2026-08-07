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
 * `accessible_role`/`accessible_name` start as a bounded heuristic (explicit
 * `role`/`aria-label` attributes, an implicit-role table for common tags, or
 * `textContent` as a name fallback), then every candidate interactive node
 * is corrected against the browser's real computed ARIA role via
 * `Locator.ariaSnapshot()` (`resolveRealAccessibleRoles`, below) — this is
 * what makes a generated `TestCase`'s `PlaywrightInteractionStep` actually
 * resolvable by `page.getByRole()` at execution time (Phase 2). Without
 * this correction, a widget whose real computed role differs from the
 * heuristic's guess (e.g. an `<input type="search">` inside a `role="search"`
 * region computes to `searchbox`, not the heuristic's plain `textbox`)
 * discovers successfully but times out on every execution attempt — this
 * was found and fixed after exactly that failure mode reproduced against
 * real search widgets (Wikipedia, HN Algolia).
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
/** Attribute name used to tag candidate interactive nodes for accessibility-role resolution, below — chosen to be extremely unlikely to collide with any real page's own attributes, and removed from every tagged element before this function returns. Duplicated as a module-level export (`WALK_ID_ATTRIBUTE`) and this in-function copy: `page.evaluate(walkForRawDom, ...)` serializes the function body alone, severing any outer closure, so the browser-side copy below is the one that actually runs. */
const WALK_ID_ATTRIBUTE = "data-qa-intelligence-walk-id";

function walkForRawDom(root: unknown): RawDomNode {
  const WALK_ID_ATTRIBUTE = "data-qa-intelligence-walk-id";
  const taggedElements: unknown[] = [];
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

  // A `data:` URI (inline base64 images/video/fonts) can be hundreds of KB
  // to multiple MB per attribute — copying it verbatim would bloat every
  // stage downstream of this capture (the in-process RawDomNode, the
  // Playwright CDP serialization, and ultimately whatever text an MCP
  // caller reads) for content that carries zero semantic meaning for UI
  // discovery or test generation. `DeterministicDomCleaner`'s
  // `max_attribute_length` truncation runs too late — it would still
  // retain a multi-KB dead fragment of the original data instead of a
  // clean placeholder. The presence of *a* src/href value (real vs.
  // empty) is preserved; the payload is not — nothing downstream binds
  // test intent to an image's actual pixel data.
  function collapseDataUri(value: string): string {
    if (!value.startsWith("data:")) return value;
    const mimeMatch = /^data:([^;,]*)/.exec(value);
    const mimeType = mimeMatch?.[1] || "unknown";
    return `data:${mimeType};<omitted:${value.length}b>`;
  }

  function walk(element: any): RawDomNode {
    const tag = element.tagName.toLowerCase();
    const attributes: Record<string, string> = {};
    for (const attribute of Array.from(element.attributes) as any[]) {
      attributes[attribute.name] = collapseDataUri(attribute.value);
    }

    // A hidden input (CSRF tokens, form state) is never a user-facing
    // Field or Action — without this, `<input type="hidden">` inherits
    // the implicit "textbox" role from the plain tag name and gets
    // discovered as an editable field alongside real ones, silently
    // corrupting every downstream binding/generation step.
    const isHiddenInput = tag === "input" && (attributes["type"] || "").toLowerCase() === "hidden";

    // disabled/readonly controls can't actually be typed into or clicked —
    // discovering them as an interactive Field/Action would produce a
    // TestCase that fails for a reason having nothing to do with the
    // acceptance criterion under test (a false negative, not a real bug).
    const isDisabledOrReadonly = element.disabled === true || element.hasAttribute?.("readonly");

    // A CSS-invisible element (display:none, visibility:hidden, the
    // `hidden` attribute) is not reachable by a real user and SHALL NOT
    // be discovered as something to interact with — `getComputedStyle` is
    // the only reliable check (inline styles and stylesheet rules both
    // resolve through it; checking the `style` attribute alone would miss
    // most real cases, which use CSS classes).
    const ownerWindow = element.ownerDocument?.defaultView;
    const computedStyle = ownerWindow?.getComputedStyle?.(element);
    const isCssInvisible =
      element.hidden === true ||
      computedStyle?.display === "none" ||
      computedStyle?.visibility === "hidden";

    const isInteractionBlocked = isHiddenInput || isDisabledOrReadonly || isCssInvisible;
    const role = isInteractionBlocked ? undefined : element.getAttribute("role") || IMPLICIT_ROLES[tag];

    const ariaLabel = element.getAttribute("aria-label");

    // aria-labelledby: one or more IDs whose *text content* (not their own
    // accessible name — this is a bounded approximation, not full ARIA
    // computation, consistent with this module's documented scope) becomes
    // the name. Common on design systems (Material UI, Ant Design) that
    // avoid aria-label in favor of labelledby pointing at a visible heading
    // or span.
    const labelledbyIds: string = element.getAttribute("aria-labelledby") || "";
    const ownerDocument = element.ownerDocument;
    let labelledbyText: string | undefined;
    if (!isHiddenInput && ariaLabel === null && labelledbyIds.trim().length > 0 && ownerDocument) {
      const texts = labelledbyIds
        .split(/\s+/)
        .map((id) => ownerDocument.getElementById?.(id)?.textContent?.trim())
        .filter((text: string | undefined): text is string => !!text);
      if (texts.length > 0) labelledbyText = texts.join(" ");
    }

    // <label for="id"> is the standard HTML association for a form
    // control's accessible name — far more common in real forms than
    // aria-label, which this pipeline previously required exclusively,
    // silently leaving every such field nameless (and unbindable by
    // Test Design's name-matching) even though the browser's own
    // accessibility tree resolves it correctly.
    const elementId: string | null = element.getAttribute("id");
    let forLabelText: string | undefined;
    if (!isHiddenInput && ariaLabel === null && labelledbyText === undefined && elementId && ownerDocument) {
      const labels: any[] = Array.from(ownerDocument.getElementsByTagName("label"));
      const associatedLabel = labels.find((label) => label.getAttribute("for") === elementId);
      const text = associatedLabel?.textContent?.trim();
      if (text) forLabelText = text;
    }

    // <label>Text <input></label> — the control is a *descendant* of its
    // label rather than linked by `for`, equally common in real markup
    // (no `id` needed on the control at all).
    let wrappingLabelText: string | undefined;
    if (!isHiddenInput && ariaLabel === null && labelledbyText === undefined && forLabelText === undefined) {
      let ancestor = element.parentElement;
      while (ancestor) {
        if (ancestor.tagName?.toLowerCase() === "label") {
          const text = ancestor.textContent?.trim();
          if (text) wrappingLabelText = text;
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }

    // placeholder/title are the standard ARIA-spec fallbacks (after
    // label/labelledby/aria-label) for an accessible name — many real
    // forms have only a placeholder and no label element at all.
    const placeholder = element.getAttribute("placeholder");
    const titleAttribute = element.getAttribute("title");

    const directText = Array.from(element.childNodes as any[])
      .filter((node: any) => node.nodeType === 3)
      .map((node: any) => (node.textContent || "").trim())
      .filter((text: string) => text.length > 0)
      .join(" ");
    const name =
      ariaLabel ||
      labelledbyText ||
      forLabelText ||
      wrappingLabelText ||
      (directText.length > 0 ? directText : undefined) ||
      placeholder ||
      titleAttribute ||
      undefined;

    // Shadow DOM: an open shadow root's children live outside
    // `element.children` entirely — a Web Component (common in enterprise
    // design systems) would otherwise contribute zero discoverable Fields/
    // Actions despite rendering visible, interactive content. A *closed*
    // shadow root is unreachable by design (the browser itself enforces
    // this — `element.shadowRoot` is `null`), which this walk correctly
    // treats the same as "no shadow content" rather than erroring.
    const shadowChildren: any[] = element.shadowRoot ? Array.from(element.shadowRoot.children) : [];

    // Same-origin iframe: `contentDocument` is `null` for a cross-origin
    // frame (the browser's own same-origin policy — not something this
    // pipeline can or should bypass) and for a frame that hasn't finished
    // loading yet. A same-origin frame's `<body>` becomes a synthetic
    // child so a login form embedded in an SSO/payment iframe is still
    // discoverable.
    let iframeChildren: any[] = [];
    if (tag === "iframe") {
      try {
        const frameBody = element.contentDocument?.body;
        if (frameBody) iframeChildren = [frameBody];
      } catch {
        // Cross-origin access throws synchronously in some engines rather
        // than returning null — treated identically to "not accessible".
      }
    }

    const children = [
      ...Array.from(element.children as any[]),
      ...shadowChildren,
      ...iframeChildren,
    ].map((child: any) => walk(child));

    // Tag every candidate interactive node with a unique id so a
    // subsequent Node-side pass can resolve its real ARIA role via
    // `Locator.ariaSnapshot()` (`resolveRealAccessibleRoles`, below) and
    // correct the heuristic guess above. Only candidates get tagged, not
    // every node — walking a large page and round-tripping through the
    // browser for every single element would be prohibitively slow.
    if (role !== undefined) {
      const walkId = String(taggedElements.length);
      element.setAttribute(WALK_ID_ATTRIBUTE, walkId);
      taggedElements.push(element);
      attributes[WALK_ID_ATTRIBUTE] = walkId;
    }

    const result: RawDomNode = { tag, attributes, children };
    if (directText.length > 0) (result as any).text = directText;
    if (role !== undefined) (result as any).accessible_role = role;
    if (name !== undefined) (result as any).accessible_name = name;
    return result;
  }

  const tree = walk(root);
  return tree;
}

/**
 * `ariaSnapshot()` output is a small YAML-like tree, e.g. `- searchbox
 * "Search Wikipedia"` or `- textbox "Password" [disabled]` — this parses
 * just the role (first bare word) and name (first quoted string) off the
 * first line, which is exactly what a single-element `Locator`'s snapshot
 * produces. Anything else in the string (nested children, states like
 * `[disabled]`) is not this function's concern — role/name is all the
 * correction needs.
 */
function parseAriaSnapshotFirstLine(snapshot: string): Readonly<{ role?: string; name?: string }> {
  const line = snapshot.split("\n")[0]?.trim() ?? "";
  const match = /^-\s*([a-z][a-z0-9-]*)(?:\s+"([^"]*)")?/i.exec(line);
  if (!match) return {};
  const role = match[1]?.toLowerCase();
  const name = match[2];
  return { ...(role ? { role } : {}), ...(name ? { name } : {}) };
}

/**
 * Walks the already-captured `RawDomNode` tree and, for every node the
 * heuristic tagged with a walk id (i.e. every candidate interactive
 * element), asks the real browser for its computed ARIA role/name via
 * `page.locator([attr="id"]).ariaSnapshot()` and overrides the heuristic
 * guess with the browser's own answer — the same source of truth
 * `page.getByRole()` uses at execution time, so a role this function
 * confirms is guaranteed resolvable later. A node the browser reports as
 * non-interactive (`generic`, `none`, or a snapshot that fails to parse)
 * has its role cleared rather than left on the heuristic's possibly-wrong
 * guess: a false "this is interactive" is worse than under-discovering,
 * since it produces a TestCase step that can never succeed.
 */
async function resolveRealAccessibleRoles(page: Page, tree: RawDomNode): Promise<RawDomNode> {
  const NON_INTERACTIVE_ROLES = new Set(["generic", "none", "text", "paragraph", "presentation"]);

  async function resolve(node: RawDomNode): Promise<RawDomNode> {
    const walkId = node.attributes[WALK_ID_ATTRIBUTE];
    const children = await Promise.all(node.children.map((child) => resolve(child)));

    if (walkId === undefined) {
      return { ...node, children };
    }

    let role = node.accessible_role;
    let name = node.accessible_name;
    try {
      const snapshot = await page.locator(`[${WALK_ID_ATTRIBUTE}="${walkId}"]`).first().ariaSnapshot({ timeout: 2_000 });
      const parsed = parseAriaSnapshotFirstLine(snapshot);
      if (parsed.role !== undefined) {
        role = NON_INTERACTIVE_ROLES.has(parsed.role) ? undefined : parsed.role;
      }
      if (parsed.name !== undefined) {
        name = parsed.name;
      }
    } catch {
      // A detached, removed, or otherwise unresolvable node keeps the
      // heuristic's guess rather than failing the whole capture — this
      // correction pass is a refinement, not a hard dependency.
    }

    const { [WALK_ID_ATTRIBUTE]: _walkId, ...attributes } = node.attributes;
    const resolved: RawDomNode = { tag: node.tag, attributes, children };
    if (node.text !== undefined) (resolved as any).text = node.text;
    if (role !== undefined) (resolved as any).accessible_role = role;
    if (name !== undefined) (resolved as any).accessible_name = name;
    return resolved;
  }

  return resolve(tree);
}

export async function extractRawDom(page: Page): Promise<RawDomNode> {
  const bodyHandle = await page.evaluateHandle("document.body");
  const heuristicTree = await page.evaluate(walkForRawDom, bodyHandle);
  try {
    return await resolveRealAccessibleRoles(page, heuristicTree);
  } finally {
    // The walk-id attribute was set directly on the live page's DOM to
    // make each candidate locatable for `ariaSnapshot()` — it SHALL NOT
    // leak into the page's real markup (a later interaction step, or a
    // subsequent capture on the same page, must see the page exactly as
    // it would without this pipeline ever having run).
    await page
      .evaluate(
        // Same Node-only-lib constraint as `walkForRawDom` above: this
        // callback runs in the browser and must not reference the
        // ambient `document` type name, so its parameter is `unknown`,
        // narrowed with `any` inside.
        (attribute: unknown) => {
          const attributeName = attribute as string;
          const doc = (globalThis as any).document;
          const nodes = doc.querySelectorAll(`[${attributeName}]`);
          for (const node of Array.from(nodes) as any[]) node.removeAttribute(attributeName);
        },
        WALK_ID_ATTRIBUTE,
      )
      .catch(() => {});
  }
}
