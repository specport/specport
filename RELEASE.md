# SpecPort release runbook

This runbook separates a reproducible release candidate from an externally
published release. A green local or CI check is not proof that npm or GitHub
Pages has accepted the artifact.

## Candidate gate

Run from the intended release commit:

```bash
git status --short
npm ci
npm run verify:package
npm pack --dry-run --json --ignore-scripts
```

The package gate typechecks, lints, builds, runs tests, packs the publish
surface, installs the exact tarball in a clean consumer, runs the installed
CLI, validates the example contract, exercises the identity-bound `spec guard`
receipt, lists the packaged skills, and exports a skill. Record the commit,
version, checksum, Node/npm versions, and command outputs. Do not publish a
dirty tree or an artifact built from another commit.

## npm authority and publication

```bash
npm whoami --registry https://registry.npmjs.org/
npm org ls specport --json --registry https://registry.npmjs.org/
npm view @specport/specport version --registry https://registry.npmjs.org/
npm publish --access public --registry https://registry.npmjs.org/
npm view @specport/specport version --registry https://registry.npmjs.org/
npm view @specport/specport dist.tarball --registry https://registry.npmjs.org/
```

The first two commands establish account and package-scope authority. A
missing `npm view` result is expected only before the first release. If npm
requests an OTP or browser authentication, complete that account-level step
and rerun publish. Never record an OTP, token, or secret-bearing URL.

The release is **published** only when the registry returns the exact version
and tarball. Install that registry version in a new consumer and run:

```bash
npm init --yes
npm install --ignore-scripts --no-save @specport/specport@<version>
npx --no-install specport --version
npx --no-install specport skill list --json
```

## GitHub Pages

The static site and Pages workflow live in the separate
`specport/specport.github.io` repository. Inspect that workflow and then the
actual URL:

```bash
gh --repo specport/specport.github.io run list --workflow "Publish GitHub Pages" --limit 5
gh --repo specport/specport.github.io run view <run-id> --log-failed
```

Do not call the site live because the workflow file exists. A Pages site must
be provisioned, the workflow must succeed, and the URL must return the
expected title and install links at `https://specport.github.io/`. The source
repository only publishes the package; it does not contain the static site.
Private repositories may require a plan that supports Pages or an owner-approved
visibility change; never change visibility implicitly.

## Recovery

- Failed local/CI gate: keep the version unpublished, fix the cause, and rerun
  the full candidate gate from the new commit.
- OTP/authentication failure: preserve two-factor protection and independently
  query the registry after authentication.
- Published package defect: prefer a corrective patch release; deprecate a
  version only for a confirmed unsafe or unusable release with authorization.
- Pages defect: correct or revert the site/workflow commit, rerun CI, and
  verify the deployed URL. Do not delete repository history.

Every release receipt should state one of `NOT-PUBLISHED`, `PUBLISHED`,
`NOT-DEPLOYED`, or `DEPLOYED`, with exact evidence and remaining limits.
