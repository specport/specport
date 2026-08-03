# SpecPort

## Goal

Make SpecPort’s public website the trustworthy operational front door for a
local-first CLI and the future portable-spec network.

The site must feel as usable as the front doors of npm, MacPorts, and PyPI:
someone should understand the product, identify the artifact, install or run
it, find documentation, inspect release truth, and see what is available within
the first minute. It may keep SpecPort’s restrained, high-contrast visual
identity, but editorial mood must never outrank utility.

“Looks like a registry” is not the goal by itself. The goal is a site that
behaves like a reliable software distribution entry point without pretending
that an unpublished package, an empty index, or a roadmap feature already
exists.

## Product identity

SpecPort is a local, deterministic npm CLI for the moment after an AI coding
tool or person finishes a change and before someone approves or ships it. Its
narrow, current wedge is:

> AI agents make code fast; SpecPort proves the final Git-visible tree before
> merge.

SpecPort compares the complete final Git-visible tree with an explicit review
source or approved scope. It can report coverage, create grounded spec drafts,
validate human-owned contracts, preserve provenance, and produce bounded
handoffs. It does not replace a reviewer, infer complete product intent, run
arbitrary pulled repositories, or grant ship authority.

The primary long-term artifact is a portable, versioned SPEC.md, not an agent
transcript, hosted account, or proprietary model workflow. A useful spec makes
the problem, users, outcome, constraints, behavior, acceptance criteria,
verification, dependencies, compatibility, version, license, provenance,
ownership, and unresolved decisions inspectable.

The broader direction is a distribution layer for useful, licensed specs:

1. Someone publishes a useful spec.
2. Others discover and inspect it.
3. A builder covers it for a target stack or remixes it for a new context.
4. A human or AI builds it locally.
5. The result reports tests, deviations, and evidence back to its lineage.

That is the expansion path. It is not proof of current adoption or permission
to market a public registry before the underlying corpus and provenance exist.

## First user and first job

The first target user is an AI-native maintainer, founder, agency, or developer
shipping a change in an existing repository where an unreviewed file, invented
product decision, provenance mistake, or false sense of completion is costly.

The first job is:

> After an AI agent finishes, prove that the exact final tree is understood,
> covered by the approved review source, and still consistent with the human
> contract before merge or release.

The first useful command must remain low-friction:

~~~bash
npx --yes @specport/specport@latest coverage
~~~

When the package is PUBLISHED, the primary install block is:

~~~bash
npm install --save-dev @specport/specport
npx --no-install specport coverage
~~~

When the package is NOT-PUBLISHED, that block must be visibly marked as
unavailable and replaced with a verified source or exact-tarball path.

For the current spec foundation, the richer first-minute path is:

~~~bash
npx --yes @specport/specport@latest spec bundle .
specport spec validate .specport/contract.json
specport spec lock SPEC.md --out SPEC.lock
specport spec drift SPEC.md --lock SPEC.lock --json
~~~

The website must explain what each command proves and does not prove. An
inventory-only result, a blocked handoff, or a passing check must not be
presented as product approval or a ship decision.

After implementation, the exact merge-readiness command is a later workflow,
not a first-minute install claim:

~~~bash
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
~~~

The guard requires identity-bound evidence and returns merge-ready evidence; it
does not publish, deploy, or approve shipping.

## Current product contract

The website may label a capability “shipping” only when the current checkout
and package verification support that claim. The source of truth is the CLI,
tests, README, schemas, and release evidence—not a marketing table.

Every `shipping` row must be backed by a release receipt containing the reviewed
commit, the command or package surface checked, the exact validation command,
the exit result, and the evidence path. If that receipt is missing or stale,
the website must use `unknown`, `human gate`, or `roadmap` rather than guessing.

| Surface | Current meaning | Website status |
| --- | --- | --- |
| coverage | Compare the final Git-visible tree with a receiver or approved scope. | shipping when verified |
| spec discover | Create a grounded repository-baseline draft from observed evidence. | shipping when verified |
| spec bundle | Produce SPEC.md, baseline, bounded map, evidence ledger, spec-check, and packet manifest in one read-only pass. | shipping when verified |
| spec lock / spec drift | Record reproducibility fingerprints and fail closed on changed or unknown state. | shipping when verified |
| spec guard | Bind final-tree coverage, contract acceptance, verification, taste, and lock evidence into a merge-ready receipt. It does not ship. | shipping with boundary text |
| spec validate | Validate a human-owned product contract before implementation. | shipping when verified |
| create / check | Preserve rough input as a draft, then report provenance, criteria, verification, taste, release, and acceptance gaps. | shipping when verified |
| pull | Fetch one spec from one exact GitHub ref with license and provenance evidence, without executing repository code. | shipping with boundary text |
| spec map | Produce a bounded static implementation map with explicit unknowns. It is not complete runtime or product-intent understanding. | shipping with boundary text |
| skill list / skill export | List and copy the packaged repository-to-spec and spec-to-production playbooks without silent overwrite. | shipping when verified |
| spec cover / spec remix | Create lineage, license, target, and change-set handoffs. | bounded handoff |
| spec build | Produce a human-gated implementation handoff. It does not generate or run code. | human gate |
| Public search, discovery, ratings, and reputation | Future index and network capabilities. | roadmap |

## Website contract

### Above-the-fold outcome

At a desktop viewport and on a narrow mobile viewport, the first screen must
answer these questions without requiring a long scroll:

1. What is SpecPort?
2. Who is it for?
3. What can I do with it today?
4. What exact command do I run?
5. Is the package published and is this site deployed?
6. Where are the docs, commands, source, and release history?

The hero must lead with a concrete product sentence, such as:

> SpecPort is a deterministic CLI that proves your final Git tree matches a
> review source or approved scope before merge.

An evocative headline may support that sentence, but it cannot replace it.

The first action must be an immediately usable install or quick-start action.
If the package is not verified on npm, the page must say NOT-PUBLISHED and
provide a verified local or exact-tarball path instead of presenting a broken
public install promise.

### Required information architecture

The public site should use task-oriented navigation, not only internal essay
anchors:

- Overview
- Install / Quick start
- Documentation
- Commands
- Skills
- Schemas and examples
- Changelog / Releases
- GitHub

The page should be organized in this order:

1. Product identity, current package status, and one working action.
2. Quick start with an exact command and representative output.
3. Current capabilities with shipping, bounded handoff, human gate, or roadmap
   status.
4. Command and documentation index linking to real repository artifacts.
5. Trust surface: version, license, Node requirement, provenance, privacy,
   exit codes, source, issues, security, and release history.
6. Clearly labeled future direction: portable specs, public discovery,
   cover/remix/build expansion, and reputation signals.

If there is not yet a real public spec corpus, do not render a fake search box,
fake package counts, fake downloads, fake maintainers, fake testimonials, or a
fake browse-registry flow. Link to real examples and source files until a real
index exists.

### Reference principles

The reference sites establish functional roles, not a requirement to copy their
CSS:

- npm makes package search, popular packages, discovery, recent updates, and
  package metrics visible.
- PyPI makes “find, install, and publish” explicit, then provides search,
  project browsing, documentation, and ecosystem statistics.
- MacPorts makes download, available ports, installation, documentation,
  support, and the latest release easy to find.

For SpecPort, translate those roles into:

- find the product and its exact package name;
- install or run the current CLI;
- browse real commands, skills, schemas, and examples;
- inspect version, license, release, provenance, and compatibility;
- find source, issues, security, and contribution paths;
- understand the future spec index without confusing it with the current CLI.

The visual system may retain paper/ink contrast, mono command surfaces, and one
signal accent. It should reduce decorative grain, rotated mockups, giant empty
editorial sections, and full-bleed panels when they compete with install,
search, documentation, or release actions.

### Interaction and content rules

- Every primary CTA must perform the action its label promises. “Read the
  contract” must open the contract or contract example, not a premise section.
- Every shell command must be copyable, exact, and verified against the current
  package/README contract.
- Terminal output must be labeled example unless it was generated from a
  committed fixture or release verification run.
- Version, package name, license, engine, publication state, deployment state,
  and release links must have one traceable source of truth.
- A status table must never label a human-gated handoff as shipped software.
- Privacy must be visible in one click: local inspection is the default; only
  explicitly requested receiver URLs or the single exact GitHub ref used by pull
  are contacted; source, prompts, transcripts, and credentials are not uploaded
  to a SpecPort service.
- No analytics, account, sign-in, hosted dashboard, or shared production key
  may be introduced merely to imitate a registry homepage.
- The page must remain usable without JavaScript except for optional copy
  enhancement. A failed clipboard action must not hide the command.
- The mobile navigation must not silently hide the primary documentation and
  install paths.

## Release and distribution truth

The package identity is:

- name: @specport/specport;
- executable: specport;
- version: read from package.json; never hard-code it in site copy;
- license: MIT;
- engine: Node.js >=20;
- repository: https://github.com/stancsz/specport;
- homepage: https://stancsz.github.io/specport/.

publishConfig.access or a successful local package build does not prove public
npm publication. The website may say PUBLISHED only after a release check
confirms:

~~~bash
npm view @specport/specport version --registry https://registry.npmjs.org/
npm view @specport/specport dist.tarball --registry https://registry.npmjs.org/
~~~

The returned version and tarball must match the intended release. Until then,
the site must use NOT-PUBLISHED and offer a verified source or exact-tarball
installation path. The same rule applies to Pages: a local docs directory or a
successful workflow definition does not prove that the deployed URL is current.
Fetch the deployed URL and inspect its title, install section, and
commit/release identity before calling it deployed.

Every release receipt should record:

- package version and commit;
- npm view result or explicit NOT-PUBLISHED state;
- npm pack file list and clean-consumer install result;
- typecheck, lint, build, and test results;
- Pages workflow and fetched deployed-page result;
- known external gates and their owner.

## Product invariants

- A spec is portable and versioned; it is never trapped in a chat transcript.
- Human-owned intent, constraints, acceptance criteria, taste, and final ship
  decisions remain outside AI or adapter authority.
- Observed facts, model inference, and unknowns are visibly different.
- No AI or adapter may silently invent requirements, erase provenance, or claim a
  check passed when it did not run.
- Local/private operation is the default; network and model access are explicit.
- Licenses, attribution, dependencies, compatibility, and security warnings
  travel with a pulled, covered, or remixed spec.
- Generated code, a passing test, a merge-ready receipt, or a marketing page is
  not proof that a product is correct or ready to ship.
- Every major workflow has both a human-readable artifact and a machine-readable
  result.
- The website must never claim current adoption, public registry coverage, or
  package publication without current evidence.

## Roadmap boundaries

### Current foundation

The current repository includes the early local foundation: repository
discovery, source-preserving draft authoring, readiness checks, bounded mapping,
repo-to-spec packets, lock/drift evidence, provenance-preserving pull,
lineage-aware cover/remix/build handoffs, identity-bound guard, and packaged
agent playbooks. Keep these commands and artifacts honest and verified.

### Next product work

The next product work may unify the spec format, improve exact-ref GitHub
discovery and local inspection, add carefully bounded mapping adapters, and
strengthen cover/remix and agent workflows. Each increment requires a fixture,
readable output, explicit provenance, and a human boundary.

### Future ecosystem work

Public search, manifest-based discovery, shared indexes, ratings, reputation,
verified build signals, code-generating adapters, and broad public sharing are
future work. Do not build those surfaces merely to make the website resemble a
registry. Earn them only after real specs are being pulled, covered, remixed,
and built by external users.

## Acceptance gates

The goal is not complete until all applicable gates have evidence.

### Product and distribution

- npm run typecheck, npm run lint, npm run build, and npm test pass.
- npm run verify:package passes, including package contents and installed CLI
  smoke tests.
- A clean consumer can install the exact packed artifact and run
  specport --version and specport coverage --help successfully.
- If public npm publication is claimed, npm view returns the intended version
  and tarball. Otherwise the website visibly says NOT-PUBLISHED.
- When the package is NOT-PUBLISHED, npm pack and a clean-consumer install of
  the exact tarball succeed, the website links to that exact artifact or source
  path, and no public npm install CTA is presented as available.
- Every documented command exists in the current CLI or is explicitly labeled
  roadmap; no marketing copy upgrades a plan into a shipped feature.

### Website behavior

- At 1280×900 and 390×844, the first screen contains the concrete product
  sentence, current distribution status, one valid install/quick-start action,
  and links to documentation and source.
- The first useful action does not require scrolling through several editorial
  sections.
- The command reference lists every shipped command, its one-line purpose,
  important boundary, and a link to a real README, skill, schema, or example.
- The capability table is traceable to CLI help, tests, package contents, or a
  labeled roadmap entry.
- All links resolve, including the contract CTA, package/source links, docs,
  skills, examples, changelog, issues, security, and release paths.
- A privacy section is reachable from the primary navigation in one click and
  states the local-inspection default, explicit receiver/GitHub network boundary,
  and no-upload handling for source, prompts, transcripts, and credentials.
- The site has a usable keyboard path, visible focus, readable contrast, useful
  mobile navigation, semantic headings, and no required JavaScript for reading
  or copying commands.
- The site contains no fake search, fake metrics, fake adoption, fake package
  availability, or fake terminal evidence.
- A copy/status review records the source or fixture for every visible number,
  terminal result, package claim, maintainer claim, and adoption statement; an
  unsupported claim blocks the release.

### Deployment evidence

- The Pages workflow succeeds for the intended commit.
- The deployed URL is fetched after deployment and its title, first-fold copy,
  install status, navigation, and capability status match the reviewed source.
- A desktop and mobile screenshot are captured for the deployed page.
- git diff --check passes and only intended files are changed.

## Non-goals

SpecPort is not initially:

- a generic autonomous coding agent;
- an AI reviewer or replacement for tests, security review, deployment, or human
  approval;
- a magic compiler or guarantee of correct generated software;
- a hosted SaaS marketplace requiring a SpecPort account;
- a package manager that executes arbitrary pulled repositories;
- a claim that AST structure reveals complete product intent;
- a public registry with ratings or popularity proof before a real corpus and
  repeated external use exist;
- a visual clone of npm, MacPorts, or PyPI.

## Definition of success

SpecPort succeeds when a new visitor can reach the product’s first useful action
without decoding a manifesto, install or run the current CLI through a truthful
path, find the relevant documentation and source, understand what each current
surface proves, and distinguish shipped behavior from roadmap work.

The website is complete only when it is operationally useful, distribution
truthful, visually coherent, accessible, deployed, and supported by current
evidence. A persuasive screenshot, a successful local build, or a written
roadmap alone is not completion evidence.

The durable moat remains the portable lifecycle, provenance, evidence, and
network of useful specs that gets better as people build, cover, remix, and
responsibly share them. The site should make that direction legible while
earning trust through the narrow product that exists today.
