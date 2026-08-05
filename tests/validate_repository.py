from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[1]
DOWNSTREAM = {"knowledge", "product", "architecture", "interfaces", "components", "runtime"}
SPEC_FRONT_MATTER = {"id", "title", "version", "status", "owner", "depends_on", "related_adrs", "last_updated"}
ADR_FRONT_MATTER = {"id", "title", "version", "status", "date", "decision_owners", "related_specs", "related_adrs", "supersedes", "superseded_by"}
GOVERNANCE_FRONT_MATTER = {"id", "title", "version", "status", "owner", "depends_on", "related_adrs", "last_updated"}


def load_front_matter(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not match:
        raise ValueError("missing YAML front matter")
    data = yaml.safe_load(match.group(1))
    if not isinstance(data, dict):
        raise ValueError("front matter is not an object")
    return data


def resolve_local_ref(schema: dict[str, Any], reference: str) -> dict[str, Any]:
    if not reference.startswith("#/"):
        raise ValueError(f"external schema reference is not supported by subset validator: {reference}")
    node: Any = schema
    for segment in reference[2:].split("/"):
        node = node[segment.replace("~1", "/").replace("~0", "~")]
    return node


def matches_type(value: Any, expected: str) -> bool:
    return {
        "object": isinstance(value, dict),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "boolean": isinstance(value, bool),
        "null": value is None,
    }[expected]


def validate_subset(value: Any, rule: dict[str, Any], root_schema: dict[str, Any], location: str = "$") -> list[str]:
    errors: list[str] = []
    if "$ref" in rule:
        return validate_subset(value, resolve_local_ref(root_schema, rule["$ref"]), root_schema, location)
    expected = rule.get("type")
    if expected:
        options = expected if isinstance(expected, list) else [expected]
        if not any(matches_type(value, option) for option in options):
            return [f"{location}: expected {expected}, got {type(value).__name__}"]
    if "enum" in rule and value not in rule["enum"]:
        errors.append(f"{location}: value is outside enum")
    if "const" in rule and value != rule["const"]:
        errors.append(f"{location}: value does not equal const")
    if isinstance(value, str):
        if len(value) < rule.get("minLength", 0):
            errors.append(f"{location}: string is too short")
        if "pattern" in rule and re.fullmatch(rule["pattern"], value) is None:
            errors.append(f"{location}: string does not match pattern")
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value < rule.get("minimum", value):
        errors.append(f"{location}: value is below minimum")
    if isinstance(value, list):
        if len(value) < rule.get("minItems", 0):
            errors.append(f"{location}: array has too few items")
        if "items" in rule:
            for index, item in enumerate(value):
                errors.extend(validate_subset(item, rule["items"], root_schema, f"{location}[{index}]"))
    if isinstance(value, dict):
        required = rule.get("required", [])
        for key in required:
            if key not in value:
                errors.append(f"{location}: missing required property {key}")
        properties = rule.get("properties", {})
        if rule.get("additionalProperties") is False:
            for key in value.keys() - properties.keys():
                errors.append(f"{location}: unexpected property {key}")
        if len(value) < rule.get("minProperties", 0):
            errors.append(f"{location}: object has too few properties")
        for key, child_rule in properties.items():
            if key in value:
                errors.extend(validate_subset(value[key], child_rule, root_schema, f"{location}.{key}"))
    return errors


def main() -> int:
    failures: list[str] = []
    yaml_count = 0
    json_count = 0

    for path in sorted(path for path in ROOT.rglob("*.yaml") if "node_modules" not in path.parts and ".git" not in path.parts):
        try:
            yaml.safe_load(path.read_text(encoding="utf-8"))
            yaml_count += 1
        except Exception as error:
            failures.append(f"YAML {path.relative_to(ROOT)}: {error}")

    for path in sorted(path for path in ROOT.rglob("*.json") if "node_modules" not in path.parts and ".git" not in path.parts):
        try:
            json.loads(path.read_text(encoding="utf-8"))
            json_count += 1
        except Exception as error:
            failures.append(f"JSON {path.relative_to(ROOT)}: {error}")

    governed_paths = sorted((ROOT / "specs").rglob("SPEC-*.md")) + sorted((ROOT / "adr").glob("ADR-*.md")) + sorted((ROOT / "governance").glob("*.md"))
    governed_paths = [path for path in governed_paths if path.name != "README.md"]
    metadata: dict[Path, dict[str, Any]] = {}
    for path in governed_paths:
        try:
            data = load_front_matter(path)
            metadata[path] = data
            if path.parent.name == "adr":
                required = ADR_FRONT_MATTER
            elif path.parent.name == "governance":
                required = GOVERNANCE_FRONT_MATTER
            else:
                required = SPEC_FRONT_MATTER
            missing = required - data.keys()
            if missing:
                failures.append(f"metadata {path.relative_to(ROOT)}: missing {sorted(missing)}")
        except Exception as error:
            failures.append(f"metadata {path.relative_to(ROOT)}: {error}")

    ids = [data.get("id") for data in metadata.values() if data.get("id")]
    duplicates = sorted(key for key, count in Counter(ids).items() if count > 1)
    if duplicates:
        failures.append(f"duplicate governed IDs: {duplicates}")

    all_ids = set(ids)
    governed_graph: dict[str, list[str]] = {}
    for path, data in metadata.items():
        artifact_id = data["id"]
        dependencies = data.get("depends_on", []) or []
        governed_graph[artifact_id] = [dependency for dependency in dependencies if dependency in all_ids]
        references = list(dependencies) + list(data.get("related_adrs", []) or []) + list(data.get("related_specs", []) or [])
        unresolved = sorted({reference for reference in references if re.fullmatch(r"(?:SPEC|ADR|GOV)-[0-9]+", str(reference)) and reference not in all_ids})
        if unresolved:
            failures.append(f"governed references {path.relative_to(ROOT)}: unresolved {unresolved}")
        if artifact_id in references:
            failures.append(f"governed references {path.relative_to(ROOT)}: self reference {artifact_id}")
        if data.get("status") == "accepted":
            unaccepted_dependencies = sorted(
                dependency
                for dependency in dependencies
                if dependency in all_ids
                and next((candidate.get("status") for candidate in metadata.values() if candidate.get("id") == dependency), None) != "accepted"
            )
            if unaccepted_dependencies:
                failures.append(f"authority {path.relative_to(ROOT)}: accepted artifact depends on non-accepted {unaccepted_dependencies}")

    spec_metadata = {data["id"]: (path, data) for path, data in metadata.items() if str(data.get("id", "")).startswith("SPEC-")}
    graph: dict[str, list[str]] = {}
    for spec_id, (path, data) in spec_metadata.items():
        dependencies = [dependency for dependency in data.get("depends_on", []) if str(dependency).startswith("SPEC-")]
        graph[spec_id] = dependencies
        unresolved = sorted(set(dependencies) - spec_metadata.keys())
        if unresolved:
            failures.append(f"dependencies {path.relative_to(ROOT)}: unresolved {unresolved}")

    readiness = yaml.safe_load((ROOT / "meta/SPEC_READINESS.yaml").read_text(encoding="utf-8"))
    readiness_families = readiness.get("families", {})
    for family_name in DOWNSTREAM:
        family = readiness_families.get(family_name)
        if not isinstance(family, dict):
            failures.append(f"readiness: missing family {family_name}")
            continue
        expected_status = family.get("status")
        if expected_status not in {"draft", "accepted"}:
            failures.append(f"readiness {family_name}: unsupported status {expected_status}")
            continue
        family_specs = {
            spec_id: data
            for spec_id, (path, data) in spec_metadata.items()
            if path.parent.name == family_name
        }
        if not family_specs:
            failures.append(f"readiness {family_name}: no specifications found")
            continue
        mismatches = sorted(
            spec_id
            for spec_id, data in family_specs.items()
            if data.get("status") != expected_status
        )
        if mismatches:
            failures.append(
                f"readiness {family_name}: expected all specifications to be {expected_status}; mismatched {mismatches}"
            )
        if expected_status == "accepted" and not family.get("approval_evidence"):
            failures.append(f"readiness {family_name}: accepted family lacks approval_evidence")

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node: str, trail: list[str]) -> None:
        if node in visiting:
            failures.append(f"dependency cycle: {' -> '.join(trail + [node])}")
            return
        if node in visited:
            return
        visiting.add(node)
        for dependency in graph.get(node, []):
            visit(dependency, trail + [node])
        visiting.remove(node)
        visited.add(node)

    for spec_id in graph:
        visit(spec_id, [])

    visiting.clear()
    visited.clear()
    graph = governed_graph
    for artifact_id in graph:
        visit(artifact_id, [])

    spec_index = yaml.safe_load((ROOT / "meta/SPEC_INDEX.yaml").read_text(encoding="utf-8"))
    indexed_specs = {}
    for family in spec_index["artifacts"].values():
        for item in family:
            indexed_specs[item["id"]] = item
            indexed_path = (ROOT / "meta" / item["path"]).resolve()
            if not indexed_path.exists():
                failures.append(f"spec index missing path: {item['path']}")
    if set(indexed_specs) != set(spec_metadata):
        failures.append(f"spec index mismatch: missing={sorted(set(spec_metadata) - set(indexed_specs))}, extra={sorted(set(indexed_specs) - set(spec_metadata))}")
    for spec_id, (_, data) in spec_metadata.items():
        if indexed_specs.get(spec_id, {}).get("status") != data.get("status"):
            failures.append(f"spec index status mismatch: {spec_id}")

    adr_index = yaml.safe_load((ROOT / "meta/ADR_INDEX.yaml").read_text(encoding="utf-8"))
    indexed_adrs = {item["id"]: item for item in adr_index["artifacts"]}
    actual_adrs = {data["id"]: (path, data) for path, data in metadata.items() if str(data.get("id", "")).startswith("ADR-")}
    if set(indexed_adrs) != set(actual_adrs):
        failures.append(f"ADR index mismatch: missing={sorted(set(actual_adrs) - set(indexed_adrs))}, extra={sorted(set(indexed_adrs) - set(actual_adrs))}")
    for adr_id, (path, data) in actual_adrs.items():
        item = indexed_adrs.get(adr_id, {})
        if item.get("status") != data.get("status"):
            failures.append(f"ADR index status mismatch: {adr_id}")
        if item and (ROOT / "meta" / item["path"]).resolve() != path.resolve():
            failures.append(f"ADR index path mismatch: {adr_id}")

    for index_name in ["SCHEMA_INDEX.yaml", "PLAYBOOK_INDEX.yaml", "ONTOLOGY_INDEX.yaml"]:
        index_data = yaml.safe_load((ROOT / "meta" / index_name).read_text(encoding="utf-8"))
        if index_data.get("status") != "accepted":
            failures.append(f"{index_name} is not accepted")
        serialized = json.dumps(index_data, default=str)
        for relative in re.findall(r'\.\./[^"} ,]+', serialized):
            if not (ROOT / "meta" / relative).resolve().exists():
                failures.append(f"{index_name} missing path: {relative}")

    rule_index = yaml.safe_load((ROOT / "meta/RULE_INDEX.yaml").read_text(encoding="utf-8"))
    if rule_index.get("status") != "accepted":
        failures.append("RULE_INDEX.yaml is not accepted")
    for item in rule_index.get("rule_sets", []):
        rule_path = (ROOT / "meta" / item["path"]).resolve()
        if not rule_path.exists():
            failures.append(f"RULE_INDEX.yaml missing path: {item['path']}")
            continue
        rule_data = yaml.safe_load(rule_path.read_text(encoding="utf-8"))
        if rule_data.get("rule_set", {}).get("status") != "accepted":
            failures.append(f"rule set is not accepted: {rule_path.relative_to(ROOT)}")

    ontology_index = yaml.safe_load((ROOT / "meta/ONTOLOGY_INDEX.yaml").read_text(encoding="utf-8"))
    for item in ontology_index.get("artifacts", []):
        if item.get("type") == "overview":
            continue
        ontology_path = (ROOT / "meta" / item["path"]).resolve()
        ontology_data = yaml.safe_load(ontology_path.read_text(encoding="utf-8"))
        if ontology_data.get("status") != "accepted":
            failures.append(f"ontology artifact is not accepted: {ontology_path.relative_to(ROOT)}")

    repository_graph = yaml.safe_load((ROOT / "meta/REPOSITORY_GRAPH.yaml").read_text(encoding="utf-8"))
    if repository_graph.get("status") != "accepted":
        failures.append("repository graph is not accepted")
    critical_edges = repository_graph.get("critical_edges", [])
    graph_edge_keys: set[tuple[str, str, str]] = set()
    graph_nodes: set[str] = set()
    for edge in critical_edges:
        source = edge.get("from")
        relationship = edge.get("relationship")
        target = edge.get("to")
        key = (source, relationship, target)
        if key in graph_edge_keys:
            failures.append(f"repository graph duplicate edge: {key}")
        graph_edge_keys.add(key)
        for node in (source, target):
            if node not in all_ids:
                failures.append(f"repository graph unresolved target: {node}")
            else:
                graph_nodes.add(node)
    critical_graph: dict[str, list[str]] = {node: [] for node in graph_nodes}
    for source, _, target in graph_edge_keys:
        if source in graph_nodes and target in graph_nodes:
            critical_graph[source].append(target)
    visiting.clear()
    visited.clear()
    graph = critical_graph
    for artifact_id in graph:
        visit(artifact_id, [])

    schema_index = yaml.safe_load((ROOT / "meta/SCHEMA_INDEX.yaml").read_text(encoding="utf-8"))
    indexed_schema_paths = {(ROOT / "meta" / path).resolve() for path in schema_index["artifacts"]}
    actual_schema_paths = {path.resolve() for path in (ROOT / "schemas").glob("*.json")}
    if indexed_schema_paths != actual_schema_paths:
        failures.append("schema index does not exactly match schemas/*.json")

    playbook_index = yaml.safe_load((ROOT / "meta/PLAYBOOK_INDEX.yaml").read_text(encoding="utf-8"))
    indexed_playbook_paths = {(ROOT / "meta" / item["path"]).resolve() for item in playbook_index["playbooks"]}
    actual_playbook_paths = {path.resolve() for path in (ROOT / "playbooks").glob("PB-*.md")}
    if indexed_playbook_paths != actual_playbook_paths:
        failures.append("playbook index does not exactly match playbooks/PB-*.md")

    manifest = yaml.safe_load((ROOT / "MANIFEST.yaml").read_text(encoding="utf-8"))
    expected_counts = {
        "foundation_specs": len(list((ROOT / "specs/foundation").glob("SPEC-*.md"))),
        "knowledge_specs": len(list((ROOT / "specs/knowledge").glob("SPEC-*.md"))),
        "product_specs": len(list((ROOT / "specs/product").glob("SPEC-*.md"))),
        "architecture_specs": len(list((ROOT / "specs/architecture").glob("SPEC-*.md"))),
        "component_specs": len(list((ROOT / "specs/components").glob("SPEC-*.md"))),
        "interface_specs": len(list((ROOT / "specs/interfaces").glob("SPEC-*.md"))),
        "runtime_specs": len(list((ROOT / "specs/runtime").glob("SPEC-*.md"))),
        "architecture_decisions": len(list((ROOT / "adr").glob("ADR-*.md"))),
        "governance_documents": len([path for path in (ROOT / "governance").glob("*.md") if path.name != "README.md"]),
    }
    for key, expected in expected_counts.items():
        if manifest["counts"].get(key) != expected:
            failures.append(f"manifest count {key}: expected {expected}, got {manifest['counts'].get(key)}")

    example_pairs = {
        "examples/agents/requirement-review-agent.example.json": "schemas/agent-definition.schema.json",
        "examples/skills/assess-requirement-quality.example.json": "schemas/skill-definition.schema.json",
        "examples/evaluations/skill-core-suite.example.json": "schemas/evaluation-suite.schema.json",
        "examples/evaluations/skill-negative-trigger.example.json": "schemas/evaluation-case.schema.json",
    }
    for example_name, schema_name in example_pairs.items():
        instance = json.loads((ROOT / example_name).read_text(encoding="utf-8"))
        schema = json.loads((ROOT / schema_name).read_text(encoding="utf-8"))
        failures.extend(f"schema {example_name}: {error}" for error in validate_subset(instance, schema, schema))

    invalid_example_pairs = {
        "examples/invalid/agent-definition.invalid.json": "schemas/agent-definition.schema.json",
        "examples/invalid/skill-definition.invalid.json": "schemas/skill-definition.schema.json",
        "examples/invalid/evaluation-suite.invalid.json": "schemas/evaluation-suite.schema.json",
        "examples/invalid/evaluation-case.invalid.json": "schemas/evaluation-case.schema.json",
    }
    for example_name, schema_name in invalid_example_pairs.items():
        instance = json.loads((ROOT / example_name).read_text(encoding="utf-8"))
        schema = json.loads((ROOT / schema_name).read_text(encoding="utf-8"))
        if not validate_subset(instance, schema, schema):
            failures.append(f"negative schema example unexpectedly passed: {example_name}")

    # GOV-012 §Minimum Definition of Ready to Implement / PB-011 / PB-012:
    # an executable Agent or Skill package may only live under agents/ or
    # skills/ once at least one GOV-012 gate record exists for it. This does
    # not evaluate whether the gates pass, or match a specific package to a
    # specific record — that judgment stays in governance/reviews/ — it only
    # blocks a promoted package from existing with zero linked gate evidence
    # anywhere in the repository.
    gate_records = sorted((ROOT / "governance" / "reviews").rglob("GOV-012_GATE_RECORD.yaml"))
    gate_subject_stems: set[str] = set()
    for gate_path in gate_records:
        gate_data = yaml.safe_load(gate_path.read_text(encoding="utf-8")) or {}
        if gate_data.get("status") not in {"in_progress", "approved", "pass"}:
            failures.append(f"gate record {gate_path.relative_to(ROOT)}: missing or unrecognized status")
        subject = gate_data.get("subject")
        if not isinstance(subject, dict):
            failures.append(f"gate record {gate_path.relative_to(ROOT)}: missing subject")
            continue
        for value in subject.values():
            if isinstance(value, str):
                # "requirement-review-agent@0.1.0" -> "requirement-review-agent"
                gate_subject_stems.add(value.split("@", 1)[0])

    for promotion_root in ("agents", "skills"):
        for path in sorted((ROOT / promotion_root).glob("*")):
            if not path.is_file() or path.name == "README.md":
                continue
            stem = path.stem
            if stem not in gate_subject_stems:
                failures.append(
                    f"promotion {path.relative_to(ROOT)}: no GOV-012_GATE_RECORD.yaml subject matches "
                    f"'{stem}' (known gate subjects: {sorted(gate_subject_stems) or 'none'})"
                )

    report = {
        "outcome": "pass" if not failures else "fail",
        "yaml_files": yaml_count,
        "json_files": json_count,
        "governed_artifacts": len(metadata),
        "specifications": len(spec_metadata),
        "downstream_specifications": sum(1 for path, _ in metadata.items() if path.parent.name in DOWNSTREAM),
        "accepted_spec_families": sorted(
            name for name, family in readiness_families.items() if family.get("status") == "accepted"
        ),
        "repository_graph_edges": len(graph_edge_keys),
        "valid_examples_validated": len(example_pairs),
        "invalid_examples_rejected": len(invalid_example_pairs),
        "failures": failures,
    }
    print(json.dumps(report, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
