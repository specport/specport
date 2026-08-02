import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';
import { captureFinalTree } from '../src/git/snapshot.js';

const temporaryPaths: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.close();
      await once(server, 'close').catch(() => undefined);
    }),
  );
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('GitHuman receiver boundary', () => {
  it('stays silent and exits 0 when a fingerprinted receiver covers the final tree', async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, 'src', 'value.ts'),
      'export const value = 2;\n',
      'utf8',
    );
    const snapshot = await captureFinalTree(repository);
    const requests: RequestRecord[] = [];
    const url = await startReceiver((request, response) => {
      requests.push(request);
      if (
        request.method === 'GET' &&
        request.path === '/api/reviews/review-1'
      ) {
        return sendJson(
          response,
          200,
          reviewFor(snapshot, 'review-1', snapshot.entries),
        );
      }
      if (request.method === 'POST' && request.path === '/api/todos') {
        return sendJson(response, 201, { id: 'todo-should-not-exist' });
      }
      return sendJson(response, 404, { error: 'not found' });
    });

    const result = await invoke([
      'coverage',
      repository,
      '--receiver',
      'githuman',
      '--receiver-url',
      url,
      '--review',
      'review-1',
      '--json',
    ]);
    const brief = JSON.parse(result.stdout) as Record<string, unknown>;
    const receiver = record(brief.receiver);

    expect(result.code).toBe(0);
    expect(brief.coverage).toBe('complete');
    expect(receiver.status).toBe('connected');
    expect(brief.findings).toEqual([]);
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('derives a staged patch fingerprint from GitHuman hunks when the API omits one', async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, 'src', 'value.ts'),
      'export const value = 2;\n',
      'utf8',
    );
    const snapshot = await captureFinalTree(repository);
    const requests: RequestRecord[] = [];
    const url = await startReceiver((request, response) => {
      requests.push(request);
      if (
        request.method === 'GET' &&
        request.path === '/api/reviews/review-derived'
      ) {
        const review = reviewFor(
          snapshot,
          'review-derived',
          snapshot.entries,
          null,
        );
        review.files = snapshot.entries.map((entry) => ({
          oldPath: entry.oldPath ?? null,
          newPath: entry.path,
          status: statusName(entry.status),
          additions: 1,
          deletions: 1,
        }));
        return sendJson(response, 200, review);
      }
      if (
        request.method === 'GET' &&
        request.path === '/api/reviews/review-derived/files/hunks'
      ) {
        return sendJson(response, 200, {
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: [
                {
                  type: 'removed',
                  content: 'export const value = 1;',
                  oldLineNumber: 1,
                  newLineNumber: null,
                },
                {
                  type: 'added',
                  content: 'export const value = 2;',
                  oldLineNumber: null,
                  newLineNumber: 1,
                },
              ],
            },
          ],
        });
      }
      return sendJson(response, 404, { error: 'not found' });
    });

    const result = await invoke([
      'coverage',
      repository,
      '--receiver',
      'githuman',
      '--receiver-url',
      url,
      '--review',
      'review-derived',
      '--json',
    ]);
    const brief = JSON.parse(result.stdout) as Record<string, unknown>;
    const receiver = record(brief.receiver);

    expect(result.code).toBe(0);
    expect(brief.coverage).toBe('complete');
    expect(receiver.sourceFingerprintKind).toBe('patch');
    expect(
      requests.some((request) => request.path.endsWith('/files/hunks')),
    ).toBe(true);
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('posts exactly one review-scoped todo when a final path is not in the receiver source', async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, 'src', 'value.ts'),
      'export const value = 2;\n',
      'utf8',
    );
    await writeFile(
      join(repository, 'src', 'forgotten.ts'),
      'export const forgotten = true;\n',
      'utf8',
    );
    const snapshot = await captureFinalTree(repository);
    const requests: RequestRecord[] = [];
    const url = await startReceiver((request, response) => {
      requests.push(request);
      if (
        request.method === 'GET' &&
        request.path === '/api/reviews/review-2'
      ) {
        const reviewed = snapshot.entries.filter(
          (entry) => entry.path !== 'src/forgotten.ts',
        );
        return sendJson(
          response,
          200,
          reviewFor(snapshot, 'review-2', reviewed, 'sha256:reviewed-source'),
        );
      }
      if (request.method === 'POST' && request.path === '/api/todos') {
        return sendJson(response, 201, { id: 'todo-2' });
      }
      return sendJson(response, 404, { error: 'not found' });
    });

    const result = await invoke([
      'coverage',
      repository,
      '--receiver',
      'githuman',
      '--receiver-url',
      url,
      '--review',
      'review-2',
      '--json',
    ]);
    const brief = JSON.parse(result.stdout) as Record<string, unknown>;
    const receiver = record(brief.receiver);
    const post = requests.find((request) => request.method === 'POST');

    expect(result.code).toBe(5);
    expect(brief.coverage).toBe('partial');
    expect(receiver.status).toBe('attached');
    expect(record(receiver.attachment).visible).toBe(true);
    expect(post).toBeDefined();
    expect(post?.body).toContain('src/forgotten.ts');
    expect(post?.body).toContain('reviewId');
  });

  it('reports unknown and does not synthesize a todo when the receiver has only paths', async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, 'src', 'value.ts'),
      'export const value = 2;\n',
      'utf8',
    );
    const snapshot = await captureFinalTree(repository);
    const requests: RequestRecord[] = [];
    const url = await startReceiver((request, response) => {
      requests.push(request);
      if (
        request.method === 'GET' &&
        request.path === '/api/reviews/review-3'
      ) {
        return sendJson(
          response,
          200,
          reviewFor(snapshot, 'review-3', snapshot.entries, null),
        );
      }
      if (request.method === 'POST' && request.path === '/api/todos') {
        return sendJson(response, 201, { id: 'todo-should-not-exist' });
      }
      return sendJson(response, 404, { error: 'not found' });
    });

    const result = await invoke([
      'coverage',
      repository,
      '--receiver',
      'githuman',
      '--receiver-url',
      url,
      '--review',
      'review-3',
      '--json',
    ]);
    const brief = JSON.parse(result.stdout) as Record<string, unknown>;
    const receiver = record(brief.receiver);

    expect(result.code).toBe(5);
    expect(brief.coverage).toBe('unknown');
    expect(receiver.status).toBe('connected');
    expect(brief.findings).toEqual([]);
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('does not attach a todo when a path-only receiver is an incomplete subset', async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, 'src', 'value.ts'),
      'export const value = 2;\n',
      'utf8',
    );
    await writeFile(
      join(repository, 'src', 'omitted.ts'),
      'export const omitted = true;\n',
      'utf8',
    );
    const snapshot = await captureFinalTree(repository);
    const requests: RequestRecord[] = [];
    const url = await startReceiver((request, response) => {
      requests.push(request);
      if (
        request.method === 'GET' &&
        request.path === '/api/reviews/review-path-only-subset'
      ) {
        const reviewed = snapshot.entries.filter(
          (entry) => entry.path !== 'src/omitted.ts',
        );
        return sendJson(
          response,
          200,
          reviewFor(snapshot, 'review-path-only-subset', reviewed, null),
        );
      }
      if (request.method === 'POST' && request.path === '/api/todos') {
        return sendJson(response, 201, { id: 'todo-should-not-exist' });
      }
      return sendJson(response, 404, { error: 'not found' });
    });

    const result = await invoke([
      'coverage',
      repository,
      '--receiver',
      'githuman',
      '--receiver-url',
      url,
      '--review',
      'review-path-only-subset',
      '--json',
    ]);
    const brief = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result.code).toBe(5);
    expect(brief.coverage).toBe('unknown');
    expect(brief.findings).toEqual([]);
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('fails closed when the receiver omits its source kind', async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, 'src', 'value.ts'),
      'export const value = 2;\n',
      'utf8',
    );
    const snapshot = await captureFinalTree(repository);
    const requests: RequestRecord[] = [];
    const url = await startReceiver((request, response) => {
      requests.push(request);
      if (
        request.method === 'GET' &&
        request.path === '/api/reviews/review-unknown-source-kind'
      ) {
        const review = reviewFor(
          snapshot,
          'review-unknown-source-kind',
          snapshot.entries,
        );
        delete review.sourceType;
        return sendJson(response, 200, review);
      }
      return sendJson(response, 404, { error: 'not found' });
    });

    const result = await invoke([
      'coverage',
      repository,
      '--receiver',
      'githuman',
      '--receiver-url',
      url,
      '--review',
      'review-unknown-source-kind',
      '--json',
    ]);
    const brief = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result.code).toBe(5);
    expect(brief.coverage).toBe('unknown');
    expect(brief.findings).toEqual([]);
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
  });
});

interface RequestRecord {
  method: string;
  path: string;
  body: string;
}

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), 'specport-githuman-'));
  temporaryPaths.push(repository);
  await runGit(repository, ['init', '--quiet']);
  await runGit(repository, ['config', 'user.name', 'SpecPort Tests']);
  await runGit(repository, [
    'config',
    'user.email',
    'specport-tests@example.invalid',
  ]);
  await mkdir(join(repository, 'src'), { recursive: true });
  await writeFile(join(repository, 'README.md'), '# fixture\n', 'utf8');
  await writeFile(
    join(repository, 'src', 'value.ts'),
    'export const value = 1;\n',
    'utf8',
  );
  await runGit(repository, ['add', '--all']);
  await runGit(repository, ['commit', '--quiet', '-m', 'base']);
  return repository;
}

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  await promisify(execFile)('git', [...args], { cwd, windowsHide: true });
}

function reviewFor(
  snapshot: Awaited<ReturnType<typeof captureFinalTree>>,
  id: string,
  entries: typeof snapshot.entries,
  sourceFingerprint: string | null = snapshot.patchFingerprint ??
    snapshot.fingerprint,
): Record<string, unknown> {
  return {
    id,
    repositoryPath: snapshot.repositoryPath,
    sourceType: 'staged',
    baseRef: snapshot.baseCommit,
    ...(sourceFingerprint ? { sourceFingerprint } : {}),
    sourceFingerprintKind: snapshot.patchFingerprint ? 'patch' : 'tree',
    files: entries.map((entry) => ({
      oldPath: entry.oldPath ?? null,
      newPath: entry.path,
      status: statusName(entry.status),
      additions: 0,
      deletions: 0,
    })),
  };
}

function statusName(status: string): string {
  return status === 'untracked' ? 'added' : status;
}

async function startReceiver(
  handler: (request: RequestRecord, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        handler(
          {
            method: request.method ?? 'GET',
            path: request.url?.split('?')[0] ?? '/',
            body: Buffer.concat(chunks).toString('utf8'),
          },
          response,
        );
      });
    },
  );
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Receiver did not bind to a TCP port.');
  return `http://127.0.0.1:${address.port}`;
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(body);
}

async function invoke(argv: readonly string[]): Promise<ProcessResult> {
  const output: string[] = [];
  const errors: string[] = [];
  const stdout = {
    write: (value: string) => {
      output.push(value);
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  const stderr = {
    write: (value: string) => {
      errors.push(value);
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  const code = await runCli(argv, { stdout, stderr });
  return { code, stdout: output.join(''), stderr: errors.join('') };
}

interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
