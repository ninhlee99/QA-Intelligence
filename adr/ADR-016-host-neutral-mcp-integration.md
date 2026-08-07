---
id: ADR-016
title: Host-Neutral MCP Integration and Thin Host Packages
status: accepted
version: 1.1.0
date: 2026-08-03
decision_owners:
  - Architecture
  - Runtime Platform
  - Product Governance
  - Security
related_specs:
  - SPEC-106
  - SPEC-309
  - SPEC-310
  - SPEC-503
  - SPEC-506
  - SPEC-508
  - SPEC-509
  - SPEC-510
  - SPEC-511
related_adrs:
  - ADR-007
  - ADR-008
  - ADR-009
  - ADR-013
  - ADR-014
  - ADR-015
  - ADR-017
supersedes: []
superseded_by: null
approved_by:
  - Repository Owner through explicit MCP distribution confirmation
  - Codex Architecture and Change-Impact Review
approval_evidence: governance/reviews/mcp-host-integration/CHANGE_IMPACT.yaml
---

# ADR-016: Host-Neutral MCP Integration and Thin Host Packages

## 1. Context

QA Intelligence must be usable from Codex, Claude Code, Cursor, CI, and future agent hosts without allowing any host prompt, model, or extension format to become product authority. Each host has a different packaging mechanism, but all require the same governed QA behavior, Workspace isolation, evidence, approvals, version resolution, and failure semantics.

The word **Plugin** already has an accepted platform meaning in ADR-007: a replaceable adapter from the Core Platform to an external technology. A Codex or Claude installation bundle is therefore a different architectural concern and requires unambiguous terminology.

## 2. Decision

Expose governed QA Intelligence capabilities through one host-neutral Model Context Protocol integration backed by the accepted Core Platform and Agent Runtime contracts.

The authoritative execution path SHALL remain:

```text
Host
→ Host Integration Package
→ QA Intelligence MCP Interface
→ Agent Runtime / Evaluation Engine
→ Skills, Rules, Knowledge and Tools
```

Codex, Claude Code, Cursor, CI, and other hosts SHALL receive thin **Host Integration Packages** containing only host metadata, focused Skills or rules, MCP connection configuration, and optional presentation assets. These packages SHALL NOT own QA business logic, policy, accepted knowledge, evaluation verdicts, runtime lifecycle, or final-result authority.

The initial MCP implementation SHALL support:

- local `stdio` transport for a single-host profile and a local socket bridge
  when multiple hosts share one active parent runtime
- remote Streamable HTTP transport for shared and enterprise deployment
- OAuth or an integrity-equivalent approved identity mechanism for remote use
- schema-versioned Tools that map to accepted QA Intelligence interfaces
- Workspace-bound context, operation identity, idempotency, deadline, budgets, evidence requirements, approvals, and cancellation
- provider-neutral results with exact versions, evidence, uncertainty, failure classification, and cleanup status

## 3. Terminology

- **Platform Plugin**: an ADR-007 adapter used by QA Intelligence to reach Playwright, GitHub, Jira, model providers, storage, or another external technology.
- **Host Integration Package**: an installable Codex, Claude Code, Cursor, or similar bundle that connects a host to QA Intelligence.
- **MCP Interface**: the transport-facing capability interface presented to hosts; it is not an alternate Agent Runtime or policy engine.
- **Local Parent Runtime**: the OS-user-owned process that holds Workspace
  lifecycle authority, owns SQLite access, and coordinates child workers.

Host Integration Packages MAY be called plugins by their host product. Repository architecture and code SHALL still use the qualified terms above when ownership could be ambiguous.

## 4. Interface Rules

MCP Tools SHALL be task-oriented and coarse enough to preserve deep modules. The interface SHALL expose governed capabilities such as requirement review, risk analysis, test design, execution, defect analysis, and release assessment rather than internal repositories or provider SDK operations.

Every Tool invocation SHALL:

- bind to one trusted Workspace and actor context
- resolve exact Agent, Skill, Tool, Prompt, policy, schema, and knowledge versions
- preserve the consequence class and require approval where policy demands it
- pass through the Agent Runtime or Evaluation Engine instead of calling a Skill implementation directly
- return only retained authoritative results or explicit non-terminal status
- exclude secrets, hidden reasoning, raw credentials, and unauthorized cross-Workspace data

MCP resources or prompts MAY improve discovery and usability, but they SHALL NOT become accepted knowledge or bypass Knowledge Store and Rule Engine authority.

## 5. Host Packaging

- Codex packaging MAY include `.codex-plugin/plugin.json`, focused Skills, and MCP configuration.
- Claude Code packaging MAY include `.claude-plugin/plugin.json`, focused Skills or Agents, hooks, and MCP configuration.
- Cursor packaging SHOULD use project or global MCP configuration plus focused Cursor Rules; editor-extension registration MAY be added when justified.
- CI and non-interactive consumers SHOULD call the same MCP Interface or an integrity-equivalent application interface governed by the same contracts.

Host-specific instructions SHALL remain minimal. A change in host packaging SHALL NOT require a change to QA capability meaning.

## 6. Security and Operations

- The MCP process is an untrusted transport adapter relative to domain authority.
- Local `stdio` inherits the host sandbox but still requires QA Intelligence authorization.
- A host bridge SHALL NOT open Workspace persistence or dispatch child workers
  independently of the active local parent runtime.
- Remote transport requires authenticated, encrypted connections and server-side Workspace authorization.
- Host approval settings cannot weaken platform approval requirements.
- Tool discovery SHALL reveal no inaccessible Workspace, secret, or protected artifact.
- Production operation requires rate limits, quotas, audit events, revocation, kill switches, health, version negotiation, and evidence retention.

## 7. Alternatives Considered

- **Independent implementation per host** was rejected because behavior, policy, and evidence would diverge.
- **Skills-only distribution** was rejected because prompt instructions cannot provide durable runtime, authorization, evidence, evaluation, or Tool execution guarantees.
- **Embedding the Core Platform inside every host plugin** was rejected because lifecycle, persistence, upgrades, and security controls would fragment.
- **Direct database or repository access from MCP Tools** was rejected because it bypasses accepted interfaces and Workspace authority.
- **Provider-specific function calling as the canonical interface** was rejected because it couples distribution to one model provider.

## 8. Consequences and Sequencing

One MCP Interface can serve every supported host, while thin packages preserve native installation and invocation experience. The additional transport and packaging layers require conformance, authentication, compatibility, and host-installation tests.

Development MAY add an in-process or `stdio` MCP adapter after the relevant core capability is vertically complete. The default local profile follows ADR-017 and stores state on the user's machine; remote MCP and PostgreSQL are opt-in shared-profile concerns. Production MCP enablement remains blocked until the underlying Agent/Skill passes GOV-012 G1–G4 and the transport passes security, isolation, approval, cancellation, evidence, and operational conformance. Public or controlled release remains subject to G5–G6.

## 9. Validation

- the same capability request produces equivalent governed semantics from Codex, Claude Code, Cursor, and direct contract tests
- host packages cannot call Skill implementations or persistence directly
- Workspace denial, approval, cancellation, timeout, and evidence behavior remain unchanged across transports
- MCP schema/version incompatibility fails before execution
- local and remote authentication paths do not widen authority
- disabling or revoking a host package or MCP connection prevents new operations without rewriting historical evidence
