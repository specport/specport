# Contributing to SpecPort

SpecPort is a local-first CLI and evidence protocol. Contributions should make
the observable product more useful without weakening the distinction between
facts, human-owned contracts, taste, and ship authority.

## Before opening a change

Install the locked toolchain and run the complete local gate:

```bash
npm ci
npm run verify:package
```

The package gate typechecks, lints, builds, runs the test suite, packs the exact
publish surface, installs that tarball in a clean consumer, and exercises the
installed CLI. Do not treat a passing TypeScript build as release evidence.

## Change expectations

- Keep network access and permissions explicit.
- Preserve provenance and unresolved decisions; do not infer product intent
  from implementation details.
- Add regression tests for behavior and failure semantics.
- Keep human taste and ship approval as explicit gates.
- Update README, GOAL.md, schemas, examples, or skills when a public contract
  changes.
- Do not include credentials, prompts, transcripts, or source uploads in
  fixtures or generated artifacts.

## Pull requests

Describe the user problem, the contract or invariant changed, the evidence
collected, known limitations, and rollback path. Include exact commands and
their results. A receiver coverage result can establish final-tree relation;
it cannot approve the product or replace the named human ship decision.
