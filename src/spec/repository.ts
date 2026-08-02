import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { FinalTreeSnapshot } from '../core/types.js';
import { tryRunGit } from '../git/command.js';
import { captureFinalTree, discoverRepository } from '../git/snapshot.js';
import { VERSION } from '../version.js';

export interface RepositoryCheck {
  name: string;
  command: string;
  purpose: 'build' | 'quality' | 'test' | 'release';
}

export interface RepositoryBaselineSpec {
  schemaVersion: string;
  specKind: 'repository-baseline';
  status: 'draft';
  generatedAt: string;
  repository: {
    path: string;
    repositoryId: string | null;
    headCommit: string | null;
    baseCommit: string | null;
    baseKind: 'commit' | 'empty-tree' | 'not-a-git-repository';
    stable: boolean | null;
    changedPaths: readonly string[];
  };
  project: {
    name: string | null;
    description: string | null;
    languages: readonly string[];
    runtimes: readonly string[];
    packageManager: string | null;
    entrypoints: readonly string[];
    scripts: Readonly<Record<string, string>>;
    checks: readonly RepositoryCheck[];
    readmeHeadings: readonly string[];
  };
  evidence: {
    fileCount: number;
    sampleFiles: readonly string[];
    importantFiles: readonly string[];
    workflowFiles: readonly string[];
    topLevelDirectories: readonly string[];
  };
  contract: {
    intent: 'missing';
    acceptance: 'missing';
    verification: 'observed' | 'missing';
    taste: 'missing';
    release: 'missing';
  };
  gaps: readonly string[];
  nextActions: readonly string[];
}

interface PackageManifest {
  name: string | null;
  description: string | null;
  engines: Readonly<Record<string, string>>;
  scripts: Readonly<Record<string, string>>;
  entrypoints: readonly string[];
}

const IMPORTANT_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'Dockerfile',
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'requirements.txt',
  'tsconfig.json',
];

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.specport',
  '.githuman',
  'coverage',
  'dist',
  'node_modules',
]);

export async function discoverRepositorySpec(
  requestedPath = '.',
  generatedAt = new Date().toISOString(),
): Promise<RepositoryBaselineSpec> {
  const requested = resolve(requestedPath);
  const requestedStats = await stat(requested);
  if (!requestedStats.isDirectory()) {
    throw new Error(`Repository path must be a directory: ${requested}`);
  }

  const gitRepository = await tryDiscoverRepository(requested);
  const root = gitRepository?.root ?? (await realpath(requested));
  const snapshot = await tryCaptureSnapshot(root);
  const files = await listRepositoryFiles(root, Boolean(gitRepository));
  const manifest = await readPackageManifest(root);
  const readmeHeadings = await readMarkdownHeadings(join(root, 'README.md'));
  const packageManager = detectPackageManager(files, manifest);
  const languages = detectLanguages(files);
  const runtimes = detectRuntimes(files, manifest);
  const checks = detectChecks(manifest.scripts);
  const topLevelDirectories = topLevelDirectoriesFor(files);
  const importantFiles = IMPORTANT_FILES.filter((file) => files.includes(file));
  const workflowFiles = files.filter((file) =>
    file.startsWith('.github/workflows/'),
  );
  const sampleFiles = files.slice(0, 40);
  const gaps = buildGaps({
    files,
    checks,
    readmeHeadings,
    workflowFiles,
  });
  const repository = snapshot
    ? repositoryEvidence(snapshot)
    : {
        path: root,
        repositoryId: gitRepository?.repositoryId ?? null,
        headCommit: gitRepository?.headCommit ?? null,
        baseCommit: null,
        baseKind: 'not-a-git-repository' as const,
        stable: null,
        changedPaths: [],
      };

  return {
    schemaVersion: VERSION,
    specKind: 'repository-baseline',
    status: 'draft',
    generatedAt,
    repository,
    project: {
      name: manifest.name,
      description: manifest.description,
      languages,
      runtimes,
      packageManager,
      entrypoints: manifest.entrypoints,
      scripts: manifest.scripts,
      checks,
      readmeHeadings,
    },
    evidence: {
      fileCount: files.length,
      sampleFiles,
      importantFiles,
      workflowFiles,
      topLevelDirectories,
    },
    contract: {
      intent: 'missing',
      acceptance: 'missing',
      verification: checks.length ? 'observed' : 'missing',
      taste: 'missing',
      release: 'missing',
    },
    gaps,
    nextActions: buildNextActions(gaps, checks),
  };
}

export function renderRepositoryBaselineMarkdown(
  spec: RepositoryBaselineSpec,
): string {
  const checks = spec.project.checks.length
    ? spec.project.checks.map(
        (check) =>
          '- `' +
          check.name +
          '`: `' +
          check.command +
          '` (' +
          check.purpose +
          ')',
      )
    : ['- None observed. Add at least one repeatable verification command.'];
  const gaps = spec.gaps.length
    ? spec.gaps.map((gap) => `- ${gap}`)
    : ['- None observed. Human contract review is still required.'];
  const nextActions = spec.nextActions.map((action) => `- ${action}`);
  const sampleFiles = spec.evidence.sampleFiles.length
    ? spec.evidence.sampleFiles.map((file) => `- \`${file}\``)
    : ['- No non-ignored files were observed.'];
  const importantFiles = spec.evidence.importantFiles.length
    ? spec.evidence.importantFiles.map((file) => `- \`${file}\``)
    : ['- None observed.'];
  const workflows = spec.evidence.workflowFiles.length
    ? spec.evidence.workflowFiles.map((file) => `- \`${file}\``)
    : ['- None observed.'];
  const changedPaths = spec.repository.changedPaths.length
    ? spec.repository.changedPaths.map((file) => `- \`${file}\``)
    : ['- None observed relative to the selected base.'];
  const entrypoints = spec.project.entrypoints.length
    ? spec.project.entrypoints.map((entrypoint) => `- \`${entrypoint}\``)
    : ['- None declared in package metadata.'];
  const headings = spec.project.readmeHeadings.length
    ? spec.project.readmeHeadings.map((heading) => `- ${heading}`)
    : ['- No README headings observed.'];
  const languages = spec.project.languages.length
    ? spec.project.languages.join(', ')
    : 'unknown';
  const runtimes = spec.project.runtimes.length
    ? spec.project.runtimes.join(', ')
    : 'unknown';
  const scripts = Object.entries(spec.project.scripts);
  const scriptLines = scripts.length
    ? scripts.map(([name, command]) => `- \`${name}\`: \`${command}\``)
    : ['- None observed.'];
  const topLevelDirectories = spec.evidence.topLevelDirectories.length
    ? spec.evidence.topLevelDirectories.map(
        (directory) => `- \`${directory}/\``,
      )
    : ['- None observed.'];

  return [
    '# Repository Contract Draft',
    '',
    '> Generated by SpecPort from repository evidence. This is a grounded starting point, not an accepted product contract.',
    '',
    `- Status: **${spec.status} — human contract work required**`,
    `- Generated: \`${spec.generatedAt}\``,
    `- Repository: \`${spec.repository.path}\``,
    '- Repository identity: `' +
      (spec.repository.repositoryId ?? 'not available') +
      '`',
    '',
    '## What was observed',
    '',
    `- Project: **${spec.project.name ?? 'unnamed'}**`,
    `- Description: ${spec.project.description ?? 'not declared'}`,
    `- Languages: ${languages}`,
    `- Runtimes: ${runtimes}`,
    `- Package manager: ${spec.project.packageManager ?? 'not detected'}`,
    `- Files observed: ${spec.evidence.fileCount}`,
    '- Base: `' +
      (spec.repository.baseCommit ?? spec.repository.baseKind) +
      '`',
    `- Working tree: ${spec.repository.stable === null ? 'not a Git repository' : spec.repository.stable ? 'stable' : 'unstable'}`,
    '',
    '## Declared entrypoints',
    '',
    ...entrypoints,
    '',
    '## Intent contract — human input required',
    '',
    '- Owner: `[NEEDS HUMAN INPUT]`',
    '- User and job: `[NEEDS HUMAN INPUT]`',
    '- Intended outcome: `[NEEDS HUMAN INPUT]`',
    '- Non-goals: `[NEEDS HUMAN INPUT]`',
    '- Success boundary: `[NEEDS HUMAN INPUT]`',
    '',
    '## Acceptance contract — human input required',
    '',
    '- Add scenario-based acceptance criteria with an identifier, expected behavior, evidence, and risk.',
    '- Every criterion must say how a reviewer can tell that it is true.',
    '- Add explicit forbidden behavior; absence of a bug is not a complete contract.',
    '',
    '## Verification contract',
    '',
    'Observed checks (not run by `spec discover`):',
    ...checks,
    '',
    'Declared scripts:',
    ...scriptLines,
    '',
    '## Taste contract — human input required',
    '',
    '- Reviewer: `[NEEDS HUMAN INPUT]`',
    '- Rubric: `[NEEDS HUMAN INPUT]`',
    '- Evidence: screenshots, recordings, listening notes, or a hands-on review appropriate to the product.',
    '- Automation may report facts; it must not impersonate human taste or approval.',
    '',
    '## Release contract — human input required',
    '',
    '- Target: `[NEEDS HUMAN INPUT]`',
    '- Version and compatibility policy: `[NEEDS HUMAN INPUT]`',
    '- Security, privacy, performance, and rollback requirements: `[NEEDS HUMAN INPUT]`',
    '- Ship decision owner: `[NEEDS HUMAN INPUT]`',
    '',
    '## Repository evidence',
    '',
    '### Important files',
    '',
    ...importantFiles,
    '',
    '### CI and workflow files',
    '',
    ...workflows,
    '',
    '### Top-level directories',
    '',
    ...topLevelDirectories,
    '',
    '### README headings',
    '',
    ...headings,
    '',
    '### Changed paths at generation time',
    '',
    ...changedPaths,
    '',
    '### Sample of observed files',
    '',
    ...sampleFiles,
    '',
    '## Gaps',
    '',
    ...gaps,
    '',
    '## Next actions',
    '',
    ...nextActions,
    '',
    '## Machine-readable baseline',
    '',
    'The JSON form is the evidence record. Treat fields marked missing as unresolved rather than filling them with assumptions.',
    '',
    '```json',
    JSON.stringify(spec, null, 2),
    '```',
    '',
  ].join('\n');
}

async function tryDiscoverRepository(
  requested: string,
): Promise<Awaited<ReturnType<typeof discoverRepository>> | null> {
  try {
    return await discoverRepository(requested);
  } catch {
    return null;
  }
}

async function tryCaptureSnapshot(
  root: string,
): Promise<FinalTreeSnapshot | null> {
  try {
    return await captureFinalTree(root);
  } catch {
    return null;
  }
}

async function listRepositoryFiles(
  root: string,
  isGitRepository: boolean,
): Promise<string[]> {
  if (isGitRepository) {
    const output = await tryRunGit(root, [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ]);
    if (output !== null) {
      return output
        .split('\0')
        .filter(Boolean)
        .map((file) => file.replaceAll('\\', '/'))
        .sort();
    }
  }
  const files: string[] = [];
  await walk(root, root, files);
  return files.sort();
}

async function walk(
  root: string,
  current: string,
  files: string[],
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(root, absolute, files);
      continue;
    }
    if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(relative(root, absolute).replaceAll('\\', '/'));
    }
  }
}

async function readPackageManifest(root: string): Promise<PackageManifest> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(root, 'package.json'), 'utf8'),
    );
    if (!isRecord(parsed)) return emptyManifest();
    const scripts = stringRecord(parsed.scripts);
    const engines = stringRecord(parsed.engines);
    const entrypoints = new Set<string>();
    for (const key of [
      'main',
      'module',
      'types',
      'typings',
      'bin',
      'exports',
    ]) {
      const value = parsed[key];
      if (typeof value === 'string') entrypoints.add(`${key}: ${value}`);
      else if (isRecord(value)) entrypoints.add(`${key}: declared`);
    }
    return {
      name: typeof parsed.name === 'string' ? parsed.name : null,
      description:
        typeof parsed.description === 'string' ? parsed.description : null,
      engines,
      scripts,
      entrypoints: [...entrypoints].sort(),
    };
  } catch {
    return emptyManifest();
  }
}

function emptyManifest(): PackageManifest {
  return {
    name: null,
    description: null,
    engines: {},
    scripts: {},
    entrypoints: [],
  };
}

async function readMarkdownHeadings(path: string): Promise<string[]> {
  try {
    const text = await readFile(path, 'utf8');
    return text
      .split(/\r?\n/)
      .map((line) => /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(line)?.[1])
      .filter((heading): heading is string => Boolean(heading))
      .slice(0, 20);
  } catch {
    return [];
  }
}

function detectPackageManager(
  files: readonly string[],
  manifest: PackageManifest,
): string | null {
  const candidates: Array<[string, string]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
    ['package-lock.json', 'npm'],
  ];
  for (const [file, manager] of candidates) {
    if (files.includes(file)) return manager;
  }
  return manifest.name ? 'npm-compatible' : null;
}

function detectLanguages(files: readonly string[]): string[] {
  const languages = new Set<string>();
  if (
    files.some((file) => /\.(ts|tsx)$/.test(file) || file === 'tsconfig.json')
  )
    languages.add('TypeScript');
  if (files.some((file) => /\.(js|jsx|mjs|cjs)$/.test(file)))
    languages.add('JavaScript');
  if (
    files.some(
      (file) =>
        file === 'pyproject.toml' ||
        file === 'requirements.txt' ||
        file.endsWith('.py'),
    )
  )
    languages.add('Python');
  if (
    files.includes('Cargo.toml') ||
    files.some((file) => file.endsWith('.rs'))
  )
    languages.add('Rust');
  if (files.includes('go.mod') || files.some((file) => file.endsWith('.go')))
    languages.add('Go');
  if (files.includes('pom.xml') || files.some((file) => file.endsWith('.java')))
    languages.add('Java');
  return [...languages].sort();
}

function detectRuntimes(
  files: readonly string[],
  manifest: PackageManifest,
): string[] {
  const runtimes = new Set<string>();
  if (manifest.engines.node) runtimes.add(`Node.js ${manifest.engines.node}`);
  else if (manifest.name) runtimes.add('Node.js (version not declared)');
  if (files.includes('pyproject.toml') || files.includes('requirements.txt'))
    runtimes.add('Python (version not declared)');
  if (files.includes('Cargo.toml')) runtimes.add('Rust (version not declared)');
  if (files.includes('go.mod')) runtimes.add('Go (version not declared)');
  return [...runtimes].sort();
}

function detectChecks(
  scripts: Readonly<Record<string, string>>,
): RepositoryCheck[] {
  return Object.entries(scripts)
    .filter(([name]) =>
      /(^|:)(build|ci|check|e2e|integration|lint|pack|test|typecheck|verify)(:|$)/i.test(
        name,
      ),
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, command]) => ({
      name,
      command: `npm run ${name}`,
      purpose: purposeForCheck(name, command),
    }));
}

function purposeForCheck(
  name: string,
  command: string,
): RepositoryCheck['purpose'] {
  if (/build|pack/i.test(name) || /build|pack/i.test(command)) return 'build';
  if (/lint|typecheck|check|verify|ci/i.test(name)) return 'quality';
  if (/test|e2e|integration/i.test(name)) return 'test';
  return 'release';
}

function topLevelDirectoriesFor(files: readonly string[]): string[] {
  return [
    ...new Set(
      files
        .filter((file) => file.includes('/'))
        .map((file) => file.slice(0, file.indexOf('/'))),
    ),
  ].sort();
}

function buildGaps(input: {
  files: readonly string[];
  checks: readonly RepositoryCheck[];
  readmeHeadings: readonly string[];
  workflowFiles: readonly string[];
}): string[] {
  const gaps: string[] = [];
  if (!input.files.includes('README.md'))
    gaps.push(
      'No README.md was observed; the user-facing contract is not documented.',
    );
  if (!input.readmeHeadings.length)
    gaps.push('No readable product/documentation headings were observed.');
  if (!input.checks.some((check) => check.purpose === 'test'))
    gaps.push('No test command was observed in the detected project scripts.');
  if (!input.checks.some((check) => check.purpose === 'quality'))
    gaps.push('No lint/typecheck/verification command was observed.');
  if (!input.checks.some((check) => check.purpose === 'build'))
    gaps.push('No build or packaging command was observed.');
  if (!input.workflowFiles.length)
    gaps.push(
      'No GitHub Actions workflow was observed; release automation is unproven.',
    );
  gaps.push(
    'Product owner, user job, outcome, and non-goals still require human input.',
  );
  gaps.push(
    'Scenario acceptance criteria and forbidden behaviors still require human input.',
  );
  gaps.push(
    'Taste reviewer and a product-specific human rubric still require human input.',
  );
  gaps.push(
    'Release target, compatibility, security, rollback, and ship authority still require human input.',
  );
  return gaps;
}

function buildNextActions(
  gaps: readonly string[],
  checks: readonly RepositoryCheck[],
): string[] {
  const actions = [
    'Edit the generated draft into an accepted product contract; do not treat observed code as intent.',
    'Add acceptance scenarios with evidence and explicit forbidden behavior.',
    'Name a human taste owner and write a rubric appropriate to the product.',
    'Declare the release target, compatibility policy, security/privacy requirements, and rollback path.',
  ];
  if (checks.length) {
    actions.push(
      'Run the observed checks after implementation and record their exact results.',
    );
  } else {
    actions.push(
      'Declare at least one repeatable build, quality, test, or release check.',
    );
  }
  if (gaps.some((gap) => gap.includes('GitHub Actions')))
    actions.push(
      'Add CI that runs the contract checks on the same artifact intended for release.',
    );
  return actions;
}

function repositoryEvidence(
  snapshot: FinalTreeSnapshot,
): RepositoryBaselineSpec['repository'] {
  return {
    path: snapshot.repositoryPath,
    repositoryId: snapshot.repositoryId,
    headCommit: snapshot.headCommit,
    baseCommit: snapshot.baseCommit,
    baseKind: snapshot.baseKind,
    stable: snapshot.stable,
    changedPaths: snapshot.entries.map((entry) => entry.path),
  };
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
