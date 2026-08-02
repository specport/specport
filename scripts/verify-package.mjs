import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const node = process.execPath;

const packageManifest = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
);
const tempRoot = await mkdtemp(join(tmpdir(), 'specport-package-'));

try {
  await run(
    npm,
    ['pack', '--ignore-scripts', '--silent', '--pack-destination', tempRoot],
    root,
  );
  const tarballs = (await readdir(tempRoot))
    .filter((file) => file.endsWith('.tgz'))
    .map((file) => join(tempRoot, file));
  if (tarballs.length !== 1) {
    throw new Error(`Expected one package tarball, found ${tarballs.length}.`);
  }

  const consumer = join(tempRoot, 'consumer');
  await mkdir(consumer, { recursive: true });
  await run(npm, ['init', '--yes', '--silent'], consumer);
  await run(
    npm,
    ['install', '--ignore-scripts', '--no-save', '--silent', tarballs[0]],
    consumer,
  );

  const installedRoot = join(consumer, 'node_modules', '@specport', 'specport');
  const installedManifest = JSON.parse(
    await readFile(join(installedRoot, 'package.json'), 'utf8'),
  );
  if (installedManifest.name !== packageManifest.name) {
    throw new Error(
      'Installed package name does not match the workspace package.',
    );
  }
  if (installedManifest.version !== packageManifest.version) {
    throw new Error(
      'Installed package version does not match the workspace package.',
    );
  }
  if (Object.keys(installedManifest.dependencies ?? {}).length !== 0) {
    throw new Error(
      'Published CLI unexpectedly declares runtime dependencies.',
    );
  }

  const installedCli = join(installedRoot, 'dist', 'cli.js');
  const lifecycleSchema = JSON.parse(
    await readFile(
      join(installedRoot, 'schemas', 'spec-lifecycle.schema.json'),
      'utf8',
    ),
  );
  const packetSchema = JSON.parse(
    await readFile(
      join(installedRoot, 'schemas', 'repo-to-spec-packet.schema.json'),
      'utf8',
    ),
  );
  const ledgerSchema = JSON.parse(
    await readFile(
      join(installedRoot, 'schemas', 'repo-to-spec-evidence-ledger.schema.json'),
      'utf8',
    ),
  );
  const lockSchema = JSON.parse(
    await readFile(join(installedRoot, 'schemas', 'spec-lock.schema.json'), 'utf8'),
  );
  const driftSchema = JSON.parse(
    await readFile(
      join(installedRoot, 'schemas', 'spec-drift.schema.json'),
      'utf8',
    ),
  );
  const lifecycleAjv = new Ajv({ allErrors: true, strict: false });
  addFormats(lifecycleAjv);
  const validateLifecycle = lifecycleAjv.compile(lifecycleSchema);
  const validatePacket = lifecycleAjv.compile(packetSchema);
  const validateLedger = lifecycleAjv.compile(ledgerSchema);
  const validateLock = lifecycleAjv.compile(lockSchema);
  const validateDrift = lifecycleAjv.compile(driftSchema);
  const version = (
    await run(node, [installedCli, '--version'], consumer)
  ).stdout.trim();
  if (version !== packageManifest.version) {
    throw new Error(
      `Installed CLI returned ${version}, expected ${packageManifest.version}.`,
    );
  }

  const draft = JSON.parse(
    (
      await run(
        node,
        [installedCli, 'create', 'package smoke notes', '--json'],
        consumer,
      )
    ).stdout,
  );
  if (draft.specKind !== 'authoring-draft' || draft.status !== 'draft') {
    throw new Error(
      'Installed create command did not return an authoring draft.',
    );
  }

  const repositoryMap = JSON.parse(
    (
      await run(
        node,
        [installedCli, 'spec', 'map', consumer, '--json'],
        consumer,
      )
    ).stdout,
  );
  if (
    repositoryMap.specKind !== 'repository-map' ||
    repositoryMap.safety?.codeExecuted !== false ||
    repositoryMap.safety?.networkAccessed !== false
  ) {
    throw new Error(
      'Installed repository mapper did not preserve its safety boundary.',
    );
  }
  const packetRoot = join(consumer, 'repo-to-spec-packet');
  const bundle = await runAllowFailure(
    node,
    [
      installedCli,
      'spec',
      'bundle',
      consumer,
      '--out',
      packetRoot,
      '--json',
      '--generated-at',
      '2026-08-02T19:00:00.000Z',
    ],
    consumer,
  );
  if (bundle.code !== 5) {
    throw new Error(
      `Installed repo-to-spec bundle returned ${bundle.code}, expected draft gate 5.`,
    );
  }
  const packet = JSON.parse(bundle.stdout);
  if (
    packet.artifactKind !== 'repo-to-spec-packet' ||
    packet.status !== 'draft-only' ||
    packet.safety?.codeExecuted !== false ||
    packet.safety?.networkAccessed !== false
  ) {
    throw new Error(
      'Installed repo-to-spec bundle did not preserve its draft-only safety boundary.',
    );
  }
  assertPacket(validatePacket, packet, 'installed repo-to-spec packet');
  for (const file of [
    'SPEC.md',
    '.specport/repository-baseline.json',
    '.specport/repo-map.json',
    '.specport/repo-to-spec/evidence-ledger.json',
    '.specport/repo-to-spec/spec-check.json',
    '.specport/repo-to-spec/packet.json',
  ]) {
    await access(join(packetRoot, ...file.split('/')));
  }
  const packetLedger = JSON.parse(
    await readFile(
      join(packetRoot, '.specport', 'repo-to-spec', 'evidence-ledger.json'),
      'utf8',
    ),
  );
  if (
    packetLedger.artifactKind !== 'repo-to-spec-evidence-ledger' ||
    packetLedger.handoff?.status !== 'draft-only'
  ) {
    throw new Error('Installed bundle did not write a usable evidence ledger.');
  }
  assertSchema(
    validateLedger,
    packetLedger,
    'installed repo-to-spec ledger',
    'repo-to-spec-evidence-ledger.schema.json',
  );
  const lockPath = join(packetRoot, 'SPEC.lock');
  const lockResult = await run(
    node,
    [
      installedCli,
      'spec',
      'lock',
      join(packetRoot, 'SPEC.md'),
      '--out',
      lockPath,
      '--json',
      '--generated-at',
      '2026-08-02T19:01:00.000Z',
    ],
    consumer,
  );
  const lock = JSON.parse(lockResult.stdout);
  if (
    lock.artifactKind !== 'spec-lock' ||
    lock.safety?.codeExecuted !== false ||
    lock.safety?.networkAccessed !== false
  ) {
    throw new Error('Installed SPEC.lock command crossed its safety boundary.');
  }
  assertSchema(validateLock, lock, 'installed SPEC.lock', 'spec-lock.schema.json');
  await access(lockPath);
  const cleanDrift = await run(
    node,
    [
      installedCli,
      'spec',
      'drift',
      join(packetRoot, 'SPEC.md'),
      '--lock',
      lockPath,
      '--json',
      '--generated-at',
      '2026-08-02T19:02:00.000Z',
    ],
    consumer,
  );
  const cleanDriftArtifact = JSON.parse(cleanDrift.stdout);
  if (cleanDriftArtifact.status !== 'clean') {
    throw new Error('Installed SPEC.lock drift check was not clean immediately after creation.');
  }
  assertSchema(
    validateDrift,
    cleanDriftArtifact,
    'installed clean SPEC.lock drift report',
    'spec-drift.schema.json',
  );
  await writeFile(
    join(packetRoot, 'SPEC.md'),
    `${await readFile(join(packetRoot, 'SPEC.md'), 'utf8')}\nChanged after lock.\n`,
    'utf8',
  );
  const changedDrift = await runAllowFailure(
    node,
    [
      installedCli,
      'spec',
      'drift',
      join(packetRoot, 'SPEC.md'),
      '--lock',
      lockPath,
      '--json',
    ],
    consumer,
  );
  if (changedDrift.code !== 5) {
    throw new Error(`Installed changed SPEC.lock drift returned ${changedDrift.code}, expected 5.`);
  }
  const changedDriftArtifact = JSON.parse(changedDrift.stdout);
  if (changedDriftArtifact.status !== 'drifted') {
    throw new Error('Installed SPEC.lock drift check did not report changed source.');
  }
  assertSchema(
    validateDrift,
    changedDriftArtifact,
    'installed changed SPEC.lock drift report',
    'spec-drift.schema.json',
  );
  const remix = JSON.parse(
    (
      await run(
        node,
        [
          installedCli,
          'spec',
          'remix',
          join(installedRoot, 'README.md'),
          '--change',
          'Package the implementation boundary explicitly',
          '--json',
        ],
        consumer,
      )
    ).stdout,
  );
  if (
    remix.artifactKind !== 'spec-remix' ||
    remix.status !== 'draft' ||
    remix.lineage?.parents?.length !== 1
  ) {
    throw new Error('Installed remix command did not preserve parent lineage.');
  }
  assertLifecycleArtifact(validateLifecycle, remix, 'installed remix');

  const lifecycleFixture = join(consumer, 'lifecycle-fixture');
  const fixtureTarget = join(lifecycleFixture, 'target');
  const fixtureSpecPath = join(lifecycleFixture, 'SPEC.md');
  const fixtureContractPath = join(fixtureTarget, '.specport', 'contract.json');
  const fixtureAcceptancePath = join(
    lifecycleFixture,
    'contract-acceptance.json',
  );
  const fixtureReceiptPath = join(lifecycleFixture, 'pull-receipt.json');
  await mkdir(join(fixtureTarget, '.specport'), { recursive: true });
  await mkdir(join(fixtureTarget, 'src'), { recursive: true });
  const fixtureSpec = [
    '# Installed lifecycle fixture',
    '',
    'Status: accepted',
    'Spec ID: installed-lifecycle-fixture',
    'Version: 1.0.0',
    'License: MIT',
    'Source: installed package smoke fixture',
    '',
    '## Intent',
    '',
    'The maintainer needs a bounded local workflow.',
    '',
    '## Workflow',
    '',
    'The user previews the action and can recover before shipping.',
    '',
    '## Acceptance',
    '',
    'AC-001: Given valid input, when the workflow runs, then the result is observable.',
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
  const fixtureSpecBytes = Buffer.from(fixtureSpec, 'utf8');
  await writeFile(fixtureSpecPath, fixtureSpecBytes);
  await writeFile(
    join(fixtureTarget, 'package.json'),
    JSON.stringify({
      name: 'installed-lifecycle-target',
      scripts: { test: 'node test.js' },
    }),
  );
  await writeFile(
    join(fixtureTarget, 'src', 'index.js'),
    'export function ready() { return true; }\n',
  );
  await writeFile(
    fixtureContractPath,
    await readFile(join(installedRoot, 'examples', 'product-contract.json')),
  );
  const fixtureContractBytes = await readFile(fixtureContractPath);
  await writeFile(
    fixtureAcceptancePath,
    JSON.stringify({
      decision: 'accepted',
      acceptedBy: 'installed package smoke owner',
      acceptedAt: '2026-01-01T00:00:00.000Z',
      contractPath: fixtureContractPath,
      contractSha256: createHash('sha256')
        .update(fixtureContractBytes)
        .digest('hex'),
      decisionSource: 'installed package smoke acceptance record',
    }),
  );
  await writeFile(
    fixtureReceiptPath,
    JSON.stringify({
      receiptKind: 'github-spec-pull',
      license: 'MIT',
      contentSha256: createHash('sha256')
        .update(fixtureSpecBytes)
        .digest('hex'),
    }),
  );

  const cover = JSON.parse(
    (
      await run(
        node,
        [
          installedCli,
          'spec',
          'cover',
          fixtureSpecPath,
          '--target',
          fixtureTarget,
          '--target-stack',
          'node',
          '--contract',
          fixtureContractPath,
          '--provenance',
          fixtureReceiptPath,
          '--json',
        ],
        consumer,
      )
    ).stdout,
  );
  if (cover.artifactKind !== 'spec-cover' || cover.status !== 'ready') {
    throw new Error('Installed cover command did not produce a ready plan.');
  }
  assertLifecycleArtifact(validateLifecycle, cover, 'installed cover');
  if (
    cover.authority?.execution !== 'none' ||
    cover.verification?.status !== 'not-run'
  ) {
    throw new Error('Installed cover command crossed its execution boundary.');
  }

  const build = JSON.parse(
    (
      await run(
        node,
        [
          installedCli,
          'spec',
          'build',
          fixtureSpecPath,
          '--target',
          fixtureTarget,
          '--target-stack',
          'node',
          '--contract',
          fixtureContractPath,
          '--acceptance-record',
          fixtureAcceptancePath,
          '--provenance',
          fixtureReceiptPath,
          '--json',
        ],
        consumer,
      )
    ).stdout,
  );
  if (build.artifactKind !== 'spec-build-handoff' || build.status !== 'ready') {
    throw new Error('Installed build command did not produce a ready handoff.');
  }
  assertLifecycleArtifact(validateLifecycle, build, 'installed build');
  if (
    build.execution?.codeGenerated !== false ||
    build.execution?.repositoryCodeExecuted !== false ||
    build.execution?.checksRun !== false
  ) {
    throw new Error('Installed build command crossed its execution boundary.');
  }

  const blockedCover = await runAllowFailure(
    node,
    [
      installedCli,
      'spec',
      'cover',
      fixtureSpecPath,
      '--target',
      fixtureTarget,
      '--target-stack',
      'node',
      '--contract',
      fixtureContractPath,
      '--json',
    ],
    consumer,
  );
  if (blockedCover.code !== 5) {
    throw new Error(
      `Installed blocked cover returned ${blockedCover.code}, expected 5.`,
    );
  }
  const blockedCoverArtifact = JSON.parse(blockedCover.stdout);
  if (blockedCoverArtifact.status !== 'blocked') {
    throw new Error(
      'Installed blocked cover did not return a blocked artifact.',
    );
  }
  assertLifecycleArtifact(
    validateLifecycle,
    blockedCoverArtifact,
    'installed blocked cover',
  );

  const skillList = JSON.parse(
    (await run(node, [installedCli, 'skill', 'list', '--json'], consumer))
      .stdout,
  );
  if (
    !skillList.skills?.some(
      (skill) => skill.name === 'specport-repo-to-spec',
    ) ||
    !skillList.skills?.some(
      (skill) => skill.name === 'specport-spec-to-production',
    )
  ) {
    throw new Error('Installed skill catalog is incomplete.');
  }
  const humanSkillList = await run(
    node,
    [installedCli, 'skill', 'list'],
    consumer,
  );
  if (!humanSkillList.stdout.includes('SKILLS')) {
    throw new Error('Installed human skill listing is incomplete.');
  }
  const skillTarget = join(consumer, 'exported-repo-to-spec');
  const skillExport = JSON.parse(
    (
      await run(
        node,
        [
          installedCli,
          'skill',
          'export',
          'specport-repo-to-spec',
          '--out',
          skillTarget,
          '--json',
        ],
        consumer,
      )
    ).stdout,
  );
  if (
    skillExport.artifactKind !== 'skill-export' ||
    !skillExport.files.includes('agents/openai.yaml') ||
    !skillExport.files.includes('references/evidence-ledger.template.json')
  ) {
    throw new Error('Installed skill export did not return an export receipt.');
  }
  await access(join(skillTarget, 'SKILL.md'));
  const productionTarget = join(consumer, 'exported-spec-to-production');
  const productionExport = JSON.parse(
    (
      await run(
        node,
        [
          installedCli,
          'skill',
          'export',
          'specport-spec-to-production',
          '--out',
          productionTarget,
          '--json',
        ],
        consumer,
      )
    ).stdout,
  );
  if (
    productionExport.artifactKind !== 'skill-export' ||
    !productionExport.files.includes('references/gate-ledger.template.md') ||
    !productionExport.files.includes('references/taste-review.template.md') ||
    !productionExport.files.includes('references/ship-receipt.template.md') ||
    !productionExport.files.includes(
      'references/contract-acceptance-record.template.json',
    )
  ) {
    throw new Error('Installed production skill export is incomplete.');
  }
  await access(join(productionTarget, 'references', 'gate-ledger.template.md'));
  await access(join(productionTarget, 'references', 'taste-review.template.md'));
  await access(
    join(
      productionTarget,
      'references',
      'contract-acceptance-record.template.json',
    ),
  );
  await access(join(installedRoot, 'RELEASE.md'));

  const contractPath = join(installedRoot, 'examples', 'product-contract.json');
  await access(contractPath);
  await access(join(installedRoot, 'schemas', 'repository-map.schema.json'));
  await access(join(installedRoot, 'schemas', 'spec-lifecycle.schema.json'));
  await access(
    join(installedRoot, 'schemas', 'repo-to-spec-packet.schema.json'),
  );
  await access(
    join(installedRoot, 'schemas', 'repo-to-spec-evidence-ledger.schema.json'),
  );
  await access(join(installedRoot, 'schemas', 'spec-lock.schema.json'));
  await access(join(installedRoot, 'schemas', 'spec-drift.schema.json'));
  const validation = JSON.parse(
    (
      await run(
        node,
        [installedCli, 'spec', 'validate', contractPath, '--json'],
        consumer,
      )
    ).stdout,
  );
  if (validation.valid !== true) {
    throw new Error('Installed contract example did not validate.');
  }
  const humanValidation = await run(
    node,
    [installedCli, 'spec', 'validate', contractPath],
    consumer,
  );
  if (!humanValidation.stdout.includes('CONTRACT  valid')) {
    throw new Error('Installed human contract validation is incomplete.');
  }

  console.log(
    `package_smoke_ok name=${packageManifest.name} version=${packageManifest.version} runtimeDependencies=0`,
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function run(command, args, cwd) {
  const executable =
    process.platform === 'win32' && command === npm ? 'cmd.exe' : command;
  const executableArgs =
    process.platform === 'win32' && command === npm
      ? ['/d', '/s', '/c', [command, ...args.map(quoteWindowsArg)].join(' ')]
      : args;
  try {
    return await execFileAsync(executable, executableArgs, {
      cwd,
      env: {
        ...process.env,
        npm_config_dry_run: 'false',
        npm_config_update_notifier: 'false',
      },
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}: ${detail}`);
  }
}

async function runAllowFailure(command, args, cwd) {
  const executable =
    process.platform === 'win32' && command === npm ? 'cmd.exe' : command;
  const executableArgs =
    process.platform === 'win32' && command === npm
      ? ['/d', '/s', '/c', [command, ...args.map(quoteWindowsArg)].join(' ')]
      : args;
  try {
    const result = await execFileAsync(executable, executableArgs, {
      cwd,
      env: {
        ...process.env,
        npm_config_dry_run: 'false',
        npm_config_update_notifier: 'false',
      },
      maxBuffer: 4 * 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: typeof error?.code === 'number' ? error.code : 1,
      stdout: error?.stdout ?? '',
      stderr: error?.stderr ?? '',
    };
  }
}

function assertLifecycleArtifact(validate, artifact, label) {
  if (!validate(artifact)) {
    throw new Error(
      `${label} failed spec-lifecycle.schema.json: ${JSON.stringify(validate.errors)}`,
    );
  }
}

function assertPacket(validate, artifact, label) {
  assertSchema(validate, artifact, label, 'repo-to-spec-packet.schema.json');
}

function assertSchema(validate, artifact, label, schemaName) {
  if (!validate(artifact)) {
    throw new Error(
      `${label} failed ${schemaName}: ${JSON.stringify(validate.errors)}`,
    );
  }
}

function quoteWindowsArg(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replaceAll('"', '\\"')}"`;
}
