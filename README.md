# SpecPort

## Catch review gaps before merge.

SpecPort is a local, deterministic npm CLI for the moment after an AI coding
tool (or a person) finishes a change and before somebody approves or ships it.
It compares the complete final Git-visible tree with an explicit review source
or approved scope, so a clean-looking summary cannot hide an unreviewed file.

The package also includes two agent skills for turning repository evidence into
a human-owned contract and carrying that contract through implementation,
verification, human taste review, and a shippable release handoff.

SpecPort does not record prompts, call an AI model, replace a code reviewer, or
pretend that a passing test proves a product is good.

The sharpest reason to install it today is final-tree review coverage: after an
AI agent finishes, prove that the exact Git-visible tree is the tree a real
receiver or approved scope covered. The spec, contract, and lifecycle surfaces
extend that boundary, but they are not a substitute for an implementation
runtime or human approval.

## Install

```bash
npm install --save-dev @specport/specport
npx --yes @specport/specport@latest coverage
```

The executable remains `specport`:

```bash
specport --version
specport coverage
```

For a global install:

```bash
npm install --global @specport/specport
```

SpecPort targets Node.js 20 or newer and has no runtime dependencies.

## The first-minute workflow

From an existing repository, start with an inventory when you do not yet have
a receiver or approved scope:

```bash
specport coverage
```

This is deliberately an acquisition diagnostic. It reports the final tree but
cannot infer intent or claim that a path is out of scope.

When a local GitHuman review is the approval object, pin it and compare the
exact source:

```bash
specport coverage \
  --receiver githuman \
  --review <review-id> \
  --json \
  --write .specport/coverage.json
```

`coverage: complete` requires matching repository identity, a full base commit,
an exact source fingerprint, and a stable final tree. A path-set match without
an exact fingerprint is `unknown`, never clean. A proven missing or unexpected
path produces at most one review-scoped GitHuman todo. SpecPort never changes
review status.

GitHuman runs locally by default at `http://localhost:3847`; pass
`--receiver-url` when needed. The adapter fails closed when the receiver does
not expose enough source identity to establish the relation.

## Specs that are evidence, contracts, and taste

SpecPort keeps three things separate:

1. **Evidence** — what the repository, Git tree, checks, and artifact actually
   show.
2. **Contract** — what a named human owner says the product must do, must not
   do, and how it will be verified.
3. **Taste** — what a human reviewer experiences and judges for the product's
   real medium: interaction, visual quality, audio, writing, or operations.

The lifecycle is:

```text
repository evidence
        ↓
grounded draft
        ↓  human accepts intent, boundaries, and criteria
product contract
        ↓
implementation + automated verification
        ↓
human taste review + release artifact smoke test
        ↓
ship decision with a receipt and rollback path
```

Generate a grounded repository draft:

```bash
specport spec discover . --write SPEC.md
```

It observes project metadata, languages, entrypoints, scripts, checks,
workflows, documentation headings, Git identity, and changed paths. It marks
intent, acceptance, taste, and release decisions as unresolved rather than
inventing them.

Turn notes or an existing brief into a deterministic draft without losing the
source text:

```bash
specport create notes.md --out SPEC.md
specport create - --out SPEC.md < notes.txt
```

`specport create` does not call a model. It records the source kind, absolute
file path when applicable, SHA-256, observed headings, and the human decisions
that still need an owner. Use `specport check SPEC.md` before implementation:

```bash
specport check SPEC.md
specport check SPEC.md --json
```

Run metadata uses the current time by default. When a byte-reproducible draft
or repository baseline is required for a fixture or release receipt, pass a
fixed ISO-8601 value with `--generated-at`.

The check returns exit code `0` only for a structurally complete spec that
declares an accepted/ready status and has no unresolved human decisions. A
draft or incomplete spec returns `5`; it is a hold signal, not a claim that the
product is bad.

For the AI-native repository workflow, generate the whole handoff packet in
one bounded, read-only pass:

```bash
specport spec bundle .
```

This writes `SPEC.md`, `.specport/repository-baseline.json`,
`.specport/repo-map.json`, `.specport/repo-to-spec/evidence-ledger.json`,
`.specport/repo-to-spec/spec-check.json`, and a packet manifest with content
hashes. It returns exit code `5` while the draft still needs human decisions;
that is intentional. The packet executes no repository code, accesses no
network, preserves observed/inferred/unknown labels, and refuses to overwrite
an existing output unless `--force` is supplied. An accepted `SPEC.md` is
protected even with `--force`.

Create a reproducibility record after the draft or contract artifacts are in
their intended location, then check it before implementation or review:

```bash
specport spec lock SPEC.md --out SPEC.lock
specport spec drift SPEC.md --lock SPEC.lock --json
```

`SPEC.lock` records the spec digest and readiness, the repository identity and
authoritative tree basis, and the observed contract, baseline, and map
digests. `spec drift` compares those files and the current local Git-visible
tree; it exits `0` for a match and `5` for drift or an unknown comparison.
The lock is reproducibility evidence, not human acceptance, test proof, taste
approval, or ship authority. Both commands are local and execute no project
code or network requests.

## Guard one candidate before merge

After implementation, bind the final tree to the accepted contract and the
evidence that a human or bounded agent actually produced:

```bash
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

Use `--receiver githuman --review <review-id>` instead of
`--expected-scope` when a pinned local review is the approval object. The
command requires an explicit comparison basis; an inventory-only scan cannot
become merge-ready. Verification and taste evidence must identify the exact
repository, base commit, final-tree fingerprint, and contract digest. The
packaged production skill includes JSON templates for both records.

`verdict: merge-ready` means the candidate is covered and the supplied
evidence is identity-bound. It is not a ship approval: the guard does not run
repository code, publish, deploy, or replace release, rollback, and human
ship-authority gates. Missing, stale, mismatched, or failed evidence returns
exit code `5` and a hold receipt.

Map the repository into a bounded implementation map without executing its
code:

```bash
specport map . --json --write .specport/repo-map.json
```

The map records observed file roles and package entrypoints, infers only
simple static symbols/import edges/HTTP surfaces, and lists unknowns when the
scan is truncated, dynamic, binary, or unresolved. It is an edit-and-review
map, not a runtime behavior proof or a product-intent contract.

Validate a human-owned machine-readable contract before implementation:

```bash
specport spec validate .specport/contract.json
```

Start from [`examples/product-contract.json`](examples/product-contract.json)
and [`schemas/product-contract.schema.json`](schemas/product-contract.schema.json).
The validator requires provenance/license ownership, scenario evidence,
repeatable verification, a human taste rubric, and release compatibility,
security, observability, rollback, and ship authority fields. It checks
contract shape; it does not grant approval.

Pull a spec from GitHub at a named ref when its repository declares a usable
license. SpecPort resolves that ref to one commit, fetches only the requested
file, records the declared license and source identity, and executes no
repository code:

```bash
specport pull owner/repo@v1.2.0:specs/SPEC.md \
  --out SPEC.md \
  --receipt .specport/pulls/owner-repo.json
```

The pull is read-only until you choose an output path. A receipt is written
next to `--out` by default, or at `--receipt` when supplied. A missing license,
unsafe path, missing file, or unresolved GitHub ref is a hold signal.
The receipt's license is a matched GitHub declaration, not independent legal
verification of file-level rights; review attribution and compatibility before
redistributing a pulled spec.

## Cover, remix, and build handoffs

The lifecycle commands make the next AI-assisted implementation step explicit
without pretending that a plan is a finished product:

```bash
# Plan a bounded cover assessment for a target repository.
specport spec cover SPEC.md \
  --target . \
  --target-stack node \
  --contract .specport/contract.json \
  --provenance .specport/pulls/source.receipt.json \
  --json

# Create a parent-preserving remix draft.
specport spec remix SPEC.md \
  --change "Use a local-only storage adapter" \
  --change "Add an offline recovery scenario" \
  --out SPEC.remix.md

# Produce a human-gated implementation handoff.
specport spec build SPEC.md \
  --target . \
  --target-stack node \
  --contract .specport/contract.json \
  --acceptance-record .specport/contract-acceptance.json \
  --provenance .specport/pulls/source.receipt.json \
  --json
```

`cover` is `ready` only when the source receipt's declared license matches the
parent bytes, the accepted spec,
contract, target stack, and bounded repository inspection pass. `remix` is
always a draft until a human rechecks the inherited contract and attribution.
`build` is a `ready` handoff only when the acceptance record names the human
approver and matches the exact contract SHA-256. The current CLI does not
generate code, execute target code, run checks, perform taste review, or approve
release; the host agent or human owner must do those steps and record evidence.

The included skills are designed for agent environments:

- [`specport-repo-to-spec`](skills/specport-repo-to-spec/SKILL.md) grounds a
  repository into `SPEC.md` without confusing code with intent.
- [`specport-spec-to-production`](skills/specport-spec-to-production/SKILL.md)
  executes an accepted contract through code, checks, receiver coverage, taste,
  packaging, rollback, and ship authority.

They are a bounded execution protocol, not a claim that one prompt can
generate arbitrary production software without a human owner or evidence.

The package also exposes the playbooks for host-agent installation:

```bash
specport skill list
specport skill export specport-repo-to-spec --out .codex/skills/specport-repo-to-spec
specport skill export specport-spec-to-production --out .codex/skills/specport-spec-to-production
```

Exports refuse to overwrite an existing directory unless `--force` is
explicit. The exported bundle includes the playbook metadata and evidence
templates.

## Output and exit codes

Use `--json` for the complete machine-readable result. Coverage artifacts
record actual, reviewed, expected, unreviewed, unexpected, and
changed-after-review paths, identity gaps, one-finding maximum, and next action.
`--write report.json` saves JSON; a `.md` output path saves a Markdown brief
that also embeds the JSON receipt. Disposable coverage artifacts cannot
overwrite tracked repository files or write `.specport/contracts/`.

`--interactive` prints the scan, high-impact categories, base state, review
order, handoff state, and discovered checks before asking bounded questions. It
never executes a declared check; a selected check is recorded as `not-run`.

Guard receipts are written as `artifactKind: spec-guard`. They distinguish a
`merge-ready` candidate from a shipped product: verification and taste are
consumed as identity-bound evidence, while release, rollback, and human ship
authority remain separate. The guard itself executes no project code.

| Code | Meaning |
| ---: | --- |
| 0 | Diagnostic completed or exact coverage is complete |
| 2 | Usage, Git, or input error |
| 4 | Requested output could not be written |
| 5 | Coverage, contract, spec, lifecycle, or guard gates require review |
| 7 | Requested receiver is unavailable or could not consume a finding |

## What SpecPort is not

SpecPort is not an AI reviewer, session recorder, prompt store, package
manager, rollback tool, sandbox, hosted telemetry service, or generic
code-to-spec compiler. Its lifecycle artifacts are not a dependency resolver
or a general code-generation engine. It does not infer behavior from hashes.
It does not replace tests, security review, product judgment, or a human ship
decision.

The receiver-first coverage path is the current proven wedge. The contract and
agent-skill surfaces are intentionally explicit extensions: their value still
depends on a real maintainer using the resulting contract and evidence to make
a faster or better merge/hold/ship decision.

## Privacy boundary

Repository inspection is local. Coverage sends requests only to the explicitly
requested local receiver URL. `pull` intentionally contacts GitHub for the
requested ref and file. SpecPort does not upload source, prompts, transcripts,
or credentials to a SpecPort service. Keep generated artifacts in the project
only when the repository's own policy allows it.

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:package
```

`verify:package` is also the `prepack` gate. Before a release, pack the exact
artifact, install it in a clean consumer, run the installed binary, and inspect
the packed file list; passing TypeScript alone is not release evidence.

Contribution and vulnerability handling are documented in
[`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md).
The exact publication, registry-verification, Pages, and recovery procedure is
in [`RELEASE.md`](RELEASE.md).

## Status

SpecPort is an npm-ready receiver-first release candidate with deterministic
repository discovery, source-preserving draft authoring, spec readiness checks,
contract-shape validation, a provenance-preserving GitHub spec pull, bounded
static repository mapping, one-command repo-to-spec packets, lineage-aware
cover/remix/build handoffs, and packaged agent playbook export. Public npm publication, a live receiver
deployment, cross-platform validation, code-generating adapters, and repeated
maintainer adoption are external or future gates; the project does not claim
those are proven by local tests.

More detail and the product contract are on the [project site](https://stancsz.github.io/specport/).
