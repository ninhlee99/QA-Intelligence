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
  target_url: string;
  /** Form login path (mutually exclusive with sso_action_name). */
  username_field_name?: string;
  username?: string;
  password_field_name?: string;
  password?: string;
  submit_action_name?: string;
  /**
   * SSO/OIDC bootstrap: click this accessible action on the login page
   * (e.g. "Continue with Google"), then wait for redirect. Does not invent
   * IdP credentials — Host must complete IdP out-of-band or use a test IdP
   * that auto-completes in the same browser session.
   */
  sso_action_name?: string;
  /** After SSO click, wait until page URL includes this substring (default: target_url host path). */
  sso_wait_url_includes?: string;
  /** Optional MFA / post-login gate: wait for this accessible name before capturing target. */
  mfa_wait_for_accessible_name?: string;
  mfa_wait_for_accessible_role?: string;
  mfa_wait_timeout_ms?: number;
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

        const ssoActionName = request.sso_action_name?.trim();
        try {
          if (ssoActionName !== undefined && ssoActionName.length > 0) {
            const ssoAction = loginMap.value.elements.find(
              (element) => element.kind === "action" && accessibleNamesMatch(element.accessible_name, ssoActionName),
            );
            if (ssoAction === undefined) {
              return loginFailure(`Login page has no discovered SSO action named "${ssoActionName}".`);
            }
            await clickByRole(page, ssoAction.accessible_role, ssoActionName);
            const waitNeedle =
              request.sso_wait_url_includes?.trim() ||
              (() => {
                try {
                  return new URL(request.target_url).pathname;
                } catch {
                  return request.target_url;
                }
              })();
            await page.waitForURL((url) => url.toString().includes(waitNeedle), { timeout: 60_000 }).catch(() => {});
            await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
          } else {
            const usernameFieldName = request.username_field_name?.trim();
            const passwordFieldName = request.password_field_name?.trim();
            const submitActionName = request.submit_action_name?.trim();
            const username = request.username;
            const password = request.password;
            if (
              !usernameFieldName ||
              !passwordFieldName ||
              !submitActionName ||
              username === undefined ||
              password === undefined
            ) {
              return loginFailure(
                "Form login requires username_field_name, username, password_field_name, password, submit_action_name — or supply sso_action_name for SSO bootstrap.",
              );
            }
            const usernameField = loginMap.value.elements.find(
              (element) => element.kind === "field" && accessibleNamesMatch(element.accessible_name, usernameFieldName),
            );
            if (usernameField === undefined) {
              return loginFailure(`Login page has no discovered field named "${usernameFieldName}".`);
            }
            const passwordField = loginMap.value.elements.find(
              (element) => element.kind === "field" && accessibleNamesMatch(element.accessible_name, passwordFieldName),
            );
            if (passwordField === undefined) {
              return loginFailure(`Login page has no discovered field named "${passwordFieldName}".`);
            }
            const submitAction = loginMap.value.elements.find(
              (element) => element.kind === "action" && accessibleNamesMatch(element.accessible_name, submitActionName),
            );
            if (submitAction === undefined) {
              return loginFailure(`Login page has no discovered action named "${submitActionName}".`);
            }

            await fillByRole(page, usernameField.accessible_role, usernameFieldName, username);
            await fillByRole(page, passwordField.accessible_role, passwordFieldName, password);
            await clickByRole(page, submitAction.accessible_role, submitActionName);
            await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
          }

          const mfaName = request.mfa_wait_for_accessible_name?.trim();
          if (mfaName !== undefined && mfaName.length > 0) {
            const timeout = request.mfa_wait_timeout_ms ?? 60_000;
            const role = request.mfa_wait_for_accessible_role;
            const locator =
              role !== undefined && role.trim().length > 0
                ? page.getByRole(role as Parameters<typeof page.getByRole>[0], { name: mfaName })
                : page.getByText(mfaName);
            await locator.waitFor({ state: "visible", timeout });
          }
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
