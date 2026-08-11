# Architecture Rules

Canonical direction:

```text
Foundation → Knowledge → Product → Architecture → Interfaces → Components → Runtime → Implementation
```

- Ontology precedes schemas.
- Interfaces precede implementing components.
- Core depends on contracts, never plugin implementations.
- Knowledge is versioned and provenance-bearing.
- Rule Engine precedes bounded AI reasoning.
- Semantic UI and the UI Knowledge Graph remain independent of raw DOM and selectors.
- Discovery precedes user questioning.
- Learning produces candidates, not authority.
- Agent working context is ephemeral; reusable facts enter the Knowledge Candidate lifecycle.
- A Skill owns a reusable procedure; a Plugin owns technology adaptation; a Tool exposes a governed action contract.
- Agent Runtime and Evaluation Engine are deep modules behind SPEC-508 and SPEC-511.
- Production adapters and deterministic fake/replay adapters use the same contract tests.
