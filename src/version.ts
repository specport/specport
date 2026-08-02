import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packagePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../package.json',
);
const packageMetadata: unknown = JSON.parse(readFileSync(packagePath, 'utf8'));

if (
  typeof packageMetadata !== 'object' ||
  packageMetadata === null ||
  typeof (packageMetadata as { version?: unknown }).version !== 'string'
) {
  throw new Error(`Invalid package metadata at ${packagePath}.`);
}

export const VERSION = (packageMetadata as { version: string }).version;
