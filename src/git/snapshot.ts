import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdtemp,
  readlink,
  realpath,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fingerprintCanonical, normalizeRepoPath } from '../core/coverage.js';
import type {
  ChangedPath,
  ChangeState,
  FinalTreeSnapshot,
  PathStatus,
} from '../core/types.js';
import { runGit, tryRunGit } from './command.js';
import { fingerprintPatch, parseUnifiedDiff } from './patch.js';

export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export interface GitRepository {
  root: string;
  repositoryId: string;
  headCommit: string | null;
}

export interface GitStatusRecord {
  path: string;
  oldPath?: string;
  state: ChangeState;
}

interface IndexEntry {
  mode: string;
  object: string;
  stage: string;
  path: string;
}

export async function discoverRepository(
  start = process.cwd(),
): Promise<GitRepository> {
  const root = (await runGit(start, ['rev-parse', '--show-toplevel'])).trim();
  const resolvedRoot = await realpath(root);
  const head =
    (
      await tryRunGit(resolvedRoot, ['rev-parse', '--verify', 'HEAD'])
    )?.trim() || null;
  return {
    root: resolvedRoot,
    repositoryId: repositoryIdentity(resolvedRoot),
    headCommit: head,
  };
}

export async function resolveBaseCommit(
  repository: GitRepository,
  baseRef?: string,
): Promise<{ commit: string | null; kind: 'commit' | 'empty-tree' }> {
  if (baseRef) {
    if (baseRef.startsWith('-'))
      throw new Error('base-invalid: base ref must not start with a dash.');
    let commit: string;
    try {
      commit = (
        await runGit(repository.root, [
          'rev-parse',
          '--verify',
          `${baseRef}^{commit}`,
        ])
      ).trim();
    } catch (error) {
      throw new Error(
        `base-invalid: could not resolve comparison base "${baseRef}" (${error instanceof Error ? error.message : String(error)}).`,
      );
    }
    return { commit, kind: 'commit' };
  }
  if (repository.headCommit)
    return { commit: repository.headCommit, kind: 'commit' };
  return { commit: null, kind: 'empty-tree' };
}

export async function captureFinalTree(
  start = process.cwd(),
  baseRef?: string,
): Promise<FinalTreeSnapshot> {
  const repository = await discoverRepository(start);
  const base = await resolveBaseCommit(repository, baseRef);
  const tempRoot = await mkdtemp(join(tmpdir(), 'specport-index-'));
  const indexPath = join(tempRoot, 'index');
  const environment = { GIT_INDEX_FILE: indexPath };
  try {
    const actualIndexPath = (
      await tryRunGit(repository.root, ['rev-parse', '--git-path', 'index'])
    )?.trim();
    let copiedActualIndex = false;
    let preserveActualIndexModes = false;
    let originalIndexEntries: IndexEntry[] = [];
    if (actualIndexPath) {
      try {
        await copyFile(resolve(repository.root, actualIndexPath), indexPath);
        copiedActualIndex = true;
        originalIndexEntries = await readIndexEntries(repository.root);
        preserveActualIndexModes = true;
      } catch {
        copiedActualIndex = false;
      }
    }
    if (!copiedActualIndex) {
      if (base.commit) {
        await runGit(repository.root, ['read-tree', base.commit], environment);
      } else {
        await runGit(repository.root, ['read-tree', '--empty'], environment);
      }
    }
    try {
      await runGit(repository.root, ['add', '--all', '--', '.'], environment);
    } catch {
      preserveActualIndexModes = false;
      if (!copiedActualIndex)
        throw new Error('Could not materialize the final Git tree.');
      if (base.commit) {
        await runGit(repository.root, ['read-tree', base.commit], environment);
      } else {
        await runGit(repository.root, ['read-tree', '--empty'], environment);
      }
      await runGit(repository.root, ['add', '--all', '--', '.'], environment);
    }
    if (preserveActualIndexModes && base.commit) {
      await preserveIndexOnlyModes(
        repository.root,
        base.commit,
        environment,
        originalIndexEntries,
      );
    }
    const diff = await runGit(
      repository.root,
      [
        'diff',
        '--cached',
        '--name-status',
        '-z',
        '--find-renames=50%',
        base.commit ?? EMPTY_TREE_SHA,
      ],
      environment,
    );
    const status = parsePorcelainStatus(
      await runGit(repository.root, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
      ]),
    );
    const entries = await enrichEntries(
      repository.root,
      parseNameStatus(diff),
      status,
    );
    const patchText = await runGit(
      repository.root,
      [
        '-c',
        'core.quotepath=false',
        'diff',
        '--cached',
        '--binary',
        '--full-index',
        '--find-renames=50%',
        '--unified=3',
        base.commit ?? EMPTY_TREE_SHA,
      ],
      environment,
    );
    const parsedPatch = parseUnifiedDiff(patchText);
    const patchFingerprint = parsedPatch.binary
      ? undefined
      : fingerprintPatch(base.commit ?? EMPTY_TREE_SHA, parsedPatch.files);
    const fingerprint = fingerprintCanonical({
      baseCommit: base.commit ?? EMPTY_TREE_SHA,
      entries: entries.map((entry) => ({
        path: entry.path,
        oldPath: entry.oldPath ?? null,
        status: entry.status,
        fingerprint: entry.fingerprint ?? null,
      })),
    });
    return {
      repositoryPath: repository.root,
      repositoryId: repository.repositoryId,
      headCommit: repository.headCommit,
      baseCommit: base.commit,
      baseKind: base.kind,
      entries,
      fingerprint,
      ...(patchFingerprint ? { patchFingerprint } : {}),
      stable:
        entries.every(
          (entry) =>
            entry.status !== 'conflicted' && !isUnmergedState(entry.state),
        ) && status.every((record) => !isUnmergedState(record.state)),
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function preserveIndexOnlyModes(
  repositoryPath: string,
  baseCommit: string,
  environment: Readonly<Record<string, string | undefined>>,
  originalIndexEntries: readonly IndexEntry[],
): Promise<void> {
  const baseModes = new Map(await readTreeEntries(repositoryPath, baseCommit));
  const stagedModeChanges = originalIndexEntries.filter((entry) => {
    if (entry.stage !== '0') return false;
    const baseMode = baseModes.get(entry.path);
    return baseMode !== undefined && baseMode !== entry.mode;
  });
  if (!stagedModeChanges.length) return;

  const finalEntries = new Map(
    (await readIndexEntries(repositoryPath, environment)).map((entry) => [
      entry.path,
      entry,
    ]),
  );
  for (const stagedEntry of stagedModeChanges) {
    const finalEntry = finalEntries.get(stagedEntry.path);
    if (!finalEntry || finalEntry.mode === stagedEntry.mode) continue;
    await runGit(
      repositoryPath,
      [
        'update-index',
        '--add',
        '--cacheinfo',
        stagedEntry.mode,
        finalEntry.object,
        finalEntry.path,
      ],
      environment,
    );
  }
}

async function readIndexEntries(
  repositoryPath: string,
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<IndexEntry[]> {
  return parseIndexEntries(
    await runGit(repositoryPath, ['ls-files', '--stage', '-z'], environment),
  );
}

function parseIndexEntries(output: string): IndexEntry[] {
  return output
    .split('\0')
    .filter(Boolean)
    .flatMap((token) => {
      const tab = token.indexOf('\t');
      if (tab < 0) return [];
      const header = token.slice(0, tab).split(' ');
      const path = token.slice(tab + 1);
      const mode = header[0];
      const object = header[1];
      const stage = header[2];
      if (!mode || !object || !stage || !path) return [];
      return [{ mode, object, stage, path: normalizeRepoPath(path) }];
    });
}

async function readTreeEntries(
  repositoryPath: string,
  baseCommit: string,
): Promise<Array<[string, string]>> {
  return (await runGit(repositoryPath, ['ls-tree', '-r', '-z', baseCommit]))
    .split('\0')
    .filter(Boolean)
    .flatMap((token) => {
      const tab = token.indexOf('\t');
      if (tab < 0) return [];
      const header = token.slice(0, tab).split(' ');
      const mode = header[0];
      const path = token.slice(tab + 1);
      if (!mode || !path) return [];
      return [[normalizeRepoPath(path), mode]] as Array<[string, string]>;
    });
}

function isUnmergedState(state: ChangeState | undefined): boolean {
  if (!state) return false;
  if (state.index === 'U' || state.worktree === 'U') return true;
  return (
    (state.index === 'A' || state.index === 'D') &&
    (state.worktree === 'A' || state.worktree === 'D')
  );
}

export function parseNameStatus(output: string): ChangedPath[] {
  const tokens = output.split('\0');
  const entries: ChangedPath[] = [];
  let cursor = 0;
  while (cursor < tokens.length) {
    const statusToken = tokens[cursor++];
    if (!statusToken) continue;
    const first = statusToken[0];
    const firstPath = tokens[cursor++];
    if (firstPath === undefined) break;
    if (first === 'R' || first === 'C') {
      const secondPath = tokens[cursor++];
      if (secondPath === undefined) break;
      entries.push({
        path: normalizeRepoPath(secondPath),
        oldPath: normalizeRepoPath(firstPath),
        status: first === 'R' ? 'renamed' : 'copied',
      });
      continue;
    }
    entries.push({
      path: normalizeRepoPath(firstPath),
      status: statusForCode(first),
    });
  }
  return entries.sort((left, right) => comparePath(left, right));
}

export function parsePorcelainStatus(output: string): GitStatusRecord[] {
  const tokens = output.split('\0');
  const records: GitStatusRecord[] = [];
  let cursor = 0;
  while (cursor < tokens.length) {
    const record = tokens[cursor++];
    if (!record) continue;
    const index = record[0] ?? ' ';
    const worktree = record[1] ?? ' ';
    const firstPath = record.slice(3) || tokens[cursor++];
    if (!firstPath) continue;
    const isRename =
      index === 'R' || index === 'C' || worktree === 'R' || worktree === 'C';
    const secondPath = isRename ? tokens[cursor++] : undefined;
    const path = normalizeRepoPath(
      isRename && secondPath ? secondPath : firstPath,
    );
    const oldPath =
      isRename && secondPath ? normalizeRepoPath(firstPath) : undefined;
    records.push({
      path,
      ...(oldPath ? { oldPath } : {}),
      state: {
        index,
        worktree,
        staged: index !== ' ' && index !== '?',
        unstaged: worktree !== ' ' && worktree !== '?',
      },
    });
  }
  return records;
}

function statusForCode(code: string | undefined): PathStatus {
  switch (code) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'T':
      return 'typechanged';
    case 'U':
      return 'conflicted';
    default:
      return 'modified';
  }
}

async function enrichEntries(
  root: string,
  entries: ChangedPath[],
  status: readonly GitStatusRecord[],
): Promise<ChangedPath[]> {
  const enriched: ChangedPath[] = [];
  const statusByPath = new Map<string, GitStatusRecord>();
  for (const record of status) {
    statusByPath.set(record.path, record);
    if (record.oldPath) statusByPath.set(record.oldPath, record);
  }
  for (const entry of entries) {
    const matchingStatus =
      statusByPath.get(entry.path) ??
      (entry.oldPath ? statusByPath.get(entry.oldPath) : undefined);
    const state = matchingStatus?.state;
    if (entry.status === 'deleted') {
      enriched.push(state ? { ...entry, state } : entry);
      continue;
    }
    const absolute = safePath(root, entry.path);
    const fingerprint = await hashFile(absolute);
    enriched.push({ ...entry, fingerprint, ...(state ? { state } : {}) });
  }
  return enriched;
}

async function hashFile(path: string): Promise<string> {
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
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
  await Promise.race([
    once(stream, 'end'),
    once(stream, 'error').then(([error]) => {
      throw error;
    }),
  ]);
  return hash.digest('hex');
}

function safePath(root: string, repoPath: string): string {
  const absolute = resolve(root, ...repoPath.split('/'));
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (absolute !== root && !absolute.startsWith(rootWithSep)) {
    throw new Error(`Git returned a path outside the repository: ${repoPath}`);
  }
  return absolute;
}

export function repositoryIdentity(repositoryPath: string): string {
  const normalized = repositoryPath.replaceAll('\\', '/').replace(/\/$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function comparePath(left: ChangedPath, right: ChangedPath): number {
  const leftKey = `${left.path}\0${left.oldPath ?? ''}`;
  const rightKey = `${right.path}\0${right.oldPath ?? ''}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
