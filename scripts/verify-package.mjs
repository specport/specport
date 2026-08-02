import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

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

  const installedRoot = join(
    consumer,
    'node_modules',
    '@specport',
    'specport',
  );
  const installedManifest = JSON.parse(
    await readFile(join(installedRoot, 'package.json'), 'utf8'),
  );
  if (installedManifest.name !== packageManifest.name) {
    throw new Error('Installed package name does not match the workspace package.');
  }
  if (installedManifest.version !== packageManifest.version) {
    throw new Error('Installed package version does not match the workspace package.');
  }
  if (Object.keys(installedManifest.dependencies ?? {}).length !== 0) {
    throw new Error('Published CLI unexpectedly declares runtime dependencies.');
  }

  const installedCli = join(installedRoot, 'dist', 'cli.js');
  const version = (await run(node, [installedCli, '--version'], consumer)).stdout.trim();
  if (version !== packageManifest.version) {
    throw new Error(`Installed CLI returned ${version}, expected ${packageManifest.version}.`);
  }

  const draft = JSON.parse(
    (
      await run(node, [installedCli, 'create', 'package smoke notes', '--json'], consumer)
    ).stdout,
  );
  if (draft.specKind !== 'authoring-draft' || draft.status !== 'draft') {
    throw new Error('Installed create command did not return an authoring draft.');
  }

  const skillList = JSON.parse(
    (
      await run(node, [installedCli, 'skill', 'list', '--json'], consumer)
    ).stdout,
  );
  if (
    !skillList.skills?.some((skill) => skill.name === 'specport-repo-to-spec') ||
    !skillList.skills?.some((skill) => skill.name === 'specport-spec-to-production')
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
    !productionExport.files.includes('references/ship-receipt.template.md')
  ) {
    throw new Error('Installed production skill export is incomplete.');
  }
  await access(join(productionTarget, 'references', 'gate-ledger.template.md'));
  await access(join(installedRoot, 'RELEASE.md'));

  const contractPath = join(installedRoot, 'examples', 'product-contract.json');
  await access(contractPath);
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
  const executable = process.platform === 'win32' && command === npm
    ? 'cmd.exe'
    : command;
  const executableArgs = process.platform === 'win32' && command === npm
    ? ['/d', '/s', '/c', [command, ...args.map(quoteWindowsArg)].join(' ')]
    : args;
  try {
    return await execFileAsync(executable, executableArgs, {
      cwd,
      env: { ...process.env, npm_config_update_notifier: 'false' },
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}: ${detail}`);
  }
}

function quoteWindowsArg(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replaceAll('"', '\\"')}"`;
}
