/**
 * Discovers a Semantic UI Map for a screen reachable only after
 * authenticating — `DiscoverUiSurface.discover()` always launches a fresh,
 * unauthenticated browser per call, so a target URL that redirects to a
 * login page (session-gated, not just basic-auth-gated) can never be
 * captured that way. This Skill runs one browser/page for the whole
 * sequence: navigate to the login page, resolve the username/password
 * fields and submit action against the *login page's own* discovered
 * Semantic UI Map (never a caller-supplied raw selector — same
 * ADR-022/ADR-003 constraint every other interaction path in this
 * repository holds to), submit, then capture the target screen on the
 * exact same session/cookies the login produced.
 */
import { chromium, type Browser } from "playwright";

import { newFullSizePage } from "../adapters/playwright/full-size-page.js";
import { accessibleNamesMatch } from "../shared/accessible-name.js";
import { DiscoverUiSurface } from "./discover-ui-surface.js";
import type { WorkspaceAuthorizer, WorkspaceContext } from "../requirement-review/public.js";
import type { SemanticUiDiscoveryResult } from "./public.js";

export interface Clock {
  now(): Date;
}

export type DiscoverAfterLoginRequest = Readonly<{
  operation_id: string;
  context: WorkspaceContext;
  login_url: string;
  username_field_name: string;
  username: string;
  password_field_name: string;
  password: string;
  submit_action_name: string;
  target_url: string;
  /** HTTP Basic Auth (a browser-native credential prompt, distinct from the in-page login form above) required in front of both login_url and target_url — supply both or neither. */
  basic_auth_username?: string;
  basic_auth_password?: string;
}>;

type Dependencies = Readonly<{
  clock: Clock;
  authorizer: WorkspaceAuthorizer;
  launchBrowser?: () => Promise<Browser>;
}>;

/** Deep module: one `discover()` call hides the login sequence and the post-login capture behind a single operation. */
export class DiscoverAfterLogin {
  readonly #clock: Clock;
  readonly #authorizer: WorkspaceAuthorizer;
  readonly #launchBrowser: () => Promise<Browser>;
  readonly #inner: DiscoverUiSurface;

  constructor(dependencies: Dependencies) {
    this.#clock = dependencies.clock;
    this.#authorizer = dependencies.authorizer;
    this.#launchBrowser = dependencies.launchBrowser ?? (() => chromium.launch());
    this.#inner = new DiscoverUiSurface({ clock: dependencies.clock, authorizer: dependencies.authorizer, ...(dependencies.launchBrowser !== undefined ? { launchBrowser: dependencies.launchBrowser } : {}) });
  }

  async discover(request: DiscoverAfterLoginRequest): Promise<SemanticUiDiscoveryResult> {
    const authorization = await this.#authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "discover-ui-surface-after-login",
      consequence_class: "reversible",
      required_permissions: ["discovery:observe", "execution:execute"],
      resource_refs: [`workspace:${request.context.workspace_id}`],
    });
    if (!authorization.ok) {
      return {
        ok: false,
        failure: {
          class: "authorization",
          code: authorization.failure.code,
          message: authorization.failure.message,
          retryable: authorization.failure.retryable,
          evidence: [...authorization.failure.evidence],
        },
      };
    }

    let browser: Browser;
    try {
      browser = await this.#launchBrowser();
    } catch (error) {
      return {
        ok: false,
        failure: {
          class: "infrastructure",
          code: "browser_launch_failed",
          message: `Discovery browser failed to launch: ${(error as Error).message}`,
          retryable: true,
          evidence: [],
        },
      };
    }

    try {
      const httpCredentials =
        request.basic_auth_username !== undefined && request.basic_auth_password !== undefined
          ? { username: request.basic_auth_username, password: request.basic_auth_password }
          : undefined;
      const page = await newFullSizePage(browser, httpCredentials);
      try {
        await page.goto(request.login_url);
        const loginMap = await this.#inner.captureSemanticUiMap(page, {
          context: request.context,
          url: request.login_url,
          operation_id: `${request.operation_id}:login-page`,
        });
        if (!loginMap.ok) return loginMap;

        const usernameField = loginMap.value.elements.find(
          (element) => element.kind === "field" && accessibleNamesMatch(element.accessible_name, request.username_field_name),
        );
        if (usernameField === undefined) {
          return loginFailure(`Login page has no discovered field named "${request.username_field_name}".`);
        }
        const passwordField = loginMap.value.elements.find(
          (element) => element.kind === "field" && accessibleNamesMatch(element.accessible_name, request.password_field_name),
        );
        if (passwordField === undefined) {
          return loginFailure(`Login page has no discovered field named "${request.password_field_name}".`);
        }
        const submitAction = loginMap.value.elements.find(
          (element) => element.kind === "action" && accessibleNamesMatch(element.accessible_name, request.submit_action_name),
        );
        if (submitAction === undefined) {
          return loginFailure(`Login page has no discovered action named "${request.submit_action_name}".`);
        }

        // Semantic locators only, same as every other interaction path
        // (ADR-022 §4) — targets resolved above against the login page's
        // own already-discovered Semantic UI Map, never a raw selector
        // this method invents.
        try {
          await fillByRole(page, usernameField.accessible_role, request.username_field_name, request.username);
          await fillByRole(page, passwordField.accessible_role, request.password_field_name, request.password);
          await clickByRole(page, submitAction.accessible_role, request.submit_action_name);
          await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
        } catch (error) {
          return {
            ok: false,
            failure: {
              class: "engine",
              code: "login_interaction_failed",
              message: `Login interaction failed: ${(error as Error).message}`,
              retryable: true,
              evidence: [],
            },
          };
        }

        if (page.url() !== request.target_url) {
          await page.goto(request.target_url).catch(() => {});
        }

        return await this.#inner.captureSemanticUiMap(page, {
          context: request.context,
          url: request.target_url,
          operation_id: `${request.operation_id}:target-page`,
        });
      } finally {
        await page.close();
      }
    } catch (error) {
      return {
        ok: false,
        failure: {
          class: "infrastructure",
          code: "navigation_failed",
          message: `Discovery navigation failed: ${(error as Error).message}`,
          retryable: true,
          evidence: [],
        },
      };
    } finally {
      await browser.close();
    }
  }
}

function loginFailure(message: string): SemanticUiDiscoveryResult {
  return { ok: false, failure: { class: "configuration", code: "login_target_not_found", message, retryable: false, evidence: [] } };
}

async function fillByRole(page: import("playwright").Page, role: string | undefined, name: string, value: string): Promise<void> {
  const locator = role !== undefined ? page.getByRole(role as Parameters<typeof page.getByRole>[0], { name }) : page.getByLabel(name);
  await locator.fill(value);
}

async function clickByRole(page: import("playwright").Page, role: string | undefined, name: string): Promise<void> {
  const locator = role !== undefined ? page.getByRole(role as Parameters<typeof page.getByRole>[0], { name }) : page.getByText(name);
  await locator.click();
}
