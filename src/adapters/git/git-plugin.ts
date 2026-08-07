import { createHash } from "node:crypto";
import { isAbsolute, normalize as normalizePath, relative } from "node:path";

import { simpleGit, type SimpleGit } from "simple-git";

import {
  pluginInvocationDigest,
  type CancelRequest,
  type DescriptorRequest,
  type DisposeRequest,
  type HealthRequest,
  type InitializeRequest,
  type InvokeRequest,
  type Plugin,
  type PluginDescriptor,
  type PluginFailure,
  type PluginOperation,
  type PluginOperationMap,
  type PluginProvider,
  type PluginRequest,
  type PluginResult,
  type ValidateConfigurationRequest,
} from "../../plugins/public.js";
import { stableStringify } from "../../shared/stable-stringify.js";
import type {
  WorkspaceAuthorizationFailure,
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../requirement-review/public.js";

export interface Clock {
  now(): Date;
}

/**
 * SPEC-409 Git Plugin Component: read-only repository-discovery and
 * change-inspection capabilities against a single, explicitly authorized
 * local checkout (§8: hosting-provider APIs and write/mutation capabilities
 * are excluded from this baseline). One instance is bound to exactly one
 * repository root at `initialize` — a caller cannot widen scope to an
 * unauthorized path afterward (§4: "access SHALL remain bound to the
 * authorized repository and Workspace").
 *
 * Unlike `yaml-ontology-repository.ts` (governance-reviewed content, ADR-021
 * §4), everything this plugin reads from the repository is untrusted input
 * (§4: "repository content SHALL be treated as untrusted evidence") — no
 * unchecked type casts on parsed Git output, and every path argument is
 * validated against the bound repository root before it reaches
 * `simple-git` (§4: "path traversal and unsafe symbolic-link behavior SHALL
 * be rejected").
 */
export type GitPluginCapability =
  | "repository_metadata"
  | "read_file_at_revision"
  | "search_paths"
  | "diff"
  | "history"
  | "changed_files"
  | "verify_integrity";

export type GitPluginLimits = Readonly<{
  max_history_entries: number;
  max_file_bytes: number;
}>;

type Dependencies = Readonly<{
  clock: Clock;
  authorizer: WorkspaceAuthorizer;
  provider: PluginProvider;
  descriptor: PluginDescriptor;
  limits: GitPluginLimits;
  /** Injected for deterministic tests; defaults to `simpleGit(repositoryRoot)`. */
  makeGit?: (repositoryRoot: string) => SimpleGit;
}>;

type InstanceState = Readonly<{
  repository_root: string;
  git: SimpleGit;
}>;

type InvokeRecord = Readonly<{
  digest: string;
  result: PluginResult<"invoke">;
}>;

const PERMISSION_BY_OPERATION: Readonly<Record<string, string>> = Object.freeze({
  descriptor: "git:read",
  validateConfiguration: "git:read",
  initialize: "git:initialize",
  health: "git:read",
  invoke: "git:read",
  cancel: "git:cancel",
  dispose: "git:dispose",
});

/** SPEC-409 §8 initial capability baseline — write/commit/push/branch-delete/history-rewriting/remote-mutation are excluded by construction (not present in this union). */
const SUPPORTED_CAPABILITIES: readonly GitPluginCapability[] = [
  "repository_metadata",
  "read_file_at_revision",
  "search_paths",
  "diff",
  "history",
  "changed_files",
  "verify_integrity",
];

export class GitPlugin implements Plugin {
  readonly #clock: Clock;
  readonly #authorizer: WorkspaceAuthorizer;
  readonly #provider: PluginProvider;
  readonly #descriptor: PluginDescriptor;
  readonly #limits: GitPluginLimits;
  readonly #makeGit: (repositoryRoot: string) => SimpleGit;
  readonly #instances = new Map<string, InstanceState>();
  readonly #invocations = new Map<string, InvokeRecord>();
  readonly #cancelled = new Set<string>();

  constructor(dependencies: Dependencies) {
    this.#clock = dependencies.clock;
    this.#authorizer = dependencies.authorizer;
    this.#provider = dependencies.provider;
    this.#descriptor = dependencies.descriptor;
    this.#limits = dependencies.limits;
    this.#makeGit = dependencies.makeGit ?? ((repositoryRoot) => simpleGit(repositoryRoot));
  }

  async descriptor(request: DescriptorRequest): Promise<PluginResult<"descriptor">> {
    const authorized = await this.#authorize(request, "descriptor");
    if (!authorized.ok) return this.#deny(request, "descriptor", authorized.failure);
    return this.#envelope(request, "descriptor", {
      ok: true,
      value: { descriptor: this.#descriptor, supported_contract_versions: ["1.0.0"], health: "healthy" },
    });
  }

  async validateConfiguration(request: ValidateConfigurationRequest): Promise<PluginResult<"validateConfiguration">> {
    const authorized = await this.#authorize(request, "validateConfiguration");
    if (!authorized.ok) return this.#deny(request, "validateConfiguration", authorized.failure);

    const repositoryRoot = request.payload.configuration["repository_root"];
    const errors: string[] = [];
    if (typeof repositoryRoot !== "string" || repositoryRoot.trim().length === 0) {
      errors.push("configuration.repository_root must be a non-empty string.");
    } else if (!isAbsolute(repositoryRoot)) {
      errors.push("configuration.repository_root must be an absolute path.");
    }
    return this.#envelope(request, "validateConfiguration", { ok: true, value: { valid: errors.length === 0, errors } });
  }

  async initialize(request: InitializeRequest): Promise<PluginResult<"initialize">> {
    const authorized = await this.#authorize(request, "initialize");
    if (!authorized.ok) return this.#deny(request, "initialize", authorized.failure);

    const repositoryRoot = request.payload.configuration["repository_root"];
    if (typeof repositoryRoot !== "string" || !isAbsolute(repositoryRoot)) {
      return this.#envelope(request, "initialize", {
        ok: false,
        failure: invalidConfigurationFailure("configuration.repository_root must be an absolute path."),
      });
    }

    const git = this.#makeGit(repositoryRoot);
    try {
      await git.revparse(["--is-inside-work-tree"]);
    } catch (cause) {
      return this.#envelope(request, "initialize", {
        ok: false,
        failure: providerFailure(`Repository at "${repositoryRoot}" is not accessible: ${describeCause(cause)}`),
      });
    }

    const instanceRef = `instance:${request.workspace.workspace_id}:${request.operationId}`;
    this.#instances.set(instanceRef, { repository_root: normalizePath(repositoryRoot), git });
    return this.#envelope(request, "initialize", {
      ok: true,
      value: { instance_ref: instanceRef, resolved_versions: { plugin: this.#descriptor.version } },
    });
  }

  async health(request: HealthRequest): Promise<PluginResult<"health">> {
    const authorized = await this.#authorize(request, "health");
    if (!authorized.ok) return this.#deny(request, "health", authorized.failure);

    const instance = this.#instances.get(request.payload.instance_ref);
    if (instance === undefined) {
      return this.#envelope(request, "health", { ok: false, failure: unavailableInstance(request.payload.instance_ref) });
    }
    return this.#envelope(request, "health", {
      ok: true,
      value: { health: "healthy", capabilities: this.#descriptor.capabilities, capacity: {} },
    });
  }

  async invoke(request: InvokeRequest): Promise<PluginResult<"invoke">> {
    const authorized = await this.#authorize(request, "invoke");
    if (!authorized.ok) return this.#deny(request, "invoke", authorized.failure);

    const instance = this.#instances.get(request.payload.instance_ref);
    if (instance === undefined) {
      return this.#envelope(request, "invoke", { ok: false, failure: unavailableInstance(request.payload.instance_ref) });
    }

    if (!SUPPORTED_CAPABILITIES.includes(request.payload.capability as GitPluginCapability)) {
      return this.#envelope(request, "invoke", { ok: false, failure: unsupportedCapability(request.payload.capability) });
    }

    const invocationKey = `${request.workspace.workspace_id}:${request.payload.instance_ref}:${request.operationId}`;
    const digest = pluginInvocationDigest(request);
    const existing = this.#invocations.get(invocationKey);
    if (existing !== undefined) {
      if (existing.digest !== digest) {
        return this.#envelope(request, "invoke", {
          ok: false,
          failure: {
            code: "idempotency_conflict",
            retryable: false,
            responsible_domain: "caller",
            message: "A different invoke request was already retained for this idempotency key.",
            details: {},
            diagnostic_evidence_refs: [],
          },
        });
      }
      return existing.result;
    }

    if (this.#cancelled.has(instanceCancellationKey(request.workspace.workspace_id, request.payload.instance_ref))) {
      const result = this.#envelope(request, "invoke", {
        ok: true,
        value: { outcome: "partial", output: {}, diagnostics: ["cancelled before completion"], evidence: [], retryable: false },
      });
      this.#invocations.set(invocationKey, { digest, result });
      return result;
    }

    const result = await this.#dispatch(request, instance);
    this.#invocations.set(invocationKey, { digest, result });
    return result;
  }

  async cancel(request: CancelRequest): Promise<PluginResult<"cancel">> {
    const authorized = await this.#authorize(request, "cancel");
    if (!authorized.ok) return this.#deny(request, "cancel", authorized.failure);

    this.#cancelled.add(instanceCancellationKey(request.workspace.workspace_id, request.payload.instance_ref));
    return this.#envelope(request, "cancel", { ok: true, value: { accepted: true, already_terminal: false } });
  }

  async dispose(request: DisposeRequest): Promise<PluginResult<"dispose">> {
    const authorized = await this.#authorize(request, "dispose");
    if (!authorized.ok) return this.#deny(request, "dispose", authorized.failure);

    this.#instances.delete(request.payload.instance_ref);
    return this.#envelope(request, "dispose", { ok: true, value: { disposed: true, residual_resources: [] } });
  }

  async #dispatch(request: InvokeRequest, instance: InstanceState): Promise<PluginResult<"invoke">> {
    const capability = request.payload.capability as GitPluginCapability;
    try {
      switch (capability) {
        case "repository_metadata":
          return await this.#repositoryMetadata(request, instance);
        case "read_file_at_revision":
          return await this.#readFileAtRevision(request, instance);
        case "search_paths":
          return await this.#searchPaths(request, instance);
        case "diff":
          return await this.#diff(request, instance);
        case "history":
          return await this.#history(request, instance);
        case "changed_files":
          return await this.#changedFiles(request, instance);
        case "verify_integrity":
          return await this.#verifyIntegrity(request, instance);
      }
    } catch (cause) {
      return this.#envelope(request, "invoke", { ok: false, failure: providerFailure(describeCause(cause)) });
    }
  }

  async #repositoryMetadata(request: InvokeRequest, instance: InstanceState): Promise<PluginResult<"invoke">> {
    const revision = await instance.git.revparse(["HEAD"]);
    const originUrl = await instance.git.raw(["config", "--get", "remote.origin.url"]).catch(() => "");
    return this.#envelope(request, "invoke", {
      ok: true,
      value: {
        outcome: "success",
        output: { revision: revision.trim(), origin: originUrl.trim(), repository_root: instance.repository_root },
        diagnostics: [],
        evidence: [`git:revision:${revision.trim()}`],
        retryable: false,
      },
    });
  }

  async #readFileAtRevision(request: InvokeRequest, instance: InstanceState): Promise<PluginResult<"invoke">> {
    const path = request.payload.input["path"];
    const revision = request.payload.input["revision"] ?? "HEAD";
    if (typeof path !== "string" || typeof revision !== "string") {
      return this.#envelope(request, "invoke", { ok: false, failure: invalidInputFailure("input.path and input.revision must be strings.") });
    }
    const pathCheck = safeRepositoryPath(instance.repository_root, path);
    if (!pathCheck.ok) {
      return this.#envelope(request, "invoke", { ok: false, failure: pathCheck.failure });
    }

    let content: string;
    try {
      content = await instance.git.show([`${revision}:${pathCheck.relativePath}`]);
    } catch (cause) {
      return this.#envelope(request, "invoke", { ok: false, failure: unknownRevisionOrPathFailure(revision, path, cause) });
    }

    if (Buffer.byteLength(content, "utf8") > this.#limits.max_file_bytes) {
      return this.#envelope(request, "invoke", {
        ok: false,
        failure: {
          code: "invalid_request",
          retryable: false,
          responsible_domain: "caller",
          message: `File "${path}" at "${revision}" exceeds the configured max_file_bytes limit.`,
          details: {},
          diagnostic_evidence_refs: [],
        },
      });
    }

    const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    return this.#envelope(request, "invoke", {
      ok: true,
      value: {
        outcome: "success",
        output: { path, revision, content, integrity_digest: digest },
        diagnostics: [],
        evidence: [`git:blob:${digest}`],
        retryable: false,
      },
    });
  }

  async #searchPaths(request: InvokeRequest, instance: InstanceState): Promise<PluginResult<"invoke">> {
    const pattern = request.payload.input["path_pattern"];
    const revision = request.payload.input["revision"] ?? "HEAD";
    if (typeof pattern !== "string" || typeof revision !== "string") {
      return this.#envelope(request, "invoke", { ok: false, failure: invalidInputFailure("input.path_pattern and input.revision must be strings.") });
    }

    const listing = await instance.git.raw(["ls-tree", "-r", "--name-only", revision]);
    const matches = listing
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.includes(pattern));

    return this.#envelope(request, "invoke", {
      ok: true,
      value: { outcome: "success", output: { matches }, diagnostics: [], evidence: [], retryable: false },
    });
  }

  async #diff(request: InvokeRequest, instance: InstanceState): Promise<PluginResult<"invoke">> {
    const fromRevision = request.payload.input["from_revision"];
    const toRevision = request.payload.input["to_revision"];
    if (typeof fromRevision !== "string" || typeof toRevision !== "string") {
      return this.#envelope(request, "invoke", { ok: false, failure: invalidInputFailure("input.from_revision and input.to_revision must be strings.") });
    }

    let diffText: string;
    try {
      diffText = await instance.git.diff([`${fromRevision}..${toRevision}`]);
    } catch (cause) {
      return this.#envelope(request, "invoke", { ok: false, failure: unknownRevisionOrPathFailure(`${fromRevision}..${toRevision}`, "", cause) });
    }
    return this.#envelope(request, "invoke", {
      ok: true,
      value: { outcome: "success", output: { diff: diffText }, diagnostics: [], evidence: [], retryable: false },
    });
  }

  async #history(request: InvokeRequest, instance: InstanceState): Promise<PluginResult<"invoke">> {
    const path = request.payload.input["path"];
    const maxEntriesInput = request.payload.input["max_entries"];
    const requested = typeof maxEntriesInput === "number" ? maxEntriesInput : this.#limits.max_history_entries;
    const maxEntries = Math.min(requested, this.#limits.max_history_entries);

    if (path !== undefined) {
      if (typeof path !== "string") {
        return this.#envelope(request, "invoke", { ok: false, failure: invalidInputFailure("input.path must be a string when provided.") });
      }
      const pathCheck = safeRepositoryPath(instance.repository_root, path);
      if (!pathCheck.ok) return this.#envelope(request, "invoke", { ok: false, failure: pathCheck.failure });
    }

    const args = ["log", `--max-count=${maxEntries}`, "--pretty=format:%H%x09%an%x09%aI%x09%s"];
    if (typeof path === "string") args.push("--", path);
    const raw = await instance.git.raw(args);
    const entries = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [hash, author, authoredAt, subject] = line.split("\t");
        return { hash: hash ?? "", author: author ?? "", authored_at: authoredAt ?? "", subject: subject ?? "" };
      });

    return this.#envelope(request, "invoke", {
      ok: true,
      value: { outcome: "success", output: { entries }, diagnostics: entries.length >= maxEntries ? ["history truncated at max_entries limit"] : [], evidence: [], retryable: false },
    });
  }

  async #changedFiles(request: InvokeRequest, instance: InstanceState): Promise<PluginResult<"invoke">> {
    const fromRevision = request.payload.input["from_revision"];
    const toRevision = request.payload.input["to_revision"];
    if (typeof fromRevision !== "string" || typeof toRevision !== "string") {
      return this.#envelope(request, "invoke", { ok: false, failure: invalidInputFailure("input.from_revision and input.to_revision must be strings.") });
    }

    let raw: string;
    try {
      raw = await instance.git.raw(["diff", "--name-status", `${fromRevision}..${toRevision}`]);
    } catch (cause) {
      return this.#envelope(request, "invoke", { ok: false, failure: unknownRevisionOrPathFailure(`${fromRevision}..${toRevision}`, "", cause) });
    }
    const files = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [status, path] = line.split("\t");
        return { status: status ?? "", path: path ?? "" };
      });

    return this.#envelope(request, "invoke", {
      ok: true,
      value: { outcome: "success", output: { files }, diagnostics: [], evidence: [], retryable: false },
    });
  }

  async #verifyIntegrity(request: InvokeRequest, instance: InstanceState): Promise<PluginResult<"invoke">> {
    const path = request.payload.input["path"];
    const revision = request.payload.input["revision"];
    const expectedDigest = request.payload.input["expected_digest"];
    if (typeof path !== "string" || typeof revision !== "string" || typeof expectedDigest !== "string") {
      return this.#envelope(request, "invoke", {
        ok: false,
        failure: invalidInputFailure("input.path, input.revision, and input.expected_digest must be strings."),
      });
    }
    const pathCheck = safeRepositoryPath(instance.repository_root, path);
    if (!pathCheck.ok) return this.#envelope(request, "invoke", { ok: false, failure: pathCheck.failure });

    let content: string;
    try {
      content = await instance.git.show([`${revision}:${pathCheck.relativePath}`]);
    } catch (cause) {
      return this.#envelope(request, "invoke", { ok: false, failure: unknownRevisionOrPathFailure(revision, path, cause) });
    }
    const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    return this.#envelope(request, "invoke", {
      ok: true,
      value: {
        outcome: digest === expectedDigest ? "success" : "failure",
        output: { matches: digest === expectedDigest, computed_digest: digest },
        diagnostics: [],
        evidence: [`git:blob:${digest}`],
        retryable: false,
      },
    });
  }

  async #authorize(
    request: Readonly<{ workspace: WorkspaceContext; operationId: string }>,
    operation: string,
  ): Promise<WorkspaceAuthorizationResult> {
    const authorizationRequest: WorkspaceAuthorizationRequest = {
      operation_id: request.operationId,
      context: request.workspace,
      purpose: `git-plugin:${operation}`,
      consequence_class: "advisory",
      required_permissions: [PERMISSION_BY_OPERATION[operation] ?? "git:read"],
      resource_refs: [`workspace:${request.workspace.workspace_id}`],
    };
    return this.#authorizer.authorize(authorizationRequest);
  }

  #envelope<Operation extends PluginOperation>(
    request: PluginRequest<Operation>,
    operation: Operation,
    outcome:
      | Readonly<{ ok: true; value: PluginOperationMap[Operation]["value"] }>
      | Readonly<{ ok: false; failure: PluginFailure }>,
  ): PluginResult<Operation> {
    const now = this.#clock.now();
    const envelope = {
      operation,
      operationId: request.operationId,
      workspace: request.workspace,
      idempotency: request.idempotency,
      deadline: request.deadline,
      version: request.version,
      provider: this.#provider,
      timing: { started_at: now.toISOString(), completed_at: now.toISOString(), duration_ms: 0 },
      warnings: [],
      evidence: outcome.ok && "evidence" in outcome.value ? (outcome.value as { evidence?: readonly string[] }).evidence ?? [] : [],
    };
    return { ...envelope, ...outcome } as PluginResult<Operation>;
  }

  #deny<Operation extends PluginOperation>(
    request: PluginRequest<Operation>,
    operation: Operation,
    authorizationFailure: WorkspaceAuthorizationFailure,
  ): PluginResult<Operation> {
    return this.#envelope(request, operation, {
      ok: false,
      failure: {
        code: "workspace_denied",
        retryable: false,
        responsible_domain: "workspace",
        message: authorizationFailure.message,
        details: {},
        diagnostic_evidence_refs: [],
      },
    });
  }
}

function instanceCancellationKey(workspaceId: string, instanceRef: string): string {
  return `${workspaceId}:${instanceRef}`;
}

type SafePathResult =
  | Readonly<{ ok: true; relativePath: string }>
  | Readonly<{ ok: false; failure: PluginFailure }>;

/** SPEC-409 §4: rejects absolute paths, `..` traversal, and any resolution that escapes the bound repository root. */
function safeRepositoryPath(repositoryRoot: string, requestedPath: string): SafePathResult {
  if (isAbsolute(requestedPath)) {
    return { ok: false, failure: unsafePathFailure(requestedPath) };
  }
  const normalized = normalizePath(requestedPath);
  if (normalized.startsWith("..") || isAbsolute(normalized)) {
    return { ok: false, failure: unsafePathFailure(requestedPath) };
  }
  const resolvedRelative = relative(repositoryRoot, normalizePath(`${repositoryRoot}/${normalized}`));
  if (resolvedRelative.startsWith("..") || isAbsolute(resolvedRelative)) {
    return { ok: false, failure: unsafePathFailure(requestedPath) };
  }
  return { ok: true, relativePath: normalized };
}

function unsafePathFailure(path: string): PluginFailure {
  return {
    code: "invalid_request",
    retryable: false,
    responsible_domain: "caller",
    message: `Path "${path}" is outside the authorized repository or uses unsafe traversal.`,
    details: {},
    diagnostic_evidence_refs: [],
  };
}

function invalidInputFailure(message: string): PluginFailure {
  return { code: "invalid_request", retryable: false, responsible_domain: "caller", message, details: {}, diagnostic_evidence_refs: [] };
}

function invalidConfigurationFailure(message: string): PluginFailure {
  return { code: "invalid_configuration", retryable: false, responsible_domain: "caller", message, details: {}, diagnostic_evidence_refs: [] };
}

function unsupportedCapability(capability: string): PluginFailure {
  return {
    code: "unsupported_capability",
    retryable: false,
    responsible_domain: "caller",
    message: `Git Plugin does not support capability "${capability}".`,
    details: {},
    diagnostic_evidence_refs: [],
  };
}

function unavailableInstance(instanceRef: string): PluginFailure {
  return {
    code: "instance_unavailable",
    retryable: false,
    responsible_domain: "caller",
    message: `No initialized instance for ${instanceRef}.`,
    details: {},
    diagnostic_evidence_refs: [],
  };
}

function providerFailure(message: string): PluginFailure {
  return { code: "provider_failure", retryable: true, responsible_domain: "plugin", message, details: {}, diagnostic_evidence_refs: [] };
}

function unknownRevisionOrPathFailure(revision: string, path: string, cause: unknown): PluginFailure {
  return {
    code: "invalid_request",
    retryable: false,
    responsible_domain: "caller",
    message: `Unknown revision "${revision}"${path.length > 0 ? ` or path "${path}"` : ""}: ${describeCause(cause)}`,
    details: {},
    diagnostic_evidence_refs: [],
  };
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
