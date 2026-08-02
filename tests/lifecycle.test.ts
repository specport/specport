import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import {
  createBuildHandoff,
  createCoverPlan,
  createRemixArtifact,
} from '../src/spec/lifecycle.js';

const temporaryPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('SpecPort lifecycle artifacts', () => {
  it('fails closed when a cover has no verified source license', async () => {
    const fixture = await createFixture();
    const plan = await createCoverPlan(
      fixture.specPath,
      fixture.targetPath,
      'node',
      fixture.contractPath,
      undefined,
      '2026-01-01T00:00:00.000Z',
    );

    expect(plan.artifactKind).toBe('spec-cover');
    expect(plan.status).toBe('blocked');
    expect(plan.license.source.status).toBe('declared');
    expect(plan.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'license', status: 'unknown' }),
      ]),
    );
    expect(plan.authority.execution).toBe('none');
  });

  it('creates a ready cover with verified parent provenance and target profile', async () => {
    const fixture = await createFixture();
    const plan = await createCoverPlan(
      fixture.specPath,
      fixture.targetPath,
      'node',
      fixture.contractPath,
      fixture.provenancePath,
      '2026-01-01T00:00:00.000Z',
    );

    expect(plan.status).toBe('ready');
    expect(plan.lineage.parents).toHaveLength(1);
    expect(plan.lineage.parents[0]?.sourceLicense.status).toBe('verified');
    expect(plan.identity.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.gateState.release).toBe('blocked');
    expect(plan.decision.state).toBe('pending');
  });

  it('preserves remix lineage and makes the change set explicit', async () => {
    const fixture = await createFixture();
    const remix = await createRemixArtifact(
      fixture.specPath,
      ['Use a local-only target profile', 'Add an offline recovery scenario'],
      'Adapt the capability for an offline maintainer workflow.',
      fixture.provenancePath,
      '2026-01-01T00:00:00.000Z',
    );

    expect(remix.artifactKind).toBe('spec-remix');
    expect(remix.status).toBe('draft');
    expect(remix.lineage.parents[0]?.sha256).toBe(fixture.specSha256);
    expect(remix.changeSet.map((change) => change.id)).toEqual([
      'CHANGE-001',
      'CHANGE-002',
    ]);
    expect(remix.source).toContain('Status: accepted');
    expect(remix.lineage.attributionRequired).toBe(true);
    expect(remix.decision.state).toBe('pending');
  });

  it('creates a bounded build handoff without executing code or checks', async () => {
    const fixture = await createFixture();
    const handoff = await createBuildHandoff(
      fixture.specPath,
      fixture.targetPath,
      'node',
      fixture.contractPath,
      fixture.acceptancePath,
      fixture.provenancePath,
      '2026-01-01T00:00:00.000Z',
    );

    expect(handoff.artifactKind).toBe('spec-build-handoff');
    expect(handoff.status).toBe('ready');
    expect(handoff.execution).toEqual(
      expect.objectContaining({
        mode: 'handoff',
        codeGenerated: false,
        repositoryCodeExecuted: false,
        networkAccessed: false,
        checksRun: false,
      }),
    );
    expect(handoff.contract.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(handoff.acceptance.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(handoff.gateState.taste).toBe('pending');
    expect(handoff.gateState.release).toBe('blocked');
  });

  it('blocks an acceptance record without a durable decision source', async () => {
    const fixture = await createFixture();
    const record = JSON.parse(
      await readFile(fixture.acceptancePath, 'utf8'),
    ) as Record<string, unknown>;
    delete record.decisionSource;
    await writeFile(fixture.acceptancePath, JSON.stringify(record), 'utf8');

    const handoff = await createBuildHandoff(
      fixture.specPath,
      fixture.targetPath,
      'node',
      fixture.contractPath,
      fixture.acceptancePath,
      fixture.provenancePath,
      '2026-01-01T00:00:00.000Z',
    );

    expect(handoff.status).toBe('blocked');
    expect(handoff.acceptance.decision).toBe('invalid');
    expect(handoff.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'contract-acceptance',
          status: 'blocked',
        }),
      ]),
    );
  });

  it('exposes a top-level build alias with stable JSON output', async () => {
    const fixture = await createFixture();
    const stdout = captureOutput();
    const stderr = captureOutput();
    const code = await runCli(
      [
        'build',
        fixture.specPath,
        '--target',
        fixture.targetPath,
        '--target-stack',
        'node',
        '--contract',
        fixture.contractPath,
        '--acceptance-record',
        fixture.acceptancePath,
        '--provenance',
        fixture.provenancePath,
        '--generated-at',
        '2026-01-01T00:00:00.000Z',
        '--json',
      ],
      { stdout: stdout.stream, stderr: stderr.stream },
    );

    const result = JSON.parse(stdout.text()) as Record<string, unknown>;
    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(result.artifactKind).toBe('spec-build-handoff');
    expect(result.status).toBe('ready');
  });
});

interface Fixture {
  specPath: string;
  specSha256: string;
  targetPath: string;
  contractPath: string;
  acceptancePath: string;
  provenancePath: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'specport-lifecycle-'));
  temporaryPaths.push(root);
  const targetPath = join(root, 'target');
  const specPath = join(root, 'SPEC.md');
  const contractPath = join(targetPath, '.specport', 'contract.json');
  const acceptancePath = join(root, 'acceptance.json');
  const provenancePath = join(root, 'pull-receipt.json');
  await mkdir(join(targetPath, 'src'), { recursive: true });
  await mkdir(join(targetPath, '.specport'), { recursive: true });
  await writeFile(
    join(targetPath, 'package.json'),
    JSON.stringify({
      name: 'lifecycle-target',
      scripts: { test: 'node test.js' },
    }),
    'utf8',
  );
  await writeFile(
    join(targetPath, 'src', 'index.js'),
    'export function ready() { return true; }\n',
    'utf8',
  );
  const spec = [
    '# Lifecycle fixture',
    '',
    'Status: accepted',
    'Spec ID: lifecycle-fixture',
    'Version: 1.0.0',
    'License: MIT',
    'Source: human-authored fixture and repository evidence',
    '',
    '## Intent',
    '',
    'The owner is the maintainer. The user job is a safe local workflow.',
    '',
    '## Workflow',
    '',
    'The user previews the action and can recover before shipping.',
    '',
    '## Acceptance',
    '',
    'AC-001: Given valid input, when the workflow runs, then the intended result is observable.',
    '',
    '## Verification',
    '',
    'Check: `npm test`',
    '',
    '## Taste and human review',
    '',
    'Reviewer: maintainer',
    'Rubric: clear, reversible, and understandable under pressure.',
    '',
    '## Release',
    '',
    'Release target and artifact: local package.',
    'Compatibility: Node.js 20 or newer. Rollback: previous version.',
    '',
  ].join('\n');
  const specBuffer = Buffer.from(spec, 'utf8');
  await writeFile(specPath, specBuffer);
  await writeFile(
    contractPath,
    await readFile('examples/product-contract.json', 'utf8'),
    'utf8',
  );
  const contractBytes = await readFile(contractPath);
  await writeFile(
    acceptancePath,
    JSON.stringify({
      decision: 'accepted',
      acceptedBy: 'lifecycle fixture owner',
      acceptedAt: '2026-01-01T00:00:00.000Z',
      contractPath,
      contractSha256: createHash('sha256').update(contractBytes).digest('hex'),
      decisionSource: 'lifecycle fixture review record',
    }),
    'utf8',
  );
  await writeFile(
    provenancePath,
    JSON.stringify({
      receiptKind: 'github-spec-pull',
      license: 'MIT',
      contentSha256: createHash('sha256').update(specBuffer).digest('hex'),
    }),
    'utf8',
  );
  return {
    specPath,
    specSha256: createHash('sha256').update(specBuffer).digest('hex'),
    targetPath,
    contractPath,
    acceptancePath,
    provenancePath,
  };
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
