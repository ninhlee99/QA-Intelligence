import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { YamlOntologyRepository } from "../../src/ontology/yaml-ontology-repository.js";

/**
 * SPEC-408 §7 conformance: "exact-version retrieval, compatibility,
 * extension validation, historical interpretation, integrity, caching, and
 * Workspace isolation." The first block below exercises the real,
 * already-accepted `ontology/*.yaml` files this repository ships (no
 * fixture, no mock) — the same trust boundary ADR-021 §4 describes. The
 * second block builds disposable fixture directories to exercise failure
 * paths a passing repository state cannot exhibit.
 */

test("[real ontology] currentRelease resolves the actual accepted 1.0.0 release", async () => {
  const repository = new YamlOntologyRepository();
  const result = await repository.currentRelease();

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.version, "1.0.0");
  assert.ok(result.value.entities.length > 0);
  assert.ok(result.value.relationships.length > 0);
  assert.ok(result.value.enumerations.length > 0);
  assert.ok(result.value.constraints.length > 0);
  assert.match(result.value.integrity_digest, /^sha256:[0-9a-f]{64}$/);
});

test("[real ontology] release() for an unknown version fails closed distinctly", async () => {
  const repository = new YamlOntologyRepository();
  const result = await repository.release("999.0.0");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unknown_version");
});

test("[real ontology] resolveTerm finds a real entity from SPEC-101's accepted ontology", async () => {
  const repository = new YamlOntologyRepository();
  const result = await repository.resolveTerm("1.0.0", "Requirement");

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.id, "Requirement");
});

test("[real ontology] resolveTerm finds a real relationship from SPEC-101's accepted ontology", async () => {
  const repository = new YamlOntologyRepository();
  const result = await repository.resolveTerm("1.0.0", "depends_on");

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.id, "depends_on");
});

test("[real ontology] resolveTerm fails closed for an unknown term", async () => {
  const repository = new YamlOntologyRepository();
  const result = await repository.resolveTerm("1.0.0", "DoesNotExist");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unknown_term");
});

test("[real ontology] compareReleases against itself reports no additions or removals", async () => {
  const repository = new YamlOntologyRepository();
  const result = await repository.compareReleases("1.0.0", "1.0.0");

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.deepEqual(result.value.added_entities, []);
  assert.deepEqual(result.value.removed_entities, []);
  assert.equal(result.value.compatible, true);
});

test("[real ontology] validateExtension rejects redeclaring a real global-scope entity id (SPEC-408 §6)", async () => {
  const repository = new YamlOntologyRepository();
  const result = await repository.validateExtension({
    workspace_id: "workspace-ontology-001",
    entities: [{ id: "Workspace", family: "platform", workspace_scope: "global" }],
  });

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.ok(result.reasons.includes("weakens_global_constraint"));
});

test("[real ontology] validateExtension accepts a genuinely new entity and relationship", async () => {
  const repository = new YamlOntologyRepository();
  const result = await repository.validateExtension({
    workspace_id: "workspace-ontology-001",
    entities: [{ id: "CustomWorkspaceWidget", family: "custom", workspace_scope: "workspace" }],
    relationships: [
      { id: "custom_relates_to", source: "CustomWorkspaceWidget", target: "Requirement", inverse: "custom_related_from" },
    ],
  });

  assert.equal(result.valid, true, JSON.stringify(result));
});

test("[real ontology] currentRelease caches — a second call returns the same object without re-reading", async () => {
  const repository = new YamlOntologyRepository();
  const first = await repository.currentRelease();
  const second = await repository.currentRelease();

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.value, second.value, "an immutable accepted release SHALL be the same cached object, not re-parsed");
});

async function withFixtureRoot<T>(
  files: Readonly<Record<string, string>>,
  run: (repositoryRoot: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "ontology-fixture-"));
  try {
    await mkdir(join(root, "meta"), { recursive: true });
    await mkdir(join(root, "ontology"), { recursive: true });
    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = join(root, relativePath);
      await mkdir(join(fullPath, ".."), { recursive: true });
      await writeFile(fullPath, content, "utf8");
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const VALID_INDEX = `
artifacts:
  - { type: entities, path: ../ontology/entities.yaml }
  - { type: relationships, path: ../ontology/relationships.yaml }
  - { type: enumerations, path: ../ontology/enumerations.yaml }
  - { type: constraints, path: ../ontology/constraints.yaml }
`;

const VALID_ENTITIES = `
ontology_version: 1.0.0
entities:
  - { id: Widget, family: test, workspace_scope: workspace }
`;

const VALID_RELATIONSHIPS = `
ontology_version: 1.0.0
relationships:
  - { id: relates_to, source: Widget, target: Widget, inverse: related_from }
`;

const VALID_ENUMERATIONS = `
ontology_version: 1.0.0
enumerations:
  widget_status: [draft, active, retired]
`;

const VALID_CONSTRAINTS = `
ontology_version: 1.0.0
constraints:
  - { id: widget_identity, rule: identifiers are not reused }
`;

test("[fixture] a missing meta/ONTOLOGY_INDEX.yaml fails closed as unavailable_source", async () => {
  await withFixtureRoot({}, async (repositoryRoot) => {
    const repository = new YamlOntologyRepository({ repositoryRoot });
    const result = await repository.currentRelease();

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, "unavailable_source");
  });
});

test("[fixture] mismatched ontology_version across files fails closed as integrity_failure", async () => {
  await withFixtureRoot(
    {
      "meta/ONTOLOGY_INDEX.yaml": VALID_INDEX,
      "ontology/entities.yaml": VALID_ENTITIES,
      "ontology/relationships.yaml": VALID_RELATIONSHIPS,
      "ontology/enumerations.yaml": VALID_ENUMERATIONS,
      "ontology/constraints.yaml": '{"ontology_version":"2.0.0","constraints":[]}',
    },
    async (repositoryRoot) => {
      const repository = new YamlOntologyRepository({ repositoryRoot });
      const result = await repository.currentRelease();

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.failure.code, "integrity_failure");
    },
  );
});

test("[fixture] an index missing a required artifact entry fails closed as integrity_failure", async () => {
  await withFixtureRoot(
    {
      "meta/ONTOLOGY_INDEX.yaml": "artifacts:\n  - { type: entities, path: ../ontology/entities.yaml }\n",
      "ontology/entities.yaml": VALID_ENTITIES,
    },
    async (repositoryRoot) => {
      const repository = new YamlOntologyRepository({ repositoryRoot });
      const result = await repository.currentRelease();

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.failure.code, "integrity_failure");
    },
  );
});

test("[fixture] a complete, consistent fixture release loads and resolves terms correctly", async () => {
  await withFixtureRoot(
    {
      "meta/ONTOLOGY_INDEX.yaml": VALID_INDEX,
      "ontology/entities.yaml": VALID_ENTITIES,
      "ontology/relationships.yaml": VALID_RELATIONSHIPS,
      "ontology/enumerations.yaml": VALID_ENUMERATIONS,
      "ontology/constraints.yaml": VALID_CONSTRAINTS,
    },
    async (repositoryRoot) => {
      const repository = new YamlOntologyRepository({ repositoryRoot });
      const release = await repository.currentRelease();

      assert.equal(release.ok, true, JSON.stringify(release));
      if (!release.ok) return;
      assert.equal(release.value.entities.length, 1);
      assert.equal(release.value.enumerations[0]?.name, "widget_status");
      assert.deepEqual([...(release.value.enumerations[0]?.values ?? [])], ["draft", "active", "retired"]);

      const term = await repository.resolveTerm("1.0.0", "Widget");
      assert.equal(term.ok, true);
    },
  );
});

test("[fixture] validateExtension rejects a duplicate entity id within the same release", async () => {
  await withFixtureRoot(
    {
      "meta/ONTOLOGY_INDEX.yaml": VALID_INDEX,
      "ontology/entities.yaml": VALID_ENTITIES,
      "ontology/relationships.yaml": VALID_RELATIONSHIPS,
      "ontology/enumerations.yaml": VALID_ENUMERATIONS,
      "ontology/constraints.yaml": VALID_CONSTRAINTS,
    },
    async (repositoryRoot) => {
      const repository = new YamlOntologyRepository({ repositoryRoot });
      const result = await repository.validateExtension({
        workspace_id: "workspace-fixture-001",
        entities: [{ id: "Widget", family: "test", workspace_scope: "workspace" }],
      });

      assert.equal(result.valid, false);
      if (result.valid) return;
      assert.ok(result.reasons.includes("duplicate_entity_id"));
    },
  );
});

test("[fixture] validateExtension rejects a relationship with an unknown endpoint", async () => {
  await withFixtureRoot(
    {
      "meta/ONTOLOGY_INDEX.yaml": VALID_INDEX,
      "ontology/entities.yaml": VALID_ENTITIES,
      "ontology/relationships.yaml": VALID_RELATIONSHIPS,
      "ontology/enumerations.yaml": VALID_ENUMERATIONS,
      "ontology/constraints.yaml": VALID_CONSTRAINTS,
    },
    async (repositoryRoot) => {
      const repository = new YamlOntologyRepository({ repositoryRoot });
      const result = await repository.validateExtension({
        workspace_id: "workspace-fixture-001",
        relationships: [{ id: "points_nowhere", source: "Widget", target: "GhostEntity" }],
      });

      assert.equal(result.valid, false);
      if (result.valid) return;
      assert.ok(result.reasons.includes("unknown_relationship_endpoint"));
    },
  );
});

