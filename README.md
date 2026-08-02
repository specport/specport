# SpecPort

## Catch review gaps. Ship with a contract.

SpecPort is a local, deterministic npm CLI for the moment after an AI coding
tool (or a person) finishes a change and before somebody approves or ships it.
It compares the complete final Git-visible tree with an explicit review source
or approved scope, so a clean-looking summary cannot hide an unreviewed file.

The package also includes two agent skills for turning repository evidence into
a human-owned contract and carrying that contract through implementation,
verification, human taste review, and a shippable release handoff.

SpecPort does not record prompts, call an AI model, replace a code reviewer, or
pretend that a passing test proves a product is good.

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

Validate a human-owned machine-readable contract before implementation:

```bash
specport spec validate .specport/contract.json
```

Start from [`examples/product-contract.json`](examples/product-contract.json)
and [`schemas/product-contract.schema.json`](schemas/product-contract.schema.json).
The validator checks contract shape; it does not grant approval.

The included skills are designed for agent environments:

- [`specport-repo-to-spec`](skills/specport-repo-to-spec/SKILL.md) grounds a
  repository into `SPEC.md` without confusing code with intent.
- [`specport-spec-to-production`](skills/specport-spec-to-production/SKILL.md)
  executes an accepted contract through code, checks, receiver coverage, taste,
  packaging, rollback, and ship authority.

They are a bounded execution protocol, not a claim that one prompt can
generate arbitrary production software without a human owner or evidence.

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

| Code | Meaning |
| ---: | --- |
| 0 | Diagnostic completed or exact coverage is complete |
| 2 | Usage, Git, or input error |
| 4 | Requested output could not be written |
| 5 | Coverage or contract validation requires review |
| 7 | Requested receiver is unavailable or could not consume a finding |

## What SpecPort is not

SpecPort is not an AI reviewer, session recorder, prompt store, package
manager, rollback tool, sandbox, hosted telemetry service, or generic
code-to-spec compiler. It does not infer behavior from hashes. It does not
replace tests, security review, product judgment, or a human ship decision.

The receiver-first coverage path is the current proven wedge. The contract and
agent-skill surfaces are intentionally explicit extensions: their value still
depends on a real maintainer using the resulting contract and evidence to make
a faster or better merge/hold/ship decision.

## Privacy boundary

Repository inspection is local. SpecPort sends requests only to the explicitly
requested local receiver URL. It does not upload source, prompts, transcripts,
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

## Status

SpecPort is an npm-installable receiver-first release with a deterministic
repository baseline and contract-shape validator. A live receiver deployment,
cross-platform validation, and repeated maintainer adoption are external gates;
the project does not claim those are proven by local tests.

More detail and the product contract are on the [project site](https://stancsz.github.io/specport/).
