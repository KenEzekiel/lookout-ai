## Why

Describe the problem and resulting behavior.

If this PR completes a tracked issue, add `Closes #N` with the issue number. Add a separate closing reference for each completed issue. Use `Related to #N` for partial work. Omit this line when no issue is associated with the work.

## Feature impact

List affected `F-` codes and link their records in `docs/features/`. For no Lookout feature impact, explain why.

Describe new or changed behavior and decisions captured in those records. Name dependencies and consumers checked, connections completed, and any remaining integration gaps. Keep incomplete features marked partial.

## Validation

Record relevant automated checks and results.

### Manual QA

For frontend journeys, use the structure below and follow `docs/verification.md`. Otherwise, state why manual browser QA does not apply. Keep each bullet short and report one check per item.

#### Setup

- Build or commit tested:
- Runtime, browser, and viewport:
- Test accounts, services, and mocks:

#### Steps and results

- Action or scenario. Expected result. Observed result.
- Relevant error or recovery check. Expected result. Observed result.

#### Evidence

- Embed screenshots from the manual QA run with captions identifying the step or state and observed result.
- Embed or link a demo video when screenshots cannot adequately show the behavior.
- Upload GitHub PR attachments from ignored or temporary files. Do not commit QA media or use raw repository URLs. Verify that each attachment opens from the saved description.

#### Gaps and blockers

- List unverified behavior and blocked verification, capture, or publication, or state none. Keep the PR in draft for required verification gaps unless the user explicitly waives them.
