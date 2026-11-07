# Lookout feature map

This directory records Lookout product capabilities and the contracts that changes must preserve. It includes planned and implemented behavior. Oracle, the coding harness, deployment tasks, and submission logistics are outside its feature inventory. The PRD owns product intent; the roadmap owns delivery planning. These records connect that intent to code and verification.

Each `F-*.md` file is one feature. Codes contain uppercase words separated by hyphens, such as `F-AUTH-ACCESS`. Codes are stable references, not sequence numbers or issue IDs. Do not rename a code when a title changes or reuse a retired code.

## Find affected features

Records are grouped by product area:

- `application/` contains the application entry and identity/access features.
- `monitoring/` contains sources, rules, assessment, device health, and live viewing.
- `response/` contains incident handling and saved evidence replay.
- `notifications/` contains incoming alerts, background push, and escalation.
- `integrations/` contains external product interfaces such as MCP.

Read one area in a single call, for example `cat docs/features/monitoring/F-*.md`. Read the complete map with `cat docs/features/*/F-*.md`. Follow dependency codes across groups when a change crosses a boundary. Folders organize reading; feature codes remain globally unique and independent of their location.

Use `rg --files docs/features` to discover records. The existing `pnpm features:list` command also lists every code, status, title, and path. No checked-in central feature index needs updating when a feature is added.

Search by capability with `rg -n 'acknowledge|replay' docs/features`. Search a code with `rg -n 'F-INCIDENT-RESPONSE' docs/features` to find its record and consumers. Read both dependencies and reverse references before changing a shared contract. Dependencies name prerequisite contracts, not every runtime interaction; the wiring section describes the remaining connections.

The initial inventory comes from the current source, PRD, DESIGN, and service roadmap. The home/fallback scaffold is implemented. Product monitoring features remain planned. Roadmap issue links identify delivery work, not verified completion. Historical PR decisions not reflected in these sources still need reconciliation when discovered.

## Maintain a feature

Before implementing an issue or PR, identify affected codes and read their behavior, wiring, source locations, and verification requirements. Record the codes in the issue when creating or updating one within authorized scope, and in the PR description. Existing issue numbers remain valid delivery references.

For a new capability, add one descriptive code and file in the appropriate product-area folder in the same PR as its first decision or implementation. Use an existing record for a bug fix, refactor, or sub-behavior that belongs to the same capability. Split a record only when the behavior has an independently meaningful contract.

Every feature file has these fields and sections:

- A title starting with its filename code, followed by a colon and a descriptive title.
- `Status: planned`, `partial`, `implemented`, or `retired`.
- `Depends on: none` or a comma-separated list of existing feature codes.
- `## Behavior` states the user outcome and invariants.
- `## Entry points` states how a user or caller reaches it.
- `## Wiring and compatibility` names the producers, consumers, shared state, permissions, and failure behavior that must agree.
- `## Implementation` links to actual source files. For planned work, explicitly say it is not implemented. For partial work, distinguish completed behavior from missing connections.
- `## Verification` names repeatable journeys, success and failure cases, and actual test links or recorded evidence. Label unexecuted checks as requirements, not results.
- `## Decisions and sources` links the deciding PR, issue, or product document. Before a new PR URL exists, describe the decision and say it is introduced by the current PR; add the URL once available when useful. Never invent a URL.
- `## Open questions` records material gaps, or says none.

Update the record whenever behavior, implementation locations, dependencies, or verification changes. Before marking a feature implemented, complete its required connections and verification. If a prerequisite is missing, use partial status and name the missing connection. A component, endpoint, fixture, or passing build alone does not establish a working feature.

When changing a contract, update and verify affected consumers in the same PR or explicitly retain partial status and document the gap. Deliberate behavior changes must state the replaced expectation and decision source. Retire removed features in place and describe their replacement or removal; preserve the code so old issues remain understandable.

## Keep parallel PRs independent

Add or edit only the relevant feature files. Do not maintain a shared counter, generated registry, global changelog, or duplicated dependency lists on both ends of an edge. Each consumer owns its prerequisite references. Find reverse references by searching the directory.

Keep each record about its current contract. Put chronological work logs, full test output, and per-commit evidence in the PR. Update source or verification references when they change, not on every unrelated PR. Two changes to the same behavior may still conflict; reconcile their intended behavior and rerun affected checks rather than accepting one side blindly.

## Validate the map

`pnpm check:features` validates globally unique filename codes, title identity, statuses, required nonempty sections, dependency references, and local Markdown link targets. Implemented records must link source and verification evidence. Integration tests exercise the checker against temporary repositories. `pnpm verify` runs both checks in CI.

This validation does not prove completeness, correctness of prose, compatibility, or a successful user journey. The implementing agent must identify affected features and perform the integration and browser verification required by [the verification guide](../verification.md). A PR with no feature impact must explain why in its feature-impact section.
