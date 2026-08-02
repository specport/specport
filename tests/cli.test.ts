import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';

const builtCli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const temporaryPaths: string[] = [];

interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

afterEach(async () => {
  const paths = temporaryPaths.splice(0);
  await Promise.all(
    paths.map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('SpecPort CLI contract', () => {
  it('prints the package version and exits successfully', async () => {
    const result = await invoke(['--version']);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('0.1.0\n');
    expect(result.stderr).toBe('');
  });

  it('prints help without requiring a Git repository', async () => {
    const result = await invoke(['--help']);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('specport coverage');
    expect(result.stdout).toContain('--receiver githuman');
    expect(result.stdout).toContain('--expected-scope <file>');
    expect(result.stdout).toContain('--json');
    expect(result.stdout).toContain('specport spec discover');
    expect(result.stdout).toContain('specport spec validate');
  });

  it('generates a draft repository baseline through the spec command', async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, 'package.json'),
      JSON.stringify(
        {
          name: 'fixture-project',
          scripts: { test: 'node test.js' },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await invoke(['spec', 'discover', repository, '--json']);
    const brief = parseJson(result);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(brief.specKind).toBe('repository-baseline');
    expect(brief.status).toBe('draft');
    expect(record(brief.project).name).toBe('fixture-project');
    expect(record(brief.contract).intent).toBe('missing');
    expect(brief.nextActions).toEqual(
      expect.arrayContaining([expect.stringContaining('contract')]),
    );
  });

  it('validates a product contract before implementation', async () => {
    const repository = await createRepository();
    const contractPath = join(repository, 'contract.json');
    await writeFile(
      contractPath,
      JSON.stringify({
        contractVersion: '1',
        kind: 'product-contract',
        id: 'fixture',
        title: 'Fixture contract',
        intent: {
          owner: 'owner',
          userJob: 'job',
          outcome: 'outcome',
          nonGoals: [],
        },
        constraints: [],
        acceptance: [{ id: 'AC-1', statement: 'works', evidence: ['test'] }],
        verification: [
          { id: 'V-1', command: 'npm test', purpose: 'regression' },
        ],
        taste: { required: true, reviewer: 'owner', rubric: ['clear'] },
        release: { target: 'fixture', version: '1.0.0', readiness: ['works'] },
      }),
      'utf8',
    );

    const valid = await invoke(['spec', 'validate', contractPath, '--json']);
    expect(valid.code).toBe(0);
    expect(parseJson(valid)).toEqual(
      expect.objectContaining({
        artifactKind: 'contract-validation',
        valid: true,
      }),
    );

    await writeFile(contractPath, '{"kind":"product-contract"}', 'utf8');
    const invalid = await invoke(['spec', 'validate', contractPath, '--json']);
    expect(invalid.code).toBe(5);
    expect(parseJson(invalid).valid).toBe(false);
  });

  it('returns an inventory-only JSON diagnostic with no receiver and exit 0', async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, 'src', 'new-file.ts'),
      'export const newFile = true;\n',
      'utf8',
    );

    const result = await invoke(['coverage', repository, '--json']);
    const brief = parseJson(result);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(brief.scopeBasis).toBe('unavailable');
    expect(brief.coverage).toBe('unknown');
    expect(brief.verdict).toBe('inventory-only');
    expect(record(brief.receiver).status).toBe('none');
    expect(record(brief.handoff).scope).toBe('observed-inventory');
    expect(record(brief.paths).actual).toContain('src/new-file.ts');
    expect(record(brief.paths).unreviewed).toEqual([]);
    expect(record(brief.paths).unexpected).toEqual([]);
    expect(brief.reviewOrder).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'src/new-file.ts',
          reasonCode: 'untracked',
          nextAction: expect.any(String),
        }),
      ]),
    );
    expect(brief.nextActions).toEqual([
      expect.objectContaining({
        code: expect.any(String),
        text: expect.any(String),
      }),
    ]);
  });

  it('labels a broad change surface with a stable next-action code', async () => {
    const repository = await createRepository();
    for (let index = 0; index < 21; index += 1) {
      await writeFile(
        join(repository, 'src', `broad-${index}.ts`),
        `export const broad${index} = true;\n`,
        'utf8',
      );
    }

    const result = await invoke(['coverage', repository, '--json']);
    const brief = parseJson(result);

    expect(result.code).toBe(0);
    expect(record(brief.reviewOrder)).toHaveLength(20);
    expect(brief.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'broad-scope' }),
      ]),
    );
  });

  it('puts handoff status, verdict, authority, check state, and next action first in human output', async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, 'src', 'human-output.ts'),
      'export const humanOutput = true;\n',
      'utf8',
    );

    const result = await invoke(['coverage', repository]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('HANDOFF    incomplete');
    expect(result.stdout).toContain('VERDICT    inventory-only');
    expect(result.stdout).toContain('AUTHORITY  none');
    expect(result.stdout).toContain('CHECK      not-run');
    expect(result.stdout).toContain('NEXT       ');
    expect(
      result.stdout
        .split('\n')
        .slice(0, 7)
        .map((line) => line.split(/\s+/)[0]),
    ).toEqual([
      'HANDOFF',
      'VERDICT',
      'AUTHORITY',
      'CHANGED',
      'FIRST',
      'CHECK',
      'NEXT',
    ]);
  });

  it('records a bounded post-hoc handoff without claiming formal authority', async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, 'src', 'interactive.ts'),
      'export const interactive = true;\n',
      'utf8',
    );
    await writeFile(
      join(repository, 'package.json'),
      JSON.stringify({
        name: 'interactive-fixture',
        scripts: { test: 'node test.js', lint: 'node lint.js' },
      }),
      'utf8',
    );
    const stdout = captureOutput();
    const stderr = captureOutput();
    const answers = ['Ship the interactive fixture', 'all request', 'npm test'];
    const prompted: string[] = [];

    const run = runCli(['coverage', repository, '--interactive', '--json'], {
      prompt: async (_question) => {
        prompted.push(stderr.text());
        return answers.shift() ?? '';
      },
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    const code = await run;
    const brief = JSON.parse(stdout.text()) as Record<string, unknown>;
    const handoff = record(brief.handoff);
    const intent = record(handoff.intent);
    const verification = record(handoff.verification);
    const topVerification = record((brief.verification as unknown[])[0]);

    expect(code).toBe(5);
    expect(prompted[0]).toContain('SCAN PREVIEW');
    expect(prompted[0]).toContain('src/interactive.ts');
    expect(prompted[0]).toContain('BASE');
    expect(prompted[0]).toContain('CHECKS');
    expect(prompted[0]).toContain('npm run test');
    expect(stderr.text()).toContain('SCAN PREVIEW');
    expect(brief.authority).toBe('ephemeral');
    expect(brief.contractTiming).toBe('posthoc');
    expect(brief.scopeBasis).toBe('user-selected-after-change');
    expect(brief.verdict).toBe('review-required');
    expect(handoff.status).toBe('posthoc');
    expect(handoff.readiness).toBe('attachable');
    expect(handoff.scopeSelection).toBe('all-displayed');
    expect(handoff.reviewRequest).toBe('user-selected');
    expect(intent.status).toBe('provided');
    expect(intent.source).toBe('user-entered');
    expect(verification.declaration).toBe('user-declared');
    expect(verification.selection).toBe('selected');
    expect(verification.state).toBe('not-run');
    expect(verification.stateStability).toBe('unknown');
    expect(topVerification.declaration).toBe('user-declared');
    expect(topVerification.selection).toBe('selected');
    expect(topVerification.state).toBe('not-run');
    expect(topVerification.discoveredChecks).toEqual(['lint', 'test']);
  });

  it('does not mark a post-hoc handoff attachable when a discovered check is skipped', async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, 'package.json'),
      JSON.stringify({
        name: 'skip-fixture',
        scripts: { test: 'node test.js' },
      }),
      'utf8',
    );
    const stdout = captureOutput();
    const stderr = captureOutput();
    const answers = ['Ship without running tests', 'all request', ''];

    const code = await runCli(
      ['coverage', repository, '--interactive', '--json'],
      {
        prompt: async () => answers.shift() ?? '',
        stdout: stdout.stream,
        stderr: stderr.stream,
      },
    );
    const brief = JSON.parse(stdout.text()) as Record<string, unknown>;
    const handoff = record(brief.handoff);
    const verification = record(handoff.verification);

    expect(code).toBe(5);
    expect(handoff.readiness).toBe('incomplete');
    expect(verification.declaration).toBe('discovered');
    expect(verification.selection).toBe('explicitly-skipped');
    expect(verification.state).toBe('not-run');
    expect(brief.nextActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'not-run' })]),
    );
    expect(stderr.text()).toContain('SCAN PREVIEW');
  });

  it('records a concrete selected subset in the post-hoc handoff', async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, 'src', 'subset.ts'),
      'export const subset = true;\n',
      'utf8',
    );
    const stdout = captureOutput();
    const stderr = captureOutput();
    const answers = [
      'Ship only the subset file',
      'subset:src/subset.ts request',
      '',
    ];

    const code = await runCli(
      ['coverage', repository, '--interactive', '--json'],
      {
        prompt: async () => answers.shift() ?? '',
        stdout: stdout.stream,
        stderr: stderr.stream,
      },
    );
    const brief = JSON.parse(stdout.text()) as Record<string, unknown>;
    const handoff = record(brief.handoff);

    expect(code).toBe(5);
    expect(handoff.scopeSelection).toBe('selected-subset');
    expect(handoff.scopePaths).toEqual(['src/subset.ts']);
    expect(handoff.reviewRequest).toBe('user-selected');
  });

  it('fails interactive mode fast without a TTY', async () => {
    const repository = await createRepository();
    const stdout = captureOutput();
    const stderr = captureOutput();

    const code = await runCli(['coverage', repository, '--interactive'], {
      stdin: { isTTY: false } as unknown as NodeJS.ReadableStream,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(code).toBe(2);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('--interactive requires a TTY');
  });

  it('returns exit 5 and identifies paths outside an expected scope', async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, 'src', 'allowed.ts'),
      'export const allowed = true;\n',
      'utf8',
    );
    await writeFile(
      join(repository, 'src', 'unexpected.ts'),
      'export const unexpected = true;\n',
      'utf8',
    );

    const scopeDirectory = await mkdtemp(join(tmpdir(), 'specport-cli-scope-'));
    temporaryPaths.push(scopeDirectory);
    const scopePath = join(scopeDirectory, 'scope.json');
    await writeFile(
      scopePath,
      JSON.stringify({ identity: 'scope:cli-test', paths: ['src/allowed.ts'] }),
      'utf8',
    );

    const result = await invoke([
      'coverage',
      repository,
      '--expected-scope',
      scopePath,
      '--json',
    ]);
    const brief = parseJson(result);

    expect(result.code).toBe(5);
    expect(result.stderr).toBe('');
    expect(brief.scopeBasis).toBe('approved-scope');
    expect(brief.coverage).toBe('partial');
    expect(brief.verdict).toBe('review-required');
    expect(record(brief.paths).unexpected).toEqual(['src/unexpected.ts']);
    expect(brief.findings).toEqual([
      expect.objectContaining({
        code: 'unexpected-paths',
        paths: ['src/unexpected.ts'],
      }),
    ]);
  });

  it('rejects an unsupported receiver with usage exit 2', async () => {
    const repository = await createRepository();

    const result = await invoke([
      'coverage',
      repository,
      '--receiver',
      'not-a-real-receiver',
    ]);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Unsupported receiver: not-a-real-receiver',
    );
    expect(result.stderr).toContain('Usage:');
  });

  it('returns output exit 4 instead of overwriting an existing brief', async () => {
    const repository = await createRepository();
    const outputPath = join(repository, 'coverage.json');
    await writeFile(outputPath, '{"keep":true}\n', 'utf8');

    const result = await invoke([
      'coverage',
      repository,
      '--write',
      outputPath,
      '--json',
    ]);

    expect(result.code).toBe(4);
    expect(result.stderr).toContain('Refusing to overwrite');
    expect(await readFile(outputPath, 'utf8')).toBe('{"keep":true}\n');
  });

  it('writes a Markdown brief when the output path ends in .md', async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, 'src', 'markdown-output.ts'),
      'export const markdownOutput = true;\n',
      'utf8',
    );
    const outputPath = join(repository, 'coverage.md');

    const result = await invoke([
      'coverage',
      repository,
      '--write',
      outputPath,
    ]);

    expect(result.code).toBe(0);
    const markdown = await readFile(outputPath, 'utf8');
    expect(markdown).toContain('# SpecPort Coverage');
    expect(markdown).toContain('## Verdict');
    expect(markdown).toContain('inventory-only');
    expect(markdown).toContain('src/markdown-output.ts');
    expect(markdown).toContain('## Stable brief');
  });

  it('writes JSON when --json is paired with a Markdown-looking target', async () => {
    const repository = await createRepository();
    await writeFile(
      join(repository, 'src', 'json-output.ts'),
      'export const jsonOutput = true;\n',
      'utf8',
    );
    const outputPath = join(repository, 'coverage.md');

    const result = await invoke([
      'coverage',
      repository,
      '--json',
      '--write',
      outputPath,
    ]);

    expect(result.code).toBe(0);
    const artifact = JSON.parse(await readFile(outputPath, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(artifact.receiptKind).toBe('coverage-preflight');
  });

  it('rejects quick artifacts inside the tracked contract directory', async () => {
    const repository = await createRepository();
    const contracts = join(repository, '.specport', 'contracts');
    await mkdir(contracts, { recursive: true });
    const result = await invoke([
      'coverage',
      repository,
      '--write',
      join(contracts, 'quick.json'),
    ]);

    expect(result.code).toBe(4);
    expect(result.stderr).toContain('must not write .specport/contracts');
  });

  it('rejects overwriting a tracked source file with a disposable brief', async () => {
    const repository = await createRepository();
    const result = await invoke([
      'coverage',
      repository,
      '--write',
      join(repository, 'README.md'),
    ]);

    expect(result.code).toBe(4);
    expect(result.stderr).toContain('tracked repository file');
    expect(await readFile(join(repository, 'README.md'), 'utf8')).toBe(
      '# fixture\n',
    );
  });

  it('labels an invalid base with a stable repair code', async () => {
    const repository = await createRepository();
    const result = await invoke([
      'coverage',
      repository,
      '--base',
      'does-not-exist',
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('base-invalid');
  });

  it.skipIf(!existsSync(builtCli))(
    'invokes the built package bin against a temporary repository',
    async () => {
      const repository = await createRepository();
      await writeFile(
        join(repository, 'src', 'built-cli.ts'),
        'export const builtCli = true;\n',
        'utf8',
      );

      const result = await spawnProcess(
        process.execPath,
        [builtCli, 'coverage', repository, '--json'],
        process.cwd(),
      );
      const brief = parseJson(result);

      expect(result.code).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe('');
      expect(brief.scopeBasis).toBe('unavailable');
      expect(brief.verdict).toBe('inventory-only');
      expect(record(brief.paths).actual).toContain('src/built-cli.ts');
    },
  );
});

async function invoke(argv: readonly string[]): Promise<ProcessResult> {
  const stdout = captureOutput();
  const stderr = captureOutput();
  const code = await runCli(argv, {
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  return {
    code,
    signal: null,
    stdout: stdout.text(),
    stderr: stderr.text(),
  };
}

function captureOutput(): { stream: Writable; text: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });
  return {
    stream,
    text: () => Buffer.concat(chunks).toString('utf8'),
  };
}

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), 'specport-cli-repo-'));
  temporaryPaths.push(repository);
  await runGit(repository, ['init', '--quiet']);
  await runGit(repository, [
    'config',
    'user.email',
    'specport-tests@example.invalid',
  ]);
  await runGit(repository, ['config', 'user.name', 'SpecPort Tests']);
  await mkdir(join(repository, 'src'), { recursive: true });
  await writeFile(join(repository, 'README.md'), '# fixture\n', 'utf8');
  await writeFile(
    join(repository, 'src', 'base.ts'),
    'export const base = true;\n',
    'utf8',
  );
  await runGit(repository, ['add', '--all']);
  await runGit(repository, ['commit', '--quiet', '-m', 'base fixture']);
  return repository;
}

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
  const result = await spawnProcess('git', args, cwd);
  if (result.code !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed with ${String(result.code)}: ${result.stderr}`,
    );
  }
}

function spawnProcess(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function parseJson(result: ProcessResult): Record<string, unknown> {
  if (!result.stdout.trim()) {
    throw new Error(
      `Expected JSON stdout; exit=${String(result.code)} stderr=${JSON.stringify(result.stderr)}`,
    );
  }
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}
