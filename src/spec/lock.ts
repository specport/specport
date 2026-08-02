import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, realpath, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fingerprintCanonical, normalizeRepoPath } from '../core/coverage.js';
import type { FinalTreeSnapshot } from '../core/types.js';
import { runGit } from '../git/command.js';
import { captureFinalTree, discoverRepository } from '../git/snapshot.js';
import { VERSION } from '../version.js';
import { checkSpecText, type SpecCheckResult } from './authoring.js';

export const DEFAULT_SPEC_LOCK_PATH = 'SPEC.lock';
const DEFAULT_IGNORED_PATHS = ['.specport/'];

export interface SpecLockFile {
  path: string;
  present: boolean;
  bytes: number;
  sha256: string | null;
}

export interface SpecLock {
  schemaVersion: string;
  artifactKind: 'spec-lock';
  status: 'draft';
  generatedAt: string;
  tool: {
    name: '@specport/specport';
    version: string;
  };
  spec: SpecLockFile & {
    readiness: SpecCheckResult['readiness'];
    accepted: boolean;
  };
  repository: {
    root: string;
    repositoryId: string | null;
    headCommit: string | null;
    baseCommit: string | null;
    baseKind: 'commit' | 'empty-tree' | 'not-a-git-repository';
    finalTreeFingerprint: string | null;
    stable: boolean | null;
    ignoredPaths: readonly string[];
  };
  artifacts: {
    contract: SpecLockFile;
    baseline: SpecLockFile;
    map: SpecLockFile;
  };
  safety: {
    codeExecuted: false;
    networkAccessed: false;
  };
}

export type DriftCheckStatus =
  | 'match'
  | 'changed'
  | 'missing'
  | 'not-recorded'
  | 'unknown';

export interface SpecDriftCheck {
  name: 'spec' | 'contract' | 'baseline' | 'map' | 'repository';
  status: DriftCheckStatus;
  path: string;
  expected: string | null;
  actual: string | null;
}

export interface SpecDriftIssue {
  code:
    | 'lock-invalid'
    | 'file-changed'
    | 'file-missing'
    | 'file-appeared'
    | 'repository-changed'
    | 'repository-unavailable';
  check: SpecDriftCheck['name'];
  path: string;
  message: string;
  severity: 'drifted' | 'unknown';
}

export interface SpecDriftReport {
  schemaVersion: string;
  artifactKind: 'spec-drift';
  status: 'clean' | 'drifted' | 'unknown';
  generatedAt: string;
  lockPath: string;
  repository: {
    root: string | null;
    repositoryId: string | null;
    finalTreeFingerprint: string | null;
  };
  checks: readonly SpecDriftCheck[];
  issues: readonly SpecDriftIssue[];
  safety: {
    codeExecuted: false;
    networkAccessed: false;
  };
}

export async function createSpecLock(
  specPath = 'SPEC.md',
  lockPath = DEFAULT_SPEC_LOCK_PATH,
  generatedAt = new Date().toISOString(),
): Promise<SpecLock> {
  const absoluteSpecPath = resolve(specPath);
  const specInfo = await stat(absoluteSpecPath);
  if (!specInfo.isFile())
    throw new Error(`spec lock requires a file: ${absoluteSpecPath}`);
  const specBytes = await readFile(absoluteSpecPath);
  const specText = specBytes.toString('utf8');
  const specCheck = checkSpecText(absoluteSpecPath, specText);
  const gitRepository = await tryDiscoverRepository(dirname(absoluteSpecPath));
  const root =
    gitRepository?.root ?? (await realpath(dirname(absoluteSpecPath)));
  const absoluteLockPath = resolve(lockPath);
  const ignoredPaths = ignoredPathsFor(root, absoluteLockPath);
  const finalTree = gitRepository ? await tryCaptureFinalTree(root) : null;
  const finalTreeFingerprint = gitRepository
    ? await tryCaptureSourceTreeFingerprint(root, ignoredPaths)
    : null;

  return {
    schemaVersion: VERSION,
    artifactKind: 'spec-lock',
    status: 'draft',
    generatedAt,
    tool: {
      name: '@specport/specport',
      version: VERSION,
    },
    spec: {
      ...fileSnapshot(relativePath(root, absoluteSpecPath), specBytes),
      readiness: specCheck.readiness,
      accepted: specCheck.accepted,
    },
    repository: repositorySnapshot(
      root,
      gitRepository,
      finalTree,
      finalTreeFingerprint,
      ignoredPaths,
    ),
    artifacts: {
      contract: await snapshotRepositoryFile(root, '.specport/contract.json'),
      baseline: await snapshotRepositoryFile(
        root,
        '.specport/repository-baseline.json',
      ),
      map: await snapshotRepositoryFile(root, '.specport/repo-map.json'),
    },
    safety: {
      codeExecuted: false,
      networkAccessed: false,
    },
  };
}

export async function checkSpecDrift(
  specPath: string | undefined,
  lockPath = DEFAULT_SPEC_LOCK_PATH,
  generatedAt = new Date().toISOString(),
): Promise<SpecDriftReport> {
  const absoluteLockPath = resolve(lockPath);
  let lock: SpecLock;
  try {
    lock = await readLock(absoluteLockPath);
  } catch (error) {
    return {
      schemaVersion: VERSION,
      artifactKind: 'spec-drift',
      status: 'unknown',
      generatedAt,
      lockPath: absoluteLockPath,
      repository: {
        root: null,
        repositoryId: null,
        finalTreeFingerprint: null,
      },
      checks: [],
      issues: [
        {
          code: 'lock-invalid',
          check: 'spec',
          path: absoluteLockPath,
          message:
            error instanceof Error
              ? error.message
              : `Could not read a valid SPEC.lock at ${absoluteLockPath}.`,
          severity: 'unknown',
        },
      ],
      safety: {
        codeExecuted: false,
        networkAccessed: false,
      },
    };
  }

  const root = resolve(lock.repository.root);
  const currentSpecPath = specPath
    ? resolve(specPath)
    : resolve(root, ...lock.spec.path.split('/'));
  const checks: SpecDriftCheck[] = [];
  const issues: SpecDriftIssue[] = [];
  await compareFile('spec', lock.spec, currentSpecPath, checks, issues);
  await compareFile(
    'contract',
    lock.artifacts.contract,
    resolveRepositoryFile(root, lock.artifacts.contract.path),
    checks,
    issues,
  );
  await compareFile(
    'baseline',
    lock.artifacts.baseline,
    resolveRepositoryFile(root, lock.artifacts.baseline.path),
    checks,
    issues,
  );
  await compareFile(
    'map',
    lock.artifacts.map,
    resolveRepositoryFile(root, lock.artifacts.map.path),
    checks,
    issues,
  );

  const currentTree = await tryCaptureFinalTree(root);
  const actualFingerprint = currentTree
    ? await tryCaptureSourceTreeFingerprint(root, lock.repository.ignoredPaths)
    : null;
  const repositoryCheck: SpecDriftCheck = {
    name: 'repository',
    status: lock.repository.finalTreeFingerprint
      ? currentTree
        ? actualFingerprint === lock.repository.finalTreeFingerprint
          ? 'match'
          : 'changed'
        : 'unknown'
      : 'not-recorded',
    path: root,
    expected: lock.repository.finalTreeFingerprint,
    actual: actualFingerprint,
  };
  checks.push(repositoryCheck);
  if (repositoryCheck.status === 'changed') {
    issues.push({
      code: 'repository-changed',
      check: 'repository',
      path: root,
      message:
        'The final Git-visible source tree fingerprint differs from SPEC.lock.',
      severity: 'drifted',
    });
  } else if (repositoryCheck.status === 'unknown') {
    issues.push({
      code: 'repository-unavailable',
      check: 'repository',
      path: root,
      message: 'The repository tree could not be captured for comparison.',
      severity: 'unknown',
    });
  }

  return {
    schemaVersion: VERSION,
    artifactKind: 'spec-drift',
    status: issues.some((issue) => issue.severity === 'drifted')
      ? 'drifted'
      : issues.length
        ? 'unknown'
        : 'clean',
    generatedAt,
    lockPath: absoluteLockPath,
    repository: {
      root,
      repositoryId: currentTree?.repositoryId ?? lock.repository.repositoryId,
      finalTreeFingerprint: actualFingerprint,
    },
    checks,
    issues,
    safety: {
      codeExecuted: false,
      networkAccessed: false,
    },
  };
}

export function renderSpecDriftHuman(report: SpecDriftReport): string {
  return [
    `DRIFT      ${report.status}`,
    `LOCK       ${report.lockPath}`,
    `REPOSITORY ${report.repository.root ?? 'not available'}`,
    ...report.checks.map(
      (check) => `CHECK      ${check.name}: ${check.status} (${check.path})`,
    ),
    ...(report.issues.length
      ? report.issues.map(
          (issue) => `ISSUE      ${issue.code}: ${issue.message}`,
        )
      : ['ISSUE      none']),
    `SAFETY     code=not executed network=not accessed`,
    '',
  ].join('\n');
}

async function readLock(path: string): Promise<SpecLock> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `Could not read SPEC.lock at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!isSpecLock(parsed))
    throw new Error(`Invalid SPEC.lock artifact at ${path}.`);
  return parsed;
}

async function compareFile(
  name: SpecDriftCheck['name'],
  expected: SpecLockFile,
  actualPath: string,
  checks: SpecDriftCheck[],
  issues: SpecDriftIssue[],
): Promise<void> {
  const actual = await tryReadFile(actualPath);
  let status: DriftCheckStatus;
  if (actual.error) status = 'unknown';
  else if (!actual.present && !expected.present) status = 'not-recorded';
  else if (!actual.present && expected.present) status = 'missing';
  else if (actual.present && !expected.present) status = 'changed';
  else if (actual.sha256 === expected.sha256) status = 'match';
  else status = 'changed';
  const check: SpecDriftCheck = {
    name,
    status,
    path: actualPath,
    expected: expected.sha256,
    actual: actual.sha256,
  };
  checks.push(check);
  if (status === 'missing') {
    issues.push({
      code: 'file-missing',
      check: name,
      path: actualPath,
      message: `The locked ${name} file is missing.`,
      severity: 'drifted',
    });
  } else if (status === 'changed') {
    issues.push({
      code:
        actual.present && expected.present ? 'file-changed' : 'file-appeared',
      check: name,
      path: actualPath,
      message: expected.present
        ? `The locked ${name} file has changed.`
        : `A ${name} file appeared after SPEC.lock was created.`,
      severity: 'drifted',
    });
  } else if (actual.error) {
    issues.push({
      code: 'lock-invalid',
      check: name,
      path: actualPath,
      message: actual.error,
      severity: 'unknown',
    });
  }
}

async function snapshotRepositoryFile(
  root: string,
  path: string,
): Promise<SpecLockFile> {
  const absolute = resolveRepositoryFile(root, path);
  const content = await tryReadFile(absolute);
  return fileSnapshot(path, {
    bytes: content.bytes,
    present: content.present,
  });
}

function fileSnapshot(path: string, content: Uint8Array): SpecLockFile;
function fileSnapshot(
  path: string,
  content: { bytes: Uint8Array; present: boolean },
): SpecLockFile;
function fileSnapshot(
  path: string,
  content: Uint8Array | { bytes: Uint8Array; present: boolean },
): SpecLockFile {
  const bytes = content instanceof Uint8Array ? content : content.bytes;
  const present = content instanceof Uint8Array ? true : content.present;
  return {
    path: normalizeRelativePath(path),
    present,
    bytes: present ? bytes.byteLength : 0,
    sha256: present ? createHash('sha256').update(bytes).digest('hex') : null,
  };
}

async function tryReadFile(path: string): Promise<{
  bytes: Uint8Array;
  present: boolean;
  sha256: string | null;
  error?: string;
}> {
  try {
    const bytes = await readFile(path);
    return {
      bytes,
      present: true,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (error) {
    if (isNodeError(error, 'ENOENT'))
      return { bytes: new Uint8Array(), present: false, sha256: null };
    return {
      bytes: new Uint8Array(),
      present: false,
      sha256: null,
      error: `Could not read ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function repositorySnapshot(
  root: string,
  gitRepository: Awaited<ReturnType<typeof discoverRepository>> | null,
  finalTree: FinalTreeSnapshot | null,
  finalTreeFingerprint: string | null,
  ignoredPaths: readonly string[],
): SpecLock['repository'] {
  return {
    root,
    repositoryId:
      finalTree?.repositoryId ?? gitRepository?.repositoryId ?? null,
    headCommit: finalTree?.headCommit ?? gitRepository?.headCommit ?? null,
    baseCommit: finalTree?.baseCommit ?? null,
    baseKind: finalTree?.baseKind ?? 'not-a-git-repository',
    finalTreeFingerprint,
    stable: finalTree?.stable ?? null,
    ignoredPaths,
  };
}

async function captureSourceTreeFingerprint(
  root: string,
  ignoredPaths: readonly string[],
): Promise<string> {
  const paths = (
    await runGit(root, [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ])
  )
    .split('\0')
    .filter(Boolean)
    .map(normalizeRepoPath)
    .filter(
      (path, index, all) =>
        all.indexOf(path) === index &&
        !ignoredPaths.some((ignored) => pathMatches(path, ignored)),
    )
    .sort();
  const entries: { path: string; fingerprint: string }[] = [];
  for (const path of paths) {
    entries.push({
      path,
      fingerprint: await hashWorkingTreeFile(resolveRepositoryFile(root, path)),
    });
  }
  return fingerprintCanonical({ entries });
}

async function hashWorkingTreeFile(path: string): Promise<string> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) {
    return createHash('sha256')
      .update(`symlink:${await readlink(path)}`)
      .digest('hex');
  }
  if (!stats.isFile()) {
    return createHash('sha256')
      .update(`mode:${stats.mode.toString(8)}`)
      .digest('hex');
  }
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function tryCaptureSourceTreeFingerprint(
  root: string,
  ignoredPaths: readonly string[],
): Promise<string | null> {
  try {
    return await captureSourceTreeFingerprint(root, ignoredPaths);
  } catch {
    return null;
  }
}

function ignoredPathsFor(root: string, lockPath: string): string[] {
  const relativeLock = relativePath(root, lockPath);
  return [
    ...DEFAULT_IGNORED_PATHS,
    ...(relativeLock.startsWith('..') ? [] : [relativeLock]),
  ];
}

function pathMatches(path: string, ignored: string): boolean {
  const normalizedPath = normalizeRelativePath(path);
  const normalizedIgnored = normalizeRelativePath(ignored).replace(/\/$/, '');
  return (
    normalizedPath === normalizedIgnored ||
    normalizedPath.startsWith(`${normalizedIgnored}/`)
  );
}

function resolveRepositoryFile(root: string, path: string): string {
  return resolve(root, ...normalizeRepoPath(path).split('/'));
}

function relativePath(root: string, path: string): string {
  const value = relative(root, path).replaceAll('\\', '/');
  return normalizeRelativePath(value || '.');
}

function normalizeRelativePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isSpecLock(value: unknown): value is SpecLock {
  if (!isRecord(value)) return false;
  const repository = value.repository;
  const spec = value.spec;
  return (
    value.artifactKind === 'spec-lock' &&
    value.status === 'draft' &&
    isRecord(repository) &&
    typeof repository.root === 'string' &&
    isRecord(spec) &&
    typeof spec.path === 'string' &&
    typeof spec.present === 'boolean' &&
    (typeof spec.sha256 === 'string' || spec.sha256 === null) &&
    isRecord(value.artifacts) &&
    isRecord(value.artifacts.contract) &&
    isRecord(value.artifacts.baseline) &&
    isRecord(value.artifacts.map)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
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

async function tryCaptureFinalTree(
  root: string,
): Promise<FinalTreeSnapshot | null> {
  try {
    return await captureFinalTree(root);
  } catch {
    return null;
  }
}
