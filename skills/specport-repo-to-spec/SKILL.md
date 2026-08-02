---
name: specport-repo-to-spec
description: Turn an existing repository into a grounded, human-reviewable product contract draft without inventing intent.
---

# SpecPort: repository to spec

Use this skill when a user points you at an existing repository and asks what
it is, what it should do, or for a production-quality specification. The job
is to make the unknowns visible and produce a contract a human can accept. It
is not to reverse-engineer intent from filenames and call the result complete.

## Product invariant

Separate every statement into one of three buckets:

- **Observed**: directly supported by files, Git state, configuration, tests,
  or a command result.
- **Proposed**: a useful interpretation or design recommendation that still
  needs owner confirmation.
- **Accepted**: a human-owned contract decision with an explicit boundary.

Never promote observed implementation into product intent. Never call a draft
spec accepted, production-ready, or shippable without a named owner and the
evidence contract required by the repository.

## Inputs

- Repository path.
- Existing instruction files (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, and
  local docs).
- Optional human answers for owner, user/job, outcome, non-goals, constraints,
  and release target.
- No prompts, credentials, source upload, or hosted SpecPort account is
  required. Keep processing local unless the user explicitly authorizes an
  external system.

## Procedure

1. Resolve the repository root and read its local instructions before making
   claims or edits.
2. Run the deterministic baseline scan:

   ```text
   npx --yes @specport/specport@latest spec discover <repo> --json
   ```

   When working from a checkout of SpecPort itself, use the local `specport`
   binary or `npm run build` first. Save the JSON as an evidence artifact and
   keep the generated Markdown readable by a human.
3. Inspect the files that define behavior and delivery: README/docs,
   entrypoints, public interfaces, persistence and network boundaries, tests,
   CI, packaging, security notes, and release configuration. Do not read the
   entire repository by default; follow evidence from the baseline.
4. Write or update `SPEC.md` with these sections:

   - Intent: owner, user/job, outcome, non-goals, and success boundary.
   - Product behavior: scenarios, invariants, forbidden behavior, and failure
     semantics.
   - System contract: interfaces, data ownership, privacy, and compatibility.
   - Verification contract: exact commands, fixtures, environments, and what a
     pass does and does not prove.
   - Taste contract: the human reviewer, product-specific rubric, and the
     evidence they must inspect (visual, audio, interaction, writing, or other
     human-facing quality).
   - Release contract: artifact, version, supported platforms, security,
     observability, rollback, and ship authority.
5. Mark unresolved fields as `[NEEDS HUMAN INPUT]`. Put recommendations in a
   `Proposals` section rather than silently changing the contract.
6. Ask the owner to accept or reject the contract. Record the decision and
   version it; do not treat an agent's generated text as authorization.
7. Hand the accepted contract to `specport-spec-to-production`.

## Required output

Return:

- `SPEC.md` — the human-readable contract draft or accepted contract;
- `.specport/repository-baseline.json` — the observed scan, if the owner wants
  a durable evidence artifact;
- an `Unknowns` section listing every material fact that was not established;
- a short `Next actions` section naming the owner decision or evidence needed
  next.

## Quality gate

The result is useful only if a cold reader can answer:

1. Who owns the ship decision?
2. What user outcome is being purchased?
3. What behavior is required and forbidden?
4. Which commands and human checks prove it?
5. What remains unknown?

If any answer is missing, the result is a draft and must say so.
