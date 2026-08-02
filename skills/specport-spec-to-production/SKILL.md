---
name: specport-spec-to-production
description: Take an accepted SpecPort product contract through bounded implementation, verification, final-tree coverage, human taste review, release-artifact validation, rollback rehearsal, and an evidence-backed ship receipt. Use when an AI coding agent must turn a human-approved contract into a mature, shippable product without self-approving or silently expanding scope.
---

# SpecPort: accepted contract to production

Use this skill only after a human has accepted a concrete product contract.
Treat the contract as the authority for scope and the repository as evidence,
not permission to invent requirements. Produce a traceable implementation and
release decision; do not imply that generated code, a green test, or a receipt
alone makes a product production-ready.

## Authority and outcome

- Keep intent, constraints, acceptance, taste, release, and ship authority
  human-owned.
- Treat `specport spec validate` as a structural contract check. A valid JSON
  contract is not proof that a human accepted it.
- Treat `specport spec check` as a SPEC.md readiness check. A draft or a
  structurally incomplete spec cannot authorize implementation.
- Keep network access, credentials, deployment, publication, and destructive
  recovery actions behind explicit owner authorization.
- Preserve pre-existing user changes. Do not reset, clean, overwrite, or
  publish them merely to make a gate look green.

Use these final statuses precisely:

- **BLOCKED**: a required gate failed, was skipped, is stale, or lacks
  evidence. Stop and name the exact resume condition.
- **SHIPPABLE**: every pre-ship gate passed, the artifact and rollback record
  exist, and the receipt is ready for the owner. This does not mean it is
  published or deployed.
- **SHIPPED**: the owner explicitly authorized the external action and the
  resulting publication or deployment was independently verified. Never infer
  this status from an attempted command.

## Evidence protocol

Create a new, non-overwriting evidence directory for each run, for example
`.specport/evidence/<run-id>/`. Use the repository's documented evidence
location when one exists. Keep disposable logs and tarballs there; commit them
only when the contract or owner requires durable release evidence. Record a
`gate-ledger.md` (or equivalent machine-readable record) with one row per gate:

```text
gate | status | owner | evidence | tree/artifact identity | recorded-at | next action
```

Use only `PASS`, `FAIL`, `BLOCKED`, `NOT-RUN`, or owner-authorized `N/A` as
gate statuses. A command that was skipped, run against another tree, or
produced an unreviewed artifact is not `PASS`. Include the exact command,
working directory, exit code, environment/tool versions, timestamp, and output
path for every automated check.

Capture these identities before editing and again before the receipt:

- contract path, contract version/id, and a SHA-256 digest of the accepted
  contract;
- repository path, remote, base ref/commit, current commit, and final-tree
  fingerprint;
- artifact name, version, path, checksum, and the commit/tree from which it
  was built;
- taste-review record identity and the human decision source.

If any of those identities cannot be established, mark the affected gate
`BLOCKED` rather than filling the field with a guess.

## Ordered gates

Run the gates in order. A failed required gate stops the run. If the contract,
source tree, dependency lockfile, toolchain, taste result, or release artifact
changes, invalidate that gate and every downstream gate and rerun them.

### G0. Contract, authority, and repository intake

1. Read repository-local instructions (`AGENTS.md`, contribution rules,
   security policy, and release notes) before editing.
2. Locate the accepted machine contract, normally
   `.specport/contract.json`, and run the installed, pinned SpecPort CLI:

   ```text
   specport spec validate .specport/contract.json --json
   ```

   Require exit code `0` and preserve the JSON result. Exit code `5`, a read
   error, or an unavailable CLI is `BLOCKED`; report the exact issue paths.
3. Extract and record `contractVersion`, `id`, `title`, intent owner/user
   job/outcome, non-goals, constraints, allowed and forbidden paths, every
   acceptance criterion and evidence requirement, every verification command,
   the taste reviewer/rubric, and release target/version/readiness/rollback.
4. Obtain an acceptance record that names the human approver, timestamp,
   decision source, and exact contract digest/ref. Do not infer acceptance
   from a valid schema, a chat message without a durable reference, or an
   agent's own summary.
5. Identify secrets, personal data, external services, permissions, migration
   risk, and network actions. Ask the owner before crossing an undeclared
   boundary.

   Record `G0 PASS` only when the contract is valid, accepted, identified, and
   its authority boundaries are understood.

### G1. Traceability and implementation plan

Create a plan that maps every contract item to implementation and evidence:

| Contract item | Planned files/systems | Risk and compatibility | Exact verification | Taste evidence | Rollback |
| --- | --- | --- | --- | --- | --- |
| `AC-...` | paths or service | data/security/user risk | command or fixture | reviewer task | recovery step |

Also list explicitly:

- allowed paths and forbidden paths;
- dependencies, migrations, feature flags, permissions, observability, and
  operational limits;
- non-goals that must not be implemented;
- unresolved decisions and the named owner who must answer them.

Do not start implementation while a mandatory decision, acceptance evidence,
release boundary, or rollback path is unresolved. Record the owner's decision
source when an ambiguity is intentionally accepted.

### G2. Bounded implementation

- Implement the smallest complete vertical slice that satisfies one or more
  criteria; keep each change traceable to the plan.
- Add or update regression tests, fixtures, migrations, documentation, and
  observability required by the contract. Do not use "production-ready" as a
  substitute for a missing criterion.
- Re-read affected files after each meaningful edit. Check the diff for scope
  expansion, accidental secrets, unsafe defaults, license issues, and generated
  files that do not belong in the release.
- Run the relevant local check after each slice, but label it interim evidence.
  Only the final candidate run in G3 can satisfy the verification gate.
- Preserve backward compatibility or record a deliberate breaking-change
  decision. For data changes, define deploy order, backup/restore behavior,
  idempotence, and forward recovery before calling the slice complete.

Record `G2 PASS` only when every in-scope criterion has an implementation
owner and no unapproved path, dependency, behavior, or requirement was added.

### G3. Verification on the final candidate

1. Freeze the candidate tree after the last implementation change. Run every
   exact command in `verification[]` in its declared environment; do not
   silently replace a command with a faster approximation.
2. Capture command, cwd, exit code, tool/runtime versions, test selection,
   logs, fixtures, and limitations. Include negative, edge, failure-recovery,
   security, accessibility, performance, and migration checks when the
   contract or risk profile requires them.
3. Mark a check `NOT-RUN` when it was skipped, unavailable, flaky without a
   recorded resolution, or run against a different commit. Do not convert it
   to `PASS` because another check succeeded.
4. Re-run the relevant checks after fixing any failure. Then prove that the
   final tree did not change during or after the last check. A test, formatter,
   code generator, or post-check hook that mutates the tree invalidates the
   corresponding evidence.

`G3 PASS` requires all required checks to pass against the same final-tree
identity and every acceptance criterion to point to observable evidence. A
build passing by itself is never sufficient.

### G4. Final-tree and scope coverage

Use an explicit comparison basis. Prefer an approved receiver:

```text
specport coverage --receiver githuman --review <review-id> --json --write <evidence-dir>/coverage.json
```

Otherwise use an owner-approved expected-scope file:

```text
specport coverage --expected-scope <approved-scope.json> --json --write <evidence-dir>/coverage.json
```

Pin the receiver review or scope to the same repository identity and base used
by the run. A plain `specport coverage --json` is useful inventory, but without
an explicit receiver or expected scope it cannot prove that the final tree is
the intended tree. Treat `complete` as required; `partial`, `unknown`, a
changed-after-review result, receiver exit `7`, or an unreviewed path is not a
pass.

Also capture `git status --short`, `git diff --check`, base/current commit,
and the final fingerprint. If the repository was already dirty, separate the
baseline from agent changes in a dedicated worktree or obtain an explicit
scope decision; do not claim coverage for changes the agent cannot identify.

`G4 PASS` means the final tree is stable, all changed paths are accounted for,
and the coverage evidence is tied to the exact candidate tested in G3.

### G5. Human taste and product-quality review

Give the named reviewer the actual candidate and the contract rubric. Ask the
reviewer to perform the real user job and record concrete observations:

- task and build/artifact/tree identity;
- each rubric item as pass, concern, or not applicable with a reason;
- usability, visual, audio, writing, accessibility, operational, and recovery
  observations appropriate to the product;
- defects, severity, screenshots/listening notes/logs/trace links as relevant;
- decision, reviewer identity, timestamp, and follow-up owner.

For UI, inspect the live flow; for audio, listen; for writing, read in
context; for operational software, exercise failure and recovery. Do not
substitute a screenshot, static analysis, model judgment, or "looks good" for
the named human review. If `taste.required` is false, record an explicit
owner-authorized `N/A` and reason; never silently omit the gate.

Any review finding that changes code, contract, data, dependencies, or
artifact inputs returns the run to G2 and invalidates G3 onward. Record `G5 PASS`
only when the required rubric is complete and the human decision is
acceptance (or an explicitly authorized exception with residual risk).

### G6. Release artifact and install/launch smoke

Build the artifact from the exact G4/G5 candidate. Do not use an artifact made
before the last source, dependency, or taste change. Verify the target-specific
install, launch, upgrade, compatibility, privacy, permissions, observability,
versioning, and documentation paths.

For npm, use the package's declared checks and the exact tarball:

```text
npm run verify:package
npm pack --dry-run
npm pack --pack-destination <evidence-dir>
```

Install that exact tarball into a fresh temporary consumer, run the published
binary and a representative command, and inspect the packed file list. Record
the package name/version, tarball path, checksum, install command, smoke
output, and source commit. Use `npm publish --dry-run` for a no-side-effect
publication check when appropriate. Do not publish or deploy until the owner
authorizes the external action; an OTP, permission, network, or registry
failure is `NOT-RUN`/`BLOCKED`, never a pass.

For other targets, use the real build, install, launch, upgrade, and deployment
or distribution path. A source checkout, preview, local dev server, or build
directory is not the release artifact unless the contract explicitly says so.

`G6 PASS` requires a reproducible artifact, checksum, clean-consumer or
target-environment smoke result, and a clear statement of what the smoke does
not prove.

### G7. Rollback and recovery rehearsal

Read the contract's rollback entries and turn them into an executable recovery
plan. Identify the last known-good version/ref, artifact, data backup or
forward-recovery strategy, owner, and health signal. Rehearse rollback in a
disposable or staging environment whenever the target permits it, then verify
the user-critical smoke path and data compatibility.

Record the exact artifact/ref restored, commands or runbook steps, observed
health, duration, data-loss boundary, and residual risk. For irreversible
migrations, prove the documented forward fix and backup recovery instead of
pretending that a downgrade is possible. Do not perform a destructive
production rollback without separate explicit authorization.

If rollback cannot be tested safely, mark the gate `BLOCKED` unless the owner
explicitly authorizes the limitation with a named recovery owner and residual
risk. A prose sentence saying "rollback is available" is not evidence.

### G8. Ship receipt and decision

Write the receipt only after G0-G7 have current evidence. Use this shape in
`<evidence-dir>/ship-receipt.md` (and mirror it in JSON when automation needs
to consume it):

```markdown
# SpecPort ship receipt

status: BLOCKED | SHIPPABLE | SHIPPED
run_id: <id>

## Contract
- path: <path>
- id/version: <id> / <version>
- sha256: <digest>
- accepted_by / accepted_at / decision_source: <...>

## Repository
- remote: <remote>
- base: <ref and commit>
- final_commit / final_tree_fingerprint: <...>

## Gates
| Gate | Status | Evidence | Identity | Notes |
| G0 contract and authority | PASS/BLOCKED/... | <path> | <digest> | <...> |
| G1 traceability and plan | PASS/BLOCKED/... | <path> | <commit> | <...> |
| G2 implementation | PASS/BLOCKED/... | <path> | <commit> | <...> |
| G3 verification | PASS/BLOCKED/... | <path> | <commit> | <...> |
| G4 final-tree coverage | PASS/BLOCKED/... | <path> | <fingerprint> | <...> |
| G5 taste review | PASS/BLOCKED/... | <path> | <artifact/tree> | <...> |
| G6 release artifact | PASS/BLOCKED/... | <path> | <checksum> | <...> |
| G7 rollback | PASS/BLOCKED/... | <path> | <ref/artifact> | <...> |

## Acceptance and verification
- criteria: <each AC id mapped to evidence>
- checks: <command, exit code, environment, limitations>

## Artifact
- target/name/version/path/checksum: <...>
- clean-consumer or target smoke: <result>

## Rollback
- last known good: <ref/version/artifact>
- recovery evidence: <path>
- residual risk and owner: <...>

## Ship decision
- owner: <human>
- decision: hold | approve | publish/deploy
- external action: not-run | verified <where/how>
- recorded_at: <timestamp>

## Limitations and next actions
- <explicit unresolved item, or `none`>
```

Set `BLOCKED` when any required gate is not `PASS` or owner-authorized `N/A`.
Set `SHIPPABLE` when all pre-ship evidence is current but the external action
has not been verified. Set `SHIPPED` only after the owner decision and an
independent observable confirms the registry, deployment, or distribution
result. Preserve the receipt; never rewrite a failed run into a green one.

## Failure and resume protocol

When a gate blocks, return:

```text
STATUS: BLOCKED
GATE: G<number> <name>
EVIDENCE: <exact artifact or command output>
REASON: <fact, not a guess>
OWNER DECISION NEEDED: <specific question or authorization>
RESUME WHEN: <observable condition>
```

Resume from the blocked gate, but rerun every downstream gate. Start a new
run ID when the contract changes, the owner changes the rubric or release
target, the final tree cannot be identified, or a new artifact is produced.

## Current SpecPort CLI boundary

Use the current CLI for evidence, not for capabilities it does not yet ship:

- `specport spec validate <contract.json> [--json]` validates the structured
  product contract and exits `5` when invalid.
- `specport spec check <SPEC.md> [--json]` reports draft/readiness issues and
  exits `5` when not ready.
- `specport coverage ... [--json]` compares the final Git-visible tree with an
  explicit receiver or expected scope; it does not run tests or provide taste
  approval.
- `specport spec discover` observes a repository baseline; it does not infer
  product intent or acceptance.

Do not describe roadmap verbs such as `pull`, `cover`, `remix`, or `build` as
implemented CLI behavior unless the installed version's help and runtime
prove them. Use the host agent's bounded coding tools for implementation and
the commands above for the evidence surfaces they actually provide.
