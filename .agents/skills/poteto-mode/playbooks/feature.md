### Feature

The main agent owns design, implementation, and integration. Research, review, and verification may use limited read-only help under the runtime contract.

1. Read the affected feature groups and identify existing or new `F-` codes under the [feature compatibility contract](../references/codex-tools.md#lookout-feature-compatibility). Use `how` to understand the affected subsystem. Read and explain it directly by default.
2. Use `architect` when the change needs a design decision. Compare alternatives yourself; request a bounded research or critique pass only if it adds value.
3. Plan small verifiable units. Identify dependencies, the data shape and its owner, shared mutable state, and the checks that establish success. Include prerequisite and consumer feature codes, required wiring, and their acceptance checks in the plan. Multiple files do not require multiple agents.
4. Implement each unit yourself. Include source, tests, configuration, and docs. Use surgical edits and re-ground upstream-derived changes against their source. Update every affected consumer of a shared primitive and the affected feature records in the same PR. Do not delegate code-writing or run implementation candidates through arena.
5. Verify affected feature contracts and consumers on the matching surface. Run `pnpm check:features` and keep missing integration or evidence explicit in the records. A verification helper may run checks and return evidence, but you fix failures. Inconclusive or wrong-surface evidence is not a pass.
6. Review the diff and keep units ordered. Use an independent reviewer only when useful or explicitly required; reviewers return findings and you apply accepted fixes.
7. Resolve contested design arguments before shipping. Add a focused critique only when it would change the decision.
8. Run **Opening a PR** only within the user's authorized scope.

**Reply:** what you built, the important design choices, verification evidence, and any unresolved decisions.
