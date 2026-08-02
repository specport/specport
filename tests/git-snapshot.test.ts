import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { fingerprintPatch, parseUnifiedDiff } from '../src/git/patch.js';
import { captureFinalTree, repositoryIdentity } from '../src/git/snapshot.js';

const execFile = promisify(execFileCallback);
const temporaryRepositories: string[] = [];

afterEach(async () => {
  const repositories = temporaryRepositories.splice(0);
  await Promise.all(
    repositories.map((repository) =>
      rm(repository, { force: true, recursive: true }),
    ),
  );
});

describe('captureFinalTree', () => {
  it('scans an unborn repository against the empty-tree base', async () => {
    const repository = await createRepository();
    await writeRepositoryFile(
      repository,
      'src/index.ts',
      'export const value = 1;\n',
    );

    const snapshot = await captureFinalTree(repository);

    expect(snapshot.baseKind).toBe('empty-tree');
    expect(snapshot.baseCommit).toBeNull();
    expect(snapshot.entries).toEqual([
      expect.objectContaining({
        path: 'src/index.ts',
        status: 'added',
      }),
    ]);
  });

  it('includes non-ignored untracked paths while excluding ignored node_modules files', async () => {
    const repository = await createRepository();
    await writeRepositoryFile(repository, '.gitignore', 'node_modules/\n');
    await writeRepositoryFile(
      repository,
      'src/new-file.ts',
      'export const newFile = true;\n',
    );
    await writeRepositoryFile(
      repository,
      'node_modules/example/index.js',
      'module.exports = true;\n',
    );

    const snapshot = await captureFinalTree(repository);
    const paths = snapshot.entries.map((entry) => entry.path);

    expect(paths).toContain('.gitignore');
    expect(paths).toContain('src/new-file.ts');
    expect(paths.some((path) => path.startsWith('node_modules/'))).toBe(false);
  });

  it('represents a staged-only change and a later unstaged edit to the same path', async () => {
    const repository = await createRepository();
    await writeRepositoryFile(
      repository,
      'src/value.ts',
      'export const value = 1;\n',
    );
    await commitAll(repository, 'initial');

    await writeRepositoryFile(
      repository,
      'src/value.ts',
      'export const value = 2;\n',
    );
    await runGit(repository, ['add', '--', 'src/value.ts']);

    const stagedSnapshot = await captureFinalTree(repository);
    const stagedEntry = findEntry(stagedSnapshot, 'src/value.ts');

    expect(stagedSnapshot.entries).toHaveLength(1);
    expect(stagedEntry.status).toBe('modified');
    expect(stagedEntry.state).toEqual({
      index: 'M',
      worktree: ' ',
      staged: true,
      unstaged: false,
    });

    await writeRepositoryFile(
      repository,
      'src/value.ts',
      'export const value = 3;\n',
    );

    const stagedAndUnstagedSnapshot = await captureFinalTree(repository);
    const stagedAndUnstagedEntry = findEntry(
      stagedAndUnstagedSnapshot,
      'src/value.ts',
    );

    expect(
      stagedAndUnstagedSnapshot.entries.filter(
        (entry) => entry.path === 'src/value.ts',
      ),
    ).toHaveLength(1);
    expect(stagedAndUnstagedEntry.status).toBe('modified');
    expect(stagedAndUnstagedEntry.state).toEqual({
      index: 'M',
      worktree: 'M',
      staged: true,
      unstaged: true,
    });
  });

  it('keeps an index-only mode change in the final-tree inventory', async () => {
    const repository = await createRepository();
    await writeRepositoryFile(
      repository,
      'src/tool.sh',
      '#!/bin/sh\necho ok\n',
    );
    await commitAll(repository, 'initial');

    await runGit(repository, [
      'update-index',
      '--chmod=+x',
      '--',
      'src/tool.sh',
    ]);

    const snapshot = await captureFinalTree(repository);

    expect(snapshot.entries).toEqual([
      expect.objectContaining({ path: 'src/tool.sh', status: 'modified' }),
    ]);
  });

  it('marks unmerged add/add entries as unstable', async () => {
    const repository = await createRepository();
    await writeRepositoryFile(repository, 'src/base.txt', 'base\n');
    const baseCommit = await commitAll(repository, 'base');

    await runGit(repository, ['checkout', '-b', 'left']);
    await writeRepositoryFile(repository, 'src/conflict.txt', 'left\n');
    await commitAll(repository, 'left');

    await runGit(repository, ['checkout', '-b', 'right', baseCommit]);
    await writeRepositoryFile(repository, 'src/conflict.txt', 'right\n');
    await commitAll(repository, 'right');
    await expect(
      runGit(repository, ['merge', '--no-commit', 'left']),
    ).rejects.toThrow();

    const snapshot = await captureFinalTree(repository);
    const entry = findEntry(snapshot, 'src/conflict.txt');

    expect(entry.state?.index).toBe('A');
    expect(entry.state?.worktree).toBe('A');
    expect(snapshot.stable).toBe(false);
  });

  it('preserves a deleted tracked path in the final-tree inventory', async () => {
    const repository = await createRepository();
    await writeRepositoryFile(
      repository,
      'src/removed.ts',
      'export const removed = true;\n',
    );
    await commitAll(repository, 'initial');
    await rm(join(repository, 'src', 'removed.ts'));

    const snapshot = await captureFinalTree(repository);
    const entry = findEntry(snapshot, 'src/removed.ts');

    expect(entry).toEqual(
      expect.objectContaining({
        path: 'src/removed.ts',
        status: 'deleted',
      }),
    );
    expect(entry.fingerprint).toBeUndefined();
    expect(entry.state).toEqual({
      index: ' ',
      worktree: 'D',
      staged: false,
      unstaged: true,
    });
  });

  it('preserves the oldPath when Git reports a rename', async () => {
    const repository = await createRepository();
    await writeRepositoryFile(
      repository,
      'src/old-name.ts',
      'export const renamed = true;\n',
    );
    await commitAll(repository, 'initial');
    await runGit(repository, [
      'mv',
      '--',
      'src/old-name.ts',
      'src/new-name.ts',
    ]);

    const snapshot = await captureFinalTree(repository);
    const entry = findEntry(snapshot, 'src/new-name.ts');

    expect(entry).toEqual(
      expect.objectContaining({
        path: 'src/new-name.ts',
        oldPath: 'src/old-name.ts',
        status: 'renamed',
      }),
    );
  });

  it('keeps spaces and Unicode intact in repository-relative paths', async () => {
    const repository = await createRepository();
    const path = 'src/space dir/你好世界.ts';
    await writeRepositoryFile(
      repository,
      path,
      'export const greeting = "你好";\n',
    );

    const snapshot = await captureFinalTree(repository);

    expect(snapshot.entries).toEqual([
      expect.objectContaining({
        path,
        status: 'added',
      }),
    ]);
  });

  it('reports the canonical repository and resolved base identity fields', async () => {
    const repository = await createRepository();
    await writeRepositoryFile(repository, 'README.md', '# SpecPort\n');
    const baseCommit = await commitAll(repository, 'initial');
    const canonicalRoot = await realpath(repository);

    const snapshot = await captureFinalTree(join(repository, 'nested', '..'));

    expect(snapshot.repositoryPath).toBe(canonicalRoot);
    expect(snapshot.repositoryId).toBe(repositoryIdentity(canonicalRoot));
    expect(snapshot.baseCommit).toBe(baseCommit);
    expect(snapshot.baseKind).toBe('commit');
  });
});

describe('patch fingerprints', () => {
  it('preserves terminal-newline differences', () => {
    const withNewline = parseUnifiedDiff(
      'diff --git a/file.txt b/file.txt\n' +
        '--- a/file.txt\n' +
        '+++ b/file.txt\n' +
        '@@ -1 +1 @@\n' +
        '-old\n' +
        '+new\n',
    );
    const withoutNewline = parseUnifiedDiff(
      'diff --git a/file.txt b/file.txt\n' +
        '--- a/file.txt\n' +
        '+++ b/file.txt\n' +
        '@@ -1 +1 @@\n' +
        '-old\n' +
        '+new\n' +
        '\\ No newline at end of file\n',
    );

    expect(fingerprintPatch('base', withNewline.files)).not.toBe(
      fingerprintPatch('base', withoutNewline.files),
    );
  });
});

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), 'specport snapshot test-'));
  temporaryRepositories.push(repository);

  await runGit(repository, ['init', '--quiet']);
  await runGit(repository, ['config', 'user.name', 'SpecPort Test']);
  await runGit(repository, [
    'config',
    'user.email',
    'specport-test@example.invalid',
  ]);
  await runGit(repository, ['config', 'core.quotepath', 'false']);
  await runGit(repository, ['config', 'core.autocrlf', 'false']);
  await runGit(repository, [
    'config',
    'core.hooksPath',
    '.specport-test-hooks',
  ]);

  return repository;
}

async function writeRepositoryFile(
  repository: string,
  repositoryPath: string,
  contents: string,
): Promise<void> {
  const absolutePath = join(repository, ...repositoryPath.split('/'));
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, 'utf8');
}

async function commitAll(repository: string, message: string): Promise<string> {
  await runGit(repository, ['add', '--all', '--', '.']);
  await runGit(repository, ['commit', '--quiet', '-m', message]);
  return (await runGit(repository, ['rev-parse', 'HEAD'])).trim();
}

async function runGit(
  repository: string,
  args: readonly string[],
): Promise<string> {
  const result = await execFile('git', [...args], {
    cwd: repository,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return result.stdout;
}

function findEntry(
  snapshot: Awaited<ReturnType<typeof captureFinalTree>>,
  path: string,
) {
  const entry = snapshot.entries.find((candidate) => candidate.path === path);
  if (!entry) {
    throw new Error(`Expected snapshot entry for ${path}`);
  }
  return entry;
}
