import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { tryRunGit } from '../git/command.js';
import { discoverRepository } from '../git/snapshot.js';
import { VERSION } from '../version.js';

export type MapLanguage =
  | 'JavaScript'
  | 'TypeScript'
  | 'Python'
  | 'Go'
  | 'Rust'
  | 'Java'
  | 'Ruby'
  | 'PHP'
  | 'CSS'
  | 'JSON'
  | 'Markdown'
  | 'YAML'
  | 'TOML'
  | 'Shell'
  | 'unknown';

export type MapFileRole =
  | 'source'
  | 'test'
  | 'config'
  | 'documentation'
  | 'workflow'
  | 'asset'
  | 'unknown';

export interface RepositoryMapFile {
  path: string;
  bytes: number;
  lines: number | null;
  language: MapLanguage;
  role: MapFileRole;
  evidence: 'observed';
  parseStatus: 'parsed' | 'skipped-binary' | 'skipped-limit' | 'unsupported';
}

export interface RepositoryMapSymbol {
  name: string;
  kind: 'class' | 'function' | 'variable' | 'type' | 'unknown';
  path: string;
  line: number;
  visibility: 'public' | 'private' | 'unknown';
  evidence: 'inferred';
}

export interface RepositoryMapImport {
  from: string;
  specifier: string;
  line: number;
  resolvedPath: string | null;
  evidence: 'inferred';
}

export interface RepositoryMapSurface {
  kind: 'http-route' | 'cli-command' | 'package-entrypoint';
  value: string;
  path: string;
  line: number | null;
  evidence: 'inferred' | 'observed';
}

export interface RepositoryMapUnknown {
  code:
    | 'dynamic-runtime'
    | 'unsupported-language'
    | 'file-limit'
    | 'byte-limit'
    | 'binary-file'
    | 'unresolved-local-import'
    | 'generated-or-reflection';
  message: string;
  path?: string;
  evidence: 'unknown';
}

export interface RepositoryMap {
  schemaVersion: string;
  specKind: 'repository-map';
  status: 'draft';
  generatedAt: string;
  repository: {
    path: string;
    repositoryId: string | null;
    headCommit: string | null;
    baseCommit: string | null;
    stable: boolean | null;
    fileCount: number;
  };
  safety: {
    codeExecuted: false;
    networkAccessed: false;
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    truncated: boolean;
  };
  files: readonly RepositoryMapFile[];
  symbols: readonly RepositoryMapSymbol[];
  imports: readonly RepositoryMapImport[];
  surfaces: readonly RepositoryMapSurface[];
  unknowns: readonly RepositoryMapUnknown[];
  nextActions: readonly string[];
}

export const MAP_LIMITS = {
  maxFiles: 2_000,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
} as const;

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.specport',
  '.githuman',
  'coverage',
  'dist',
  'node_modules',
]);

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.go',
  '.java',
  '.js',
  '.jsx',
  '.mjs',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.ts',
  '.tsx',
]);

export async function mapRepository(
  requestedPath = '.',
  generatedAt = new Date().toISOString(),
): Promise<RepositoryMap> {
  const requested = resolve(requestedPath);
  const requestedStats = await stat(requested);
  if (!requestedStats.isDirectory()) {
    throw new Error(`Repository path must be a directory: ${requested}`);
  }

  const gitRepository = await tryDiscoverRepository(requested);
  const root = gitRepository?.root ?? (await realpath(requested));
  const files = await listRepositoryFiles(root, Boolean(gitRepository));
  const unknowns: RepositoryMapUnknown[] = [];
  const mapFiles: RepositoryMapFile[] = [];
  const symbols: RepositoryMapSymbol[] = [];
  const imports: RepositoryMapImport[] = [];
  const surfaces: RepositoryMapSurface[] = [];
  let totalBytes = 0;
  let truncated = false;

  const limitedFiles = files.slice(0, MAP_LIMITS.maxFiles);
  if (files.length > MAP_LIMITS.maxFiles) {
    truncated = true;
    unknowns.push({
      code: 'file-limit',
      message: `Only the first ${MAP_LIMITS.maxFiles} sorted files were mapped; ${files.length - MAP_LIMITS.maxFiles} files were not inspected.`,
      evidence: 'unknown',
    });
  }

  for (const path of limitedFiles) {
    const absolute = join(root, ...path.split('/'));
    const bytes = await fileSize(absolute);
    const language = languageForPath(path);
    const role = roleForPath(path, language);
    const baseFile: RepositoryMapFile = {
      path,
      bytes,
      lines: null,
      language,
      role,
      evidence: 'observed',
      parseStatus: 'unsupported',
    };

    if (bytes > MAP_LIMITS.maxFileBytes) {
      truncated = true;
      mapFiles.push({ ...baseFile, parseStatus: 'skipped-limit' });
      unknowns.push({
        code: 'byte-limit',
        message: `File exceeds the ${MAP_LIMITS.maxFileBytes}-byte mapping limit and was not parsed.`,
        path,
        evidence: 'unknown',
      });
      continue;
    }
    if (totalBytes + bytes > MAP_LIMITS.maxTotalBytes) {
      truncated = true;
      mapFiles.push({ ...baseFile, parseStatus: 'skipped-limit' });
      unknowns.push({
        code: 'byte-limit',
        message: `The repository mapping stopped at the ${MAP_LIMITS.maxTotalBytes}-byte aggregate limit.`,
        path,
        evidence: 'unknown',
      });
      continue;
    }

    totalBytes += bytes;
    if (!SOURCE_EXTENSIONS.has(extname(path).toLowerCase())) {
      mapFiles.push(baseFile);
      continue;
    }

    const content = await readTextSafely(absolute);
    if (content === null) {
      mapFiles.push({ ...baseFile, parseStatus: 'skipped-binary' });
      unknowns.push({
        code: 'binary-file',
        message: 'The file contains binary bytes and was not parsed as source.',
        path,
        evidence: 'unknown',
      });
      continue;
    }

    mapFiles.push({
      ...baseFile,
      lines: lineCount(content),
      parseStatus: 'parsed',
    });
    const parsed = parseSource(path, content);
    symbols.push(...parsed.symbols);
    surfaces.push(...parsed.surfaces);
    for (const imported of parsed.imports) {
      imports.push({
        from: path,
        specifier: imported.specifier,
        line: imported.line,
        resolvedPath: null,
        evidence: 'inferred',
      });
    }
    if (parsed.hasDynamicRuntime) {
      unknowns.push({
        code: 'dynamic-runtime',
        message:
          'Dynamic import, require, reflection, or runtime path construction was observed; static edges are incomplete.',
        path,
        evidence: 'unknown',
      });
    }
  }

  const knownPaths = new Set(mapFiles.map((file) => file.path));
  const resolvedImports = imports.map((entry) => {
    const resolvedPath = resolveLocalImport(
      entry.from,
      entry.specifier,
      knownPaths,
    );
    if (entry.specifier.startsWith('.') && resolvedPath === null) {
      unknowns.push({
        code: 'unresolved-local-import',
        message: `A local import could not be resolved within the mapped file set: ${entry.specifier}.`,
        path: entry.from,
        evidence: 'unknown',
      });
    }
    return { ...entry, resolvedPath };
  });

  const packageEntrypoints = await readPackageEntrypoints(root);
  surfaces.push(...packageEntrypoints);
  if (files.some((path) => path.startsWith('.github/workflows/'))) {
    unknowns.push({
      code: 'generated-or-reflection',
      message:
        'Workflow and generated-output behavior is recorded as files, but runtime deployment behavior is not inferred.',
      evidence: 'unknown',
    });
  }
  if (mapFiles.some((file) => file.language === 'unknown')) {
    unknowns.push({
      code: 'unsupported-language',
      message:
        'Some observed files have no supported language classification; their behavior is not mapped.',
      evidence: 'unknown',
    });
  }

  const repositorySnapshot = await tryRepositorySnapshot(root);
  const repository = repositorySnapshot
    ? {
        path: root,
        repositoryId: repositorySnapshot.repositoryId,
        headCommit: repositorySnapshot.headCommit,
        baseCommit: repositorySnapshot.baseCommit,
        stable: repositorySnapshot.stable,
        fileCount: files.length,
      }
    : {
        path: root,
        repositoryId: gitRepository?.repositoryId ?? null,
        headCommit: gitRepository?.headCommit ?? null,
        baseCommit: null,
        stable: null,
        fileCount: files.length,
      };

  const uniqueUnknowns = dedupeUnknowns(unknowns);
  const uniqueSymbols = dedupeSymbols(symbols);
  const uniqueSurfaces = dedupeSurfaces(surfaces);
  const nextActions = buildNextActions({
    files: mapFiles,
    imports: resolvedImports,
    unknowns: uniqueUnknowns,
    surfaces: uniqueSurfaces,
  });

  return {
    schemaVersion: VERSION,
    specKind: 'repository-map',
    status: 'draft',
    generatedAt,
    repository,
    safety: {
      codeExecuted: false,
      networkAccessed: false,
      ...MAP_LIMITS,
      truncated,
    },
    files: mapFiles.sort((left, right) => left.path.localeCompare(right.path)),
    symbols: uniqueSymbols,
    imports: resolvedImports.sort(compareImports),
    surfaces: uniqueSurfaces,
    unknowns: uniqueUnknowns,
    nextActions,
  };
}

export function renderRepositoryMapMarkdown(map: RepositoryMap): string {
  const observedFiles = map.files.length
    ? map.files.map(
        (file) =>
          `- \`${file.path}\` — ${file.role}, ${file.language}, ${file.bytes} bytes (${file.parseStatus})`,
      )
    : ['- None observed.'];
  const symbols = map.symbols.length
    ? map.symbols.map(
        (symbol) =>
          `- \`${symbol.name}\` (${symbol.kind}, ${symbol.visibility}) — \`${symbol.path}:${symbol.line}\``,
      )
    : ['- None statically identified.'];
  const imports = map.imports.length
    ? map.imports.map(
        (entry) =>
          `- \`${entry.from}:${entry.line}\` → \`${entry.specifier}\`` +
          (entry.resolvedPath
            ? ` → \`${entry.resolvedPath}\``
            : ' (unresolved)'),
      )
    : ['- None statically identified.'];
  const surfaces = map.surfaces.length
    ? map.surfaces.map(
        (surface) =>
          `- **${surface.kind}** \`${surface.value}\` — \`${surface.path}${surface.line ? `:${surface.line}` : ''}\` (${surface.evidence})`,
      )
    : ['- None statically identified.'];
  const unknowns = map.unknowns.length
    ? map.unknowns.map(
        (unknown) =>
          `- **${unknown.code}**${unknown.path ? ` \`${unknown.path}\`` : ''}: ${unknown.message}`,
      )
    : ['- None recorded.'];
  const nextActions = map.nextActions.map((action) => `- ${action}`);

  return [
    '# Repository Map Draft',
    '',
    '> Generated by SpecPort from bounded static evidence. It is an implementation map, not a product-intent contract.',
    '',
    `- Status: **${map.status}**`,
    `- Generated: \`${map.generatedAt}\``,
    `- Repository: \`${map.repository.path}\``,
    `- Repository identity: \`${map.repository.repositoryId ?? 'not available'}\``,
    `- Head: \`${map.repository.headCommit ?? 'not available'}\``,
    `- Files observed: **${map.repository.fileCount}**`,
    '',
    '## Safety boundary',
    '',
    '- Code executed: **no**',
    '- Network accessed: **no**',
    `- Limits: ${map.safety.maxFiles} files, ${map.safety.maxFileBytes} bytes/file, ${map.safety.maxTotalBytes} bytes total`,
    `- Truncated: **${map.safety.truncated ? 'yes — unknowns below are incomplete' : 'no'}**`,
    '',
    '## Observed files',
    '',
    ...observedFiles,
    '',
    '## Inferred symbols',
    '',
    ...symbols,
    '',
    '## Inferred local and package imports',
    '',
    ...imports,
    '',
    '## Inferred or observed product surfaces',
    '',
    ...surfaces,
    '',
    '## Unknowns and boundaries',
    '',
    ...unknowns,
    '',
    '## Next actions',
    '',
    ...nextActions,
    '',
    '## Machine-readable map',
    '',
    '```json',
    JSON.stringify(map, null, 2),
    '```',
    '',
  ].join('\n');
}

async function tryDiscoverRepository(
  requested: string,
): Promise<Awaited<ReturnType<typeof discoverRepository>> | null> {
  try {
    return await discoverRepository(requested);
  } catch {
    return null;
  }
}

async function tryRepositorySnapshot(root: string): Promise<{
  repositoryId: string;
  headCommit: string | null;
  baseCommit: string | null;
  stable: boolean | null;
} | null> {
  try {
    const repository = await discoverRepository(root);
    const output = await tryRunGit(root, ['status', '--porcelain']);
    return {
      repositoryId: repository.repositoryId,
      headCommit: repository.headCommit,
      baseCommit: null,
      stable: output === '',
    };
  } catch {
    return null;
  }
}

async function listRepositoryFiles(
  root: string,
  isGitRepository: boolean,
): Promise<string[]> {
  if (isGitRepository) {
    const output = await tryRunGit(root, [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ]);
    if (output !== null) {
      return output
        .split('\0')
        .filter(Boolean)
        .map((file) => file.replaceAll('\\', '/'))
        .sort();
    }
  }
  const files: string[] = [];
  await walk(root, root, files);
  return files.sort();
}

async function walk(
  root: string,
  current: string,
  files: string[],
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(root, absolute, files);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(relative(root, absolute).replaceAll('\\', '/'));
    }
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function readTextSafely(path: string): Promise<string | null> {
  try {
    const buffer = await readFile(path);
    if (buffer.includes(0)) return null;
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

function languageForPath(path: string): MapLanguage {
  const extension = extname(path).toLowerCase();
  if (extension === '.ts' || extension === '.tsx') return 'TypeScript';
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) return 'JavaScript';
  if (extension === '.py') return 'Python';
  if (extension === '.go') return 'Go';
  if (extension === '.rs') return 'Rust';
  if (extension === '.java') return 'Java';
  if (extension === '.rb') return 'Ruby';
  if (extension === '.php') return 'PHP';
  if (extension === '.css' || extension === '.scss') return 'CSS';
  if (extension === '.json') return 'JSON';
  if (extension === '.md' || extension === '.mdx') return 'Markdown';
  if (extension === '.yaml' || extension === '.yml') return 'YAML';
  if (extension === '.toml') return 'TOML';
  if (extension === '.sh' || extension === '.bash') return 'Shell';
  return 'unknown';
}

function roleForPath(path: string, language: MapLanguage): MapFileRole {
  const normalized = path.toLowerCase();
  if (normalized.startsWith('.github/workflows/')) return 'workflow';
  if (
    normalized === 'readme.md' ||
    normalized.startsWith('docs/') ||
    language === 'Markdown'
  )
    return 'documentation';
  if (
    /(^|\/)(test|tests|__tests__|spec|specs|e2e)(\/|$)/.test(normalized) ||
    /\.(test|spec)\.[^.]+$/.test(normalized)
  )
    return 'test';
  if (
    language === 'JSON' ||
    language === 'YAML' ||
    language === 'TOML' ||
    /(^|\/)(package|tsconfig|vite|webpack|rollup|biome|eslint|jest|vitest)[^.]*\./.test(
      normalized,
    )
  )
    return 'config';
  if (SOURCE_EXTENSIONS.has(extname(path).toLowerCase())) return 'source';
  if (language !== 'unknown') return 'asset';
  return 'unknown';
}

function lineCount(content: string): number {
  return content.length === 0 ? 0 : content.split(/\r?\n/).length;
}

interface ParsedSource {
  symbols: RepositoryMapSymbol[];
  imports: Array<{ specifier: string; line: number }>;
  surfaces: RepositoryMapSurface[];
  hasDynamicRuntime: boolean;
}

function parseSource(path: string, content: string): ParsedSource {
  const language = languageForPath(path);
  const lines = content.split(/\r?\n/);
  const symbols: RepositoryMapSymbol[] = [];
  const imports: Array<{ specifier: string; line: number }> = [];
  const surfaces: RepositoryMapSurface[] = [];
  let hasDynamicRuntime = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineNumber = index + 1;
    if (language === 'TypeScript' || language === 'JavaScript') {
      collectJavaScriptSymbols(path, line, lineNumber, symbols);
      collectJavaScriptImports(line, lineNumber, imports);
      collectJavaScriptSurfaces(path, line, lineNumber, surfaces);
      if (/\b(?:import|require)\s*\(/.test(line) || /\bReflect\./.test(line))
        hasDynamicRuntime = true;
    } else if (language === 'Python') {
      collectPythonSymbols(path, line, lineNumber, symbols);
      collectPythonImports(line, lineNumber, imports);
      collectPythonSurfaces(path, line, lineNumber, surfaces);
      if (/\b(?:__import__|importlib|globals\s*\()/.test(line))
        hasDynamicRuntime = true;
    } else if (language === 'Go') {
      collectGenericSymbols(
        path,
        line,
        lineNumber,
        symbols,
        /^(?:\s*)func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
      );
      collectGoImports(line, lineNumber, imports);
    } else if (language === 'Rust') {
      collectGenericSymbols(
        path,
        line,
        lineNumber,
        symbols,
        /^(?:\s*)(?:pub\s+)?(?:fn|struct|enum|trait)\s+([A-Za-z_]\w*)/,
      );
      collectRustImports(line, lineNumber, imports);
    } else if (language === 'Java') {
      collectGenericSymbols(
        path,
        line,
        lineNumber,
        symbols,
        /^(?:\s*)(?:(?:public|private|protected|static|final)\s+)*(?:class|interface|enum)\s+([A-Za-z_]\w*)/,
      );
    }
  }

  return { symbols, imports, surfaces, hasDynamicRuntime };
}

function collectJavaScriptSymbols(
  path: string,
  line: string,
  lineNumber: number,
  symbols: RepositoryMapSymbol[],
): void {
  const match =
    /^(\s*)(export\s+)?(?:default\s+)?(?:async\s+)?(function|class|const|let|var|type|interface)\s+([A-Za-z_$][\w$]*)/.exec(
      line,
    );
  if (!match) return;
  const kind = match[3];
  symbols.push({
    name: match[4] ?? 'unknown',
    kind:
      kind === 'function'
        ? 'function'
        : kind === 'class'
          ? 'class'
          : kind === 'type' || kind === 'interface'
            ? 'type'
            : 'variable',
    path,
    line: lineNumber,
    visibility: match[2] ? 'public' : 'private',
    evidence: 'inferred',
  });
}

function collectJavaScriptImports(
  line: string,
  lineNumber: number,
  imports: Array<{ specifier: string; line: number }>,
): void {
  const patterns = [
    /^(?:\s*)import(?:[^'"\n]*?\sfrom\s*)?['"]([^'"]+)['"]/,
    /^(?:\s*)export(?:[^'"\n]*?\sfrom\s*)['"]([^'"]+)['"]/,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (match?.[1]) imports.push({ specifier: match[1], line: lineNumber });
  }
}

function collectJavaScriptSurfaces(
  path: string,
  line: string,
  lineNumber: number,
  surfaces: RepositoryMapSurface[],
): void {
  const route =
    /\b(?:app|router|server|fastify)\.(get|post|put|patch|delete|options|head|use)\s*\(\s*['"]([^'"]+)['"]/.exec(
      line,
    );
  if (route?.[1] && route[2]) {
    surfaces.push({
      kind: 'http-route',
      value: `${route[1].toUpperCase()} ${route[2]}`,
      path,
      line: lineNumber,
      evidence: 'inferred',
    });
  }
}

function collectPythonSymbols(
  path: string,
  line: string,
  lineNumber: number,
  symbols: RepositoryMapSymbol[],
): void {
  const match = /^\s*(async\s+)?(def|class)\s+([A-Za-z_]\w*)/.exec(line);
  if (!match?.[3]) return;
  symbols.push({
    name: match[3],
    kind: match[2] === 'def' ? 'function' : 'class',
    path,
    line: lineNumber,
    visibility: match[3].startsWith('_') ? 'private' : 'public',
    evidence: 'inferred',
  });
}

function collectPythonImports(
  line: string,
  lineNumber: number,
  imports: Array<{ specifier: string; line: number }>,
): void {
  const match = /^\s*(?:from\s+([.\w/]+)\s+import|import\s+([.\w/]+))/.exec(
    line,
  );
  const specifier = match?.[1] ?? match?.[2];
  if (specifier) imports.push({ specifier, line: lineNumber });
}

function collectPythonSurfaces(
  path: string,
  line: string,
  lineNumber: number,
  surfaces: RepositoryMapSurface[],
): void {
  const route = /@\w+\.route\(\s*['"]([^'"]+)['"]/.exec(line);
  if (route?.[1]) {
    surfaces.push({
      kind: 'http-route',
      value: route[1],
      path,
      line: lineNumber,
      evidence: 'inferred',
    });
  }
}

function collectGenericSymbols(
  path: string,
  line: string,
  lineNumber: number,
  symbols: RepositoryMapSymbol[],
  pattern: RegExp,
): void {
  const match = pattern.exec(line);
  if (!match?.[1]) return;
  symbols.push({
    name: match[1],
    kind: /struct|enum|trait|class|interface/.test(line) ? 'type' : 'function',
    path,
    line: lineNumber,
    visibility: /\bpub\b|\bpublic\b/.test(line) ? 'public' : 'private',
    evidence: 'inferred',
  });
}

function collectGoImports(
  line: string,
  lineNumber: number,
  imports: Array<{ specifier: string; line: number }>,
): void {
  const match = /^\s*import\s+(?:\w+\s+)?["`]([^"`]+)["`]/.exec(line);
  if (match?.[1]) imports.push({ specifier: match[1], line: lineNumber });
}

function collectRustImports(
  line: string,
  lineNumber: number,
  imports: Array<{ specifier: string; line: number }>,
): void {
  const match = /^\s*(?:pub\s+)?use\s+([^;]+);/.exec(line);
  if (match?.[1])
    imports.push({ specifier: match[1].trim(), line: lineNumber });
}

function resolveLocalImport(
  fromPath: string,
  specifier: string,
  knownPaths: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith('.')) return null;
  const directory = fromPath.includes('/')
    ? fromPath.slice(0, fromPath.lastIndexOf('/'))
    : '';
  const base = normalizePath(`${directory}/${specifier}`);
  const extensionless = base.replace(/\.(?:c?js|jsx|mjs|tsx?|py)$/i, '');
  const candidates = [
    base,
    extensionless,
    `${extensionless}.ts`,
    `${extensionless}.tsx`,
    `${extensionless}.js`,
    `${extensionless}.jsx`,
    `${extensionless}.mjs`,
    `${extensionless}.cjs`,
    `${extensionless}.py`,
    `${extensionless}/index.ts`,
    `${extensionless}/index.tsx`,
    `${extensionless}/index.js`,
    `${extensionless}/index.jsx`,
    `${extensionless}/__init__.py`,
  ];
  return candidates.find((candidate) => knownPaths.has(candidate)) ?? null;
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

async function readPackageEntrypoints(
  root: string,
): Promise<RepositoryMapSurface[]> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(root, 'package.json'), 'utf8'),
    );
    if (!isRecord(parsed)) return [];
    const surfaces: RepositoryMapSurface[] = [];
    for (const key of ['main', 'module', 'types', 'typings']) {
      if (typeof parsed[key] === 'string') {
        surfaces.push({
          kind: 'package-entrypoint',
          value: `${key}: ${parsed[key]}`,
          path: 'package.json',
          line: null,
          evidence: 'observed',
        });
      }
    }
    if (isRecord(parsed.exports)) {
      surfaces.push({
        kind: 'package-entrypoint',
        value: 'exports: declared',
        path: 'package.json',
        line: null,
        evidence: 'observed',
      });
    }
    if (isRecord(parsed.bin)) {
      for (const [name, value] of Object.entries(parsed.bin)) {
        if (typeof value === 'string') {
          surfaces.push({
            kind: 'cli-command',
            value: `${name}: ${value}`,
            path: 'package.json',
            line: null,
            evidence: 'observed',
          });
        }
      }
    } else if (typeof parsed.bin === 'string') {
      surfaces.push({
        kind: 'cli-command',
        value: `package-bin: ${parsed.bin}`,
        path: 'package.json',
        line: null,
        evidence: 'observed',
      });
    }
    return surfaces;
  } catch {
    return [];
  }
}

function dedupeSymbols(
  symbols: readonly RepositoryMapSymbol[],
): RepositoryMapSymbol[] {
  const seen = new Set<string>();
  return symbols
    .filter((symbol) => {
      const key = `${symbol.path}:${symbol.line}:${symbol.name}:${symbol.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.line - right.line ||
        left.name.localeCompare(right.name),
    );
}

function dedupeSurfaces(
  surfaces: readonly RepositoryMapSurface[],
): RepositoryMapSurface[] {
  const seen = new Set<string>();
  return surfaces
    .filter((surface) => {
      const key = `${surface.kind}:${surface.value}:${surface.path}:${String(surface.line)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.value.localeCompare(right.value) ||
        left.path.localeCompare(right.path),
    );
}

function dedupeUnknowns(
  unknowns: readonly RepositoryMapUnknown[],
): RepositoryMapUnknown[] {
  const seen = new Set<string>();
  return unknowns.filter((unknown) => {
    const key = `${unknown.code}:${unknown.path ?? ''}:${unknown.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareImports(
  left: RepositoryMapImport,
  right: RepositoryMapImport,
): number {
  return (
    left.from.localeCompare(right.from) ||
    left.line - right.line ||
    left.specifier.localeCompare(right.specifier)
  );
}

function buildNextActions(input: {
  files: readonly RepositoryMapFile[];
  imports: readonly RepositoryMapImport[];
  unknowns: readonly RepositoryMapUnknown[];
  surfaces: readonly RepositoryMapSurface[];
}): string[] {
  const actions = [
    'Use the observed file roles and inferred edges to define the intended edit scope before asking an agent to change code.',
    'Turn important inferred surfaces into scenario acceptance criteria and repeatable verification commands owned by a human.',
  ];
  if (input.unknowns.length)
    actions.push(
      'Resolve or explicitly accept the recorded unknowns; static mapping does not prove runtime behavior, security, taste, or release readiness.',
    );
  if (!input.imports.some((entry) => entry.resolvedPath !== null))
    actions.push(
      'Confirm module boundaries manually or with the project test/build commands; no local static dependency edge was proven.',
    );
  if (!input.surfaces.length)
    actions.push(
      'Declare the user-facing entrypoint and product contract; no callable surface was statically identified.',
    );
  if (!input.files.some((file) => file.role === 'test'))
    actions.push(
      'Add or identify executable tests before treating a mapped change as shippable.',
    );
  return actions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
