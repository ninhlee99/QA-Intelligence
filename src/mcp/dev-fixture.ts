/**
 * Shared dev/tracer-bullet wiring for `dev-entrypoint.ts` (stdio) and
 * `remote-dev-entrypoint.ts` (Streamable HTTP). Both entrypoints compose
 * the exact same Agent Runtime, seeded fixtures, and MCP tool definitions
 * (ADR-016 §8) — only their transport and identity/authorizer plumbing
 * differ (fixture proof vs. real OIDC/JWKS). Extracted so the tool
 * descriptions/schemas/budgets have one source of truth instead of two
 * files kept manually in sync (ADR-023 §4's registry seam is unaffected:
 * this module only builds the `tools` array + `AgentRunExecutor` that
 * `AgentRuntimeToolRegistry` / `OidcBearerAuthenticator` already accept).
 */
import { join } from "node:path";

import type { WorkspaceAuthorizer } from "../requirement-review/public.js";
import { FileBackedKnowledgeSearch } from "../knowledge/file-backed-knowledge-search.js";
import { InMemoryRequirementResolver } from "../adapters/memory/requirement-resolver.js";
import { ScriptedReasoningProvider } from "../adapters/replay/scripted-reasoning-provider.js";
import {
  AssessRequirementQuality,
  RequirementQualityRuleEngine,
} from "../requirement-review/assess-requirement-quality.js";
import { CompositeRuleEngine } from "../requirement-review/composite-rule-engine.js";
import { RequirementReviewRuntimeExecutor } from "../requirement-review/runtime-executor.js";
import { RequirementIntelligenceRuleEngine } from "../requirement-intelligence/requirement-intelligence-rule-engine.js";
import { InMemoryAgentRuntime, type IdFactory, type Clock } from "../runtime/in-memory-agent-runtime.js";
import { CompositeAgentRunExecutor } from "../runtime/composite-executor.js";
import type { AgentRunExecutor } from "../runtime/executor.js";
import type { JsonValue, Requirement } from "../requirement-review/public.js";
import { PlaywrightExecutionEngine, type PlaywrightExecutionPlan } from "../adapters/playwright/playwright-execution-engine.js";
import { ExecuteBrowserTest } from "../execution/execute-browser-test.js";
import { BrowserTestRuntimeExecutor } from "../execution/runtime-executor.js";
import { DiscoverUiSurface } from "../discovery/discover-ui-surface.js";
import { UiSurfaceDiscoveryRuntimeExecutor } from "../discovery/runtime-executor.js";
import { DiscoverAfterLogin } from "../discovery/discover-after-login.js";
import { DiscoverAfterLoginRuntimeExecutor } from "../discovery/discover-after-login-runtime-executor.js";
import { AccessibilitySmokeRuntimeExecutor } from "../discovery/assess-ui-accessibility-smoke-runtime-executor.js";
import { GenerateTestCases } from "../test-design/generate-test-cases.js";
import { GenerateTestCasesRuntimeExecutor } from "../test-design/runtime-executor.js";
import { ExecuteGeneratedTestCaseRuntimeExecutor } from "../test-design/execute-generated-test-case-runtime-executor.js";
import { RunAutoQaPipelineRuntimeExecutor } from "../test-design/run-auto-qa-pipeline-runtime-executor.js";
import {
  AssessDefectQuality,
  DefectQualityRuleEngine,
} from "../bug-analysis/assess-defect-quality.js";
import { DefectQualityRuntimeExecutor } from "../bug-analysis/runtime-executor.js";
import { ExploratoryCharterRuntimeExecutor } from "../test-strategy/generate-exploratory-charter-runtime-executor.js";
import { FileBackedWorkspaceCredentialRegistry } from "../credentials/file-backed-workspace-credential-registry.js";
import { CredentialRegistryRuntimeExecutor } from "../credentials/runtime-executor.js";
import { InMemoryWorkspaceEnvironmentRegistry } from "../environments/workspace-environment-registry.js";
import { EnvironmentRegistryRuntimeExecutor } from "../environments/runtime-executor.js";
import { FileBackedWorkspaceDatasetRegistry } from "../test-data/file-backed-workspace-dataset-registry.js";
import { DatasetRegistryRuntimeExecutor } from "../test-data/dataset-registry-runtime-executor.js";
import { AutomationAssetStubRuntimeExecutor } from "../automation/create-automation-asset-runtime-executor.js";
import { generateWorkflowStub } from "../business-analysis/generate-workflow-stub.js";
import { generateRiskStubs } from "../risk-analysis/generate-risk-stub.js";
import { generateTestStrategyStub } from "../test-strategy/generate-test-strategy-stub.js";
import { UiMapStubRuntimeExecutor } from "./ui-map-stub-runtime-executor.js";
import { EvaluateTestCaseQualitySkillRuntimeExecutor } from "../agent-skill-quality/evaluate-test-case-quality-skill-runtime-executor.js";
import { RaiseMistakeRecurrenceCandidateRuntimeExecutor } from "../learning-engine/raise-mistake-recurrence-candidate-runtime-executor.js";
import { ListLearningCandidatesRuntimeExecutor } from "../learning-engine/list-learning-candidates-runtime-executor.js";
import { MistakeRecurrenceTracker } from "../learning-engine/mistake-recurrence.js";
import { InMemoryCandidateRepository } from "../adapters/memory/in-memory-candidate-repository.js";
import { UiBaselineRuntimeExecutor } from "../visual-testing/ui-baseline-runtime-executor.js";
import { SurfaceBaselineRuntimeExecutor } from "../discovery/surface-baseline-runtime-executor.js";
import {
  DocumentQualityRuntimeExecutor,
  toDocumentQualityAssessment,
  toDocumentQualityFailure,
} from "./document-assessor-runtime-executor.js";
import {
  AssessBusinessAnalysisQuality,
  BusinessAnalysisQualityRuleEngine,
} from "../business-analysis/assess-business-analysis-quality.js";
import type { Workflow } from "../business-analysis/public.js";
import {
  AssessRiskQuality,
  RiskQualityRuleEngine,
} from "../risk-analysis/assess-risk-quality.js";
import type { Risk } from "../risk-analysis/public.js";
import {
  AssessTestStrategyQuality,
  TestStrategyQualityRuleEngine,
} from "../test-strategy/assess-test-strategy-quality.js";
import type { TestStrategy } from "../test-strategy/public.js";
import {
  AssessTestCaseQuality,
  TestCaseQualityRuleEngine,
} from "../test-design/assess-test-case-quality.js";
import type { TestCase } from "../test-design/public.js";
import {
  AssessTestDatasetQuality,
  TestDatasetQualityRuleEngine,
} from "../test-data/assess-test-dataset-quality.js";
import type { TestDataset } from "../test-data/public.js";
import {
  AssessAutomationAssetQuality,
  AutomationAssetQualityRuleEngine,
} from "../automation/assess-automation-asset-quality.js";
import type { AutomationAsset } from "../automation/public.js";
import {
  AssessReportQuality,
  ReportQualityRuleEngine,
} from "../reporting/assess-report-quality.js";
import type { Report } from "../reporting/public.js";
import { ExecuteApiSmoke } from "../api-testing/execute-api-smoke.js";
import { ApiSmokeRuntimeExecutor } from "../api-testing/runtime-executor.js";
import { ExecuteExploratorySession } from "../test-strategy/execute-exploratory-session.js";
import { ExploratorySessionRuntimeExecutor } from "../test-strategy/execute-exploratory-session-runtime-executor.js";
import { runPlaywrightBoundedProbes } from "../test-strategy/exploratory-bounded-probes.js";
import { RunDepthSmokes } from "../depth-smokes/run-depth-smokes.js";
import { DepthSmokesRuntimeExecutor } from "../depth-smokes/runtime-executor.js";
import type { SessionMemory } from "../memory/session-memory.js";
import { FailureAvoidanceHintsRuntimeExecutor } from "../memory/failure-avoidance-hints-runtime-executor.js";
import { DiscoverProductContext } from "../discovery/discover-product-context.js";
import { ProductContextDiscoveryRuntimeExecutor } from "../discovery/product-context-runtime-executor.js";
import {
  AssessExecutionRecordQuality,
  ExecutionRecordQualityRuleEngine,
} from "../execution/assess-execution-record-quality.js";
import type { ExecutionRecord } from "../execution/public.js";
import { DraftDefectsRuntimeExecutor } from "../bug-analysis/draft-defects-runtime-executor.js";
import { RequirementRegistryRuntimeExecutor } from "../requirement-review/requirement-registry-runtime-executor.js";
import { DiscoverUiWorkflow } from "../discovery/discover-ui-workflow.js";
import { UiWorkflowDiscoveryRuntimeExecutor } from "../discovery/discover-ui-workflow-runtime-executor.js";
import { FileBackedRegressionSuiteRegistry } from "../test-design/file-backed-regression-suite-registry.js";
import { GenerateJourneyRuntimeExecutor } from "../test-design/generate-journey-runtime-executor.js";
import {
  CompareUiSurfacesRuntimeExecutor,
  DefectExportRuntimeExecutor,
  DefectFileRuntimeExecutor,
  KnowledgeRegisterRuntimeExecutor,
  OpenApiSmokeRuntimeExecutor,
  RegressionSuiteRuntimeExecutor,
  RoleSurfaceCompareRuntimeExecutor,
} from "../test-design/pro-tester-runtime-executors.js";

import { compactMcpInput } from "./mcp-input.js";
import type { AgentRuntimeToolDefinition } from "./agent-runtime-tool-registry.js";

export const AGENT = { id: "requirement-review-agent", version: "0.1.0" } as const;
export const SKILL = { id: "assess-requirement-quality", version: "0.1.0" } as const;
export const BROWSER_TEST_AGENT = { id: "browser-test-execution-agent", version: "0.1.0" } as const;
export const BROWSER_TEST_SKILL = { id: "execute-browser-test", version: "0.1.0" } as const;
export const DEMO_TEST_CASE_REF = "TC-DEMO-001@1.0.0";
export const DEMO_ENVIRONMENT_REF = "dev-fixture";
export const UI_DISCOVERY_AGENT = { id: "ui-surface-discovery-agent", version: "0.1.0" } as const;
export const UI_DISCOVERY_SKILL = { id: "discover-ui-surface", version: "0.1.0" } as const;
export const UI_DISCOVERY_ENGINE_REF = "playwright-dom-pipeline@0.1.0";
export const DISCOVER_AFTER_LOGIN_AGENT = { id: "discover-after-login-agent", version: "0.1.0" } as const;
export const DISCOVER_AFTER_LOGIN_SKILL = { id: "discover-after-login", version: "0.1.0" } as const;
export const TEST_CASE_GENERATION_AGENT = { id: "test-case-generation-agent", version: "0.1.0" } as const;
export const TEST_CASE_GENERATION_SKILL = { id: "generate-test-cases", version: "0.1.0" } as const;
export const EXECUTE_GENERATED_AGENT = { id: "execute-generated-test-case-agent", version: "0.1.0" } as const;
export const EXECUTE_GENERATED_SKILL = { id: "execute-generated-test-case", version: "0.1.0" } as const;
export const AUTO_QA_AGENT = { id: "auto-qa-pipeline-agent", version: "0.1.0" } as const;
export const AUTO_QA_SKILL = { id: "run-auto-qa-pipeline", version: "0.1.0" } as const;
export const A11Y_SMOKE_AGENT = { id: "ui-accessibility-smoke-agent", version: "0.1.0" } as const;
export const A11Y_SMOKE_SKILL = { id: "assess-ui-accessibility-smoke", version: "0.1.0" } as const;
export const EXPLORATORY_AGENT = { id: "exploratory-charter-agent", version: "0.1.0" } as const;
export const EXPLORATORY_SKILL = { id: "generate-exploratory-charter", version: "0.1.0" } as const;
export const EXPLORATORY_SESSION_AGENT = { id: "exploratory-session-agent", version: "0.1.0" } as const;
export const EXPLORATORY_SESSION_SKILL = { id: "execute-exploratory-session", version: "0.1.0" } as const;
export const DEFECT_QUALITY_AGENT = { id: "bug-analysis-agent", version: "0.1.0" } as const;
export const DEFECT_QUALITY_SKILL = { id: "assess-defect-quality", version: "0.1.0" } as const;
export const CREDENTIAL_REGISTER_AGENT = { id: "credential-registry-agent", version: "0.1.0" } as const;
export const CREDENTIAL_REGISTER_SKILL = { id: "register-workspace-secret", version: "0.1.0" } as const;
export const CREDENTIAL_LIST_AGENT = { id: "credential-list-agent", version: "0.1.0" } as const;
export const CREDENTIAL_LIST_SKILL = { id: "list-workspace-secrets", version: "0.1.0" } as const;
export const BA_QUALITY_AGENT = { id: "business-analysis-quality-agent", version: "0.1.0" } as const;
export const BA_QUALITY_SKILL = { id: "assess-business-analysis-quality", version: "0.1.0" } as const;
export const RISK_QUALITY_AGENT = { id: "risk-quality-agent", version: "0.1.0" } as const;
export const RISK_QUALITY_SKILL = { id: "assess-risk-quality", version: "0.1.0" } as const;
export const STRATEGY_QUALITY_AGENT = { id: "test-strategy-quality-agent", version: "0.1.0" } as const;
export const STRATEGY_QUALITY_SKILL = { id: "assess-test-strategy-quality", version: "0.1.0" } as const;
export const TEST_CASE_QUALITY_AGENT = { id: "test-case-quality-agent", version: "0.1.0" } as const;
export const TEST_CASE_QUALITY_SKILL = { id: "assess-test-case-quality", version: "0.1.0" } as const;
export const DATASET_QUALITY_AGENT = { id: "test-dataset-quality-agent", version: "0.1.0" } as const;
export const DATASET_QUALITY_SKILL = { id: "assess-test-dataset-quality", version: "0.1.0" } as const;
export const AUTOMATION_QUALITY_AGENT = { id: "automation-asset-quality-agent", version: "0.1.0" } as const;
export const AUTOMATION_QUALITY_SKILL = { id: "assess-automation-asset-quality", version: "0.1.0" } as const;
export const REPORT_QUALITY_AGENT = { id: "report-quality-agent", version: "0.1.0" } as const;
export const REPORT_QUALITY_SKILL = { id: "assess-report-quality", version: "0.1.0" } as const;
export const API_SMOKE_AGENT = { id: "api-smoke-agent", version: "0.1.0" } as const;
export const API_SMOKE_SKILL = { id: "execute-api-smoke", version: "0.1.0" } as const;
export const DEPTH_SMOKES_AGENT = { id: "depth-smokes-agent", version: "0.1.0" } as const;
export const DEPTH_SMOKES_SKILL = { id: "run-depth-smokes", version: "0.1.0" } as const;
export const FAILURE_AVOIDANCE_AGENT = { id: "failure-avoidance-hints-agent", version: "0.1.0" } as const;
export const FAILURE_AVOIDANCE_SKILL = { id: "list-failure-avoidance-hints", version: "0.1.0" } as const;
export const PRODUCT_CONTEXT_AGENT = { id: "product-context-discovery-agent", version: "0.1.0" } as const;
export const PRODUCT_CONTEXT_SKILL = { id: "discover-product-context", version: "0.1.0" } as const;
export const EXECUTION_RECORD_QUALITY_AGENT = { id: "execution-record-quality-agent", version: "0.1.0" } as const;
export const EXECUTION_RECORD_QUALITY_SKILL = { id: "assess-execution-record-quality", version: "0.1.0" } as const;
export const DRAFT_DEFECTS_AGENT = { id: "draft-defects-agent", version: "0.1.0" } as const;
export const DRAFT_DEFECTS_SKILL = { id: "draft-defects-from-qa-run", version: "0.1.0" } as const;
export const ENVIRONMENT_REGISTER_AGENT = { id: "environment-registry-agent", version: "0.1.0" } as const;
export const ENVIRONMENT_REGISTER_SKILL = { id: "register-workspace-environment", version: "0.1.0" } as const;
export const ENVIRONMENT_LIST_AGENT = { id: "environment-list-agent", version: "0.1.0" } as const;
export const ENVIRONMENT_LIST_SKILL = { id: "list-workspace-environments", version: "0.1.0" } as const;
export const WORKFLOW_STUB_AGENT = { id: "generate-workflow-stub-agent", version: "0.1.0" } as const;
export const WORKFLOW_STUB_SKILL = { id: "generate-business-analysis-stub", version: "0.1.0" } as const;
export const RISK_STUB_AGENT = { id: "generate-risk-stub-agent", version: "0.1.0" } as const;
export const RISK_STUB_SKILL = { id: "generate-risk-stub", version: "0.1.0" } as const;
export const STRATEGY_STUB_AGENT = { id: "generate-test-strategy-stub-agent", version: "0.1.0" } as const;
export const STRATEGY_STUB_SKILL = { id: "generate-test-strategy-stub", version: "0.1.0" } as const;
export const DATASET_REGISTER_AGENT = { id: "dataset-registry-agent", version: "0.1.0" } as const;
export const DATASET_REGISTER_SKILL = { id: "register-test-dataset", version: "0.1.0" } as const;
export const DATASET_LIST_AGENT = { id: "dataset-list-agent", version: "0.1.0" } as const;
export const DATASET_LIST_SKILL = { id: "list-test-datasets", version: "0.1.0" } as const;
export const DATASET_RESOLVE_AGENT = { id: "dataset-resolve-agent", version: "0.1.0" } as const;
export const DATASET_RESOLVE_SKILL = { id: "resolve-test-dataset-fields", version: "0.1.0" } as const;
export const AUTOMATION_STUB_AGENT = { id: "create-automation-asset-agent", version: "0.1.0" } as const;
export const AUTOMATION_STUB_SKILL = { id: "create-automation-asset", version: "0.1.0" } as const;
export const SKILL_QUALITY_EVAL_AGENT = { id: "evaluate-test-case-quality-skill-agent", version: "0.1.0" } as const;
export const SKILL_QUALITY_EVAL_SKILL = { id: "evaluate-test-case-quality-skill", version: "0.1.0" } as const;
export const MISTAKE_RECURRENCE_AGENT = { id: "raise-mistake-recurrence-candidate-agent", version: "0.1.0" } as const;
export const MISTAKE_RECURRENCE_SKILL = { id: "raise-mistake-recurrence-candidate", version: "0.1.0" } as const;
export const LIST_LEARNING_CANDIDATES_AGENT = { id: "list-learning-candidates-agent", version: "0.1.0" } as const;
export const LIST_LEARNING_CANDIDATES_SKILL = { id: "list-learning-candidates", version: "0.1.0" } as const;
export const UI_BASELINE_CAPTURE_AGENT = { id: "capture-ui-baseline-agent", version: "0.1.0" } as const;
export const UI_BASELINE_CAPTURE_SKILL = { id: "capture-ui-baseline", version: "0.1.0" } as const;
export const UI_BASELINE_COMPARE_AGENT = { id: "compare-ui-baseline-agent", version: "0.1.0" } as const;
export const UI_BASELINE_COMPARE_SKILL = { id: "compare-ui-baseline", version: "0.1.0" } as const;
export const SURFACE_BASELINE_REGISTER_AGENT = { id: "register-ui-surface-baseline-agent", version: "0.1.0" } as const;
export const SURFACE_BASELINE_REGISTER_SKILL = { id: "register-ui-surface-baseline", version: "0.1.0" } as const;
export const SURFACE_BASELINE_COMPARE_AGENT = { id: "compare-ui-surface-to-baseline-agent", version: "0.1.0" } as const;
export const SURFACE_BASELINE_COMPARE_SKILL = { id: "compare-ui-surface-to-baseline", version: "0.1.0" } as const;
export const REQUIREMENT_REGISTER_AGENT = { id: "requirement-registry-agent", version: "0.1.0" } as const;
export const REQUIREMENT_REGISTER_SKILL = { id: "register-requirement", version: "0.1.0" } as const;
export const REQUIREMENT_LIST_AGENT = { id: "requirement-list-agent", version: "0.1.0" } as const;
export const REQUIREMENT_LIST_SKILL = { id: "list-requirements", version: "0.1.0" } as const;
export const UI_WORKFLOW_AGENT = { id: "ui-workflow-discovery-agent", version: "0.1.0" } as const;
export const UI_WORKFLOW_SKILL = { id: "discover-ui-workflow", version: "0.1.0" } as const;
export const REGRESSION_REGISTER_AGENT = { id: "regression-suite-register-agent", version: "0.1.0" } as const;
export const REGRESSION_REGISTER_SKILL = { id: "register-regression-suite", version: "0.1.0" } as const;
export const REGRESSION_LIST_AGENT = { id: "regression-suite-list-agent", version: "0.1.0" } as const;
export const REGRESSION_LIST_SKILL = { id: "list-regression-suites", version: "0.1.0" } as const;
export const REGRESSION_RUN_AGENT = { id: "regression-suite-run-agent", version: "0.1.0" } as const;
export const REGRESSION_RUN_SKILL = { id: "run-regression-suite", version: "0.1.0" } as const;
export const OPENAPI_SMOKE_AGENT = { id: "openapi-to-api-smoke-agent", version: "0.1.0" } as const;
export const OPENAPI_SMOKE_SKILL = { id: "generate-api-smoke-from-openapi", version: "0.1.0" } as const;
export const DEFECT_EXPORT_AGENT = { id: "export-defects-agent", version: "0.1.0" } as const;
export const DEFECT_EXPORT_SKILL = { id: "export-defects-for-tracker", version: "0.1.0" } as const;
export const DEFECT_FILE_AGENT = { id: "file-defects-agent", version: "0.1.0" } as const;
export const DEFECT_FILE_SKILL = { id: "file-defects-to-tracker", version: "0.1.0" } as const;
export const KNOWLEDGE_REGISTER_AGENT = { id: "register-knowledge-record-agent", version: "0.1.0" } as const;
export const KNOWLEDGE_REGISTER_SKILL = { id: "register-knowledge-record", version: "0.1.0" } as const;
export const JOURNEY_GEN_AGENT = { id: "generate-journey-test-cases-agent", version: "0.1.0" } as const;
export const JOURNEY_GEN_SKILL = { id: "generate-journey-test-cases", version: "0.1.0" } as const;
export const COMPARE_UI_AGENT = { id: "compare-ui-surfaces-agent", version: "0.1.0" } as const;
export const COMPARE_UI_SKILL = { id: "compare-ui-surfaces", version: "0.1.0" } as const;
export const ROLE_COMPARE_AGENT = { id: "discover-compare-role-surfaces-agent", version: "0.1.0" } as const;
export const ROLE_COMPARE_SKILL = { id: "discover-compare-role-surfaces", version: "0.1.0" } as const;
export const DEMO_LOGIN_REQUIREMENT_REF = "REQ-DEMO-002@1.0.0";
export const DEMO_PASSWORD_SECRET_REF = "workspace-secret:demo-password";
export const DEMO_PAGE_ENVIRONMENT_REF = "environment:dev-fixture-page";
export const DEMO_LOGIN_ENVIRONMENT_REF = "environment:dev-fixture-login";

export function seedRequirement(workspaceId: string): Requirement {
  return {
    id: "REQ-DEMO-001",
    version: "1.0.0",
    status: "draft",
    title: "Lock repeated failed login attempts",
    statement: "The demo product SHALL lock authentication after the configured failed-attempt threshold.",
    source: ["DEMO-POLICY-001"],
    owner: "Demo Product Owner",
    capability_id: "Authentication",
    scope: { workspace_id: workspaceId },
    acceptance_criteria: [{ id: "AC-1", statement: "The threshold is evaluated by an accepted deterministic rule." }],
    assumptions: [],
    traceability: [{ relationship: "governed_by", target_id: "DEMO-POLICY-001" }],
  };
}

export function seedLoginRequirement(workspaceId: string): Requirement {
  return {
    id: "REQ-DEMO-002",
    version: "1.0.0",
    status: "in_review",
    title: "User can sign in",
    statement: "The demo product SHALL let a registered user sign in with valid credentials.",
    source: ["DEMO-POLICY-001"],
    owner: "Demo Product Owner",
    capability_id: "Authentication",
    scope: { workspace_id: workspaceId },
    acceptance_criteria: [
      { id: "AC-1", statement: 'The "Sign in" action authenticates a user who has entered a valid Username and Password.' },
    ],
    assumptions: [],
    traceability: [{ relationship: "governed_by", target_id: "DEMO-POLICY-001" }],
  };
}

function hasAccessibleText(
  node: import("../dom-cleaner/public.js").CleanedDomNode,
  expected: string,
): boolean {
  if (node.text === expected || node.accessible_name === expected) return true;
  return node.children.some((child) => hasAccessibleText(child, expected));
}

export const demoPageUrl = `data:text/html,${encodeURIComponent(
  "<html><body><h1>QA Intelligence dev fixture</h1></body></html>",
)}`;

export const demoLoginPageUrl = `data:text/html,${encodeURIComponent(`
  <html><body>
    <h1>Sign in</h1>
    <input aria-label="Username" id="u"/>
    <input aria-label="Password" id="p" type="password"/>
    <button aria-label="Sign in" onclick="
      if (document.getElementById('u').value === 'demo-user' &amp;&amp; document.getElementById('p').value === 'demo-pass') {
        document.body.innerHTML = '<h1>Welcome</h1>';
      } else {
        document.body.innerHTML = '<h1>Invalid credentials</h1>';
      }
    ">Sign in</button>
  </body></html>
`)}`;

export const DEMO_LOGIN_TEST_CASE_REF = "TC-DEMO-002@1.0.0";

export type DevFixtureBuild = Readonly<{
  runtime: InMemoryAgentRuntime;
  tools: readonly AgentRuntimeToolDefinition[];
  mistakeRecurrenceTracker: MistakeRecurrenceTracker;
  candidateRepository: InMemoryCandidateRepository;
}>;

/**
 * Builds the shared Agent Runtime + tool definitions both dev entrypoints
 * expose. Each caller supplies its own `authorizer` (fixture-proof for
 * `stdio`, real OIDC/JWKS for the remote transport) and `workspaceId` —
 * everything else (seeded requirements, Playwright fixture plans, tool
 * schemas/descriptions/budgets) is identical between the two transports.
 */
export function buildDevFixture(options: {
  workspaceId: string;
  policyVersion: string;
  authorizer: WorkspaceAuthorizer;
  clock: Clock;
  /** Phase 11 — shared with AgentRuntimeToolRegistry for failure-avoidance read/write. */
  sessionMemory?: SessionMemory;
}): DevFixtureBuild {
  const { workspaceId, policyVersion, authorizer, clock, sessionMemory } = options;

  let reviewId = 0;
  const reviewer = new AssessRequirementQuality({
    authorizer,
    knowledge: new FileBackedKnowledgeSearch({
      rootDir: join(process.cwd(), ".qa-knowledge"),
      workspace_id: workspaceId,
      knowledge_snapshot: "0.1.0",
      projection_freshness: clock.now().toISOString(),
      seed_records: [],
    }),
    // SPEC-203 (quality: acceptance criteria, source, ambiguous terms) and
    // SPEC-202 (contract completeness: rationale, traceability-count-by-
    // status) are independent accepted rule sets that both govern the same
    // Requirement — merge them so this dev entrypoint doesn't silently run
    // only one of the two rule sets a Requirement is actually subject to.
    rules: new CompositeRuleEngine([
      new RequirementQualityRuleEngine(),
      new RequirementIntelligenceRuleEngine(),
    ]),
    reasoning: new ScriptedReasoningProvider([]),
    clock,
    ids: { next: (scope): string => `${scope}-${++reviewId}` },
    configuration: {
      resolved_versions: {
        agent: `${AGENT.id}@${AGENT.version}`,
        skill: `${SKILL.id}@${SKILL.version}`,
        prompt: "requirement-assessment-prompt@0.1.0",
        rule_set: "requirement-quality@1.0.0",
        knowledge_snapshot: "0.1.0",
        policy: policyVersion,
        input_schema: "requirement.schema.json@1.0.0",
        output_schema: "requirement-assessment.schema.json@1.0.0",
      },
      limits: { knowledge_hits: 5, reasoning_tokens: 500, reasoning_cost: 0, reasoning_timeout_ms: 5_000 },
    },
  });

  // Phase 6 credential registry — file-backed under .qa-credentials/ so
  // refs survive MCP restart (local disk, not Vault). Demo password
  // pre-registered so login flows can use password_secret_ref.
  const credentials = new FileBackedWorkspaceCredentialRegistry(
    clock,
    join(process.cwd(), ".qa-credentials"),
  );
  credentials.register({
    workspace_id: workspaceId,
    secret_ref: DEMO_PASSWORD_SECRET_REF,
    value: "demo-pass",
    kind: "password",
    label: "Demo login password",
  });

  // SPEC-512 §12 — seed fixture environments; non-loopback http(s) must match.
  const environments = new InMemoryWorkspaceEnvironmentRegistry(clock);
  environments.register({
    workspace_id: workspaceId,
    environment_ref: DEMO_PAGE_ENVIRONMENT_REF,
    base_url: demoPageUrl,
    label: "Dev fixture page",
  });
  environments.register({
    workspace_id: workspaceId,
    environment_ref: DEMO_LOGIN_ENVIRONMENT_REF,
    base_url: demoLoginPageUrl,
    label: "Dev fixture login",
  });
  const datasets = new FileBackedWorkspaceDatasetRegistry(
    clock,
    join(process.cwd(), ".qa-test-datasets"),
  );
  const candidateRepository = new InMemoryCandidateRepository(clock);
  const mistakeRecurrenceTracker = new MistakeRecurrenceTracker(clock);

  // Tracer bullet (docs/proposals/SPEC-512-mcp-test-execution-tool.md).
  // TC-DEMO-001: navigate + assert only. TC-DEMO-002 (Phase 2,
  // docs/proposals/professional-qa-mcp-roadmap.md): semantic type/click
  // steps driving a real login fixture, with the password resolved through
  // the Workspace credential registry rather than appearing anywhere in the
  // plan or MCP input.
  const browserTestPlans = new Map<string, PlaywrightExecutionPlan>([
    [
      DEMO_TEST_CASE_REF,
      {
        url: demoPageUrl,
        assert: (cleaned) => hasAccessibleText(cleaned, "QA Intelligence dev fixture"),
      },
    ],
    [
      DEMO_LOGIN_TEST_CASE_REF,
      {
        url: demoLoginPageUrl,
        steps: [
          { kind: "type", target: { accessible_name: "Username" }, text: "demo-user" },
          { kind: "type", target: { accessible_name: "Password" }, secret_ref: DEMO_PASSWORD_SECRET_REF },
          { kind: "click", target: { accessible_name: "Sign in", accessible_role: "button" } },
        ],
        assert: (cleaned) => hasAccessibleText(cleaned, "Welcome"),
      },
    ],
  ]);
  const browserTestEngine = new PlaywrightExecutionEngine({
    clock,
    authorizer,
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: browserTestPlans,
    secrets: credentials,
  });
  const browserTestSkill = new ExecuteBrowserTest({
    engine: browserTestEngine,
    clock,
    provider_ref: "playwright-execution-engine@0.1.0",
  });
  const uiDiscoverySkill = new DiscoverUiSurface({ clock, authorizer });
  const uiWorkflowSkill = new DiscoverUiWorkflow({ clock, authorizer, discoverUiSurface: uiDiscoverySkill });
  const regressionSuites = new FileBackedRegressionSuiteRegistry(
    clock,
    join(process.cwd(), ".qa-regression-suites"),
  );

  const discoverAfterLoginSkill = new DiscoverAfterLogin({ clock, authorizer });
  const requirementResolver = new InMemoryRequirementResolver(
    workspaceId,
    [seedRequirement(workspaceId), seedLoginRequirement(workspaceId)],
    authorizer,
  );
  let testCaseSequence = 0;
  let testCaseFindingSequence = 0;
  const testCaseGenerator = new GenerateTestCases({
    authorizer,
    ids: { next: (scope): string => (scope === "test-case" ? `test-case-${++testCaseSequence}` : `finding-${++testCaseFindingSequence}`) },
  });

  let defectAssessmentSequence = 0;
  let defectFindingSequence = 0;
  const emptyKnowledge = new FileBackedKnowledgeSearch({
    rootDir: join(process.cwd(), ".qa-knowledge"),
    workspace_id: workspaceId,
    knowledge_snapshot: "0.1.0",
    projection_freshness: clock.now().toISOString(),
    seed_records: [
      {
        workspace_id: workspaceId,
        knowledge_snapshot: "0.1.0",
        knowledge_ref: "knowledge:product-context-seed",
        title: "Product context seed",
        excerpt:
          "Dev MCP ships a durable Knowledge seed under .qa-knowledge/. Prefer register_knowledge_record for Workspace facts — never invent product truth.",
        authority_status: "accepted",
        scopes: ["product-context"],
        applicability: { workspace_id: workspaceId },
        provenance: ["dev-fixture-seed"],
        evidence: ["source:dev-fixture"],
      },
    ],
  });
  const defectReviewer = new AssessDefectQuality({
    authorizer,
    knowledge: emptyKnowledge,
    rules: new DefectQualityRuleEngine(),
    clock,
    ids: {
      next: (scope): string =>
        scope === "assessment" ? `defect-assessment-${++defectAssessmentSequence}` : `defect-finding-${++defectFindingSequence}`,
    },
    configuration: {
      resolved_versions: {
        agent: `${DEFECT_QUALITY_AGENT.id}@${DEFECT_QUALITY_AGENT.version}`,
        skill: `${DEFECT_QUALITY_SKILL.id}@${DEFECT_QUALITY_SKILL.version}`,
        rule_set: "defect-quality@1.0.0",
        knowledge_snapshot: "0.1.0",
        policy: policyVersion,
        input_schema: "defect.schema.json@1.0.0",
        output_schema: "defect-assessment.schema.json@1.0.0",
      },
      limits: { knowledge_hits: 5 },
    },
  });

  // Phase 7 — document-quality Skills already exist; MCP only wires them.
  let docAssessmentSequence = 0;
  let docFindingSequence = 0;
  const nextDocId = (scope: "assessment" | "finding"): string =>
    scope === "assessment" ? `doc-assessment-${++docAssessmentSequence}` : `doc-finding-${++docFindingSequence}`;

  const baReviewer = new AssessBusinessAnalysisQuality({
    authorizer,
    knowledge: emptyKnowledge,
    rules: new BusinessAnalysisQualityRuleEngine(),
    clock,
    ids: { next: nextDocId },
    configuration: {
      resolved_versions: {
        agent: `${BA_QUALITY_AGENT.id}@${BA_QUALITY_AGENT.version}`,
        skill: `${BA_QUALITY_SKILL.id}@${BA_QUALITY_SKILL.version}`,
        rule_set: "business-analysis-quality@1.0.0",
        knowledge_snapshot: "0.1.0",
        policy: policyVersion,
        input_schema: "workflow.schema.json@1.0.0",
        output_schema: "business-analysis-assessment.schema.json@1.0.0",
      },
      limits: { knowledge_hits: 5 },
    },
  });
  const riskReviewer = new AssessRiskQuality({
    authorizer,
    knowledge: emptyKnowledge,
    rules: new RiskQualityRuleEngine(),
    clock,
    ids: { next: nextDocId },
    configuration: {
      resolved_versions: {
        agent: `${RISK_QUALITY_AGENT.id}@${RISK_QUALITY_AGENT.version}`,
        skill: `${RISK_QUALITY_SKILL.id}@${RISK_QUALITY_SKILL.version}`,
        rule_set: "risk-quality@1.0.0",
        knowledge_snapshot: "0.1.0",
        policy: policyVersion,
        input_schema: "risk.schema.json@1.0.0",
        output_schema: "risk-assessment.schema.json@1.0.0",
      },
      limits: { knowledge_hits: 5 },
    },
  });
  const strategyReviewer = new AssessTestStrategyQuality({
    authorizer,
    knowledge: emptyKnowledge,
    rules: new TestStrategyQualityRuleEngine(),
    clock,
    ids: { next: nextDocId },
    configuration: {
      resolved_versions: {
        agent: `${STRATEGY_QUALITY_AGENT.id}@${STRATEGY_QUALITY_AGENT.version}`,
        skill: `${STRATEGY_QUALITY_SKILL.id}@${STRATEGY_QUALITY_SKILL.version}`,
        rule_set: "test-strategy-quality@1.0.0",
        knowledge_snapshot: "0.1.0",
        policy: policyVersion,
        input_schema: "test-strategy.schema.json@1.0.0",
        output_schema: "test-strategy-assessment.schema.json@1.0.0",
      },
      limits: { knowledge_hits: 5 },
    },
  });
  const testCaseQualityReviewer = new AssessTestCaseQuality({
    authorizer,
    knowledge: emptyKnowledge,
    rules: new TestCaseQualityRuleEngine(),
    clock,
    ids: { next: nextDocId },
    configuration: {
      resolved_versions: {
        agent: `${TEST_CASE_QUALITY_AGENT.id}@${TEST_CASE_QUALITY_AGENT.version}`,
        skill: `${TEST_CASE_QUALITY_SKILL.id}@${TEST_CASE_QUALITY_SKILL.version}`,
        rule_set: "test-case-quality@1.0.0",
        knowledge_snapshot: "0.1.0",
        policy: policyVersion,
        input_schema: "test-case.schema.json@1.0.0",
        output_schema: "test-case-assessment.schema.json@1.0.0",
      },
      limits: { knowledge_hits: 5 },
    },
  });
  const datasetReviewer = new AssessTestDatasetQuality({
    authorizer,
    knowledge: emptyKnowledge,
    rules: new TestDatasetQualityRuleEngine(),
    clock,
    ids: { next: nextDocId },
    configuration: {
      resolved_versions: {
        agent: `${DATASET_QUALITY_AGENT.id}@${DATASET_QUALITY_AGENT.version}`,
        skill: `${DATASET_QUALITY_SKILL.id}@${DATASET_QUALITY_SKILL.version}`,
        rule_set: "test-dataset-quality@1.0.0",
        knowledge_snapshot: "0.1.0",
        policy: policyVersion,
        input_schema: "test-dataset.schema.json@1.0.0",
        output_schema: "test-dataset-assessment.schema.json@1.0.0",
      },
      limits: { knowledge_hits: 5 },
    },
  });
  const automationReviewer = new AssessAutomationAssetQuality({
    authorizer,
    knowledge: emptyKnowledge,
    rules: new AutomationAssetQualityRuleEngine(),
    clock,
    ids: { next: nextDocId },
    configuration: {
      resolved_versions: {
        agent: `${AUTOMATION_QUALITY_AGENT.id}@${AUTOMATION_QUALITY_AGENT.version}`,
        skill: `${AUTOMATION_QUALITY_SKILL.id}@${AUTOMATION_QUALITY_SKILL.version}`,
        rule_set: "automation-asset-quality@1.0.0",
        knowledge_snapshot: "0.1.0",
        policy: policyVersion,
        input_schema: "automation-asset.schema.json@1.0.0",
        output_schema: "automation-asset-assessment.schema.json@1.0.0",
      },
      limits: { knowledge_hits: 5 },
    },
  });
  const reportReviewer = new AssessReportQuality({
    authorizer,
    knowledge: emptyKnowledge,
    rules: new ReportQualityRuleEngine(),
    clock,
    ids: { next: nextDocId },
    configuration: {
      resolved_versions: {
        agent: `${REPORT_QUALITY_AGENT.id}@${REPORT_QUALITY_AGENT.version}`,
        skill: `${REPORT_QUALITY_SKILL.id}@${REPORT_QUALITY_SKILL.version}`,
        rule_set: "report-quality@1.0.0",
        knowledge_snapshot: "0.1.0",
        policy: policyVersion,
        input_schema: "report.schema.json@1.0.0",
        output_schema: "report-assessment.schema.json@1.0.0",
      },
      limits: { knowledge_hits: 5 },
    },
  });

  let apiSmokeSuiteSequence = 0;
  let apiSmokeCaseSequence = 0;
  const apiSmokeSkill = new ExecuteApiSmoke({
    authorizer,
    clock,
    credentials,
    ids: {
      next: (scope): string =>
        scope === "suite" ? `api-smoke-${++apiSmokeSuiteSequence}` : `api-case-${++apiSmokeCaseSequence}`,
    },
  });

  let exploratorySessionSequence = 0;
  let exploratoryObservationSequence = 0;
  const exploratorySessionSkill = new ExecuteExploratorySession({
    authorizer,
    clock,
    discoverUiSurface: uiDiscoverySkill,
    runBoundedProbes: runPlaywrightBoundedProbes,
    ids: {
      next: (scope): string =>
        scope === "session"
          ? `exploratory-session-${++exploratorySessionSequence}`
          : `exploratory-obs-${++exploratoryObservationSequence}`,
    },
  });

  let depthReportSequence = 0;
  let depthFindingSequence = 0;
  const depthSmokesSkill = new RunDepthSmokes({
    authorizer,
    clock,
    ids: {
      next: (scope): string =>
        scope === "report" ? `depth-report-${++depthReportSequence}` : `depth-finding-${++depthFindingSequence}`,
    },
  });

  let productContextFindingSequence = 0;
  let productContextQuestionSequence = 0;
  const productContextSkill = new DiscoverProductContext({
    authorizer,
    knowledge: emptyKnowledge,
    ids: {
      next: (scope): string =>
        scope === "finding"
          ? `discovery-finding-${++productContextFindingSequence}`
          : `discovery-question-${++productContextQuestionSequence}`,
    },
    configuration: {
      resolved_versions: {
        agent: `${PRODUCT_CONTEXT_AGENT.id}@${PRODUCT_CONTEXT_AGENT.version}`,
        skill: `${PRODUCT_CONTEXT_SKILL.id}@${PRODUCT_CONTEXT_SKILL.version}`,
        knowledge_snapshot: "0.1.0",
      },
      limits: { hits_per_scope: 10 },
    },
  });

  const executionRecordReviewer = new AssessExecutionRecordQuality({
    authorizer,
    knowledge: emptyKnowledge,
    rules: new ExecutionRecordQualityRuleEngine(),
    clock,
    ids: { next: nextDocId },
    configuration: {
      resolved_versions: {
        agent: `${EXECUTION_RECORD_QUALITY_AGENT.id}@${EXECUTION_RECORD_QUALITY_AGENT.version}`,
        skill: `${EXECUTION_RECORD_QUALITY_SKILL.id}@${EXECUTION_RECORD_QUALITY_SKILL.version}`,
        rule_set: "execution-record-quality@1.0.0",
        knowledge_snapshot: "0.1.0",
        policy: policyVersion,
        input_schema: "execution-record.schema.json@1.0.0",
        output_schema: "execution-record-assessment.schema.json@1.0.0",
      },
      limits: { knowledge_hits: 5 },
    },
  });

  let runSequence = 0;
  let eventSequence = 0;
  const ids: IdFactory = {
    next: (kind: "run" | "event"): string => (kind === "run" ? `run-${++runSequence}` : `event-${++eventSequence}`),
  };
  const executorMap = new Map<string, AgentRunExecutor>([
      [
        AGENT.id,
        new RequirementReviewRuntimeExecutor({
          reviewer,
          requirements: requirementResolver,
          validateAssessment: () => true,
          expected_agent: AGENT,
          expected_skill: SKILL,
        }),
      ],
      [
        BROWSER_TEST_AGENT.id,
        new BrowserTestRuntimeExecutor({
          skill: browserTestSkill,
          expected_agent: BROWSER_TEST_AGENT,
          expected_skill: BROWSER_TEST_SKILL,
        }),
      ],
      [
        UI_DISCOVERY_AGENT.id,
        new UiSurfaceDiscoveryRuntimeExecutor({
          skill: uiDiscoverySkill,
          expected_agent: UI_DISCOVERY_AGENT,
          expected_skill: UI_DISCOVERY_SKILL,
          engine_ref: UI_DISCOVERY_ENGINE_REF,
          environments,
        }),
      ],
      [
        DISCOVER_AFTER_LOGIN_AGENT.id,
        new DiscoverAfterLoginRuntimeExecutor({
          skill: discoverAfterLoginSkill,
          expected_agent: DISCOVER_AFTER_LOGIN_AGENT,
          expected_skill: DISCOVER_AFTER_LOGIN_SKILL,
          engine_ref: UI_DISCOVERY_ENGINE_REF,
          credentials,
        }),
      ],
      [
        TEST_CASE_GENERATION_AGENT.id,
        new GenerateTestCasesRuntimeExecutor({
          requirements: requirementResolver,
          discovery: uiDiscoverySkill,
          generator: testCaseGenerator,
          expected_agent: TEST_CASE_GENERATION_AGENT,
          expected_skill: TEST_CASE_GENERATION_SKILL,
        }),
      ],
      [
        EXECUTE_GENERATED_AGENT.id,
        new ExecuteGeneratedTestCaseRuntimeExecutor({
          clock,
          authorizer,
          expected_agent: EXECUTE_GENERATED_AGENT,
          expected_skill: EXECUTE_GENERATED_SKILL,
          credentials,
        }),
      ],
      [
        AUTO_QA_AGENT.id,
        new RunAutoQaPipelineRuntimeExecutor({
          clock,
          authorizer,
          discoverUiSurface: uiDiscoverySkill,
          discoverAfterLogin: discoverAfterLoginSkill,
          generator: testCaseGenerator,
          expected_agent: AUTO_QA_AGENT,
          expected_skill: AUTO_QA_SKILL,
          credentials,
          ...(sessionMemory !== undefined ? { sessionMemory } : {}),
        }),
      ],
      [
        A11Y_SMOKE_AGENT.id,
        new AccessibilitySmokeRuntimeExecutor({
          discoverUiSurface: uiDiscoverySkill,
          expected_agent: A11Y_SMOKE_AGENT,
          expected_skill: A11Y_SMOKE_SKILL,
        }),
      ],
      [
        EXPLORATORY_AGENT.id,
        new ExploratoryCharterRuntimeExecutor({
          discoverUiSurface: uiDiscoverySkill,
          expected_agent: EXPLORATORY_AGENT,
          expected_skill: EXPLORATORY_SKILL,
        }),
      ],
      [
        EXPLORATORY_SESSION_AGENT.id,
        new ExploratorySessionRuntimeExecutor({
          skill: exploratorySessionSkill,
          expected_agent: EXPLORATORY_SESSION_AGENT,
          expected_skill: EXPLORATORY_SESSION_SKILL,
        }),
      ],
      [
        DEFECT_QUALITY_AGENT.id,
        new DefectQualityRuntimeExecutor({
          reviewer: defectReviewer,
          expected_agent: DEFECT_QUALITY_AGENT,
          expected_skill: DEFECT_QUALITY_SKILL,
        }),
      ],
      [
        CREDENTIAL_REGISTER_AGENT.id,
        new CredentialRegistryRuntimeExecutor({
          registry: credentials,
          expected_agent: CREDENTIAL_REGISTER_AGENT,
          expected_skill: CREDENTIAL_REGISTER_SKILL,
          mode: "register",
          authorizer,
        }),
      ],
      [
        CREDENTIAL_LIST_AGENT.id,
        new CredentialRegistryRuntimeExecutor({
          registry: credentials,
          expected_agent: CREDENTIAL_LIST_AGENT,
          expected_skill: CREDENTIAL_LIST_SKILL,
          mode: "list",
          authorizer,
        }),
      ],
      [
        BA_QUALITY_AGENT.id,
        new DocumentQualityRuntimeExecutor({
          expected_agent: BA_QUALITY_AGENT,
          expected_skill: BA_QUALITY_SKILL,
          document_key: "workflow",
          review: async ({ operation_id, workspace_id, context, document }) => {
            const result = await baReviewer.review({
              operation_id,
              workspace_id,
              context,
              workflow: document as unknown as Workflow,
            });
            if (!result.ok) return { ok: false, failure: toDocumentQualityFailure(result.failure) };
            return { ok: true, value: toDocumentQualityAssessment(result.value) };
          },
        }),
      ],
      [
        RISK_QUALITY_AGENT.id,
        new DocumentQualityRuntimeExecutor({
          expected_agent: RISK_QUALITY_AGENT,
          expected_skill: RISK_QUALITY_SKILL,
          document_key: "risk",
          review: async ({ operation_id, workspace_id, context, document }) => {
            const result = await riskReviewer.review({
              operation_id,
              workspace_id,
              context,
              risk: document as unknown as Risk,
            });
            if (!result.ok) return { ok: false, failure: toDocumentQualityFailure(result.failure) };
            return { ok: true, value: toDocumentQualityAssessment(result.value) };
          },
        }),
      ],
      [
        STRATEGY_QUALITY_AGENT.id,
        new DocumentQualityRuntimeExecutor({
          expected_agent: STRATEGY_QUALITY_AGENT,
          expected_skill: STRATEGY_QUALITY_SKILL,
          document_key: "test_strategy",
          review: async ({ operation_id, workspace_id, context, document }) => {
            const result = await strategyReviewer.review({
              operation_id,
              workspace_id,
              context,
              test_strategy: document as unknown as TestStrategy,
            });
            if (!result.ok) return { ok: false, failure: toDocumentQualityFailure(result.failure) };
            return { ok: true, value: toDocumentQualityAssessment(result.value) };
          },
        }),
      ],
      [
        TEST_CASE_QUALITY_AGENT.id,
        new DocumentQualityRuntimeExecutor({
          expected_agent: TEST_CASE_QUALITY_AGENT,
          expected_skill: TEST_CASE_QUALITY_SKILL,
          document_key: "test_case",
          review: async ({ operation_id, workspace_id, context, document }) => {
            const result = await testCaseQualityReviewer.review({
              operation_id,
              workspace_id,
              context,
              test_case: document as unknown as TestCase,
            });
            if (!result.ok) return { ok: false, failure: toDocumentQualityFailure(result.failure) };
            return { ok: true, value: toDocumentQualityAssessment(result.value) };
          },
        }),
      ],
      [
        DATASET_QUALITY_AGENT.id,
        new DocumentQualityRuntimeExecutor({
          expected_agent: DATASET_QUALITY_AGENT,
          expected_skill: DATASET_QUALITY_SKILL,
          document_key: "test_dataset",
          review: async ({ operation_id, workspace_id, context, document }) => {
            const result = await datasetReviewer.review({
              operation_id,
              workspace_id,
              context,
              test_dataset: document as unknown as TestDataset,
            });
            if (!result.ok) return { ok: false, failure: toDocumentQualityFailure(result.failure) };
            return { ok: true, value: toDocumentQualityAssessment(result.value) };
          },
        }),
      ],
      [
        AUTOMATION_QUALITY_AGENT.id,
        new DocumentQualityRuntimeExecutor({
          expected_agent: AUTOMATION_QUALITY_AGENT,
          expected_skill: AUTOMATION_QUALITY_SKILL,
          document_key: "automation_asset",
          review: async ({ operation_id, workspace_id, context, document }) => {
            const result = await automationReviewer.review({
              operation_id,
              workspace_id,
              context,
              automation_asset: document as unknown as AutomationAsset,
            });
            if (!result.ok) return { ok: false, failure: toDocumentQualityFailure(result.failure) };
            return { ok: true, value: toDocumentQualityAssessment(result.value) };
          },
        }),
      ],
      [
        REPORT_QUALITY_AGENT.id,
        new DocumentQualityRuntimeExecutor({
          expected_agent: REPORT_QUALITY_AGENT,
          expected_skill: REPORT_QUALITY_SKILL,
          document_key: "report",
          review: async ({ operation_id, workspace_id, context, document }) => {
            const result = await reportReviewer.review({
              operation_id,
              workspace_id,
              context,
              report: document as unknown as Report,
            });
            if (!result.ok) return { ok: false, failure: toDocumentQualityFailure(result.failure) };
            return { ok: true, value: toDocumentQualityAssessment(result.value) };
          },
        }),
      ],
      [
        API_SMOKE_AGENT.id,
        new ApiSmokeRuntimeExecutor({
          skill: apiSmokeSkill,
          expected_agent: API_SMOKE_AGENT,
          expected_skill: API_SMOKE_SKILL,
        }),
      ],
      [
        DEPTH_SMOKES_AGENT.id,
        new DepthSmokesRuntimeExecutor({
          skill: depthSmokesSkill,
          expected_agent: DEPTH_SMOKES_AGENT,
          expected_skill: DEPTH_SMOKES_SKILL,
        }),
      ],
  ]);
  if (sessionMemory !== undefined) {
    executorMap.set(
      FAILURE_AVOIDANCE_AGENT.id,
      new FailureAvoidanceHintsRuntimeExecutor({
        sessionMemory,
        expected_agent: FAILURE_AVOIDANCE_AGENT,
        expected_skill: FAILURE_AVOIDANCE_SKILL,
      }),
    );
  }
  executorMap.set(
    PRODUCT_CONTEXT_AGENT.id,
    new ProductContextDiscoveryRuntimeExecutor({
      skill: productContextSkill,
      expected_agent: PRODUCT_CONTEXT_AGENT,
      expected_skill: PRODUCT_CONTEXT_SKILL,
    }),
  );
  executorMap.set(
    EXECUTION_RECORD_QUALITY_AGENT.id,
    new DocumentQualityRuntimeExecutor({
      expected_agent: EXECUTION_RECORD_QUALITY_AGENT,
      expected_skill: EXECUTION_RECORD_QUALITY_SKILL,
      document_key: "execution_record",
      review: async ({ operation_id, workspace_id, context, document }) => {
        const result = await executionRecordReviewer.review({
          operation_id,
          workspace_id,
          context,
          execution_record: document as unknown as ExecutionRecord,
        });
        if (!result.ok) return { ok: false, failure: toDocumentQualityFailure(result.failure) };
        return { ok: true, value: toDocumentQualityAssessment(result.value) };
      },
    }),
  );
  executorMap.set(
    DRAFT_DEFECTS_AGENT.id,
    new DraftDefectsRuntimeExecutor({
      expected_agent: DRAFT_DEFECTS_AGENT,
      expected_skill: DRAFT_DEFECTS_SKILL,
    }),
  );
  executorMap.set(
    ENVIRONMENT_REGISTER_AGENT.id,
    new EnvironmentRegistryRuntimeExecutor({
      registry: environments,
      expected_agent: ENVIRONMENT_REGISTER_AGENT,
      expected_skill: ENVIRONMENT_REGISTER_SKILL,
      mode: "register",
      authorizer,
    }),
  );
  executorMap.set(
    ENVIRONMENT_LIST_AGENT.id,
    new EnvironmentRegistryRuntimeExecutor({
      registry: environments,
      expected_agent: ENVIRONMENT_LIST_AGENT,
      expected_skill: ENVIRONMENT_LIST_SKILL,
      mode: "list",
      authorizer,
    }),
  );
  executorMap.set(
    WORKFLOW_STUB_AGENT.id,
    new UiMapStubRuntimeExecutor({
      discoverUiSurface: uiDiscoverySkill,
      expected_agent: WORKFLOW_STUB_AGENT,
      expected_skill: WORKFLOW_STUB_SKILL,
      tool_name: "generate_business_analysis_stub",
      generate: ({ elements, source_url, workspace_id, input }) => {
        const requirementRef =
          typeof input["requirement_ref"] === "string" && input["requirement_ref"].trim()
            ? input["requirement_ref"].trim()
            : undefined;
        const workflow = generateWorkflowStub({
          elements,
          workspace_id,
          ...(source_url !== undefined ? { source_url } : {}),
          ...(requirementRef !== undefined ? { requirement_ref: requirementRef } : {}),
        });
        return { workflow: { ...workflow } };
      },
    }),
  );
  executorMap.set(
    RISK_STUB_AGENT.id,
    new UiMapStubRuntimeExecutor({
      discoverUiSurface: uiDiscoverySkill,
      expected_agent: RISK_STUB_AGENT,
      expected_skill: RISK_STUB_SKILL,
      tool_name: "generate_risk_stub",
      generate: ({ elements, source_url, workspace_id, input }) => {
        const requirementRef =
          typeof input["requirement_ref"] === "string" && input["requirement_ref"].trim()
            ? input["requirement_ref"].trim()
            : undefined;
        const risks = generateRiskStubs({
          elements,
          workspace_id,
          ...(source_url !== undefined ? { source_url } : {}),
          ...(requirementRef !== undefined ? { requirement_ref: requirementRef } : {}),
        });
        return { risks: risks.map((risk) => ({ ...risk })) };
      },
    }),
  );
  executorMap.set(
    STRATEGY_STUB_AGENT.id,
    new UiMapStubRuntimeExecutor({
      discoverUiSurface: uiDiscoverySkill,
      expected_agent: STRATEGY_STUB_AGENT,
      expected_skill: STRATEGY_STUB_SKILL,
      tool_name: "generate_test_strategy_stub",
      generate: ({ elements, source_url, workspace_id, input }) => {
        const objective =
          typeof input["objective"] === "string" && input["objective"].trim() ? input["objective"].trim() : undefined;
        const requirementRef =
          typeof input["requirement_ref"] === "string" && input["requirement_ref"].trim()
            ? input["requirement_ref"].trim()
            : undefined;
        const strategy = generateTestStrategyStub({
          elements,
          workspace_id,
          ...(source_url !== undefined ? { source_url } : {}),
          ...(objective !== undefined ? { objective } : {}),
          ...(requirementRef !== undefined ? { requirement_ref: requirementRef } : {}),
        });
        return { test_strategy: { ...strategy } };
      },
    }),
  );
  executorMap.set(
    DATASET_REGISTER_AGENT.id,
    new DatasetRegistryRuntimeExecutor({
      registry: datasets,
      expected_agent: DATASET_REGISTER_AGENT,
      expected_skill: DATASET_REGISTER_SKILL,
      mode: "register",
      authorizer,
    }),
  );
  executorMap.set(
    DATASET_LIST_AGENT.id,
    new DatasetRegistryRuntimeExecutor({
      registry: datasets,
      expected_agent: DATASET_LIST_AGENT,
      expected_skill: DATASET_LIST_SKILL,
      mode: "list",
      authorizer,
    }),
  );
  executorMap.set(
    DATASET_RESOLVE_AGENT.id,
    new DatasetRegistryRuntimeExecutor({
      registry: datasets,
      expected_agent: DATASET_RESOLVE_AGENT,
      expected_skill: DATASET_RESOLVE_SKILL,
      mode: "resolve",
      authorizer,
    }),
  );
  executorMap.set(
    AUTOMATION_STUB_AGENT.id,
    new AutomationAssetStubRuntimeExecutor({
      expected_agent: AUTOMATION_STUB_AGENT,
      expected_skill: AUTOMATION_STUB_SKILL,
      authorizer,
      persistRootDir: join(process.cwd(), ".qa-automation-assets"),
    }),
  );
  executorMap.set(
    SKILL_QUALITY_EVAL_AGENT.id,
    new EvaluateTestCaseQualitySkillRuntimeExecutor({
      clock,
      evidenceVerifier: { verify: () => true },
      skill: testCaseQualityReviewer,
      expected_agent: SKILL_QUALITY_EVAL_AGENT,
      expected_skill: SKILL_QUALITY_EVAL_SKILL,
    }),
  );
  executorMap.set(
    MISTAKE_RECURRENCE_AGENT.id,
    new RaiseMistakeRecurrenceCandidateRuntimeExecutor({
      candidateRepository,
      expected_agent: MISTAKE_RECURRENCE_AGENT,
      expected_skill: MISTAKE_RECURRENCE_SKILL,
    }),
  );
  executorMap.set(
    LIST_LEARNING_CANDIDATES_AGENT.id,
    new ListLearningCandidatesRuntimeExecutor({
      candidateRepository,
      expected_agent: LIST_LEARNING_CANDIDATES_AGENT,
      expected_skill: LIST_LEARNING_CANDIDATES_SKILL,
    }),
  );
  executorMap.set(
    UI_BASELINE_CAPTURE_AGENT.id,
    new UiBaselineRuntimeExecutor({
      expected_agent: UI_BASELINE_CAPTURE_AGENT,
      expected_skill: UI_BASELINE_CAPTURE_SKILL,
      mode: "capture",
      clock,
    }),
  );
  executorMap.set(
    UI_BASELINE_COMPARE_AGENT.id,
    new UiBaselineRuntimeExecutor({
      expected_agent: UI_BASELINE_COMPARE_AGENT,
      expected_skill: UI_BASELINE_COMPARE_SKILL,
      mode: "compare",
      clock,
    }),
  );
  executorMap.set(
    SURFACE_BASELINE_REGISTER_AGENT.id,
    new SurfaceBaselineRuntimeExecutor({
      expected_agent: SURFACE_BASELINE_REGISTER_AGENT,
      expected_skill: SURFACE_BASELINE_REGISTER_SKILL,
      mode: "register",
      clock,
    }),
  );
  executorMap.set(
    SURFACE_BASELINE_COMPARE_AGENT.id,
    new SurfaceBaselineRuntimeExecutor({
      expected_agent: SURFACE_BASELINE_COMPARE_AGENT,
      expected_skill: SURFACE_BASELINE_COMPARE_SKILL,
      mode: "compare",
      clock,
    }),
  );
  executorMap.set(
    REQUIREMENT_REGISTER_AGENT.id,
    new RequirementRegistryRuntimeExecutor({
      resolver: requirementResolver,
      expected_agent: REQUIREMENT_REGISTER_AGENT,
      expected_skill: REQUIREMENT_REGISTER_SKILL,
      mode: "register",
      authorizer,
    }),
  );
  executorMap.set(
    REQUIREMENT_LIST_AGENT.id,
    new RequirementRegistryRuntimeExecutor({
      resolver: requirementResolver,
      expected_agent: REQUIREMENT_LIST_AGENT,
      expected_skill: REQUIREMENT_LIST_SKILL,
      mode: "list",
      authorizer,
    }),
  );
  executorMap.set(
    UI_WORKFLOW_AGENT.id,
    new UiWorkflowDiscoveryRuntimeExecutor({
      skill: uiWorkflowSkill,
      expected_agent: UI_WORKFLOW_AGENT,
      expected_skill: UI_WORKFLOW_SKILL,
    }),
  );
  executorMap.set(
    REGRESSION_REGISTER_AGENT.id,
    new RegressionSuiteRuntimeExecutor({
      registry: regressionSuites,
      expected_agent: REGRESSION_REGISTER_AGENT,
      expected_skill: REGRESSION_REGISTER_SKILL,
      mode: "register",
      authorizer,
      clock,
      browserAuthorizer: authorizer,
      apiSmoke: apiSmokeSkill,
      credentials,
    }),
  );
  executorMap.set(
    REGRESSION_LIST_AGENT.id,
    new RegressionSuiteRuntimeExecutor({
      registry: regressionSuites,
      expected_agent: REGRESSION_LIST_AGENT,
      expected_skill: REGRESSION_LIST_SKILL,
      mode: "list",
      authorizer,
      clock,
      browserAuthorizer: authorizer,
      apiSmoke: apiSmokeSkill,
      credentials,
    }),
  );
  executorMap.set(
    REGRESSION_RUN_AGENT.id,
    new RegressionSuiteRuntimeExecutor({
      registry: regressionSuites,
      expected_agent: REGRESSION_RUN_AGENT,
      expected_skill: REGRESSION_RUN_SKILL,
      mode: "run",
      authorizer,
      clock,
      browserAuthorizer: authorizer,
      apiSmoke: apiSmokeSkill,
      credentials,
    }),
  );
  executorMap.set(
    OPENAPI_SMOKE_AGENT.id,
    new OpenApiSmokeRuntimeExecutor({
      expected_agent: OPENAPI_SMOKE_AGENT,
      expected_skill: OPENAPI_SMOKE_SKILL,
    }),
  );
  executorMap.set(
    DEFECT_EXPORT_AGENT.id,
    new DefectExportRuntimeExecutor({
      expected_agent: DEFECT_EXPORT_AGENT,
      expected_skill: DEFECT_EXPORT_SKILL,
    }),
  );
  executorMap.set(
    DEFECT_FILE_AGENT.id,
    new DefectFileRuntimeExecutor({
      expected_agent: DEFECT_FILE_AGENT,
      expected_skill: DEFECT_FILE_SKILL,
      credentials,
    }),
  );
  executorMap.set(
    KNOWLEDGE_REGISTER_AGENT.id,
    new KnowledgeRegisterRuntimeExecutor({
      knowledge: emptyKnowledge,
      expected_agent: KNOWLEDGE_REGISTER_AGENT,
      expected_skill: KNOWLEDGE_REGISTER_SKILL,
    }),
  );
  executorMap.set(
    JOURNEY_GEN_AGENT.id,
    new GenerateJourneyRuntimeExecutor({
      expected_agent: JOURNEY_GEN_AGENT,
      expected_skill: JOURNEY_GEN_SKILL,
    }),
  );
  executorMap.set(
    COMPARE_UI_AGENT.id,
    new CompareUiSurfacesRuntimeExecutor({
      expected_agent: COMPARE_UI_AGENT,
      expected_skill: COMPARE_UI_SKILL,
    }),
  );
  executorMap.set(
    ROLE_COMPARE_AGENT.id,
    new RoleSurfaceCompareRuntimeExecutor({
      expected_agent: ROLE_COMPARE_AGENT,
      expected_skill: ROLE_COMPARE_SKILL,
      discoverAfterLogin: discoverAfterLoginSkill,
      credentials,
    }),
  );
  const executor: AgentRunExecutor = new CompositeAgentRunExecutor(executorMap);

  const runtime = new InMemoryAgentRuntime(clock, ids, authorizer, executor);

  const tools: AgentRuntimeToolDefinition[] = [
    {
      name: "assess_requirement_quality",
      description:
        "Assess a requirement's quality (traceability, acceptance criteria, ambiguity) via the QA Intelligence Requirement Review Agent. Development seed data only (REQ-DEMO-001).",
      inputSchema: {
        type: "object",
        properties: { requirement_ref: { type: "string", description: "e.g. REQ-DEMO-001@1.0.0" } },
        required: ["requirement_ref"],
      },
      agent: AGENT,
      purpose: "Review requirement quality via MCP (development)",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [SKILL],
      // No max_tokens: this Skill only calls a Reasoning Provider when
      // deterministic rules are indeterminate, and RequirementReviewRuntimeExecutor
      // does not report usage.tokens at all — the SPEC-508 §3.1 default
      // would otherwise fail every run as budget_exhausted on a
      // dimension this Skill never measures.
      budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
      buildInput: (args) => ({
        requirement_ref: (args["requirement_ref"] as string | undefined) ?? "REQ-DEMO-001@1.0.0",
      }),
    },
    {
      name: "execute_browser_test",
      description:
        "DEMO ONLY — executes a seeded Playwright plan (TC-DEMO-001 navigate+assert, TC-DEMO-002 login). For real targets use run_auto_qa or execute_generated_test_case. Target elements resolve by accessible name/role, never raw selectors (ADR-022 §4); credentials for TC-DEMO-002 resolve through a Workspace-scoped SecretResolver.",
      inputSchema: {
        type: "object",
        properties: {
          test_case_ref: { type: "string", description: "e.g. TC-DEMO-001@1.0.0 (read-only) or TC-DEMO-002@1.0.0 (login flow)" },
          environment_ref: { type: "string", description: "e.g. dev-fixture" },
        },
        required: [],
      },
      agent: BROWSER_TEST_AGENT,
      purpose: "Execute a governed browser test via MCP (development tracer bullet)",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [BROWSER_TEST_SKILL],
      allowed_tools: [{ id: "playwright-execution-engine", version: "0.1.0" }],
      budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
      buildInput: (args) => ({
        test_case_ref: (args["test_case_ref"] as string | undefined) ?? DEMO_TEST_CASE_REF,
        environment_ref: (args["environment_ref"] as string | undefined) ?? DEMO_ENVIRONMENT_REF,
      }),
    },
    {
      name: "discover_ui_surface",
      description:
        "Discover a live page's Semantic UI Map (SPEC-201 §8/SPEC-101 §12: Page/Field/Action) by navigating a URL and running it through the Semantic UI pipeline (DomCleaner). Prefer environment_ref after register_workspace_environment (SPEC-512 §12). Non-loopback http(s) URLs must match a registered base_url; data: and loopback remain allowed for fixtures. Optional browser: chromium (default) | firefox | webkit (Phase 9).",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "e.g. https://staging.example.com/login — must be allowlisted unless data:/loopback" },
          environment_ref: { type: "string", description: "e.g. environment:dev-fixture-login — resolves URL from Workspace registry" },
          browser: { type: "string", description: "chromium | firefox | webkit (default chromium)" },
        },
        required: [],
      },
      agent: UI_DISCOVERY_AGENT,
      purpose: "Discover a page's Semantic UI Map via MCP (development tracer bullet)",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [UI_DISCOVERY_SKILL],
      allowed_tools: [{ id: "playwright-dom-pipeline", version: "0.1.0" }],
      budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          url: (args["url"] as string | undefined) ?? "",
          environment_ref: (args["environment_ref"] as string | undefined) ?? "",
          browser: (args["browser"] as string | undefined) ?? "",
        }),
    },
    {
      name: "discover_ui_surface_after_login",
      description:
        "Discovers a Semantic UI Map for a screen reachable only after authenticating. Form path: login_url + username/password fields + submit + target_url. SSO path: login_url + sso_action_name (+ optional sso_wait_url_includes / mfa_wait_for_*) + target_url — clicks IdP button and waits for redirect; does not invent IdP credentials (test IdP or human-in-session). Field/action names must match discover_ui_surface on the login page. Optional HTTP Basic Auth via basic_auth_*.",
      inputSchema: {
        type: "object",
        properties: {
          login_url: { type: "string", description: "e.g. https://your-app.example/login" },
          username_field_name: { type: "string", description: "Form login: discovered field accessible_name, e.g. \"Username\"" },
          username: { type: "string" },
          password_field_name: { type: "string", description: "Form login: discovered field accessible_name, e.g. \"Password\"" },
          password: { type: "string", description: "Literal password — prefer password_secret_ref after register_workspace_secret." },
          password_secret_ref: { type: "string", description: "e.g. workspace-secret:demo-password (Phase 6)." },
          submit_action_name: { type: "string", description: "Form login: discovered action accessible_name, e.g. \"Sign in\"" },
          sso_action_name: { type: "string", description: "SSO bootstrap: accessible name of IdP button, e.g. \"Continue with Google\"." },
          sso_wait_url_includes: { type: "string", description: "After SSO click, wait until URL includes this (default: target pathname)." },
          mfa_wait_for_accessible_name: { type: "string", description: "Optional MFA/post-login gate accessible name before capture." },
          mfa_wait_for_accessible_role: { type: "string" },
          mfa_wait_timeout_ms: { type: "number" },
          target_url: { type: "string", description: "The screen to discover after login, e.g. https://your-app.example/dashboard" },
          basic_auth_username: { type: "string", description: "Optional. Supply with basic_auth_password or basic_auth_password_secret_ref when the site is also behind HTTP Basic Auth." },
          basic_auth_password: { type: "string" },
          basic_auth_password_secret_ref: { type: "string" },
        },
        required: ["login_url", "target_url"],
      },
      agent: DISCOVER_AFTER_LOGIN_AGENT,
      purpose: "Discover a session-gated screen's Semantic UI Map via MCP, logging in first",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [DISCOVER_AFTER_LOGIN_SKILL],
      allowed_tools: [{ id: "playwright-dom-pipeline", version: "0.1.0" }],
      budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          login_url: (args["login_url"] as string | undefined) ?? "",
          username_field_name: (args["username_field_name"] as string | undefined) ?? "",
          username: (args["username"] as string | undefined) ?? "",
          password_field_name: (args["password_field_name"] as string | undefined) ?? "",
          password: (args["password"] as string | undefined) ?? "",
          password_secret_ref: (args["password_secret_ref"] as string | undefined) ?? "",
          submit_action_name: (args["submit_action_name"] as string | undefined) ?? "",
          sso_action_name: (args["sso_action_name"] as string | undefined) ?? "",
          sso_wait_url_includes: (args["sso_wait_url_includes"] as string | undefined) ?? "",
          mfa_wait_for_accessible_name: (args["mfa_wait_for_accessible_name"] as string | undefined) ?? "",
          mfa_wait_for_accessible_role: (args["mfa_wait_for_accessible_role"] as string | undefined) ?? "",
          mfa_wait_timeout_ms: (args["mfa_wait_timeout_ms"] as number | undefined) ?? 0,
          target_url: (args["target_url"] as string | undefined) ?? "",
          basic_auth_username: (args["basic_auth_username"] as string | undefined) ?? "",
          basic_auth_password: (args["basic_auth_password"] as string | undefined) ?? "",
          basic_auth_password_secret_ref: (args["basic_auth_password_secret_ref"] as string | undefined) ?? "",
        }),
    },
    {
      name: "generate_test_cases",
      description:
        "Generate governed TestCases (SPEC-207 §2/§6) against a live page's discovered Semantic UI Map — composes Discovery then Test Design in one call. Per bindable, expected_text-bearing acceptance criterion, generates up to 4 variants per editable field: positive, negative (wrong value, success text must be absent), boundary (oversized input, no leaked system error), adversarial (benign XSS/SQLi probe, checked for both unescaped reflection and actual execution via dialog detection). A criterion that cannot be bound to any discovered field/action is reported as a finding, never fabricated into a test case. Two input modes: (1) pass acceptance_criteria inline — works against ANY real url, no seed data needed, e.g. {\"url\": \"https://your-real-app.example/login\", \"acceptance_criteria\": [{\"id\": \"AC-1\", \"statement\": \"...mentions a discovered field or action's name...\", \"expected_text\": \"text expected after a successful action\"}]}; (2) omit acceptance_criteria to fall back to development seed data (REQ-DEMO-002).",
      inputSchema: {
        type: "object",
        properties: {
          requirement_ref: { type: "string", description: "e.g. REQ-DEMO-002@1.0.0, or any label when acceptance_criteria is supplied inline" },
          requirement_title: { type: "string", description: "Used only with inline acceptance_criteria." },
          url: { type: "string", description: "Any real, reachable URL, e.g. https://example.com/login" },
          acceptance_criteria: {
            type: "array",
            description:
              "Inline ad hoc criteria (advisory consequence class — bypasses the seeded Requirement Resolver entirely). Each item needs id, statement, and at least one executable oracle: expected_text and/or expected_url_includes / expected_title_includes / expected_network (copied onto the positive generated_assertion).",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                statement: { type: "string" },
                expected_text: { type: "string" },
                expected_url_includes: { type: "string" },
                expected_title_includes: { type: "string" },
                option_label: { type: "string", description: "Required when AC binds a selectable field — never invented." },
                wait_for_accessible_name: { type: "string" },
                wait_for_accessible_role: { type: "string" },
                wait_for_timeout_ms: { type: "number" },
                expected_network: {
                  type: "object",
                  description: "UI→API coupling for the positive case (xhr/fetch).",
                  properties: {
                    url_includes: { type: "string" },
                    method: { type: "string" },
                    status: {},
                    body_includes: { type: "string" },
                  },
                },
              },
            },
          },
        },
        required: [],
      },
      agent: TEST_CASE_GENERATION_AGENT,
      purpose: "Generate test cases via MCP (development tracer bullet)",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [TEST_CASE_GENERATION_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
      buildInput: (args) => ({
        requirement_ref: (args["requirement_ref"] as string | undefined) ?? DEMO_LOGIN_REQUIREMENT_REF,
        requirement_title: (args["requirement_title"] as string | undefined) ?? "",
        url: (args["url"] as string | undefined) ?? demoLoginPageUrl,
        acceptance_criteria: (args["acceptance_criteria"] as JsonValue | undefined) ?? [],
      }),
    },
    {
      name: "execute_generated_test_case",
      description:
        "Closes the generate->execute loop: takes the exact test_case and generated_assertion objects a prior generate_test_cases call returned and runs them via ExecuteBrowserTest (flake-aware). Prefer field_secret_refs (Phase 6) over putting passwords in field_values. Assertion may include expected_network (xhr/fetch url_includes + optional method/status/body_includes) to couple UI submit→API in the same run.",
      inputSchema: {
        type: "object",
        properties: {
          test_case: { type: "object", description: "The exact test_case object from a generate_test_cases response's test_cases array." },
          generated_assertion: { type: "object", description: "The matching entry from that same response's generated_assertions array (same test_case_id)." },
          field_values: {
            type: "object",
            description: "Literal values keyed by field accessible_name. Prefer field_secret_refs for secrets.",
          },
          field_secret_refs: {
            type: "object",
            description: "Map field accessible_name → workspace-secret:… ref registered via register_workspace_secret.",
          },
        },
        required: ["test_case", "generated_assertion"],
      },
      agent: EXECUTE_GENERATED_AGENT,
      purpose: "Execute a freshly generated test case via MCP, against any real target",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [EXECUTE_GENERATED_SKILL],
      allowed_tools: [{ id: "playwright-execution-engine", version: "0.1.0" }],
      budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
      buildInput: (args) => ({
        test_case: (args["test_case"] as JsonValue | undefined) ?? {},
        generated_assertion: (args["generated_assertion"] as JsonValue | undefined) ?? {},
        field_values: (args["field_values"] as JsonValue | undefined) ?? {},
        field_secret_refs: (args["field_secret_refs"] as JsonValue | undefined) ?? {},
      }),
    },
    {
      name: "run_auto_qa",
      description:
        "One call that runs the whole pipeline: discovers a page's Semantic UI Map, runs accessibility naming smoke on that capture, generates TestCases (positive/negative/boundary/adversarial per bindable criterion with executable oracles — SPEC-207 §4/§6), executes every generated case for real via PlaywrightExecutionEngine (with flake detection), drafts SPEC-211 Defect records from failed/flaky outcomes (suspected_cause only), builds variant coverage + residual-risk notes, and returns a QA run report with a Senior-QA release_recommendation — both as JSON and, when output_path is given, written to that path as a self-contained HTML file. Replaces manually chaining discover_ui_surface -> generate_test_cases -> execute_generated_test_case yourself. Supply login_url + username_field_name + username + password_field_name + password + submit_action_name together to test a screen reachable only after signing in (all six or none — a partial set is rejected); omit all six to discover url directly. When the site also sits behind HTTP Basic Auth (a browser-native credential prompt distinct from the in-page login form), also supply basic_auth_username + basic_auth_password together. acceptance_criteria is required (this tool never invents what a page should do) — each item needs id, statement, and at least one oracle (expected_text and/or expected_url_includes / expected_title_includes / expected_network); statement should mention a field/action name the target page is expected to have.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The page to test — the post-login target screen when login fields are supplied, otherwise navigated to directly." },
          requirement_ref: { type: "string", description: "Optional label for the report; defaults to a value derived from url." },
          requirement_title: { type: "string", description: "Optional label for the report; defaults to url." },
          acceptance_criteria: {
            type: "array",
            description:
              "Required. Each item needs id, statement, and at least one executable oracle: expected_text and/or expected_url_includes / expected_title_includes / expected_network (copied onto the positive generated_assertion).",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                statement: { type: "string" },
                expected_text: { type: "string" },
                expected_url_includes: { type: "string" },
                expected_title_includes: { type: "string" },
                option_label: { type: "string", description: "Required when AC binds a selectable field — never invented." },
                wait_for_accessible_name: { type: "string" },
                wait_for_accessible_role: { type: "string" },
                wait_for_timeout_ms: { type: "number" },
                expected_network: {
                  type: "object",
                  description: "UI→API coupling for the positive case (xhr/fetch).",
                  properties: {
                    url_includes: { type: "string" },
                    method: { type: "string" },
                    status: {},
                    body_includes: { type: "string" },
                  },
                },
              },
            },
          },
          login_url: { type: "string", description: "Supply with the other five login_* fields to test a session-gated screen." },
          username_field_name: { type: "string", description: "Discovered field accessible_name on the login page, e.g. \"Username\"." },
          username: { type: "string" },
          password_field_name: { type: "string", description: "Discovered field accessible_name on the login page, e.g. \"Password\"." },
          password: { type: "string", description: "Literal — prefer password_secret_ref (Phase 6)." },
          password_secret_ref: { type: "string", description: "e.g. workspace-secret:demo-password" },
          submit_action_name: { type: "string", description: "Discovered action accessible_name on the login page, e.g. \"Sign in\"." },
          basic_auth_username: { type: "string" },
          basic_auth_password: { type: "string" },
          basic_auth_password_secret_ref: { type: "string" },
          output_path: { type: "string", description: "When given, the self-contained HTML report is also written to this local file path (parent directories are created as needed). Must resolve inside the server's configured output directory — a path that escapes it (e.g. via ../) is rejected." },
          browser: { type: "string", description: "Phase 9: chromium (default) | firefox | webkit for discovery + execution." },
        },
        required: ["url", "acceptance_criteria"],
      },
      agent: AUTO_QA_AGENT,
      purpose: "Discover, generate, execute, and report on a target screen in one call",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [AUTO_QA_SKILL],
      allowed_tools: [{ id: "playwright-dom-pipeline", version: "0.1.0" }, { id: "playwright-execution-engine", version: "0.1.0" }],
      budgets: { max_steps: 20, max_duration_seconds: 300, max_tool_calls: 30, max_retries: 1 },
      buildInput: (args) => ({
        url: (args["url"] as string | undefined) ?? "",
        requirement_ref: (args["requirement_ref"] as string | undefined) ?? "",
        requirement_title: (args["requirement_title"] as string | undefined) ?? "",
        acceptance_criteria: (args["acceptance_criteria"] as JsonValue | undefined) ?? [],
        login_url: (args["login_url"] as string | undefined) ?? "",
        username_field_name: (args["username_field_name"] as string | undefined) ?? "",
        username: (args["username"] as string | undefined) ?? "",
        password_field_name: (args["password_field_name"] as string | undefined) ?? "",
        password: (args["password"] as string | undefined) ?? "",
        password_secret_ref: (args["password_secret_ref"] as string | undefined) ?? "",
        submit_action_name: (args["submit_action_name"] as string | undefined) ?? "",
        basic_auth_username: (args["basic_auth_username"] as string | undefined) ?? "",
        basic_auth_password: (args["basic_auth_password"] as string | undefined) ?? "",
        basic_auth_password_secret_ref: (args["basic_auth_password_secret_ref"] as string | undefined) ?? "",
        output_path: (args["output_path"] as string | undefined) ?? "",
        browser: (args["browser"] as string | undefined) ?? "",
      }),
    },
    {
      name: "assess_ui_accessibility_smoke",
      description:
        "Accessibility naming smoke over a live URL (or a prior Semantic UI Map). Flags missing/duplicate accessible names on fields/actions and unlabeled editable fields. Not a full WCAG/axe audit — use for first-pass Senior QA triage before deeper a11y work. Supply url OR ui_map_elements (from discover_ui_surface).",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Live page to discover + smoke. Omit when ui_map_elements is supplied." },
          ui_map_elements: {
            type: "array",
            description: "Optional prior discovery elements — skips a fresh browser navigate when provided.",
            items: { type: "object" },
          },
          source_url: { type: "string", description: "Provenance URL when ui_map_elements is supplied without url." },
        },
        required: [],
      },
      agent: A11Y_SMOKE_AGENT,
      purpose: "Run accessibility naming smoke on a discovered UI surface",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [A11Y_SMOKE_SKILL],
      allowed_tools: [{ id: "playwright-dom-pipeline", version: "0.1.0" }],
      budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
      buildInput: (args) => ({
        url: (args["url"] as string | undefined) ?? "",
        ui_map_elements: (args["ui_map_elements"] as JsonValue | undefined) ?? [],
        source_url: (args["source_url"] as string | undefined) ?? "",
      }),
    },
    {
      name: "generate_exploratory_charter",
      description:
        "Build a time-boxed exploratory testing charter (SPEC-206) from a live URL or prior Semantic UI Map: focus areas, oracles, risks to probe, and explicit out-of-scope. Does not execute exploration — returns a charter a human/host can follow. Supply url OR ui_map_elements.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          ui_map_elements: { type: "array", items: { type: "object" } },
          source_url: { type: "string" },
          objective: { type: "string", description: "Optional tester objective; never invented when omitted beyond a generic explore prompt." },
          requirement_ref: { type: "string", description: "Optional — marks scripted AC coverage as out-of-scope for free exploration." },
        },
        required: [],
      },
      agent: EXPLORATORY_AGENT,
      purpose: "Generate an exploratory testing charter from a discovered surface",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [EXPLORATORY_SKILL],
      allowed_tools: [{ id: "playwright-dom-pipeline", version: "0.1.0" }],
      budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
      buildInput: (args) => ({
        url: (args["url"] as string | undefined) ?? "",
        ui_map_elements: (args["ui_map_elements"] as JsonValue | undefined) ?? [],
        source_url: (args["source_url"] as string | undefined) ?? "",
        objective: (args["objective"] as string | undefined) ?? "",
        requirement_ref: (args["requirement_ref"] as string | undefined) ?? "",
      }),
    },
    {
      name: "execute_exploratory_session",
      description:
        "Phase 9: run an exploratory *session* (not free-form explore). Discovers the live URL per browser, auto-checks oracles grounded in the Semantic UI Map (leakage, unlabeled controls), optionally runs bounded live probes (empty-submit / click ≤2 named actions + re-capture; set include_live_probes=false to skip), records focus/risk as manual_follow_up, and can compare chromium vs firefox/webkit. Does not invent business expected results.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          charter: { type: "object", description: "Optional prior charter from generate_exploratory_charter." },
          objective: { type: "string" },
          requirement_ref: { type: "string" },
          browsers: {
            type: "array",
            description: "e.g. [\"chromium\",\"firefox\"] — default [chromium].",
            items: { type: "string" },
          },
          browser: { type: "string", description: "Single-browser shorthand." },
          include_live_probes: {
            type: "boolean",
            description: "Default true. Bounded empty-submit/click probes after capture (not free exploration).",
          },
        },
        required: [],
      },
      agent: EXPLORATORY_SESSION_AGENT,
      purpose: "Execute exploratory session with multi-browser captures",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [EXPLORATORY_SESSION_SKILL],
      allowed_tools: [{ id: "playwright-dom-pipeline", version: "0.1.0" }],
      budgets: { max_steps: 16, max_duration_seconds: 240, max_tool_calls: 20, max_retries: 1 },
      buildInput: (args) => ({
        url: (args["url"] as string | undefined) ?? "",
        charter: (args["charter"] as JsonValue | undefined) ?? {},
        objective: (args["objective"] as string | undefined) ?? "",
        requirement_ref: (args["requirement_ref"] as string | undefined) ?? "",
        browsers: (args["browsers"] as JsonValue | undefined) ?? [],
        browser: (args["browser"] as string | undefined) ?? "",
        include_live_probes: args["include_live_probes"] === undefined ? true : Boolean(args["include_live_probes"]),
      }),
    },
    {
      name: "assess_defect_quality",
      description:
        "Assess a Defect document against SPEC-211 (completeness, cause integrity, closure governance). Pass a draft from run_auto_qa.draft_defects (or a hand-authored defect). Never confirms root cause — only reviews contract quality. Requires defect:read permission.",
      inputSchema: {
        type: "object",
        properties: {
          defect: { type: "object", description: "Full Defect Contract object (id/version/status/summary/observed/expected/authority/evidence/...)." },
        },
        required: ["defect"],
      },
      agent: DEFECT_QUALITY_AGENT,
      purpose: "Assess defect report quality via MCP",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [DEFECT_QUALITY_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 60, max_tool_calls: 5, max_retries: 1 },
      buildInput: (args) => ({
        defect: (args["defect"] as JsonValue | undefined) ?? {},
      }),
    },
    {
      name: "register_workspace_secret",
      description:
        "Phase 6: register a Workspace-scoped secret (workspace-secret:<name>). Values persist under .qa-credentials/ (local disk, mode 0o600 when OS allows — not Vault/KMS). List returns metadata only — never the value. Prefer password_secret_ref / field_secret_refs afterward so plaintext stays off the MCP wire.",
      inputSchema: {
        type: "object",
        properties: {
          secret_ref: { type: "string", description: "e.g. workspace-secret:staging-password" },
          value: { type: "string", description: "Secret value — stored in .qa-credentials/ for this Workspace (dev registry, not Vault)." },
          kind: { type: "string", description: "password | api_token | basic_auth_password | other" },
          label: { type: "string" },
        },
        required: ["secret_ref", "value"],
      },
      agent: CREDENTIAL_REGISTER_AGENT,
      purpose: "Register a Workspace secret for approved injection",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [CREDENTIAL_REGISTER_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: (args) => ({
        secret_ref: (args["secret_ref"] as string | undefined) ?? "",
        value: (args["value"] as string | undefined) ?? "",
        kind: (args["kind"] as string | undefined) ?? "",
        label: (args["label"] as string | undefined) ?? "",
      }),
    },
    {
      name: "list_workspace_secrets",
      description:
        "List registered Workspace secret refs/metadata only — never returns secret values.",
      inputSchema: { type: "object", properties: {}, required: [] },
      agent: CREDENTIAL_LIST_AGENT,
      purpose: "List Workspace secret refs without values",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [CREDENTIAL_LIST_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: () => ({}),
    },
    {
      name: "assess_business_analysis_quality",
      description:
        "Phase 7 / SPEC-204: assess a Workflow (business analysis) document for completeness and governance. Pass the full Workflow object — never invents actors/activities/transitions.",
      inputSchema: {
        type: "object",
        properties: { workflow: { type: "object", description: "Full Workflow contract object." } },
        required: ["workflow"],
      },
      agent: BA_QUALITY_AGENT,
      purpose: "Assess business-analysis Workflow quality via MCP",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [BA_QUALITY_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 60, max_tool_calls: 5, max_retries: 1 },
      buildInput: (args) => ({ workflow: (args["workflow"] as JsonValue | undefined) ?? {} }),
    },
    {
      name: "assess_risk_quality",
      description:
        "Phase 7 / SPEC-205: assess a Risk document for completeness and critical-category governance. Pass the full Risk object.",
      inputSchema: {
        type: "object",
        properties: { risk: { type: "object", description: "Full Risk contract object." } },
        required: ["risk"],
      },
      agent: RISK_QUALITY_AGENT,
      purpose: "Assess risk quality via MCP",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [RISK_QUALITY_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 60, max_tool_calls: 5, max_retries: 1 },
      buildInput: (args) => ({ risk: (args["risk"] as JsonValue | undefined) ?? {} }),
    },
    {
      name: "assess_test_strategy_quality",
      description:
        "Phase 7 / SPEC-206: assess a Test Strategy document for completeness, risk coverage, and governance.",
      inputSchema: {
        type: "object",
        properties: { test_strategy: { type: "object" } },
        required: ["test_strategy"],
      },
      agent: STRATEGY_QUALITY_AGENT,
      purpose: "Assess test strategy quality via MCP",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [STRATEGY_QUALITY_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 60, max_tool_calls: 5, max_retries: 1 },
      buildInput: (args) => ({ test_strategy: (args["test_strategy"] as JsonValue | undefined) ?? {} }),
    },
    {
      name: "assess_test_case_quality",
      description:
        "Phase 7 / SPEC-207: assess a Test Case document for step/expected-result completeness and traceability.",
      inputSchema: {
        type: "object",
        properties: { test_case: { type: "object" } },
        required: ["test_case"],
      },
      agent: TEST_CASE_QUALITY_AGENT,
      purpose: "Assess test case quality via MCP",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [TEST_CASE_QUALITY_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 60, max_tool_calls: 5, max_retries: 1 },
      buildInput: (args) => ({ test_case: (args["test_case"] as JsonValue | undefined) ?? {} }),
    },
    {
      name: "assess_test_dataset_quality",
      description:
        "Phase 7 / SPEC-208: assess a Test Dataset document for completeness and data-governance findings.",
      inputSchema: {
        type: "object",
        properties: { test_dataset: { type: "object" } },
        required: ["test_dataset"],
      },
      agent: DATASET_QUALITY_AGENT,
      purpose: "Assess test dataset quality via MCP",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [DATASET_QUALITY_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 60, max_tool_calls: 5, max_retries: 1 },
      buildInput: (args) => ({ test_dataset: (args["test_dataset"] as JsonValue | undefined) ?? {} }),
    },
    {
      name: "assess_automation_asset_quality",
      description:
        "Phase 7 / SPEC-209: assess an Automation Asset document for completeness and lifecycle governance.",
      inputSchema: {
        type: "object",
        properties: { automation_asset: { type: "object" } },
        required: ["automation_asset"],
      },
      agent: AUTOMATION_QUALITY_AGENT,
      purpose: "Assess automation asset quality via MCP",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [AUTOMATION_QUALITY_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 60, max_tool_calls: 5, max_retries: 1 },
      buildInput: (args) => ({ automation_asset: (args["automation_asset"] as JsonValue | undefined) ?? {} }),
    },
    {
      name: "assess_report_quality",
      description:
        "Phase 7 / SPEC-212: assess a recurring Report document for completeness, aggregation integrity, and metric governance.",
      inputSchema: {
        type: "object",
        properties: { report: { type: "object" } },
        required: ["report"],
      },
      agent: REPORT_QUALITY_AGENT,
      purpose: "Assess report quality via MCP",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [REPORT_QUALITY_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 60, max_tool_calls: 5, max_retries: 1 },
      buildInput: (args) => ({ report: (args["report"] as JsonValue | undefined) ?? {} }),
    },
    {
      name: "execute_api_smoke",
      description:
        "Phase 8: HTTP API smoke/contract checks against a base_url. Each case asserts status and/or body/header substrings. Cases may set auth=none|alternate_bearer|default. Prefer bearer_token_secret_ref / alternate_bearer_token_secret_ref / basic_auth_password_secret_ref after register_workspace_secret. Infrastructure faults never become product failed. Does not invent OpenAPI or run load tests.",
      inputSchema: {
        type: "object",
        properties: {
          base_url: { type: "string", description: "e.g. https://api.staging.example.com" },
          cases: {
            type: "array",
            description: "Array of { id?, method, path, headers?, body?, auth?, expect:{status?,body_includes?,header?}, requirement_ref? }",
            items: { type: "object" },
          },
          bearer_token: { type: "string" },
          bearer_token_secret_ref: { type: "string" },
          alternate_bearer_token: { type: "string", description: "Wrong-role bearer for cases with auth=alternate_bearer." },
          alternate_bearer_token_secret_ref: { type: "string" },
          basic_auth_username: { type: "string" },
          basic_auth_password: { type: "string" },
          basic_auth_password_secret_ref: { type: "string" },
          timeout_ms: { type: "number", description: "Per-request timeout (default 15000)." },
        },
        required: ["base_url", "cases"],
      },
      agent: API_SMOKE_AGENT,
      purpose: "Execute HTTP API smoke cases with SPEC-210 outcomes",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [API_SMOKE_SKILL],
      budgets: { max_steps: 32, max_duration_seconds: 180, max_tool_calls: 40, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          base_url: (args["base_url"] as string | undefined) ?? "",
          cases: (args["cases"] as JsonValue | undefined) ?? [],
          bearer_token: (args["bearer_token"] as string | undefined) ?? "",
          bearer_token_secret_ref: (args["bearer_token_secret_ref"] as string | undefined) ?? "",
          alternate_bearer_token: (args["alternate_bearer_token"] as string | undefined) ?? "",
          alternate_bearer_token_secret_ref: (args["alternate_bearer_token_secret_ref"] as string | undefined) ?? "",
          basic_auth_username: (args["basic_auth_username"] as string | undefined) ?? "",
          basic_auth_password: (args["basic_auth_password"] as string | undefined) ?? "",
          basic_auth_password_secret_ref: (args["basic_auth_password_secret_ref"] as string | undefined) ?? "",
          timeout_ms: (args["timeout_ms"] as number | undefined) ?? 0,
        }),
    },
    {
      name: "run_depth_smokes",
      description:
        "Phase 10: depth portfolio smokes on a live URL — a11y WCAG-subset heuristics (lang/title/img alt), optional axe-core (`stages` includes \"axe\"), navigation perf vs threshold, and light security heuristics. has_critical is explicit — never hide critical behind green counts. Default stages omit axe; axe is still not a full WCAG certification claim. stages subset: a11y_subset | axe | perf | security. browser defaults to chromium.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          stages: {
            type: "array",
            items: { type: "string" },
            description: "Subset of a11y_subset | axe | perf | security",
          },
          browser: { type: "string" },
          perf_threshold_ms: { type: "number", description: "Default 3000." },
        },
        required: ["url"],
      },
      agent: DEPTH_SMOKES_AGENT,
      purpose: "Run a11y/perf/security depth smokes",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [DEPTH_SMOKES_SKILL],
      allowed_tools: [{ id: "playwright-dom-pipeline", version: "0.1.0" }],
      budgets: { max_steps: 12, max_duration_seconds: 180, max_tool_calls: 10, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          url: (args["url"] as string | undefined) ?? "",
          stages: (args["stages"] as JsonValue | undefined) ?? [],
          browser: (args["browser"] as string | undefined) ?? "",
          perf_threshold_ms: (args["perf_threshold_ms"] as number | undefined) ?? 0,
        }),
    },
    ...(sessionMemory !== undefined
      ? [
          {
            name: "list_failure_avoidance_hints",
            description:
              "Phase 11: list Session Memory failure-avoidance hints retained after prior run_auto_qa draft defects in this Workspace/process (keys avoid:*). Advisory only — never confirmed root cause. Empty when no prior drafts were retained.",
            inputSchema: { type: "object", properties: {}, required: [] },
            agent: FAILURE_AVOIDANCE_AGENT,
            purpose: "List prior failure-avoidance hints from Session Memory",
            consequence_class: "advisory" as const,
            policy_version: policyVersion,
            allowed_skills: [FAILURE_AVOIDANCE_SKILL],
            budgets: { max_steps: 2, max_duration_seconds: 15, max_tool_calls: 1, max_retries: 0 },
            buildInput: () => ({}),
          } satisfies AgentRuntimeToolDefinition,
        ]
      : []),
    {
      name: "discover_product_context",
      description:
        "SPEC-201 knowledge-store discovery: search governed Knowledge scopes for product context against an objective. Does not invent UI maps — Knowledge Search only. Default scopes: requirements, architecture, risk.",
      inputSchema: {
        type: "object",
        properties: {
          objective: { type: "string" },
          knowledge_scopes: { type: "array", items: { type: "string" } },
          capability_id: { type: "string" },
          knowledge_snapshot: { type: "string" },
        },
        required: ["objective"],
      },
      agent: PRODUCT_CONTEXT_AGENT,
      purpose: "Discover product context from Knowledge Store",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [PRODUCT_CONTEXT_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 60, max_tool_calls: 10, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          objective: (args["objective"] as string | undefined) ?? "",
          knowledge_scopes: (args["knowledge_scopes"] as JsonValue | undefined) ?? [],
          capability_id: (args["capability_id"] as string | undefined) ?? "",
          knowledge_snapshot: (args["knowledge_snapshot"] as string | undefined) ?? "",
        }),
    },
    {
      name: "assess_execution_record_quality",
      description:
        "SPEC-210: assess an ExecutionRecord document for completeness, outcome integrity, and isolation governance.",
      inputSchema: {
        type: "object",
        properties: { execution_record: { type: "object" } },
        required: ["execution_record"],
      },
      agent: EXECUTION_RECORD_QUALITY_AGENT,
      purpose: "Assess execution record quality via MCP",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [EXECUTION_RECORD_QUALITY_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 60, max_tool_calls: 5, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          execution_record: (args["execution_record"] as JsonValue | undefined) ?? {},
        }),
    },
    {
      name: "draft_defects_from_qa_run",
      description:
        "SPEC-211 draft path (standalone): turn failed/flaky QA run test_cases into Defect drafts (suspected_cause only). Same logic embedded in run_auto_qa — use to re-triage without re-running browsers.",
      inputSchema: {
        type: "object",
        properties: {
          requirement_ref: { type: "string" },
          target_url: { type: "string" },
          environment_ref: { type: "string" },
          test_cases: { type: "array", items: { type: "object" } },
        },
        required: ["requirement_ref", "target_url", "test_cases"],
      },
      agent: DRAFT_DEFECTS_AGENT,
      purpose: "Draft SPEC-211 defects from QA run outcomes",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [DRAFT_DEFECTS_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 1, max_retries: 0 },
      buildInput: (args) =>
        compactMcpInput({
          requirement_ref: (args["requirement_ref"] as string | undefined) ?? "",
          target_url: (args["target_url"] as string | undefined) ?? "",
          environment_ref: (args["environment_ref"] as string | undefined) ?? "",
          test_cases: (args["test_cases"] as JsonValue | undefined) ?? [],
        }),
    },
    {
      name: "register_workspace_environment",
      description:
        "SPEC-512 §12: register an approved target environment (environment:… + base_url). Non-loopback http(s) discovery/execution should use allowlisted URLs.",
      inputSchema: {
        type: "object",
        properties: {
          environment_ref: { type: "string", description: "e.g. environment:staging" },
          base_url: { type: "string" },
          label: { type: "string" },
        },
        required: ["environment_ref", "base_url"],
      },
      agent: ENVIRONMENT_REGISTER_AGENT,
      purpose: "Register Workspace target environment",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [ENVIRONMENT_REGISTER_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          environment_ref: (args["environment_ref"] as string | undefined) ?? "",
          base_url: (args["base_url"] as string | undefined) ?? "",
          label: (args["label"] as string | undefined) ?? "",
        }),
    },
    {
      name: "list_workspace_environments",
      description: "List registered Workspace target environments (refs + base_url metadata).",
      inputSchema: { type: "object", properties: {}, required: [] },
      agent: ENVIRONMENT_LIST_AGENT,
      purpose: "List Workspace environments",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [ENVIRONMENT_LIST_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: () => ({}),
    },
    {
      name: "generate_business_analysis_stub",
      description:
        "SPEC-204 generate path: draft a Workflow stub from url or ui_map_elements. For assess_business_analysis_quality — never invents accepted BA.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          ui_map_elements: { type: "array", items: { type: "object" } },
          source_url: { type: "string" },
          requirement_ref: { type: "string" },
        },
        required: [],
      },
      agent: WORKFLOW_STUB_AGENT,
      purpose: "Generate Workflow stub from Semantic UI Map",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [WORKFLOW_STUB_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 5, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          url: (args["url"] as string | undefined) ?? "",
          ui_map_elements: (args["ui_map_elements"] as JsonValue | undefined) ?? [],
          source_url: (args["source_url"] as string | undefined) ?? "",
          requirement_ref: (args["requirement_ref"] as string | undefined) ?? "",
        }),
    },
    {
      name: "generate_risk_stub",
      description:
        "SPEC-205 generate path: draft Risk stubs from url or ui_map_elements. Pass outputs to assess_risk_quality.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          ui_map_elements: { type: "array", items: { type: "object" } },
          source_url: { type: "string" },
          requirement_ref: { type: "string" },
        },
        required: [],
      },
      agent: RISK_STUB_AGENT,
      purpose: "Generate Risk stubs from Semantic UI Map",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [RISK_STUB_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 5, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          url: (args["url"] as string | undefined) ?? "",
          ui_map_elements: (args["ui_map_elements"] as JsonValue | undefined) ?? [],
          source_url: (args["source_url"] as string | undefined) ?? "",
          requirement_ref: (args["requirement_ref"] as string | undefined) ?? "",
        }),
    },
    {
      name: "generate_test_strategy_stub",
      description:
        "STUB only (SPEC-206 generate path): draft a thin Test Strategy document from url or ui_map_elements. Heuristic UI-map template — not a professional strategy. Prefer assess_test_strategy_quality on a real strategy when one exists.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          ui_map_elements: { type: "array", items: { type: "object" } },
          source_url: { type: "string" },
          objective: { type: "string" },
          requirement_ref: { type: "string" },
        },
        required: [],
      },
      agent: STRATEGY_STUB_AGENT,
      purpose: "Generate Test Strategy stub from Semantic UI Map",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [STRATEGY_STUB_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 5, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          url: (args["url"] as string | undefined) ?? "",
          ui_map_elements: (args["ui_map_elements"] as JsonValue | undefined) ?? [],
          source_url: (args["source_url"] as string | undefined) ?? "",
          objective: (args["objective"] as string | undefined) ?? "",
          requirement_ref: (args["requirement_ref"] as string | undefined) ?? "",
        }),
    },
    {
      name: "register_test_dataset",
      description:
        "SPEC-208: register TestDataset under .qa-test-datasets/. Optional field_samples (accessible_name→value) only when classification=synthetic; rejects credential-shaped keys/values. Secrets stay in register_workspace_secret.",
      inputSchema: {
        type: "object",
        properties: {
          purpose: { type: "string" },
          classification: { type: "string" },
          traced_test_refs: { type: "array", items: { type: "string" } },
          owner: { type: "string" },
          id: { type: "string" },
          environment_scope: { type: "string" },
          field_samples: {
            type: "object",
            description: "Synthetic fills only — e.g. {\"Username\":\"demo-user\",\"Email\":\"qa@example.test\"}.",
          },
        },
        required: ["purpose"],
      },
      agent: DATASET_REGISTER_AGENT,
      purpose: "Register TestDataset metadata",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [DATASET_REGISTER_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          purpose: (args["purpose"] as string | undefined) ?? "",
          classification: (args["classification"] as string | undefined) ?? "",
          traced_test_refs: (args["traced_test_refs"] as JsonValue | undefined) ?? [],
          owner: (args["owner"] as string | undefined) ?? "",
          id: (args["id"] as string | undefined) ?? "",
          environment_scope: (args["environment_scope"] as string | undefined) ?? "",
          field_samples: (args["field_samples"] as JsonValue | undefined) ?? {},
        }),
    },
    {
      name: "list_test_datasets",
      description: "List registered TestDataset metadata for the Workspace (field_sample_keys only — not values).",
      inputSchema: { type: "object", properties: {}, required: [] },
      agent: DATASET_LIST_AGENT,
      purpose: "List TestDatasets",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [DATASET_LIST_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: () => ({}),
    },
    {
      name: "resolve_test_dataset_fields",
      description:
        "Return synthetic field_values map for a dataset_id — pass into execute_generated_test_case / run_regression_suite. Empty if dataset has no samples.",
      inputSchema: {
        type: "object",
        properties: { dataset_id: { type: "string" } },
        required: ["dataset_id"],
      },
      agent: DATASET_RESOLVE_AGENT,
      purpose: "Resolve TestDataset field samples",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [DATASET_RESOLVE_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          dataset_id: (args["dataset_id"] as string | undefined) ?? "",
        }),
    },
    {
      name: "create_automation_asset",
      description:
        "SPEC-209 create path: draft an AutomationAsset from implemented_test_case_refs, persist under .qa-automation-assets/, default execution_interface mcp:run_regression_suite (optional regression_suite_id bind).",
      inputSchema: {
        type: "object",
        properties: {
          implemented_test_case_refs: { type: "array", items: { type: "string" } },
          owner: { type: "string" },
          environment_constraints: { type: "array", items: { type: "string" } },
          execution_interface: { type: "string" },
          id: { type: "string" },
          regression_suite_id: {
            type: "string",
            description: "Optional suite_id from register_regression_suite to record on the asset.",
          },
        },
        required: ["implemented_test_case_refs"],
      },
      agent: AUTOMATION_STUB_AGENT,
      purpose: "Create AutomationAsset stub",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [AUTOMATION_STUB_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          implemented_test_case_refs: (args["implemented_test_case_refs"] as JsonValue | undefined) ?? [],
          owner: (args["owner"] as string | undefined) ?? "",
          environment_constraints: (args["environment_constraints"] as JsonValue | undefined) ?? [],
          execution_interface: (args["execution_interface"] as string | undefined) ?? "",
          id: (args["id"] as string | undefined) ?? "",
          regression_suite_id: (args["regression_suite_id"] as string | undefined) ?? "",
        }),
    },
    {
      name: "evaluate_test_case_quality_skill",
      description:
        "SPEC-213 dogfood: run EvaluationManager over Assess Test Case Quality using real review() trials. Pass cases[{case_id,expect_pass,test_case}].",
      inputSchema: {
        type: "object",
        properties: {
          cases: { type: "array", items: { type: "object" } },
          run_id: { type: "string" },
          suite_id: { type: "string" },
          critical_invariant_ids: { type: "array", items: { type: "string" } },
        },
        required: ["cases"],
      },
      agent: SKILL_QUALITY_EVAL_AGENT,
      purpose: "Dogfood evaluate AssessTestCaseQuality Skill",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [SKILL_QUALITY_EVAL_SKILL],
      budgets: { max_steps: 32, max_duration_seconds: 180, max_tool_calls: 32, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          cases: (args["cases"] as JsonValue | undefined) ?? [],
          run_id: (args["run_id"] as string | undefined) ?? "",
          suite_id: (args["suite_id"] as string | undefined) ?? "",
          critical_invariant_ids: (args["critical_invariant_ids"] as JsonValue | undefined) ?? [],
        }),
    },
    {
      name: "raise_mistake_recurrence_candidate",
      description:
        "SPEC-105 §9a: create a Knowledge Candidate from a recurring mistake assessment. Never promotes. Rejects non-recurring assessments.",
      inputSchema: {
        type: "object",
        properties: {
          occurrence: { type: "object" },
          assessment: { type: "object" },
          causal_mistake: { type: "string" },
          prior_avoidance_fact_refs: { type: "array", items: { type: "string" } },
          owner: { type: "string" },
          expires_at: { type: "string" },
          idempotency_key: { type: "string" },
        },
        required: ["occurrence", "assessment"],
      },
      agent: MISTAKE_RECURRENCE_AGENT,
      purpose: "Raise mistake-recurrence Learning Engine candidate",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [MISTAKE_RECURRENCE_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          occurrence: (args["occurrence"] as JsonValue | undefined) ?? {},
          assessment: (args["assessment"] as JsonValue | undefined) ?? {},
          causal_mistake: (args["causal_mistake"] as string | undefined) ?? "",
          prior_avoidance_fact_refs: (args["prior_avoidance_fact_refs"] as JsonValue | undefined) ?? [],
          owner: (args["owner"] as string | undefined) ?? "",
          expires_at: (args["expires_at"] as string | undefined) ?? "",
          idempotency_key: (args["idempotency_key"] as string | undefined) ?? "",
        }),
    },
    {
      name: "list_learning_candidates",
      description:
        "Read Learning Engine candidates (default discovery_source=mistake-recurrence). Never promotes — human triage only (SPEC-105).",
      inputSchema: {
        type: "object",
        properties: {
          discovery_source: {
            type: "string",
            description: "Optional filter; default mistake-recurrence.",
          },
        },
        required: [],
      },
      agent: LIST_LEARNING_CANDIDATES_AGENT,
      purpose: "List Learning Engine candidates",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [LIST_LEARNING_CANDIDATES_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          discovery_source: (args["discovery_source"] as string | undefined) ?? "",
        }),
    },
    {
      name: "capture_ui_baseline",
      description:
        "Capture full-page PNG under .qa-baselines/ (SHA-256 + dimensions). Exact-match baseline only — not perceptual soft compare.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          baseline_id: { type: "string" },
          browser: { type: "string" },
        },
        required: ["url", "baseline_id"],
      },
      agent: UI_BASELINE_CAPTURE_AGENT,
      purpose: "Capture UI visual baseline",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [UI_BASELINE_CAPTURE_SKILL],
      allowed_tools: [{ id: "playwright-dom-pipeline", version: "0.1.0" }],
      budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 4, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          url: (args["url"] as string | undefined) ?? "",
          baseline_id: (args["baseline_id"] as string | undefined) ?? "",
          browser: (args["browser"] as string | undefined) ?? "",
        }),
    },
    {
      name: "compare_ui_baseline",
      description:
        "Re-screenshot URL and compare to .qa-baselines/ via exact SHA-256 + dimensions. Mismatch is observation only — never auto product fail.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          baseline_id: { type: "string" },
          browser: { type: "string" },
        },
        required: ["url", "baseline_id"],
      },
      agent: UI_BASELINE_COMPARE_AGENT,
      purpose: "Compare UI visual baseline",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [UI_BASELINE_COMPARE_SKILL],
      allowed_tools: [{ id: "playwright-dom-pipeline", version: "0.1.0" }],
      budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 4, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          url: (args["url"] as string | undefined) ?? "",
          baseline_id: (args["baseline_id"] as string | undefined) ?? "",
          browser: (args["browser"] as string | undefined) ?? "",
        }),
    },
    {
      name: "register_ui_surface_baseline",
      description:
        "Persist Semantic UI element array under .qa-surface-baselines/ for release-over-release named-control drift.",
      inputSchema: {
        type: "object",
        properties: {
          baseline_id: { type: "string" },
          elements: { type: "array", items: { type: "object" } },
          label: { type: "string" },
          source_url: { type: "string" },
        },
        required: ["baseline_id", "elements"],
      },
      agent: SURFACE_BASELINE_REGISTER_AGENT,
      purpose: "Register UI surface baseline",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [SURFACE_BASELINE_REGISTER_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          baseline_id: (args["baseline_id"] as string | undefined) ?? "",
          elements: (args["elements"] as JsonValue | undefined) ?? [],
          label: (args["label"] as string | undefined) ?? "",
          source_url: (args["source_url"] as string | undefined) ?? "",
        }),
    },
    {
      name: "compare_ui_surface_to_baseline",
      description:
        "Diff live elements[] against a registered surface baseline (only-baseline / only-live / shared). Observation only.",
      inputSchema: {
        type: "object",
        properties: {
          baseline_id: { type: "string" },
          elements: { type: "array", items: { type: "object" } },
          label: { type: "string" },
        },
        required: ["baseline_id", "elements"],
      },
      agent: SURFACE_BASELINE_COMPARE_AGENT,
      purpose: "Compare UI surface to baseline",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [SURFACE_BASELINE_COMPARE_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          baseline_id: (args["baseline_id"] as string | undefined) ?? "",
          elements: (args["elements"] as JsonValue | undefined) ?? [],
          label: (args["label"] as string | undefined) ?? "",
        }),
    },
    {
      name: "register_requirement",
      description:
        "SPEC-202 ingest: register/replace a Requirement (id/title/statement/acceptance_criteria). scope.workspace_id forced to this Workspace. Use requirement_ref = id@version with generate_test_cases / run_auto_qa.",
      inputSchema: {
        type: "object",
        properties: { requirement: { type: "object" } },
        required: ["requirement"],
      },
      agent: REQUIREMENT_REGISTER_AGENT,
      purpose: "Register Workspace Requirement",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [REQUIREMENT_REGISTER_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: (args) => compactMcpInput({ requirement: (args["requirement"] as JsonValue | undefined) ?? {} }),
    },
    {
      name: "list_requirements",
      description: "List registered Requirement refs (id@version) for this Workspace.",
      inputSchema: { type: "object", properties: {}, required: [] },
      agent: REQUIREMENT_LIST_AGENT,
      purpose: "List Requirements",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [REQUIREMENT_LIST_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: () => ({}),
    },
    {
      name: "discover_ui_workflow",
      description:
        "SPEC-201 Navigation thin slice: same-origin multi-page crawl from url (max_pages default 3, cap 8). Returns pages (+ optional network_hints from xhr/fetch — candidates not oracles) + link edges + start_page_map. Not full Region/State/Permission.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          max_pages: { type: "number" },
          browser: { type: "string" },
        },
        required: ["url"],
      },
      agent: UI_WORKFLOW_AGENT,
      purpose: "Discover multi-page UI workflow",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [UI_WORKFLOW_SKILL],
      budgets: { max_steps: 16, max_duration_seconds: 180, max_tool_calls: 16, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          url: (args["url"] as string | undefined) ?? "",
          max_pages: (args["max_pages"] as number | undefined) ?? 0,
          browser: (args["browser"] as string | undefined) ?? "",
        }),
    },
    {
      name: "register_regression_suite",
      description:
        "Persist a regression pack to disk under .qa-regression-suites/<workspace>/ (survives MCP restart): cases[{kind:browser,test_case,generated_assertion}|{kind:api,case}]. Returns suite_id + persisted_path. Re-run via run_regression_suite.",
      inputSchema: {
        type: "object",
        properties: {
          label: { type: "string" },
          cases: { type: "array", items: { type: "object" } },
          id: { type: "string" },
          environment_ref: { type: "string" },
          base_url: { type: "string" },
        },
        required: ["label", "cases"],
      },
      agent: REGRESSION_REGISTER_AGENT,
      purpose: "Register regression suite",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [REGRESSION_REGISTER_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          label: (args["label"] as string | undefined) ?? "",
          cases: (args["cases"] as JsonValue | undefined) ?? [],
          id: (args["id"] as string | undefined) ?? "",
          environment_ref: (args["environment_ref"] as string | undefined) ?? "",
          base_url: (args["base_url"] as string | undefined) ?? "",
        }),
    },
    {
      name: "list_regression_suites",
      description: "List registered regression suites for this Workspace.",
      inputSchema: { type: "object", properties: {}, required: [] },
      agent: REGRESSION_LIST_AGENT,
      purpose: "List regression suites",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [REGRESSION_LIST_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
      buildInput: () => ({}),
    },
    {
      name: "run_regression_suite",
      description:
        "Re-run a registered regression suite (browser + API). Optional case_ids / related_defect_ids (DEF-DRAFT:<id>) for subset retest; field_values for browser fills. Returns draft_defects + release_recommendation (not pass-count-only).",
      inputSchema: {
        type: "object",
        properties: {
          suite_id: { type: "string" },
          base_url: { type: "string" },
          case_ids: { type: "array", items: { type: "string" }, description: "Subset of test_case / api case ids." },
          related_defect_ids: {
            type: "array",
            items: { type: "string" },
            description: "DEF-DRAFT:<test_case_id> or raw case ids to retest.",
          },
          field_values: { type: "object", description: "Map accessible_name → fill value for browser cases." },
          requirement_ref: { type: "string" },
          target_url: { type: "string" },
        },
        required: ["suite_id"],
      },
      agent: REGRESSION_RUN_AGENT,
      purpose: "Run regression suite",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [REGRESSION_RUN_SKILL],
      budgets: { max_steps: 64, max_duration_seconds: 600, max_tool_calls: 64, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          suite_id: (args["suite_id"] as string | undefined) ?? "",
          base_url: (args["base_url"] as string | undefined) ?? "",
          case_ids: (args["case_ids"] as JsonValue | undefined) ?? [],
          related_defect_ids: (args["related_defect_ids"] as JsonValue | undefined) ?? [],
          field_values: (args["field_values"] as JsonValue | undefined) ?? {},
          requirement_ref: (args["requirement_ref"] as string | undefined) ?? "",
          target_url: (args["target_url"] as string | undefined) ?? "",
        }),
    },
    {
      name: "generate_api_smoke_from_openapi",
      description:
        "Generate ApiSmokeCase[] from OpenAPI 3 JSON (status asserts from documented responses). Set include_authz_negatives=true to add unauthenticated 401|403 cases (auth=none). Set include_wrong_role_negatives=true to add auth=alternate_bearer cases expecting documented 403 — supply alternate_bearer_token_secret_ref at execute_api_smoke. Does not invent bodies/tokens.",
      inputSchema: {
        type: "object",
        properties: {
          openapi: { type: "object" },
          include_authz_negatives: { type: "boolean" },
          include_wrong_role_negatives: { type: "boolean" },
        },
        required: ["openapi"],
      },
      agent: OPENAPI_SMOKE_AGENT,
      purpose: "OpenAPI to API smoke cases",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [OPENAPI_SMOKE_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 60, max_tool_calls: 2, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          openapi: (args["openapi"] as JsonValue | undefined) ?? {},
          include_authz_negatives: args["include_authz_negatives"] === true,
          include_wrong_role_negatives: args["include_wrong_role_negatives"] === true,
        }),
    },
    {
      name: "export_defects_for_tracker",
      description:
        "Format Defect drafts as markdown or jira_description text for paste into Jira/Linear. Does not call tracker APIs.",
      inputSchema: {
        type: "object",
        properties: {
          defects: { type: "array", items: { type: "object" } },
          format: { type: "string", description: "markdown | jira_description" },
        },
        required: ["defects"],
      },
      agent: DEFECT_EXPORT_AGENT,
      purpose: "Export defects for tracker paste",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [DEFECT_EXPORT_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 1, max_retries: 0 },
      buildInput: (args) =>
        compactMcpInput({
          defects: (args["defects"] as JsonValue | undefined) ?? [],
          format: (args["format"] as string | undefined) ?? "",
        }),
    },
    {
      name: "file_defects_to_tracker",
      description:
        "Optional tracker filing seam (jira_rest | linear_graphql | webhook). Default dry-run builds payloads without POSTing. Set confirm_file=true + bearer_token_secret_ref to live-file. Never silent auto-file; never invents confirmed_cause.",
      inputSchema: {
        type: "object",
        properties: {
          defects: { type: "array", items: { type: "object" } },
          provider: { type: "string", description: "jira_rest | linear_graphql | webhook" },
          base_url: { type: "string" },
          project_or_team: { type: "string", description: "Jira project key or Linear team UUID (ignored for webhook)." },
          bearer_token: { type: "string" },
          bearer_token_secret_ref: { type: "string" },
          confirm_file: { type: "boolean", description: "Must be true to POST — default dry-run." },
          jira_issue_type: { type: "string", description: "Default Bug." },
        },
        required: ["defects", "provider", "base_url"],
      },
      agent: DEFECT_FILE_AGENT,
      purpose: "Dry-run or confirm-file defects to Jira/Linear/webhook",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [DEFECT_FILE_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 20, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          defects: (args["defects"] as JsonValue | undefined) ?? [],
          provider: (args["provider"] as string | undefined) ?? "",
          base_url: (args["base_url"] as string | undefined) ?? "",
          project_or_team: (args["project_or_team"] as string | undefined) ?? "",
          bearer_token: (args["bearer_token"] as string | undefined) ?? "",
          bearer_token_secret_ref: (args["bearer_token_secret_ref"] as string | undefined) ?? "",
          confirm_file: args["confirm_file"] === true,
          jira_issue_type: (args["jira_issue_type"] as string | undefined) ?? "",
        }),
    },
    {
      name: "register_knowledge_record",
      description:
        "Upsert a durable Knowledge Search record under .qa-knowledge/<workspace>/records.json (survives MCP restart). Caller-authored facts only — never invent product truth. Used by discover_product_context / assessors.",
      inputSchema: {
        type: "object",
        properties: {
          knowledge_ref: { type: "string" },
          title: { type: "string" },
          excerpt: { type: "string" },
          authority_status: { type: "string" },
          scopes: { type: "array", items: { type: "string" } },
          provenance: { type: "array", items: { type: "string" } },
          evidence: { type: "array", items: { type: "string" } },
        },
        required: ["knowledge_ref", "title", "excerpt"],
      },
      agent: KNOWLEDGE_REGISTER_AGENT,
      purpose: "Register durable knowledge record for Workspace search",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [KNOWLEDGE_REGISTER_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 1, max_retries: 0 },
      buildInput: (args) =>
        compactMcpInput({
          knowledge_ref: (args["knowledge_ref"] as string | undefined) ?? "",
          title: (args["title"] as string | undefined) ?? "",
          excerpt: (args["excerpt"] as string | undefined) ?? "",
          authority_status: (args["authority_status"] as string | undefined) ?? "",
          scopes: (args["scopes"] as JsonValue | undefined) ?? [],
          provenance: (args["provenance"] as JsonValue | undefined) ?? [],
          evidence: (args["evidence"] as JsonValue | undefined) ?? [],
        }),
    },
    {
      name: "generate_journey_test_cases",
      description:
        "Build thin E2E journey TestCases from discover_ui_workflow pages[] + edges[] (click link chains + expected_url_includes). Optional expected_network (caller-supplied API substring) copies onto generated assertions. Execute via execute_generated_test_case or register_regression_suite.",
      inputSchema: {
        type: "object",
        properties: {
          start_url: { type: "string" },
          pages: { type: "array", items: { type: "object" } },
          edges: { type: "array", items: { type: "object" } },
          max_hops: { type: "number" },
          requirement_ref: { type: "string" },
          expected_network: {
            type: "object",
            description: "Optional UI→API oracle: {url_includes, method?, status?, body_includes?}",
          },
        },
        required: ["start_url", "pages", "edges"],
      },
      agent: JOURNEY_GEN_AGENT,
      purpose: "Generate journey TestCases from workflow edges",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [JOURNEY_GEN_SKILL],
      budgets: { max_steps: 8, max_duration_seconds: 60, max_tool_calls: 2, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          start_url: (args["start_url"] as string | undefined) ?? "",
          pages: (args["pages"] as JsonValue | undefined) ?? [],
          edges: (args["edges"] as JsonValue | undefined) ?? [],
          max_hops: (args["max_hops"] as number | undefined) ?? 0,
          requirement_ref: (args["requirement_ref"] as string | undefined) ?? "",
          expected_network: (args["expected_network"] as JsonValue | undefined) ?? {},
        }),
    },
    {
      name: "compare_ui_surfaces",
      description:
        "Permission/role thin slice: diff two Semantic UI element arrays (e.g. admin vs viewer maps from separate discovery sessions).",
      inputSchema: {
        type: "object",
        properties: {
          elements_a: { type: "array", items: { type: "object" } },
          elements_b: { type: "array", items: { type: "object" } },
          label_a: { type: "string" },
          label_b: { type: "string" },
        },
        required: ["elements_a", "elements_b"],
      },
      agent: COMPARE_UI_AGENT,
      purpose: "Compare two UI surfaces for role diffs",
      consequence_class: "advisory",
      policy_version: policyVersion,
      allowed_skills: [COMPARE_UI_SKILL],
      budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 1, max_retries: 0 },
      buildInput: (args) =>
        compactMcpInput({
          elements_a: (args["elements_a"] as JsonValue | undefined) ?? [],
          elements_b: (args["elements_b"] as JsonValue | undefined) ?? [],
          label_a: (args["label_a"] as string | undefined) ?? "",
          label_b: (args["label_b"] as string | undefined) ?? "",
        }),
    },
    {
      name: "discover_and_compare_role_ui_surfaces",
      description:
        "Orchestrate two discover_ui_surface_after_login sessions (role_a / role_b) then compare named controls. Prefer password_secret_ref. Not a permission model — Host interprets only_in_a / only_in_b.",
      inputSchema: {
        type: "object",
        properties: {
          role_a: { type: "object" },
          role_b: { type: "object" },
        },
        required: ["role_a", "role_b"],
      },
      agent: ROLE_COMPARE_AGENT,
      purpose: "Dual-role after-login discovery + surface compare",
      consequence_class: "reversible",
      policy_version: policyVersion,
      allowed_skills: [ROLE_COMPARE_SKILL],
      allowed_tools: [{ id: "playwright-dom-pipeline", version: "0.1.0" }],
      budgets: { max_steps: 16, max_duration_seconds: 240, max_tool_calls: 8, max_retries: 1 },
      buildInput: (args) =>
        compactMcpInput({
          role_a: (args["role_a"] as JsonValue | undefined) ?? {},
          role_b: (args["role_b"] as JsonValue | undefined) ?? {},
        }),
    },
  ];

  return { runtime, tools, mistakeRecurrenceTracker, candidateRepository };
}
