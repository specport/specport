# SpecPort agent skills

These playbooks are intentionally runtime-neutral. Install the npm package for
the `specport` CLI, use `specport skill list` to inspect the catalog, then run
`specport skill export <name> --out <directory>` to copy one into the native
skill location used by the agent host (for example Codex or Claude Code). Keep
the skills versioned with the project or pin the package version when
reproducible behavior matters.

- `specport-repo-to-spec/SKILL.md` observes a repository and produces a
  grounded, human-reviewable contract draft.
- `specport-spec-to-production/SKILL.md` executes an accepted contract through
  ordered implementation, verification, final-tree coverage, taste review,
  release-artifact and rollback gates, and an evidence-backed ship receipt.

The skills do not grant an agent permission to approve, publish, deploy, or
invent missing requirements. They are operating instructions for a bounded
workflow; a receipt cannot replace gate evidence, and the human owner remains
responsible for intent, constraints, acceptance, exceptions, and the final
ship decision.
