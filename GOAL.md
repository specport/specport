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

## Immediate catalog expansion goal

The next product increment is a real, maintained public catalog of useful
portable specs. A maintainer should not have to hand-format every card, detail
page, download link, or search record. A bounded GitHub Action should discover
public `SPEC.md` files, reject obvious noise, preserve source and license
evidence, update the catalog repository, and generate the static data consumed
by the public site.

The desired visitor flow is:

1. Open `https://specport.github.io/` and choose Browse or Search.
2. Search and filter real catalog records by job, category, tags, stack,
   compatibility, implementation state, effort, license, and freshness.
3. Open a detail page with a concise summary, the honest implementation
   boundary, verification evidence, provenance, license, and lineage.
4. Read or download the exact `SPEC.md`, open its GitHub source, or copy an
   exact-ref pull command.

The desired maintainer flow is:

1. Run the catalog discovery script locally or dispatch the scheduled GitHub
   Action with an authenticated GitHub token.
2. Let deterministic policy checks classify candidates as catalogable,
   needs-review, rejected, or stale, with machine-readable reason codes.
3. Generate a reviewable change or pull request in `specport/specs`; merging it
   is the publication gate for new or changed external entries.
4. Build one static catalog index, search index, detail artifact, and raw-spec
   route from the repository source, then deploy the site automatically.

Repository boundaries are explicit:

- `specport/specport` owns the local CLI and the provenance-preserving pull
  primitive. The requested ergonomic flow is `spec pull <url>`; because the
  published npm executable is currently named `specport`, the compatible
  package form is `specport pull <url>`. The implementation must either expose
  an explicit `spec` alias or use the package name consistently, and must not
  leave two subtly different pull behaviors.
- `specport/specs` is the catalog source of truth. Its existing pack manifests,
  `SPEC.md` files, contracts, covers, generated `catalog.json`, and static
  assets remain the durable input/output model; imported GitHub candidates must
  extend that model rather than create a second undocumented format.
- The public site at `https://specport.github.io/` consumes the generated
  catalog artifacts. A static site or Pages build must not require a catalog
  server, account, analytics, or a shared runtime key.

This goal is about making discovery and distribution real now. It does not
change the human-owned intent, acceptance, verification, taste, licensing, or
ship-authority boundaries of the core SpecPort product.

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
| GitHub SPEC catalog / Discover | Automatically index public repositories with more than 200 stars and an exact `SPEC.md`; presence is discoverability, not endorsement. | roadmap |
| Ratings and reputation | Future quality, lineage, and adoption signals layered on top of verified catalog records. | roadmap |

### GitHub SPEC catalog / Discover direction

`spec discover` remains the local repository-to-spec draft command. The public
Discover feature is a separate, explicitly networked catalog that looks for
usable specs on GitHub.

### Discovery policy

The initial eligibility policy remains deliberately narrow and versioned. An
entry is a candidate only when all of these conditions are true at catalog sync
time:

1. The repository is public and has **more than 200 stars**. Exactly 200 stars
   does not qualify.
2. The repository's default branch contains at least one file whose exact
   filename is `SPEC.md`. Each qualifying file is one catalog entry and the
   complete path is part of its identity, so a root `SPEC.md` and
   `specs/mobile/SPEC.md` are distinct entries in the same repository.
3. The file can be fetched at an immutable commit, is within the configured
   size limit, and is non-empty UTF-8 Markdown.
4. The repository's license metadata is usable under the catalog's
   redistribution policy. An unknown or incompatible license may remain a
   source-only review record, but it must not be copied into the catalog as if
   redistribution were authorized.

The indexer should use GitHub code search to find candidates, then re-check
repository metadata and the default-branch tree/content endpoint before writing
an entry. Search results are only candidate evidence: the final record must
contain a repository snapshot, default branch, commit SHA, file path, file SHA,
star count, license declaration, GitHub repository URL, exact spec URL,
content digest, and `indexedAt` timestamp. A record is removed or marked stale
when a refresh can no longer verify the policy.

The usefulness filter is a transparent admission policy, not an AI popularity
score. It must produce reason codes and retain the evidence used to decide:

Every normalized display field must carry an origin of `observed`,
`inferred-with-evidence`, or `unknown`. Inferred titles, tags, categories,
compatibility, or summaries must point to the source text or repository
metadata that supports them; unknown must remain visible instead of being
filled with plausible-sounding text.

- `catalogable`: the spec has a recognizable product or project intent, a
  concrete user/job or outcome, constraints or non-goals, scenario-based
  acceptance criteria, repeatable verification, and an explicit human or
  release boundary. Required headings and content checks should be deterministic
  and configurable.
- `needs-review`: the source is plausibly useful but a required field is
  ambiguous, incomplete, generated-looking, or outside the automatic policy.
  It may appear in a maintainer review queue, never as a featured result by
  accident.
- `rejected`: the file is empty, a placeholder, a prompt dump, unrelated to a
  buildable product/project, inaccessible, unsafe to redistribute, or fails a
  hard policy check. The rejection reason must be recorded for auditability.
- `stale`: a previously accepted source changed, disappeared, lost eligibility,
  or could not be refreshed. Stale records must not silently keep old content
  looking current.

An optional model-assisted review may suggest tags or a classification, but it
must not invent metadata, rewrite the source, or publish without the same
deterministic checks and maintainer gate. GitHub stars are an eligibility fact,
not a SpecPort quality, safety, or usefulness score.

The catalog is a discovery layer, not an approval layer. It must not execute
repository code, silently copy or rewrite the spec, claim that the spec is
correct, or turn a source snapshot into a ship recommendation. A missing GitHub
license is shown as `unknown` with a review warning; it is not hidden or
presented as permission to redistribute. If raw source copying is allowed, the
catalog preserves the exact bytes, commit, path, file SHA, content digest,
attribution, and original license. Otherwise it links to the source and keeps
the entry source-only.

The implementation is deliberately honest about GitHub's search boundary:
GitHub code search exposes at most 1,000 results for one query. The scheduled
workflow records the result cap, candidate/recheck caps, incomplete-search
state, and rate-limit headers. A complete run may replace
`data/github-catalog.json`; an incomplete or rate-limited run writes only
`data/github-discovery-review.json`, so the public website continues to consume
the last complete catalog rather than presenting a partial scan as current.
The scheduled seed query is contract-shaped (`filename:SPEC.md "## Intent"
"## Acceptance" "## Verification"`) and can be overridden for narrower
shards; the filename-only query remains useful as an explicit broad review
scan.

Every accepted entry links to the exact GitHub file and can offer an exact-ref
pull command such as:

~~~bash
specport pull owner/repo@<commit>:path/to/SPEC.md
~~~

The pull surface should also accept the catalog's copyable GitHub file URL
(`https://github.com/<owner>/<repo>/blob/<ref>/<path>`) when it can resolve
that URL to one immutable commit. The catalog should prefer a commit-pinned
URL or locator so branch movement cannot silently change what a user pulls.
Unsupported or ambiguous URL forms must fail with a repairable message rather
than guessing where the ref ends and the path begins.

The catalog identity is `owner/repository:path`; a stable record id must be
derived from that identity rather than from a display title. A refresh must
deduplicate repeated search hits, detect source changes by commit and digest,
retain first-seen and last-seen evidence, and expose the last successful sync,
policy version, rate-limit state, and incomplete-search state.

### Automation and generated artifacts

The `specport/specs` workflow must support both a scheduled refresh and manual
dispatch. It should paginate or checkpoint GitHub search, honor rate limits,
fail closed on incomplete discovery, and never execute a checked-out candidate
repository or run commands from an imported `SPEC.md`. The workflow should
write candidates and generated artifacts in a reviewable branch or pull
request; merging is the human publication gate for new external content.

The deterministic build should generate, at minimum:

- a top-level `catalog.json` containing schema version, policy version,
  generation time, source snapshot, counts, filter facets, sync health, and
  compact records;
- one detail record per accepted or source-only entry with the full manifest,
  provenance, evidence, license state, source links, digests, and exact pull
  command;
- a safe raw `SPEC.md` download route only where the license policy permits
  redistribution, otherwise a source link and clear download boundary;
- a compact browser search index with normalized searchable fields so search
  and filters remain fast without a server; and
- static detail pages or equivalent no-JavaScript-readable routes generated
  from the same records, so adding a pack never requires hand-editing a page.

Generated data must be deterministic for a fixed source commit and generated
timestamp, stable under repeated runs, schema-validated, and safe against path
traversal, untrusted HTML, Markdown injection, and arbitrary URL schemes.

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
- Browse / Search specs
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

### Catalog browse and detail contract

Once the generated index exists, the site must expose a real Browse/Search
surface rather than a decorative marketplace imitation:

- Search must cover the normalized title, tagline, summary, user/job, outcome,
  tags, category, compatibility, implementation state, and provenance fields.
- Filters must be data-driven from the catalog facets and include category,
  tags, stack or runtime, agent compatibility, starter/reference state, effort,
  license state, catalog status, and updated time where present. Empty results
  must explain which filters are active and provide a clear reset action.
- Sorting may include featured, recently updated, name, and verified/reference
  state. It must not imply popularity unless a sourced metric is explicitly
  present and labeled as such.
- Each card must show enough context to choose a result: name, one-line job or
  outcome, category, useful tags, state, verification boundary, license, and
  updated date. It must link to a detail page generated from the same record.
- Each detail page must show the complete source identity, exact commit and
  path, source and raw-file links, license and attribution requirement,
  catalog decision and reason, implementation boundary, compatibility, effort,
  verification evidence, lineage, and a copyable exact-ref pull command.
- Download must mean one of two honest things: download the catalog's exact
  preserved `SPEC.md` when redistribution is allowed, or open the original
  source when it is source-only. A detail page must never silently change the
  spec while formatting it for display.
- The generated pages must be accessible on mobile and keyboard, safe to render
  from untrusted Markdown, readable when JavaScript is unavailable, and fast
  enough that search and filter changes feel immediate for the full index.

Adding one accepted entry must update cards, facets, search, detail links, raw
download or source links, and the catalog count from the generated data. No
hand-maintained duplicate list is allowed.

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
- Privacy must be visible in one click: local inspection is the default. The
  current CLI contacts only explicitly requested receiver URLs or the single
  exact GitHub ref used by `pull`; the future catalog runs as a bounded,
  maintainer-controlled GitHub Action against public GitHub metadata. Neither
  path uploads source, prompts, transcripts, or credentials to a SpecPort
  service.
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
- repository: https://github.com/specport/specport;
- homepage: https://specport.github.io/.

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

The next product work is the catalog expansion in this goal: a policy-driven
GitHub scanner, usefulness/review classification, candidate update workflow,
stable static artifacts, and a fast Browse/Search/detail experience. The
existing `specport/specs` pack compiler and the existing exact-ref `pull`
primitive should be extended rather than replaced. Each increment requires a
fixture, readable output, explicit provenance, and a human boundary.

### Future ecosystem work

After the catalog is real, manifest-based discovery beyond GitHub, shared
indexes, ratings, reputation, verified build signals, code-generating adapters,
and broad public sharing can be evaluated. Do not treat the catalog's
eligibility or structural usefulness checks as universal quality assurance, and
do not build reputation or popularity surfaces merely to make the website
resemble a registry.

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
- Catalog fixtures prove that 200 stars is excluded, 201 stars without an
  exact `SPEC.md` is excluded, and 201 stars with a verified default-branch
  `SPEC.md` is included with stable provenance and a deterministic record ID.
- A catalog refresh is idempotent, deduplicates multiple paths correctly,
  surfaces GitHub rate-limit/incomplete-search state, and never executes
  repository code.
- A broad live search records GitHub's 1,000-result ceiling and bounds metadata
  re-checks; an incomplete or rate-limited run creates review output without
  replacing the canonical current report or writing new source snapshots.
- Catalog fixtures cover catalogable, needs-review, rejected, stale,
  source-only, missing-license, placeholder, malformed-Markdown, duplicate-hit,
  changed-commit, and unsafe-URL cases with stable reason codes.
- A fixed GitHub fixture set produces byte-stable `catalog.json`, detail records,
  search fields, source links, and pull commands; adding or changing one source
  updates every dependent artifact without hand-editing generated pages.
- The scheduled/manual workflow uses least-privilege permissions, records its
  policy and sync state, opens a reviewable update for new external content,
  and does not publish incomplete or rate-limited results as current.
- `specport pull` accepts the catalog's exact source locator and the supported
  GitHub URL form, resolves to an immutable commit, preserves the raw spec and
  provenance receipt, fails closed on an unusable license, and executes no
  repository code.

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
- With a real catalog, Browse/Search returns the committed records, filters by
  the generated facets, sorts only by labeled fields, and updates counts and
  empty states without a server or hand-maintained duplicate index.
- Every accepted detail page exposes the exact `SPEC.md` source, license and
  attribution state, catalog decision/reason, implementation boundary,
  verification evidence, raw download or source-only boundary, and a tested
  exact-ref pull command.
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
- an objective judge of whether a spec is good, safe, commercially viable, or
  correct. The automatic filter is a catalog admission signal with evidence,
  not endorsement;
- a mechanism for copying unlicensed or ambiguous source content into the
  repository, or for hiding attribution and source changes;
- an LLM-generated catalog description that silently rewrites the source or
  invents implementation, popularity, customer, or verification claims;
- a public registry with ratings or popularity proof before a real corpus and
  repeated external use exist. The first catalog may show GitHub's star-count
  snapshot only as an eligibility fact, never as a SpecPort quality score;
- a visual clone of npm, MacPorts, or PyPI.

## Definition of success

SpecPort succeeds when a new visitor can reach the product’s first useful action
without decoding a manifesto, install or run the current CLI through a truthful
path, find the relevant documentation and source, understand what each current
surface proves, and distinguish shipped behavior from roadmap work.

For this catalog increment, success additionally means that a maintainer can
run or dispatch one bounded discovery workflow and get a deterministic,
reviewable update to `specport/specs`, while a visitor can browse, search, and
filter the resulting records quickly, inspect the evidence and licensing
boundary, read or download the exact `SPEC.md` where allowed, and pull the same
immutable source with a provenance receipt. A new accepted record must flow
through the index, facets, detail page, download/source link, and pull command
without hand-editing duplicate website data.

The website is complete only when it is operationally useful, distribution
truthful, visually coherent, accessible, deployed, and supported by current
evidence. A persuasive screenshot, a successful local build, or a written
roadmap alone is not completion evidence.

The durable moat remains the portable lifecycle, provenance, evidence, and
network of useful specs that gets better as people build, cover, remix, and
responsibly share them. The site should make that direction legible while
earning trust through the narrow product that exists today.
