---
name: specport-spec-to-production
description: Execute an accepted product contract through implementation, verification, human taste review, and a shippable release handoff.
---

# SpecPort: spec to production

Use this skill after a human has accepted a product contract. It gives an AI
coding agent a bounded way to implement a whole project while preserving the
truth boundary between code that works, code that is verified, and a product a
human is willing to ship.

This is an execution and evidence protocol, not a promise that a model can
generate an arbitrary production system from one paragraph. If the contract
is incomplete, stop and return to `specport-repo-to-spec`.

## Non-negotiable gates

- The accepted contract is the authority for scope; repository code is
  evidence, not permission to expand scope.
- Every acceptance criterion names observable evidence.
- A passing build is not a passing product.
- Automated checks may establish facts; they cannot provide human taste or
  ship approval.
- Never claim a check passed when it was skipped, stale, or run against a
  different tree.
- Keep secrets, credentials, prompts, and source local unless the contract
  explicitly authorizes an external service.

## Workflow

### 1. Intake and contract gate

Read the repository instructions and the accepted contract. Validate the
machine-readable contract before editing:

```text
specport spec validate .specport/contract.json
```

If invalid, report the exact fields and stop. Summarize the allowed paths,
forbidden paths, acceptance criteria, verification commands, taste reviewer,
release artifact, and rollback path before implementation.

### 2. Model and plan

Build a small implementation plan mapped to contract criteria. For each item,
name the files, risk, verification command, and rollback. Reject work that is
only “make it production-ready” without a concrete criterion. Ask for a human
decision when two designs change the user outcome, security boundary, or
release target.

### 3. Implement in vertical slices

Implement the smallest complete slice first. Re-read changed files after each
meaningful edit. Preserve existing behavior unless a contract criterion
intentionally changes it. Add regression tests alongside behavior and keep
generated or disposable evidence out of tracked source unless the contract
requires it.

### 4. Verify the actual tree

Run the contract's exact checks in the declared environment. Then capture the
final Git-visible tree:

```text
specport coverage --json --write .specport/coverage.json
```

For a receiver-backed handoff, pin the receiver source instead:

```text
specport coverage --receiver githuman --review <review-id> --json --write .specport/coverage.json
```

An inventory-only result is not approval. A receiver result is `complete` only
when repository identity, base, source fingerprint, and final-tree stability
match exactly. Treat `partial`, `unknown`, `not-run`, and unavailable receiver
states as review-required.

### 5. Taste and usability gate

Give the named human reviewer the product and the rubric. Ask them to perform
the real user task and record concrete observations, not a thumbs-up generated
by the agent. For UI, inspect the live flow; for audio, listen; for writing,
read in context; for operational tools, exercise failure and recovery. Keep
the result as a separate human review record and never overwrite automated
evidence with it.

### 6. Release gate

Check the target artifact as a user will receive it. For npm, the minimum is:

```text
npm run verify:package
npm pack --dry-run
npm pack
```

Install the exact tarball in a clean consumer, run the published binary, and
inspect the packed file list. For another target, substitute its real build,
install, launch, upgrade, and rollback path. Confirm privacy, permissions,
observability, versioning, and documentation before asking the owner to ship.

### 7. Handoff

Return a release receipt containing:

- contract identity and accepted version;
- final commit/tree identity;
- criteria with evidence links or command results;
- automated check results and environments;
- human taste review and unresolved concerns;
- artifact checksum/version and install or deployment smoke result;
- known limitations, rollback path, and explicit ship decision owner.

The final state is **shippable** only when the contract is valid, required
criteria have evidence, the artifact works in a clean consumer environment,
the human-facing taste gate is complete, and the owner makes the ship decision.
