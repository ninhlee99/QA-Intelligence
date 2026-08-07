import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { load } from "js-yaml";

import { stableStringify } from "../shared/stable-stringify.js";
import type {
  OntologyConstraint,
  OntologyEntity,
  OntologyEnumeration,
  OntologyExtension,
  OntologyExtensionValidationResult,
  OntologyRelationship,
  OntologyRelease,
  OntologyReleaseComparison,
  OntologyRepository,
  OntologyResult,
} from "./public.js";

const GLOBAL_ENTITY_IDS_IMMUTABLE_MESSAGE =
  "Workspace extensions cannot redeclare a global-scope entity id (SPEC-408 §6).";

export type YamlOntologyRepositoryOptions = Readonly<{
  /** Directory containing meta/ONTOLOGY_INDEX.yaml and the ontology/ tree it indexes; defaults to this repository's own root. */
  repositoryRoot?: string;
}>;

/**
 * Production `OntologyRepository` (SPEC-408 §9): reads the already-accepted
 * `ontology/*.yaml` files this repository's own governance process
 * produces and validates, indexed by `meta/ONTOLOGY_INDEX.yaml`. Read-only
 * and one-directional — it never writes YAML (ADR-021 §3) — and treats
 * every file it reads as already-trusted, governance-reviewed content, not
 * untrusted input, per ADR-021 §4.
 *
 * There is exactly one accepted release today (`1.0.0`, the same version
 * every `ontology/*.yaml` file declares); `release()` for any other
 * version correctly returns `unknown_version` rather than fabricating a
 * historical release this repository never actually had.
 */
export class YamlOntologyRepository implements OntologyRepository {
  readonly #repositoryRoot: string;
  #cached: OntologyRelease | undefined;
  #loadError: OntologyResult<OntologyRelease> | undefined;

  constructor(options: YamlOntologyRepositoryOptions = {}) {
    this.#repositoryRoot = options.repositoryRoot ?? defaultRepositoryRoot();
  }

  async currentRelease(): Promise<OntologyResult<OntologyRelease>> {
    return this.#load();
  }

  async release(version: string): Promise<OntologyResult<OntologyRelease>> {
    const current = await this.#load();
    if (!current.ok) return current;
    if (current.value.version !== version) {
      return { ok: false, failure: { code: "unknown_version", message: `No accepted ontology release "${version}".` } };
    }
    return current;
  }

  async resolveTerm(
    version: string,
    termId: string,
  ): Promise<OntologyResult<OntologyEntity | OntologyRelationship>> {
    const release = await this.release(version);
    if (!release.ok) return release;

    const entity = release.value.entities.find((candidate) => candidate.id === termId);
    if (entity !== undefined) return { ok: true, value: entity };

    const relationship = release.value.relationships.find((candidate) => candidate.id === termId);
    if (relationship !== undefined) return { ok: true, value: relationship };

    return { ok: false, failure: { code: "unknown_term", message: `No entity or relationship named "${termId}".` } };
  }

  async validateExtension(extension: OntologyExtension): Promise<OntologyExtensionValidationResult> {
    const current = await this.#load();
    if (!current.ok) {
      return { valid: false, reasons: ["unknown_relationship_endpoint"] };
    }

    const reasons: Array<
      "duplicate_entity_id" | "duplicate_relationship_id" | "unknown_relationship_endpoint" | "weakens_global_constraint"
    > = [];
    const globalEntityIds = new Set(
      current.value.entities.filter((entity) => entity.workspace_scope === "global").map((entity) => entity.id),
    );
    const allEntityIds = new Set(current.value.entities.map((entity) => entity.id));

    for (const entity of extension.entities ?? []) {
      if (globalEntityIds.has(entity.id)) {
        reasons.push("weakens_global_constraint");
      } else if (allEntityIds.has(entity.id)) {
        reasons.push("duplicate_entity_id");
      }
      allEntityIds.add(entity.id);
    }

    const allRelationshipIds = new Set(current.value.relationships.map((relationship) => relationship.id));
    const knownEndpoints = new Set([...allEntityIds, ...(extension.entities ?? []).map((entity) => entity.id)]);
    for (const relationship of extension.relationships ?? []) {
      if (allRelationshipIds.has(relationship.id)) {
        reasons.push("duplicate_relationship_id");
      }
      if (!knownEndpoints.has(relationship.source) || !knownEndpoints.has(relationship.target)) {
        reasons.push("unknown_relationship_endpoint");
      }
      allRelationshipIds.add(relationship.id);
    }

    if (reasons.length > 0) return { valid: false, reasons };
    return { valid: true };
  }

  async compareReleases(
    fromVersion: string,
    toVersion: string,
  ): Promise<OntologyResult<OntologyReleaseComparison>> {
    const from = await this.release(fromVersion);
    if (!from.ok) return from;
    const to = await this.release(toVersion);
    if (!to.ok) return to;

    const fromEntityIds = new Set(from.value.entities.map((entity) => entity.id));
    const toEntityIds = new Set(to.value.entities.map((entity) => entity.id));
    const fromRelationshipIds = new Set(from.value.relationships.map((relationship) => relationship.id));
    const toRelationshipIds = new Set(to.value.relationships.map((relationship) => relationship.id));

    const removedEntities = [...fromEntityIds].filter((id) => !toEntityIds.has(id));
    const removedRelationships = [...fromRelationshipIds].filter((id) => !toRelationshipIds.has(id));

    return {
      ok: true,
      value: {
        added_entities: [...toEntityIds].filter((id) => !fromEntityIds.has(id)),
        removed_entities: removedEntities,
        added_relationships: [...toRelationshipIds].filter((id) => !fromRelationshipIds.has(id)),
        removed_relationships: removedRelationships,
        // SPEC-408 §4: removal is reported, not silently dropped; a release
        // that removed an id is not "compatible" in the additive sense.
        compatible: removedEntities.length === 0 && removedRelationships.length === 0,
      },
    };
  }

  async #load(): Promise<OntologyResult<OntologyRelease>> {
    if (this.#cached !== undefined) return { ok: true, value: this.#cached };
    if (this.#loadError !== undefined) return this.#loadError;

    let indexRaw: string;
    try {
      indexRaw = await readFile(resolve(this.#repositoryRoot, "meta/ONTOLOGY_INDEX.yaml"), "utf8");
    } catch (cause) {
      const result: OntologyResult<OntologyRelease> = {
        ok: false,
        failure: { code: "unavailable_source", message: describeReadFailure("meta/ONTOLOGY_INDEX.yaml", cause) },
      };
      this.#loadError = result;
      return result;
    }

    const index = load(indexRaw) as OntologyIndexFile;
    const artifactPath = (type: string): string | undefined =>
      index.artifacts.find((artifact) => artifact.type === type)?.path;

    const entitiesPath = artifactPath("entities");
    const relationshipsPath = artifactPath("relationships");
    const enumerationsPath = artifactPath("enumerations");
    const constraintsPath = artifactPath("constraints");
    if (
      entitiesPath === undefined ||
      relationshipsPath === undefined ||
      enumerationsPath === undefined ||
      constraintsPath === undefined
    ) {
      const result: OntologyResult<OntologyRelease> = {
        ok: false,
        failure: { code: "integrity_failure", message: "meta/ONTOLOGY_INDEX.yaml is missing a required artifact entry." },
      };
      this.#loadError = result;
      return result;
    }

    const metaDir = resolve(this.#repositoryRoot, "meta");
    let entitiesFile: OntologyEntitiesFile;
    let relationshipsFile: OntologyRelationshipsFile;
    let enumerationsFile: OntologyEnumerationsFile;
    let constraintsFile: OntologyConstraintsFile;
    try {
      [entitiesFile, relationshipsFile, enumerationsFile, constraintsFile] = await Promise.all([
        readYaml<OntologyEntitiesFile>(resolve(metaDir, entitiesPath)),
        readYaml<OntologyRelationshipsFile>(resolve(metaDir, relationshipsPath)),
        readYaml<OntologyEnumerationsFile>(resolve(metaDir, enumerationsPath)),
        readYaml<OntologyConstraintsFile>(resolve(metaDir, constraintsPath)),
      ]);
    } catch (cause) {
      const result: OntologyResult<OntologyRelease> = {
        ok: false,
        failure: { code: "unavailable_source", message: describeReadFailure("ontology/*.yaml", cause) },
      };
      this.#loadError = result;
      return result;
    }

    const versions = new Set([
      entitiesFile.ontology_version,
      relationshipsFile.ontology_version,
      enumerationsFile.ontology_version,
      constraintsFile.ontology_version,
    ]);
    if (versions.size !== 1) {
      const result: OntologyResult<OntologyRelease> = {
        ok: false,
        failure: {
          code: "integrity_failure",
          message: `ontology_version mismatch across ontology/*.yaml files: ${[...versions].join(", ")}.`,
        },
      };
      this.#loadError = result;
      return result;
    }

    const enumerations: OntologyEnumeration[] = Object.entries(enumerationsFile.enumerations).map(
      ([name, values]) => ({ name, values }),
    );

    const withoutDigest = {
      version: entitiesFile.ontology_version,
      entities: entitiesFile.entities,
      relationships: relationshipsFile.relationships,
      enumerations,
      constraints: constraintsFile.constraints,
    };
    const release: OntologyRelease = {
      ...withoutDigest,
      integrity_digest: `sha256:${createHash("sha256").update(stableStringify(withoutDigest)).digest("hex")}`,
    };

    this.#cached = release;
    return { ok: true, value: release };
  }
}

type OntologyIndexFile = Readonly<{ artifacts: readonly Readonly<{ type: string; path: string }>[] }>;
type OntologyEntitiesFile = Readonly<{ ontology_version: string; entities: readonly OntologyEntity[] }>;
type OntologyRelationshipsFile = Readonly<{ ontology_version: string; relationships: readonly OntologyRelationship[] }>;
type OntologyEnumerationsFile = Readonly<{ ontology_version: string; enumerations: Readonly<Record<string, readonly string[]>> }>;
type OntologyConstraintsFile = Readonly<{ ontology_version: string; constraints: readonly OntologyConstraint[] }>;

async function readYaml<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return load(raw) as T;
}

function describeReadFailure(what: string, cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `Could not read ${what}: ${detail}`;
}

function defaultRepositoryRoot(): string {
  // Compiles to dist/src/ontology/yaml-ontology-repository.js (tsconfig
  // rootDir "."); meta/ and ontology/ live at the actual repository root,
  // three levels above the compiled file's own directory.
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

