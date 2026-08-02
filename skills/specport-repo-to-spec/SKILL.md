---
name: specport-repo-to-spec
description: Turn an existing Git repository into a provenance-bearing SPEC.md, machine-readable evidence ledger, and human-gated handoff. Use when an AI agent must understand an unfamiliar codebase, preserve observed/inferred/unknown facts, or prepare an accepted contract for specport-spec-to-production.
---

# SpecPort: repository to spec

Use this skill when a user points at an existing repository and asks what it
is, what it should do, or for a production-quality specification. Produce a
grounded draft that a human can accept; do not reverse-engineer intent from
filenames and call the result complete.

## Boundary and truth labels

Work locally and begin with observation. Do not edit implementation files,
run arbitrary repository code, access credentials, or call a hosted service
unless the user explicitly authorizes it. Keep generated evidence under the
target repository's `.specport/` directory.

Use these labels in both `SPEC.md` and the evidence ledger:

| Label | Meaning | Required treatment |
| --- | --- | --- |
| **Observed** | Directly supported by a file, Git state, configuration, test output, or command result. | Cite the path and locator, or the exact command and exit result. |
| **Inferred** | A reasoned interpretation of observed evidence. | Cite the supporting `OBS-*` entries and mark it for human confirmation. |
| **Unknown** | A material fact the repository cannot establish. | Write the decision as a question, name what it blocks, and use `[NEEDS HUMAN INPUT]` where it appears in the contract. |
| **Accepted** | An explicit human-owned decision. | Record the owner, date, contract version, and boundary; never create it silently. |

Never promote an observed implementation detail into product intent. Never
call a draft accepted, production-ready, or shippable without a named owner,
an accepted contract, and the evidence gates required by that contract.

## Inputs

- Repository path.
- Root and nested instruction files (`AGENTS.md`, `CLAUDE.md`,
  `CONTRIBUTING.md`, and applicable local docs).
- Optional human answers for owner, user/job, outcome, non-goals, constraints,
  release target, and ship authority.
- A local SpecPort checkout or the published `@specport/specport` CLI.

No prompt, credential, source upload, or hosted SpecPort account is required.
Keep processing local unless the user explicitly authorizes an external
system.

## Procedure

### 1. Resolve the root and establish a safe baseline

1. Resolve the canonical repository root. For a Git repository, use
   `git rev-parse --show-toplevel`; otherwise use the canonical directory
   supplied by the user.
2. Read the root instructions and only the nested instructions that govern the
   files or commands you will inspect. Treat them as part of the repository's
   contract.
3. Record the starting `git status --short`, current commit or empty-tree
   state, and repository identity. Preserve a dirty tree; do not clean it or
   imply that uncommitted work is released.
4. Inspect the smallest useful evidence surface: README and local docs,
   package/build metadata, entrypoints and public interfaces, persistence and
   network boundaries, tests/fixtures, CI, packaging, security notes, and
   release configuration. Follow evidence rather than reading the entire
   repository by default.

### 2. Generate the baseline artifacts before interpreting them

Run from the repository root. For an installed CLI, pin the package version in
the target repository before running it:

```text
npm install --save-dev --exact @specport/specport@<version>
npx --no-install specport spec discover . --write SPEC.md
npx --no-install specport spec discover . --json --write .specport/repository-baseline.json
```

When working in the SpecPort checkout itself, build first and use the local
binary instead:

```text
npm run build
node dist/cli.js spec discover . --write SPEC.md
node dist/cli.js spec discover . --json --write .specport/repository-baseline.json
```

The first command creates the human-readable observed draft. The second saves
the complete machine-readable baseline. The CLI also prints its result; the
saved files are the durable evidence artifacts. A baseline is an observation,
not a product contract, and its checks are discovered rather than run.

Do not pass `--force` by default. If `SPEC.md` or an evidence file already
exists, preserve the human-owned artifact and either ask before replacing it
or use clearly named drafts such as `SPEC.generated.md` and
`.specport/repository-baseline.generated.json`. Report the conflict and the
merge decision. Never overwrite an accepted contract to make a scan fit.

If the baseline reports an unstable working tree, a missing Git identity, or
an empty-tree/not-a-Git basis, preserve that limitation in `Unknowns` and
repeat the scan only after the owner decides which tree is authoritative.

### 3. Build a traceable evidence ledger

Read [the ledger template](references/evidence-ledger.template.json), copy its
shape to `.specport/repo-to-spec/evidence-ledger.json`, and replace every
placeholder with real values. Keep the baseline JSON beside it. The ledger
must contain:

- `OBS-*` claims with a source path plus line/heading/symbol locator, Git ref,
  or an exact command result;
- `INF-*` interpretations that cite their supporting `OBS-*` IDs and remain
  `needsHumanConfirmation: true` until accepted;
- `UNK-*` questions with materiality and the workflow stage they block;
- command records with the command, purpose, run time, exit code, and the
  path of any captured output;
- a handoff object naming `SPEC.md`, `.specport/contract.json`, and the next
  skill.

Do not use an agent summary as evidence. If a command was not run, record it
as not run; do not report a pass. If a fact is absent, record an `UNK-*`
question instead of filling it with a conventional default.

### 4. Write or update `SPEC.md` as a contract draft

Keep the generated provenance preamble and add or refine these sections:

- **Intent**: owner, target user/job, outcome, non-goals, constraints, and
  forbidden behavior;
- **Product behavior**: observed workflows and interfaces, inferred product
  implications, edge cases, failure semantics, and boundaries;
- **System contract**: interfaces, data ownership, privacy, compatibility,
  dependencies, and permissions;
- **Acceptance**: scenario criteria with IDs, observable results, evidence,
  risk, and explicit forbidden behavior;
- **Verification**: exact commands, fixtures, environments, and what each
  check does not prove;
- **Taste and human review**: named reviewer, product-specific rubric, and
  visual/audio/interaction/writing/operational evidence appropriate to the
  product;
- **Release**: artifact, version, supported platforms, security,
  observability, rollback, and ship authority;
- **Unknowns** and **Next actions**: every unresolved material decision and
  the evidence or owner decision needed next.

Reference ledger IDs such as `[OBS-003]`, `[INF-002]`, and `[UNK-004]` next to
claims so a cold reader can move from prose to evidence. Keep observed behavior
separate from inferred intent. Use `[NEEDS HUMAN INPUT]` for unresolved
contract fields; do not make the draft look complete by deleting warnings.

Run the structural gate after writing:

```text
specport check SPEC.md --json --write .specport/repo-to-spec/spec-check.json
```

Use the local `node dist/cli.js` equivalent when appropriate. Exit code `5`
means the result is draft or otherwise not ready; inspect the JSON and keep
that result as evidence rather than treating it as a tool failure. A green
check proves structure and explicit status only; it does not prove behavior,
taste, security, or release readiness.

### 5. Gate and hand off to `specport-spec-to-production`

Ask the owner to review the draft and explicitly accept, reject, or revise it.
Only after acceptance:

1. Record the accepted status, decision owner, decision date, contract
   version, scope boundaries, and any accepted risks in `SPEC.md`.
2. Create or update the human-owned `.specport/contract.json` from the
   accepted decisions. Do not generate acceptance, taste, or ship authority
   by inference.
3. Run and capture the machine-readable validation result:

   ```text
   specport spec validate .specport/contract.json --json
   ```

   The command must exit `0`. Save its JSON output with the other evidence.
4. Update the ledger handoff status to `ready-for-production` and pass the
   second skill this packet: `SPEC.md`, `.specport/contract.json`,
   `.specport/repository-baseline.json`,
   `.specport/repo-to-spec/evidence-ledger.json`, the spec-check result, the
   contract-validation result, allowed/forbidden paths, and known limitations.

If the contract is not accepted or validation is nonzero, set the handoff to
`draft-only` or `blocked` and return to the owner. Do not invoke the second
skill with generated prose alone. Its intake gate is the accepted,
machine-readable contract; its implementation evidence must remain separate
from repository-discovery evidence.

## Required output

Return the exact paths and status of:

- `SPEC.md` (or a clearly named generated draft when an existing file was
  preserved);
- `.specport/repository-baseline.json`;
- `.specport/repo-to-spec/evidence-ledger.json`;
- `.specport/repo-to-spec/spec-check.json`;
- `.specport/contract.json` and its validation result only when the owner has
  accepted the contract;
- an `Unknowns` section and a short `Next actions` section in `SPEC.md`.

Also report the repository identity, authoritative commit/tree, commands
actually run, exit codes, files intentionally not inspected, and whether the
handoff is `draft-only`, `blocked`, or `ready-for-production`.

## Quality gate

The result is useful only if a cold reader can answer:

1. What repository and exact tree produced these artifacts?
2. Which statements are observed, inferred, unknown, or accepted?
3. Who owns the ship decision and what user outcome is being purchased?
4. What behavior is required and forbidden?
5. Which commands, fixtures, and human checks prove each criterion?
6. What remains unknown, and what exactly must happen before the second skill
   may implement or ship?

If any answer is missing, keep the result a draft and say so.
