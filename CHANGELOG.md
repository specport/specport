# Changelog

All notable changes to SpecPort are recorded here. The project follows
semantic-versioning intent, but a version is not considered released until the
exact npm artifact and clean-consumer smoke test pass.

## 0.1.2 - exact GitHub pulls

- Added the literal `spec` executable alongside the existing `specport` name.
- Accepted commit-pinned `raw.githubusercontent.com` sources and rejected URL
  traversal, encoded separators, queries, and fragments before network access.
- Added package-gate coverage for both published executable names.

## 0.1.1 - corrective patch

- Corrected the published package repository metadata to the canonical
  `specport/specport` URL.
- Published the coverage-first README and clarified inventory versus proof.
- Fixed CLI entrypoint detection when npm invokes the package through a Unix
  symlinked bin.

## 0.1.0 - published

- Added `spec bundle`, a draft-only one-command repository-to-spec packet with
  a grounded `SPEC.md`, bounded map, evidence ledger, structural check, output
  hashes, and explicit no-code/no-network safety boundaries.
- Added `spec lock` and `spec drift` for local reproducibility fingerprints and
  fail-closed detection of changed specs, supporting artifacts, or source trees.
- Added `spec guard`, an evidence-first merge guard that binds final-tree
  coverage, accepted contracts, contract acceptance, verification, taste, and
  candidate-lock identity into a machine-readable receipt without executing
  repository code or granting ship authority.
- Added identity-bound verification and taste evidence templates for the
  production skill.
- Added a copyable human taste-review template to the production skill so
  maturity evidence covers the real product medium, not only automated checks.
- Added deterministic final-tree coverage with receiver and expected-scope
  boundaries.
- Added repository discovery, source-preserving draft authoring, and spec
  readiness checks.
- Added provenance-aware product contracts with verification, taste, release,
  rollback, and ship-authority fields.
- Added runtime-neutral repository-to-spec and spec-to-production skills with
  Codex metadata, plus `skill list`/`skill export` packaging commands.
- Added cross-platform CI, package smoke validation, documentation, and a
  dedicated GitHub Pages site in `specport/specport.github.io`.
- Added a commit-pinned, license-aware GitHub spec pull with a provenance
  receipt and no-code-execution boundary.
- Added a bounded, deterministic repository map for file roles, static symbols,
  local import edges, package/HTTP/CLI surfaces, scan limits, and explicit
  unknowns; it executes no repository code and is not a runtime contract.
- Added lineage-aware `spec cover`, `spec remix`, and `spec build` artifacts.
  Cover creates a gated target plan, remix preserves parent identity and
  attribution in a draft, and build creates a handoff without generating or
  executing target code.
- Added a content SHA-256 to GitHub pull receipts and a durable contract
  acceptance-record template for digest-bound human authority.
- Added a release runbook that separates candidate evidence from npm and Pages
  publication proof and documents recovery boundaries.
