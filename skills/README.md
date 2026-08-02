# SpecPort agent skills

These playbooks are intentionally runtime-neutral. Install the npm package for
the `specport` CLI, use `specport skill list` to inspect the catalog, then run
`specport skill export <name> --out <directory>` to copy one into the native
skill location used by the agent host (for example Codex or Claude Code). Keep
the skills versioned with the project or pin the package version when
reproducible behavior matters.

- `specport-repo-to-spec/SKILL.md` observes a repository and produces a
  grounded, human-reviewable contract draft. Start with
  `specport spec bundle .` to write the draft, bounded map, evidence ledger,
  and structural handoff in one read-only pass. Then write `SPEC.lock` with
  `specport spec lock SPEC.md` and run `specport spec drift SPEC.md` before
  handing the packet to another agent.
- `specport-spec-to-production/SKILL.md` executes an accepted contract through
  ordered implementation, verification, final-tree coverage, taste review,
  release-artifact and rollback gates, and an evidence-backed ship receipt.
  Before merge, `specport spec guard` composes the exact-tree, acceptance,
  verification, taste, and candidate-lock evidence into a fail-closed receipt.
  Its `references/` directory includes copyable gate-ledger, verification,
  taste-review, and ship-receipt templates so the workflow leaves durable
  evidence rather than only prose.

The skills do not grant an agent permission to approve, publish, deploy, or
invent missing requirements. They are operating instructions for a bounded
workflow; a receipt cannot replace gate evidence, and the human owner remains
responsible for intent, constraints, acceptance, exceptions, and the final
ship decision.
