/**
 * Bounded live probes for exploratory sessions: empty-submit and/or
 * click 1–2 named actions, then re-capture. Not free-form exploration.
 */
import type { Page } from "playwright";

import { createLaunchBrowser, type BrowserName } from "../adapters/playwright/browser-launcher.js";
import { newFullSizePage } from "../adapters/playwright/full-size-page.js";
import type { DiscoverUiSurface } from "../discovery/discover-ui-surface.js";
import type { SemanticUiElement } from "../discovery/public.js";
import type { WorkspaceContext } from "../requirement-review/public.js";
import type { ExploratoryObservation } from "./execute-exploratory-session.js";

const LEAK_PATTERNS = [
  /internal server error/i,
  /stack trace/i,
  /exception in thread/i,
  /traceback \(most recent call last\)/i,
  /\bat\s+[\w.$]+\([\w.]+:\d+\)/,
];

const SUBMIT_HINT = /^(submit|save|continue|sign in|log in|login|search|send|next|apply)$/i;
const AVOID_HINT = /delete|remove|destroy|logout|sign out|cancel subscription|wipe/i;

export type BoundedProbeRunnerInput = Readonly<{
  operation_id: string;
  context: WorkspaceContext;
  url: string;
  browser: BrowserName;
  elements: readonly SemanticUiElement[];
  ids: { next(scope: "session" | "observation"): string };
  discoverUiSurface: DiscoverUiSurface;
}>;

export type BoundedProbeRunner = (
  input: BoundedProbeRunnerInput,
) => Promise<readonly ExploratoryObservation[]>;

/** Default Playwright runner — empty-submit then optional second click (max 2). */
export const runPlaywrightBoundedProbes: BoundedProbeRunner = async (input) => {
  const plan = pickProbeTargets(input.elements);
  if (plan.length === 0) {
    return [
      {
        id: input.ids.next("observation"),
        browser: input.browser,
        kind: "risk",
        subject: "bounded live probes",
        status: "manual_follow_up",
        note: "No safe named clickable actions on the capture — probes skipped.",
        evidence: [`browser:${input.browser}`, "probe:skipped:no-targets"],
      },
    ];
  }

  const observations: ExploratoryObservation[] = [];
  let browser;
  try {
    browser = await createLaunchBrowser(input.browser)();
  } catch (error) {
    return [
      {
        id: input.ids.next("observation"),
        browser: input.browser,
        kind: "risk",
        subject: "bounded live probes",
        status: "blocked",
        note: `Probe browser failed to launch: ${(error as Error).message}`,
        evidence: [`browser:${input.browser}`, "probe:launch-failed"],
      },
    ];
  }

  try {
    const page = await newFullSizePage(browser);
    try {
      await page.goto(input.url);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

      for (const target of plan) {
        const obs = await runOneProbe({
          page,
          target,
          input,
        });
        observations.push(obs);
      }
    } finally {
      await page.close();
    }
  } catch (error) {
    observations.push({
      id: input.ids.next("observation"),
      browser: input.browser,
      kind: "risk",
      subject: "bounded live probes",
      status: "blocked",
      note: `Probe navigation/interaction failed: ${(error as Error).message}`,
      evidence: [`browser:${input.browser}`, "probe:infra-error"],
    });
  } finally {
    await browser.close();
  }

  return observations;
};

type ProbeTarget = Readonly<{
  label: string;
  name: string;
  role: string;
  mode: "empty_submit" | "click";
}>;

function pickProbeTargets(elements: readonly SemanticUiElement[]): ProbeTarget[] {
  const fields = elements.filter((el) => el.kind === "field");
  const actions = elements.filter(
    (el) =>
      el.kind === "action" &&
      !!el.accessible_name?.trim() &&
      (el.interaction_hint === "clickable" || el.interaction_hint === undefined) &&
      !AVOID_HINT.test(el.accessible_name.trim()),
  );

  const out: ProbeTarget[] = [];
  const submit = actions.find((el) => SUBMIT_HINT.test(el.accessible_name!.trim()));
  if (fields.length > 0 && submit !== undefined) {
    out.push({
      label: `empty-submit via "${submit.accessible_name}"`,
      name: submit.accessible_name!.trim(),
      role: submit.accessible_role?.trim() || "button",
      mode: "empty_submit",
    });
  }

  for (const action of actions) {
    if (out.length >= 2) break;
    const name = action.accessible_name!.trim();
    if (out.some((t) => t.name === name)) continue;
    out.push({
      label: `click "${name}"`,
      name,
      role: action.accessible_role?.trim() || "button",
      mode: "click",
    });
  }

  return out.slice(0, 2);
}

async function runOneProbe(args: {
  page: Page;
  target: ProbeTarget;
  input: BoundedProbeRunnerInput;
}): Promise<ExploratoryObservation> {
  const { page, target, input } = args;
  const evidenceBase = [
    `browser:${input.browser}`,
    `probe:${target.mode}`,
    `action:${target.name}`,
  ];

  try {
    const locator = page.getByRole(target.role as Parameters<typeof page.getByRole>[0], {
      name: target.name,
    });
    await locator.first().click({ timeout: 5_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  } catch (error) {
    return {
      id: input.ids.next("observation"),
      browser: input.browser,
      kind: "risk",
      subject: target.label,
      status: "fail",
      note: `Could not click probe target: ${(error as Error).message}`,
      evidence: [...evidenceBase, "probe:click-miss"],
    };
  }

  const captured = await input.discoverUiSurface.captureSemanticUiMap(page, {
    context: input.context,
    url: page.url(),
    operation_id: `${input.operation_id}:probe:${target.mode}`,
  });

  if (!captured.ok) {
    return {
      id: input.ids.next("observation"),
      browser: input.browser,
      kind: "risk",
      subject: target.label,
      status: "blocked",
      note: `Re-capture after probe failed: ${captured.failure.message}`,
      evidence: [...evidenceBase, ...captured.failure.evidence, "probe:recapture-failed"],
    };
  }

  const pageText = flattenAccessibleText(captured.value.elements);
  const leaked = LEAK_PATTERNS.some((pattern) => pattern.test(pageText));
  return {
    id: input.ids.next("observation"),
    browser: input.browser,
    kind: "risk",
    subject: target.label,
    status: leaked ? "fail" : "pass",
    note: leaked
      ? "After bounded probe, leakage pattern matched in re-captured accessible text."
      : `Bounded probe completed; re-capture ${captured.value.elements.length} elements, no leakage pattern.`,
    evidence: [
      ...evidenceBase,
      `capture:${captured.value.capture_id}`,
      leaked ? "oracle:leak:hit" : "oracle:leak:clean",
    ],
  };
}

function flattenAccessibleText(elements: readonly SemanticUiElement[]): string {
  return elements
    .map((el) => [el.accessible_name, el.accessible_role].filter(Boolean).join(" "))
    .join("\n");
}
