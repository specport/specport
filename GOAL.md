# SpecPort

## Mission

SpecPort makes software specifications portable, discoverable, implementable,
and remixable.

> From messy intent to an AI-implementable spec.
>
> From a repository to an observed spec.
>
> From a free spec to a built capability.

The primary artifact is a versioned spec, not an agent transcript, a review
report, or a hosted SaaS subscription. SpecPort is a local-first,
npm-installable CLI and extensible protocol that helps a human or an AI agent
author, understand, find, adapt, and build from specs.

The long-term product thesis is that software can be distributed like a
recipe or blueprint: instead of buying a separate SaaS product for every
workflow, a user can find a useful, licensed spec, cover or remix it for their
context, and build it with the tools and AI they choose.

That is a direction, not a claim that every generated implementation is safe,
correct, or production-ready. SpecPort must preserve provenance, licensing,
unknowns, verification evidence, and human ownership of the final ship
decision.

## What counts as a spec

A SpecPort spec is a portable, structured description of a capability that
another person or AI can implement without inventing important product
decisions. It should make these things explicit:

- the problem, users, desired outcome, and success measures;
- scope, non-goals, assumptions, and constraints;
- behavior, workflows, interfaces, data, and important edge cases;
- implementation guidance and stack-specific requirements where relevant;
- acceptance criteria, checks, fixtures, and evidence expectations;
- dependencies, compatibility, version, license, provenance, and ownership;
- unresolved questions and decisions that still require a human.

"AI-implementable" does not mean "guaranteed to produce correct software." It
means the spec is specific enough to plan, implement, test, and review, with
uncertainty visible instead of silently filled in by a model.

The canonical human-readable artifact is SPEC.md. A machine-readable
manifest or companion format may carry identity, version, tags, source,
license, and build metadata. The format must remain useful without a
SpecPort account or a particular model vendor.

## The spec lifecycle

SpecPort should make one coherent loop possible:

~~~
messy text -----\
GitHub spec -----+--> inspect / normalize --> check --> cover or remix --> build
existing repo ---/                                               |
                                                               +--> evidence and feedback
~~~

### 1. Turn arbitrary text into a well-written spec

Given notes, a problem statement, an issue dump, a document, or other
unstructured text, SpecPort should produce a clear draft SPEC.md.

The transformation must preserve source material, separate confirmed facts
from inference, identify missing decisions, and expose contradictions. It
should improve structure and implementability without pretending that the
input contained requirements it did not contain.

The first useful flow should be short:

~~~
rough input -> draft spec -> spec check -> human confirmation -> build handoff
~~~

### 2. Discover and pull specs from GitHub

SpecPort should make good specs easy to find and safe to pull from ordinary
GitHub repositories. The discovery contract should prefer explicit metadata
over guesswork:

| Signal | Recommended convention |
| --- | --- |
| One primary spec | SPEC.md at the repository root |
| Multiple specs | specs/<spec-id>/SPEC.md or specs/<spec-id>.md |
| Machine metadata | .specport/manifest.yml or specport.yml |
| Repository topics | specport, spec, and domain/stack topics |
| Optional labels | specport-ready, specport-coverable, specport-remixable |

Topics and labels are discovery hints, not proof of quality. A manifest
should declare the spec ID, version, paths, tags, compatible stacks, license,
dependencies, and whether the spec is ready to cover or remix. The resolver
should use a predictable order: manifest, canonical paths, then clearly
reported metadata heuristics.

Pulling a spec must preserve the exact repository, ref, commit, source path,
license, and provenance. A pulled spec is inspected locally before a build is
started. SpecPort must not execute arbitrary repository code merely because a
spec was discovered.

### 3. Map an existing repository into a spec

SpecPort should also work in reverse: given a repository, produce a useful
starting SPEC.md by combining AST mapping with observable repository evidence
such as:

- modules, symbols, routes, commands, data models, and dependency edges;
- configuration, package metadata, migrations, fixtures, and tests;
- documentation, examples, and selected Git history when requested.

The reverse map must distinguish:

- **observed**: directly supported by source, configuration, tests, or docs;
- **inferred**: a reasoned interpretation that needs human confirmation;
- **unknown**: a product decision or behavior the repository cannot establish.

AST mapping describes what the code is and how it is shaped. It must not claim
to know why the product exists, whether behavior is correct, or which
requirements were intended unless evidence supports that claim. The output is
a spec draft to refine, not an oracle.

### 4. Cover and remix specs

SpecPort should make reuse a first-class action:

- **Cover a spec** means implement the same capability for a target repository,
  language, framework, or deployment context. The result records
  compatibility, deviations, and verification evidence against the parent
  spec.
- **Remix a spec** means intentionally adapt or extend it for a different
  audience, workflow, constraint, or product direction. The result preserves
  the parent reference, change history, attribution, license, and an explicit
  diff of what changed.

Both actions should be possible from the CLI and from an AI skill. They should
produce ordinary files that can be reviewed, versioned, forked, and shared;
they must not create an opaque lock-in to SpecPort.

## AI-native operation

SpecPort should ship native operating instructions and adapters for Claude,
Codex, and other AI systems. An agent should be able to:

- locate and load the relevant spec and its provenance;
- draft or revise a spec while preserving unresolved decisions;
- check whether a spec is implementable before coding;
- cover or remix a spec with an explicit change set;
- build against a spec in a bounded target repository;
- run the declared checks and return structured evidence;
- report deviations rather than quietly changing the contract.

The skill layer should be installable into the host agent's native workflow
and should not require one shared production API key or one model vendor.
Human-owned intent, constraints, acceptance criteria, and final approval remain
outside the agent's authority.

## npm and CLI contract

SpecPort must be easy for both humans and agents to install and invoke:

~~~
npm install --save-dev @specport/specport
npx --yes @specport/specport@latest <command>
~~~

The target command surface is:

| Command | Purpose |
| --- | --- |
| specport coverage <repo> | Compare the final Git-visible tree with a receiver or expected scope |
| specport spec discover <repo> | Generate an observed repository-baseline draft |
| specport spec validate <contract> | Validate a human-owned product contract before implementation |
| specport create <input> | Turn arbitrary text into a draft spec |
| specport check <spec> | Check structure, completeness, provenance, and readiness |
| specport pull <github-ref> | Discover and fetch a spec at an exact ref |
| specport map <repo> | AST-map a repository into an observed spec draft |
| specport cover <spec> | Implement a spec for a target repo or stack |
| specport remix <spec> | Fork/adapt a spec while preserving lineage |
| specport build <spec> | Run or hand off a bounded implementation workflow |
| specport skill <install or export> | Install or export native AI operating instructions |
| specport search <query> | Search local or future public spec indexes |

Commands should have concise human output and stable JSON output for agents,
scripts, CI, and other tools. They should work locally by default, make
network access explicit, use deterministic exit codes, and never hide
important warnings behind a green-looking summary.

The exact command names may evolve, but the verbs and the lifecycle should
remain understandable without reading implementation code.

## Extensibility

SpecPort should be a small core with adapters rather than a closed monolith.
Extension points should cover:

- spec formats and validators;
- GitHub and other source/index providers;
- AST parsers and language/framework mappers;
- AI runtimes and native skill formats;
- build targets, test runners, and evidence collectors;
- local, team, and future public registries.

An extension must declare its inputs, outputs, permissions, network behavior,
and failure modes. The core should preserve a stable spec identity and
provenance model even when an adapter changes.

## Long-term distribution vision

The strategic opportunity is a new distribution layer for software
capabilities:

1. Someone publishes a useful, licensed spec.
2. Others discover and inspect it.
3. A builder covers it for a chosen stack or remixes it for a new context.
4. An AI or human builds it locally.
5. The resulting implementation reports tests, deviations, and evidence back
   to the spec's lineage.

This can make a free spec more valuable than a static SaaS feature because it
is portable, inspectable, adaptable, and buildable by the user. SpecPort does
not need to own hosting, deployment, billing, or the implementation runtime
to enable that ecosystem.

Future discovery should support ratings and reputation, but popularity alone
must not be the quality model. Useful signals may include verified builds,
test results, update history, maintainer responsiveness, cover/remix outcomes,
security reports, compatibility, and human reviews. Ratings are a later
ecosystem feature, after the spec format, provenance, and build evidence are
real.

## First user and first job

The first target user is an AI-native developer, founder, or maintainer who
has either a half-formed idea or an existing codebase and wants a portable
build brief that another human or AI can use.

The first job is:

> Turn rough intent or existing code into a trustworthy SPEC.md, identify
> what is still unknown, and make the next implementation step obvious.

The first-minute experience should eventually be:

~~~
npx --yes @specport/specport@latest spec discover . --write SPEC.md
specport spec validate .specport/contract.json

# Target lifecycle once the authoring/build phases land:
specport create notes.md --out SPEC.md
specport check SPEC.md
specport build SPEC.md --target .
~~~

For an existing project, the parallel entry point is:

~~~
npx --yes @specport/specport@latest spec discover . --write SPEC.md

# Target AST/evidence mapping once the mapper phase lands:
specport map . --out SPEC.md
~~~

These are target workflows until each command is implemented and tested.

## Phased roadmap

### Phase 0: current repository foundation

The current codebase is already an early spec foundation:

- spec discover creates a grounded repository-baseline draft from observed
  files, package metadata, Git state, README headings, and detected checks;
- spec validate validates a human-owned product contract with intent,
  acceptance, verification, taste, release, and path-boundary fields;
- the repository includes native skills for repository-to-spec and
  spec-to-production workflows;
- coverage compares the final Git-visible tree with an explicit review
  receiver or expected scope and reports complete, partial, or unknown.

These are valuable foundations and evidence adapters, but they are not yet the
full product described here. The current code does not yet provide arbitrary
text-to-spec authoring, GitHub spec pull/build, full AST mapping, lineage-aware
cover/remix, a general build engine, public discovery, or ratings.

Keep current commands and artifacts honest. Do not describe unbuilt lifecycle
commands as if they already ship, and do not let the coverage adapter become
the definition of SpecPort.

### Phase 1: unify the foundational spec format

Extend the existing contract and repository-baseline artifacts into a stable
human-readable SPEC.md plus machine-readable metadata. Define provenance,
readiness, unknown/decision handling, and the create and check workflows. Add
representative messy-text fixtures and require a human review step for
model-generated drafts.

### Phase 2: GitHub discovery and build

Implement the manifest and naming conventions, exact-ref pull, license and
provenance checks, local inspection, and a bounded build handoff. Prove the
workflow against fixture repositories before adding a public index.

### Phase 3: repository-to-spec mapping

Implement AST and evidence adapters for a small number of useful languages.
Validate observed facts against fixture repositories and make inferred intent
and unknown behavior visible in the generated spec.

### Phase 4: cover, remix, and AI skills

Add lineage-aware cover/remix operations, target compatibility profiles,
deviation reports, and native skills for Claude, Codex, and other agents.
Validate the same spec through at least two agent runtimes or a runtime-neutral
dry-run protocol before claiming vendor portability.

### Phase 5: open discovery and reputation

Only after real specs are being pulled, covered, remixed, and built, add
search, sharing, ratings, verified evidence, and reputation signals. Keep
quality, security, licensing, and maintenance visible alongside popularity.

## Acceptance gates

Each phase must be demonstrated with a real fixture and a readable artifact:

- messy input produces a SPEC.md that retains source facts, exposes unknowns,
  and passes the readiness check only when material decisions are present;
- a GitHub fixture is discovered by the documented convention, pulled at an
  exact ref, and reported with license and provenance;
- a repository fixture produces an AST/evidence draft that separates observed,
  inferred, and unknown statements;
- a cover or remix preserves parent identity, license, lineage, deviations,
  and verification evidence;
- an AI skill can perform the workflow in a bounded test repository and return
  structured results without silently expanding scope;
- the exact npm package installs in a clean consumer and supports both human
  output and stable machine-readable output;
- ratings and public sharing are not called successful until real specs have
  repeated pull, cover, remix, and build activity. Once the signals are
  trustworthy, high-rated specs can be surfaced and shared with their evidence
  and license still visible.

## Product invariants

- A spec is portable and versioned; it is never trapped in a chat transcript.
- Intent, constraints, acceptance criteria, and ship decisions remain
  human-owned.
- Observed facts, model inference, and unknowns are visibly different.
- No AI or adapter may silently invent requirements, erase provenance, or
  claim a check passed when it did not run.
- Local/private operation is the default; network and model access are
  explicit.
- Licenses, attribution, dependencies, and security warnings travel with a
  pulled, covered, or remixed spec.
- Generated code is an output of a build workflow, not proof that the spec was
  correct or that the product is ready to ship.
- Every major workflow has a human-readable artifact and a machine-readable
  result.

## Non-goals

SpecPort is not initially:

- a generic autonomous coding agent;
- a replacement for tests, security review, deployment, or human approval;
- a hosted SaaS marketplace that requires a SpecPort account;
- a package manager that executes arbitrary pulled repositories;
- a claim that AST structure reveals complete product intent;
- a popularity contest that treats ratings as proof of correctness.

## Definition of success

SpecPort succeeds when a new user can take messy intent, an existing
repository, or a licensed GitHub spec and move through a clear local path to
a reviewable, AI-implementable spec. They can cover or remix that spec for
their context, build it with the AI and tools they choose, and inspect what
was observed, inferred, changed, tested, and still unknown.

The durable moat is not a file extension or a single model integration. It is
the portable lifecycle, provenance, evidence, and network of useful specs that
gets better as people build, cover, remix, and responsibly rate them.
