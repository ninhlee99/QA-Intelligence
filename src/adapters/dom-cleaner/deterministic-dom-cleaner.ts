import { createHash } from "node:crypto";

import type {
  CleanedDomNode,
  DomCleaner,
  DomCleanerFailureCode,
  DomCleanRequest,
  DomCleanResult,
  DomCleanValue,
  RawDomNode,
  RedactionEvent,
  RedactionPolicy,
  SourceNodeMapping,
} from "../../dom-cleaner/public.js";

/** Tags whose entire subtree carries no structural or accessible meaning and SHALL be removed outright (SPEC-302 §2). */
const PROHIBITED_TAGS = new Set(["script", "style", "noscript", "template", "link", "meta"]);

/** Attributes that are pure styling/runtime noise, never accessible or structural meaning. */
const NOISE_ATTRIBUTE_PREFIXES = ["style", "on", "data-testid", "data-reactid", "class"];

const INTERACTIVE_TAGS: Readonly<Record<string, "clickable" | "editable" | "selectable" | "navigable">> = {
  button: "clickable",
  a: "navigable",
  input: "editable",
  textarea: "editable",
  select: "selectable",
  option: "selectable",
};

/**
 * Deterministic reference `DomCleaner` (SPEC-302 §9's required "deterministic
 * fixture" adapter): operates on an already-typed `RawDomNode` tree rather
 * than a live browser DOM, so it needs no Playwright dependency. Implements
 * the exact SPEC-302 §5 pipeline stage order — this is what a production
 * browser-backed adapter's output SHALL be equivalent to for the same
 * input, policy, and cleaner version (§7 determinism).
 */
export class DeterministicDomCleaner implements DomCleaner {
  static readonly VERSION = "1.0.0";

  async clean(request: DomCleanRequest): Promise<DomCleanResult> {
    // Validate Scope and Limits
    if (!request.capture_authorized) {
      return failure("capture_unauthorized", "The capture was not authorized.");
    }
    if (request.capture_id.trim().length === 0 || request.raw_content_ref.trim().length === 0) {
      return failure("malformed_input", "capture_id and raw_content_ref are required.");
    }
    const rawNodeCount = countNodes(request.raw);
    if (rawNodeCount > request.limits.max_nodes) {
      return failure("excessive_size", `Raw tree has ${rawNodeCount} nodes, exceeding the limit of ${request.limits.max_nodes}.`);
    }
    const depth = treeDepth(request.raw);
    if (depth > request.limits.max_depth) {
      return failure("excessive_size", `Raw tree depth ${depth} exceeds the limit of ${request.limits.max_depth}.`);
    }

    // Parse Without Script Execution: RawDomNode is already parsed data,
    // never executed — this stage is structurally satisfied by the input
    // type itself (SPEC-302 §6 "Active content SHALL never execute").

    // Remove Prohibited Content + Redact Sensitive Values + Normalize
    // Stable Structure + Retain Accessibility and Interaction Signals,
    // walked together in one pass per subtree (each stage's output feeds
    // the next node-by-node, not as separate full-tree passes).
    const redactionEvents: RedactionEvent[] = [];
    const sourceMapping: SourceNodeMapping[] = [];
    let nodeSequence = 0;
    let retainedCount = 0;

    const walk = (node: RawDomNode, path: readonly number[]): CleanedDomNode | undefined => {
      if (PROHIBITED_TAGS.has(node.tag.toLowerCase())) return undefined;

      nodeSequence += 1;
      const nodeId = `node-${nodeSequence}`;
      retainedCount += 1;
      sourceMapping.push({ node_id: nodeId, raw_path: path });

      const retainedAttributes: Record<string, string> = {};
      for (const [key, value] of Object.entries(node.attributes)) {
        if (NOISE_ATTRIBUTE_PREFIXES.some((prefix) => key.toLowerCase().startsWith(prefix))) continue;
        const redacted = redactValue(value, request.redaction_policy, key);
        if (redacted.redacted) {
          redactionEvents.push({ node_id: nodeId, attribute_or_text: key, reason: redacted.reason });
          continue;
        }
        retainedAttributes[key] = truncate(value, request.limits.max_attribute_length);
      }

      let text = node.text;
      if (text !== undefined) {
        const redacted = redactValue(text, request.redaction_policy, "#text");
        if (redacted.redacted) {
          redactionEvents.push({ node_id: nodeId, attribute_or_text: "#text", reason: redacted.reason });
          text = undefined;
        } else {
          text = truncate(text, request.limits.max_text_length);
        }
      }

      const children = node.children
        .map((child, index) => walk(child, [...path, index]))
        .filter((child): child is CleanedDomNode => child !== undefined);

      const interactionHint = INTERACTIVE_TAGS[node.tag.toLowerCase()];

      return {
        node_id: nodeId,
        tag: node.tag,
        retained_attributes: retainedAttributes,
        ...(text !== undefined ? { text } : {}),
        ...(node.accessible_role !== undefined ? { accessible_role: node.accessible_role } : {}),
        ...(node.accessible_name !== undefined ? { accessible_name: node.accessible_name } : {}),
        ...(interactionHint !== undefined ? { interaction_hint: interactionHint } : {}),
        children,
      };
    };

    const sanitizedTree = walk(request.raw, []);
    if (sanitizedTree === undefined) {
      return failure("unsupported_content", "The root node itself is prohibited content and cannot be cleaned.");
    }

    const serializedBytes = Buffer.byteLength(JSON.stringify(sanitizedTree), "utf8");
    if (serializedBytes > request.limits.max_bytes) {
      return failure("excessive_size", `Sanitized output is ${serializedBytes} bytes, exceeding the limit of ${request.limits.max_bytes}.`);
    }

    const value: DomCleanValue = {
      sanitized_tree: sanitizedTree,
      redaction_events: redactionEvents,
      source_node_mapping: sourceMapping,
      capture_id: request.capture_id,
      cleaner_version: DeterministicDomCleaner.VERSION,
      warnings: rawNodeCount !== retainedCount ? [`${rawNodeCount - retainedCount} node(s) removed as prohibited content`] : [],
      coverage: { raw_node_count: rawNodeCount, retained_node_count: retainedCount },
    };
    return { ok: true, value };
  }
}

function redactValue(
  value: string,
  policy: RedactionPolicy,
  attributeName: string,
): Readonly<{ redacted: false } | { redacted: true; reason: string }> {
  for (const rule of policy.rules) {
    if (new RegExp(rule.attribute_pattern).test(attributeName)) {
      return { redacted: true, reason: rule.reason };
    }
  }
  for (const pattern of policy.redact_text_matching) {
    if (new RegExp(pattern).test(value)) {
      return { redacted: true, reason: "matched redact_text_matching pattern" };
    }
  }
  return { redacted: false };
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function countNodes(node: RawDomNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function treeDepth(node: RawDomNode): number {
  return node.children.length === 0 ? 1 : 1 + Math.max(...node.children.map(treeDepth));
}

function failure(code: DomCleanerFailureCode, message: string): DomCleanResult {
  return { ok: false, failure: { code, message } };
}

/** Deterministic digest over a cleaned tree — useful for a caller comparing two cleaning runs for byte-identical determinism (SPEC-302 §7). */
export function cleanedTreeDigest(tree: CleanedDomNode): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(tree)).digest("hex")}`;
}
