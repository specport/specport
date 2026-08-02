import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { mapRepository, renderRepositoryMapMarkdown } from '../src/spec/map.js';

const temporaryPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('repository mapper', () => {
  it('maps static evidence without executing repository code', async () => {
    const repository = await createFixture();
    const map = await mapRepository(repository, '2026-01-01T00:00:00.000Z');

    expect(map.specKind).toBe('repository-map');
    expect(map.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(map.safety.codeExecuted).toBe(false);
    expect(map.safety.networkAccessed).toBe(false);
    expect(map.files.find((file) => file.path === 'src/index.ts')).toEqual(
      expect.objectContaining({
        language: 'TypeScript',
        role: 'source',
        parseStatus: 'parsed',
      }),
    );
    expect(
      map.files.find((file) => file.path === 'tests/index.test.ts'),
    ).toEqual(expect.objectContaining({ role: 'test' }));
    expect(map.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'health',
          path: 'src/index.ts',
          visibility: 'public',
        }),
      ]),
    );
    expect(map.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'src/index.ts',
          specifier: './feature.js',
          resolvedPath: 'src/feature.ts',
        }),
      ]),
    );
    expect(map.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'http-route',
          value: 'GET /health',
          path: 'src/index.ts',
        }),
        expect.objectContaining({
          kind: 'cli-command',
          value: 'fixture: ./src/index.ts',
          path: 'package.json',
          evidence: 'observed',
        }),
      ]),
    );
    expect(map.unknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dynamic-runtime',
          path: 'src/index.ts',
        }),
      ]),
    );
    expect(renderRepositoryMapMarkdown(map)).toContain('Code executed: **no**');
  });

  it('is byte-deterministic when generatedAt is fixed', async () => {
    const repository = await createFixture();
    const first = await mapRepository(repository, '2026-01-01T00:00:00.000Z');
    const second = await mapRepository(repository, '2026-01-01T00:00:00.000Z');

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('records bounded-scan unknowns instead of reading unbounded source', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'specport-map-limit-'));
    temporaryPaths.push(repository);
    await writeFile(
      join(repository, 'large.ts'),
      'x'.repeat(256 * 1024 + 1),
      'utf8',
    );

    const map = await mapRepository(repository, '2026-01-01T00:00:00.000Z');

    expect(map.files[0]).toEqual(
      expect.objectContaining({
        parseStatus: 'skipped-limit',
        path: 'large.ts',
      }),
    );
    expect(map.unknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'byte-limit', path: 'large.ts' }),
      ]),
    );
  });

  it('exposes the mapper through the CLI and writes Markdown', async () => {
    const repository = await createFixture();
    const outputPath = join(repository, 'repository-map.md');
    const stdout = captureOutput();
    const stderr = captureOutput();

    const code = await runCli(
      [
        'spec',
        'map',
        repository,
        '--out',
        outputPath,
        '--generated-at',
        '2026-01-01T00:00:00.000Z',
      ],
      { stdout: stdout.stream, stderr: stderr.stream },
    );

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toContain('MAP        draft');
    expect(await readFile(outputPath, 'utf8')).toContain(
      '# Repository Map Draft',
    );
  });
});

async function createFixture(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), 'specport-map-fixture-'));
  temporaryPaths.push(repository);
  await writeFile(
    join(repository, 'package.json'),
    JSON.stringify(
      {
        name: 'map-fixture',
        bin: { fixture: './src/index.ts' },
        scripts: { test: 'node tests/index.test.ts' },
      },
      null,
      2,
    ),
    'utf8',
  );
  await import('node:fs/promises').then(({ mkdir }) =>
    mkdir(join(repository, 'src'), { recursive: true }),
  );
  await import('node:fs/promises').then(({ mkdir }) =>
    mkdir(join(repository, 'tests'), { recursive: true }),
  );
  await writeFile(
    join(repository, 'src', 'feature.ts'),
    'export const feature = true;\n',
    'utf8',
  );
  await writeFile(
    join(repository, 'src', 'index.ts'),
    [
      "import { feature } from './feature.js';",
      'export function health() {',
      "  app.get('/health', () => feature);",
      '}',
      "const loaded = import('./runtime.js');",
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(repository, 'tests', 'index.test.ts'),
    'test();\n',
    'utf8',
  );
  return repository;
}

function captureOutput(): {
  stream: NodeJS.WritableStream;
  text: () => string;
} {
  const chunks: Buffer[] = [];
  const stream = {
    write(chunk: string | Uint8Array): boolean {
      chunks.push(Buffer.from(chunk));
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return {
    stream,
    text: () => Buffer.concat(chunks).toString('utf8'),
  };
}
