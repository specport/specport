import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = join(root, 'package.json');
const outputPath = join(root, 'docs', 'release.json');
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const bin = typeof packageJson.bin === 'string'
  ? packageJson.name.split('/').at(-1)
  : Object.keys(packageJson.bin ?? {})[0] ?? null;

const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(packageJson.name)}`;
const release = {
  name: packageJson.name,
  version: packageJson.version,
  license: packageJson.license,
  engine: packageJson.engines?.node ?? null,
  bin,
  repository: packageJson.repository?.url ?? null,
  homepage: packageJson.homepage ?? null,
  publicationStatus: 'NOT-PUBLISHED',
  registryVersion: null,
  registryTarball: null,
  deploymentStatus: process.env.SPECPORT_PAGES_STATUS ?? 'SOURCE / VERIFY AFTER DEPLOY',
  commit: process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 12) : 'local checkout',
  source: 'package.json + registry.npmjs.org',
};

try {
  const response = await fetch(registryUrl, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });

  if (response.ok) {
    const registry = await response.json();
    const registryVersion = registry['dist-tags']?.latest ?? null;
    const versionRecord = registry.versions?.[packageJson.version];
    release.registryVersion = registryVersion;
    release.registryTarball = versionRecord?.dist?.tarball ?? null;
    if (registryVersion === packageJson.version && release.registryTarball) {
      release.publicationStatus = 'PUBLISHED';
    } else if (registryVersion !== packageJson.version) {
      release.publicationStatus = 'VERSION-MISMATCH';
    }
  }
} catch {
  // A failed registry check is deliberately fail-closed as NOT-PUBLISHED.
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(release, null, 2)}\n`, 'utf8');
console.log(`Wrote ${outputPath} (${release.publicationStatus}, ${release.version}).`);
