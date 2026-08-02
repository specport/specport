# SpecPort agent skills

These playbooks are intentionally runtime-neutral. Install the npm package for
the `specport` CLI, then copy the skill directory into the native skill
location used by the agent host (for example Codex or Claude Code). Keep the
skills versioned with the project or pin the package version when reproducible
behavior matters.

- `specport-repo-to-spec/SKILL.md` observes a repository and produces a
  grounded, human-reviewable contract draft.
- `specport-spec-to-production/SKILL.md` executes an accepted contract through
  implementation, verification, taste review, release smoke, and ship
  authority.

The skills do not grant an agent permission to approve, publish, deploy, or
invent missing requirements. They are operating instructions for a bounded
workflow; the human owner remains responsible for intent, constraints,
acceptance, and the final ship decision.
