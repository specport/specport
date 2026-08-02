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
only when the contract or owner requires durable release evidence. Start
`gate-ledger.md` from `references/gate-ledger.template.md`, start the taste
record from `references/taste-review.template.md`, and start the ship receipt
from `references/ship-receipt.template.md` (or use equivalent machine-readable
records). Keep one row per gate:

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

## CLI resolution and pinning

Record the exact SpecPort version before G0. For a published dependency, install
the requested version explicitly and invoke the local binary through the
project installation:

```text
npm install --save-dev --exact @specport/specport@<version>
npx --no-install specport --version
```

For a SpecPort checkout, use `npm ci`, `npm run build`, and
`node dist/cli.js --version`. Do not silently fall back to an unpinned global
binary. If the target repository is not SpecPort and has no
`verify:package` script, run the exact commands declared by its accepted
contract instead and record that fallback as the target's G3/G6 evidence.

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

Start the taste record from `references/taste-review.template.md`. For UI,
inspect the live flow; for audio, listen; for writing, read in
context; for operational software, exercise failure and recovery. Do not
substitute a screenshot, static analysis, model judgment, or "looks good" for
the named human review. If `taste.required` is false, record an explicit
owner-authorized `N/A` and reason; never silently omit the gate.

Any review finding that changes code, contract, data, dependencies, or
artifact inputs returns the run to G2 and invalidates G3 onward. Record `G5 PASS`
only when the required rubric is complete and the human decision is
acceptance (or an explicitly authorized exception with residual risk).

### Merge guard: bind the evidence to one candidate

Once the accepted contract, acceptance record, verification evidence, taste
record, and candidate `SPEC.lock` exist, compose the machine guard receipt:

```text
specport spec guard . \
  --spec SPEC.md \
  --contract .specport/contract.json \
  --acceptance-record .specport/evidence/contract-acceptance.json \
  --verification .specport/evidence/verification.json \
  --taste .specport/evidence/taste.json \
  --lock SPEC.lock \
  --expected-scope .specport/evidence/approved-scope.json \
  --write .specport/evidence/guard.json \
  --json
```

The receiver form is equivalent when a pinned review is the approval object:
`--receiver githuman --review <review-id>` can replace `--expected-scope`.
The scope or receiver is mandatory; an inventory-only scan can never become a
merge-ready result. Verification and taste records must carry the repository
identity, base commit, final-tree fingerprint, and contract digest. Use
`references/verification-evidence.template.json` and
`references/taste-review.template.json` as starting shapes.

`spec guard` does not execute repository code, run a check, approve a product,
or publish/deploy anything. Exit `0` with `verdict: merge-ready` means the
exact candidate is covered and its supplied evidence is identity-bound; it
still requires the separate release, rollback, and human ship decisions. Exit
`5` is a hold for missing, stale, mismatched, or failed evidence.

### G6. Release artifact and install/launch smoke

Build the artifact from the exact G4/G5 candidate. Do not use an artifact made
before the last source, dependency, or taste change. Verify the target-specific
install, launch, upgrade, compatibility, privacy, permissions, observability,
versioning, and documentation paths.

For npm, use the package's declared checks and the exact tarball. When the
package declares `verify:package`, run it before packing:

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

Write the receipt only after G0-G7 have current evidence. Start from
`references/ship-receipt.template.md` and save it as
`<evidence-dir>/ship-receipt.md` (mirror it in JSON when automation needs to
consume it):

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
- `specport spec guard [path] --spec SPEC.md --contract FILE
  --acceptance-record FILE --verification FILE --lock SPEC.lock` composes a
  fail-closed, identity-bound merge guard. Supply `--taste FILE` when the
  contract requires taste review and either `--expected-scope FILE` or a
  pinned GitHuman receiver. It consumes evidence and does not execute project
  code or grant ship authority.
- `specport spec discover` observes a repository baseline; it does not infer
  product intent or acceptance.
- `specport spec bundle` composes the repository baseline, bounded map,
  draft-only `SPEC.md`, evidence ledger, structural check, and packet manifest
  in one read-only pass; exit `5` is expected until the human contract is
  accepted.
- `specport spec lock SPEC.md --out SPEC.lock` records the spec and supporting
  artifact fingerprints for a reproducible handoff. `specport spec drift
  SPEC.md --lock SPEC.lock --json` is a useful pre-implementation and
  pre-receipt hold gate; `clean` means the inputs match, not that they are
  accepted, tested, tasteful, secure, or shippable.
- `specport spec map [path] [--json]` creates a read-only bounded static map of
  files, simple symbols, local imports, and explicit surfaces. Inferred edges
  and all scan limits/unknowns remain labeled; it does not prove runtime
  behavior, security, taste, or product intent.
- `specport pull <owner/repo@ref[:path]> [--out SPEC.md]` fetches one GitHub
  file from a repository with a declared license at a resolved commit, writes a
  provenance receipt when requested, and executes no repository code. Treat
  that license as a matched source declaration, not independent legal proof.
- `specport spec cover <SPEC.md> --target <repo> --target-stack <stack>` creates
  a lineage-aware target-assessment and implementation plan. A `ready` result
  means the source license, accepted spec, contract, and bounded target map
  passed; it does not mean code was generated or verified.
- `specport spec remix <SPEC.md> --change <statement>` creates a draft with the
  parent content digest, an explicit change set, and inherited attribution
  obligations. It always requires human re-acceptance before implementation.
- `specport spec build <SPEC.md> --target <repo> --target-stack <stack>
  --contract <contract.json> --acceptance-record <record.json>` creates a
  handoff only. The acceptance record must name the human approver and contain
  a `contractSha256` matching the exact contract bytes. The command does not
  execute repository code, run checks, perform taste review, or approve release.

The top-level aliases `specport cover`, `specport remix`, `specport build`, and
`specport guard` are retained for convenience, but the `spec` namespace is
canonical. Use the
host agent's bounded coding tools for implementation and the commands above for
the evidence surfaces they actually provide.
