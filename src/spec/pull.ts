/**
 * A read-only, exact-ref GitHub spec pull.
 *
 * This module deliberately has no filesystem, Git, process, or package-manager
 * access. It only uses an injected fetch function (or the host's fetch) to
 * inspect GitHub metadata and return the selected file as text.
 */

import { createHash } from 'node:crypto';

export const DEFAULT_SPEC_PATH = 'SPEC.md';
export const PULL_RECEIPT_SCHEMA_VERSION = '1';
const MAX_SPEC_BYTES = 2 * 1024 * 1024;

export interface GitHubSpecReference {
  readonly source: string;
  readonly canonicalSource: string;
  readonly owner: string;
  readonly repository: string;
  readonly ref: string;
  readonly path: string;
}

export interface GitHubFetchInit {
  readonly method: 'GET';
  readonly headers: Readonly<Record<string, string>>;
}

export interface GitHubFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText?: string;
  json(): Promise<unknown>;
}

export type GitHubSpecFetch = (
  url: string,
  init: GitHubFetchInit,
) => Promise<GitHubFetchResponse>;

export interface GitHubSpecPullOptions {
  readonly fetch?: GitHubSpecFetch;
  readonly apiBaseUrl?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface GitHubLicenseInfo {
  readonly spdxId: string | null;
  readonly name: string | null;
  readonly key: string | null;
  readonly url: string | null;
}

export interface GitHubRepositoryMetadata {
  readonly fullName: string;
  readonly htmlUrl: string;
  readonly defaultBranch: string | null;
  readonly private: boolean | null;
  readonly archived: boolean | null;
  readonly license: GitHubLicenseInfo;
}

export interface GitHubSpecProvenance {
  readonly provider: 'github';
  readonly source: string;
  readonly repository: string;
  readonly ref: string;
  readonly commit: string;
  readonly path: string;
  readonly license: string;
  readonly repositoryUrl: string;
  readonly contentUrl: string;
}

export interface GitHubSpecPullReceipt {
  readonly schemaVersion: string;
  readonly receiptKind: 'github-spec-pull';
  /** The exact locator supplied by the caller. */
  readonly source: string;
  /** The locator with the default path made explicit. */
  readonly canonicalSource: string;
  readonly owner: string;
  readonly repository: string;
  readonly ref: string;
  readonly commit: string;
  readonly path: string;
  /** SPDX identifier when available, otherwise GitHub's declared license name. */
  readonly license: string;
  readonly licenseDetails: GitHubLicenseInfo;
  readonly repositoryMetadata: GitHubRepositoryMetadata;
  readonly content: {
    readonly path: string;
    readonly sha: string | null;
    readonly encoding: 'base64';
  };
  /** SHA-256 of the decoded UTF-8 spec bytes, for derived-artifact lineage. */
  readonly contentSha256: string;
  readonly provenance: GitHubSpecProvenance;
  /** Explicitly records that no repository code was executed. */
  readonly execution: 'none';
}

export interface GitHubSpecPullResult {
  readonly receipt: GitHubSpecPullReceipt;
  /** Decoded UTF-8 file contents, preserved byte-for-byte as text. */
  readonly rawContent: string;
  /** Alias for rawContent for callers that use the conventional content name. */
  readonly content: string;
}

export type GitHubSpecPullErrorCode =
  | 'invalid-source'
  | 'unsafe-path'
  | 'invalid-ref'
  | 'fetch-unavailable'
  | 'request-failed'
  | 'github-error'
  | 'invalid-response'
  | 'missing-license'
  | 'unsupported-content'
  | 'missing-content'
  | 'content-too-large'
  | 'invalid-content';

export class GitHubSpecPullError extends Error {
  readonly code: GitHubSpecPullErrorCode;
  readonly status: number | null;
  readonly url: string | null;

  constructor(
    code: GitHubSpecPullErrorCode,
    message: string,
    details: { readonly status?: number; readonly url?: string } = {},
  ) {
    super(message);
    this.name = 'GitHubSpecPullError';
    this.code = code;
    this.status = details.status ?? null;
    this.url = details.url ?? null;
  }
}

/**
 * Parse owner/repo@ref:path or a commit-pinned GitHub file URL. A missing path
 * means SPEC.md. The source is not normalized or silently trimmed: the
 * receipt can therefore prove exactly what the caller requested.
 */
export function parseGitHubSpecReference(source: string): GitHubSpecReference {
  if (typeof source !== 'string' || source.length === 0) {
    throw new GitHubSpecPullError(
      'invalid-source',
      'GitHub spec source must be a non-empty owner/repo@ref locator.',
    );
  }
  if (source.trim() !== source) {
    throw new GitHubSpecPullError(
      'invalid-source',
      'GitHub spec source must not have leading or trailing whitespace.',
    );
  }

  if (looksLikeUrl(source)) return parseGitHubSpecUrl(source);

  const at = source.indexOf('@');
  if (at <= 0) {
    throw new GitHubSpecPullError(
      'invalid-source',
      'GitHub spec source must use owner/repo@ref[:path].',
    );
  }

  const repositoryLocator = source.slice(0, at);
  const repositoryParts = repositoryLocator.split('/');
  if (repositoryParts.length !== 2) {
    throw new GitHubSpecPullError(
      'invalid-source',
      'GitHub spec source must contain exactly one owner/repo separator.',
    );
  }
  const owner = repositoryParts[0];
  const repository = repositoryParts[1];
  if (
    !owner ||
    !repository ||
    !isGitHubName(owner) ||
    !isGitHubName(repository)
  ) {
    throw new GitHubSpecPullError(
      'invalid-source',
      'GitHub owner and repository names contain unsupported characters.',
    );
  }

  const refAndPath = source.slice(at + 1);
  const colon = refAndPath.indexOf(':');
  const ref = colon === -1 ? refAndPath : refAndPath.slice(0, colon);
  const path = colon === -1 ? DEFAULT_SPEC_PATH : refAndPath.slice(colon + 1);
  if (colon !== -1 && refAndPath.indexOf(':', colon + 1) !== -1) {
    throw new GitHubSpecPullError(
      'unsafe-path',
      'GitHub spec paths must be relative POSIX paths without colons.',
    );
  }

  validateRef(ref);
  validatePath(path);

  return {
    source,
    canonicalSource: `${owner}/${repository}@${ref}:${path}`,
    owner,
    repository,
    ref,
    path,
  };
}

function looksLikeUrl(source: string): boolean {
  return /^[A-Za-z][A-Za-z\d+.-]*:\/\//u.test(source);
}

function parseGitHubSpecUrl(source: string): GitHubSpecReference {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new GitHubSpecPullError(
      'invalid-source',
      'GitHub spec URL is not a valid URL.',
    );
  }

  if (url.protocol !== 'https:' || url.search !== '' || url.hash !== '') {
    throw new GitHubSpecPullError(
      'invalid-source',
      'GitHub spec URLs must use HTTPS and must not contain a query or fragment.',
    );
  }

  const segments = decodeUrlPath(url.pathname);
  const hostname = url.hostname.toLowerCase();
  const isGitHubBlob =
    hostname === 'github.com' || hostname === 'www.github.com';
  const isGitHubRaw = hostname === 'raw.githubusercontent.com';
  if (!isGitHubBlob && !isGitHubRaw) {
    throw new GitHubSpecPullError(
      'invalid-source',
      'GitHub spec URLs must use github.com or raw.githubusercontent.com.',
    );
  }

  const minimumSegments = isGitHubBlob ? 5 : 4;
  if (
    segments.length < minimumSegments ||
    segments.some((segment) => segment === '')
  ) {
    throw new GitHubSpecPullError(
      'invalid-source',
      'GitHub spec URL must identify owner, repository, an exact commit, and a file path.',
    );
  }

  const owner = segments[0] ?? '';
  const repository = segments[1] ?? '';
  const refIndex = isGitHubBlob ? 3 : 2;
  const ref = segments[refIndex] ?? '';
  const pathIndex = isGitHubBlob ? 4 : 3;
  if (isGitHubBlob && segments[2] !== 'blob') {
    throw new GitHubSpecPullError(
      'invalid-source',
      'GitHub web URLs must use the /blob/<commit>/<path> form.',
    );
  }
  if (
    !owner ||
    !repository ||
    !isGitHubName(owner) ||
    !isGitHubName(repository)
  ) {
    throw new GitHubSpecPullError(
      'invalid-source',
      'GitHub owner and repository names contain unsupported characters.',
    );
  }
  if (!/^[0-9a-f]{40}$/iu.test(ref)) {
    throw new GitHubSpecPullError(
      'invalid-ref',
      'GitHub file URLs must pin a 40-character commit SHA; use owner/repo@ref:path for a branch or tag.',
    );
  }

  const path = segments.slice(pathIndex).join('/');
  validateRef(ref);
  validatePath(path);
  return {
    source,
    canonicalSource: `${owner}/${repository}@${ref}:${path}`,
    owner,
    repository,
    ref,
    path,
  };
}

function decodeUrlPath(pathname: string): string[] {
  const rawSegments = pathname.split('/').slice(1);
  try {
    return rawSegments.map((segment) => decodeURIComponent(segment));
  } catch {
    throw new GitHubSpecPullError(
      'unsafe-path',
      'GitHub spec URL contains invalid percent encoding.',
    );
  }
}

/**
 * Resolve a GitHub ref to a commit and fetch one file from that immutable
 * commit through the contents API. No repository code is downloaded for
 * execution; the only returned artifact is decoded text plus its receipt.
 */
export async function pullGitHubSpec(
  source: string,
  options: GitHubSpecPullOptions = {},
): Promise<GitHubSpecPullResult> {
  const reference = parseGitHubSpecReference(source);
  const fetcher = options.fetch ?? defaultFetch();
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const headers: Readonly<Record<string, string>> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'specport',
    ...options.headers,
  };
  const repositoryUrl = `${apiBaseUrl}/repos/${encodePathSegment(reference.owner)}/${encodePathSegment(reference.repository)}`;

  const repositoryPayload = await requestJson(
    fetcher,
    repositoryUrl,
    headers,
    'repository metadata',
  );
  const repositoryMetadata = readRepositoryMetadata(
    repositoryPayload,
    reference,
  );

  const commitUrl = `${repositoryUrl}/commits/${encodeURIComponent(reference.ref)}`;
  const commitPayload = await requestJson(
    fetcher,
    commitUrl,
    headers,
    'ref resolution',
  );
  const commit = readCommit(commitPayload);

  const contentUrl = `${repositoryUrl}/contents/${encodePath(reference.path)}?ref=${encodeURIComponent(commit)}`;
  const contentPayload = await requestJson(
    fetcher,
    contentUrl,
    headers,
    'spec content',
  );
  const file = readContent(contentPayload, reference.path);
  const webRepositoryUrl = repositoryMetadata.htmlUrl;
  const sourceUrl = `${webRepositoryUrl.replace(/\/$/u, '')}/blob/${encodePath(reference.ref)}/${encodePath(reference.path)}`;
  const webContentUrl = nonEmptyString(contentPayload.html_url) ?? sourceUrl;

  const provenance: GitHubSpecProvenance = {
    provider: 'github',
    source: reference.source,
    repository: repositoryMetadata.fullName,
    ref: reference.ref,
    commit,
    path: reference.path,
    license:
      repositoryMetadata.license.spdxId ??
      repositoryMetadata.license.name ??
      '',
    repositoryUrl: webRepositoryUrl,
    contentUrl: webContentUrl,
  };
  const license = provenance.license;
  if (!license) {
    throw new GitHubSpecPullError(
      'missing-license',
      'GitHub repository metadata did not provide a usable license.',
    );
  }

  const receipt: GitHubSpecPullReceipt = {
    schemaVersion: PULL_RECEIPT_SCHEMA_VERSION,
    receiptKind: 'github-spec-pull',
    source: reference.source,
    canonicalSource: reference.canonicalSource,
    owner: reference.owner,
    repository: reference.repository,
    ref: reference.ref,
    commit,
    path: reference.path,
    license,
    licenseDetails: repositoryMetadata.license,
    repositoryMetadata,
    contentSha256: createHash('sha256').update(file.text, 'utf8').digest('hex'),
    content: file.metadata,
    provenance,
    execution: 'none',
  };

  return {
    receipt,
    rawContent: file.text,
    content: file.text,
  };
}

function validateRef(ref: string): void {
  if (
    ref.length === 0 ||
    ref.trim() !== ref ||
    /\s/u.test(ref) ||
    ['~', '^', ':', '?', '*', '[', '\\', '#'].some((character) =>
      ref.includes(character),
    ) ||
    ref.includes('..') ||
    ref.includes('@{') ||
    ref.startsWith('/') ||
    ref.endsWith('/') ||
    ref.startsWith('.') ||
    ref.endsWith('.') ||
    ref.includes('//')
  ) {
    throw new GitHubSpecPullError(
      'invalid-ref',
      'GitHub refs must use a valid exact branch, tag, or commit reference.',
    );
  }
}

function validatePath(path: string): void {
  if (
    path.length === 0 ||
    path.trim() !== path ||
    path.startsWith('/') ||
    path.endsWith('/') ||
    path.includes('//') ||
    path.includes('\\') ||
    path.includes('?') ||
    path.includes('#') ||
    path.includes('%') ||
    /^[A-Za-z]:/u.test(path) ||
    hasControlCharacter(path)
  ) {
    throw new GitHubSpecPullError(
      'unsafe-path',
      'GitHub spec path must be a relative, unencoded POSIX path.',
    );
  }
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new GitHubSpecPullError(
      'unsafe-path',
      'GitHub spec path must not contain dot traversal segments.',
    );
  }
}

function isGitHubName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value);
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const input = value ?? 'https://api.github.com';
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new GitHubSpecPullError(
      'invalid-source',
      `GitHub API base URL is invalid: ${input}`,
    );
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new GitHubSpecPullError(
      'invalid-source',
      'GitHub API base URL must be an HTTP(S) URL without query or fragment.',
    );
  }
  return url.toString().replace(/\/$/u, '');
}

function defaultFetch(): GitHubSpecFetch {
  const candidate = (globalThis as { fetch?: unknown }).fetch;
  if (typeof candidate !== 'function') {
    throw new GitHubSpecPullError(
      'fetch-unavailable',
      'No fetch implementation is available; inject options.fetch.',
    );
  }
  return (url, init) => (candidate as GitHubSpecFetch)(url, init);
}

async function requestJson(
  fetcher: GitHubSpecFetch,
  url: string,
  headers: Readonly<Record<string, string>>,
  purpose: string,
): Promise<Record<string, unknown>> {
  let response: GitHubFetchResponse;
  try {
    response = await fetcher(url, { method: 'GET', headers });
  } catch (error) {
    if (error instanceof GitHubSpecPullError) throw error;
    throw new GitHubSpecPullError(
      'request-failed',
      `GitHub ${purpose} request failed: ${errorMessage(error)}`,
      { url },
    );
  }
  if (!response.ok) {
    const statusText = response.statusText?.trim();
    throw new GitHubSpecPullError(
      'github-error',
      `GitHub ${purpose} request failed with HTTP ${response.status}${statusText ? ` ${statusText}` : ''}.`,
      { status: response.status, url },
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new GitHubSpecPullError(
      'invalid-response',
      `GitHub ${purpose} response was not valid JSON: ${errorMessage(error)}`,
      { status: response.status, url },
    );
  }
  if (!isRecord(payload)) {
    throw new GitHubSpecPullError(
      'invalid-response',
      `GitHub ${purpose} response must be a JSON object.`,
      { status: response.status, url },
    );
  }
  return payload;
}

function readRepositoryMetadata(
  payload: Record<string, unknown>,
  reference: GitHubSpecReference,
): GitHubRepositoryMetadata {
  const license = readLicense(payload.license);
  const fullName =
    nonEmptyString(payload.full_name) ??
    `${reference.owner}/${reference.repository}`;
  return {
    fullName,
    htmlUrl:
      nonEmptyString(payload.html_url) ??
      `https://github.com/${reference.owner}/${reference.repository}`,
    defaultBranch: nonEmptyString(payload.default_branch) ?? null,
    private: booleanOrNull(payload.private),
    archived: booleanOrNull(payload.archived),
    license,
  };
}

function readLicense(value: unknown): GitHubLicenseInfo {
  const record = isRecord(value) ? value : {};
  const rawSpdxId = nonEmptyString(record.spdx_id);
  const rawName = nonEmptyString(record.name);
  const spdxId = usableLicenseValue(rawSpdxId) ?? null;
  const name = usableLicenseValue(rawName) ?? null;
  if (!spdxId && !name) {
    throw new GitHubSpecPullError(
      'missing-license',
      'GitHub repository metadata did not declare a usable license.',
    );
  }
  return {
    spdxId,
    name,
    key: nonEmptyString(record.key) ?? null,
    url: nonEmptyString(record.url) ?? null,
  };
}

function readCommit(payload: Record<string, unknown>): string {
  const commit = nonEmptyString(payload.sha);
  if (!commit || !/^[0-9a-f]{40}$/iu.test(commit)) {
    throw new GitHubSpecPullError(
      'invalid-response',
      'GitHub ref resolution did not return a usable commit SHA.',
    );
  }
  return commit;
}

function readContent(
  payload: Record<string, unknown>,
  requestedPath: string,
): {
  readonly metadata: GitHubSpecPullReceipt['content'];
  readonly text: string;
} {
  if (payload.type !== 'file') {
    throw new GitHubSpecPullError(
      'unsupported-content',
      `GitHub contents API returned ${String(payload.type ?? 'unknown')}; only files can be pulled.`,
    );
  }
  const returnedPath = nonEmptyString(payload.path);
  if (returnedPath && returnedPath !== requestedPath) {
    throw new GitHubSpecPullError(
      'invalid-response',
      `GitHub contents API returned ${returnedPath} instead of ${requestedPath}.`,
    );
  }
  if (payload.encoding !== 'base64') {
    throw new GitHubSpecPullError(
      'unsupported-content',
      'GitHub contents API did not return base64 file content.',
    );
  }
  const encoded = nonEmptyString(payload.content);
  if (!encoded) {
    throw new GitHubSpecPullError(
      'missing-content',
      'GitHub contents API returned no file content.',
    );
  }
  if (
    typeof payload.size === 'number' &&
    (!Number.isSafeInteger(payload.size) || payload.size > MAX_SPEC_BYTES)
  ) {
    throw new GitHubSpecPullError(
      'content-too-large',
      `GitHub spec content exceeds the ${MAX_SPEC_BYTES}-byte local limit.`,
    );
  }
  const text = decodeBase64Utf8(encoded);
  if (text.trim() === '') {
    throw new GitHubSpecPullError(
      'missing-content',
      'GitHub contents API returned an empty spec file.',
    );
  }
  if (new TextEncoder().encode(text).byteLength > MAX_SPEC_BYTES) {
    throw new GitHubSpecPullError(
      'content-too-large',
      `GitHub spec content exceeds the ${MAX_SPEC_BYTES}-byte local limit.`,
    );
  }
  return {
    metadata: {
      path: returnedPath ?? requestedPath,
      sha: nonEmptyString(payload.sha) ?? null,
      encoding: 'base64',
    },
    text,
  };
}

function decodeBase64Utf8(value: string): string {
  const encoded = value.replace(/[\r\n\t ]/gu, '');
  if (
    encoded.length === 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      encoded,
    )
  ) {
    throw new GitHubSpecPullError(
      'invalid-content',
      'GitHub file content was not valid base64.',
    );
  }

  const decoder = (globalThis as { atob?: (data: string) => string }).atob;
  if (typeof decoder !== 'function') {
    throw new GitHubSpecPullError(
      'invalid-content',
      'This runtime does not provide a base64 decoder.',
    );
  }
  let binary: string;
  try {
    binary = decoder(encoded);
  } catch {
    throw new GitHubSpecPullError(
      'invalid-content',
      'GitHub file content was not decodable base64.',
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new GitHubSpecPullError(
      'invalid-content',
      'GitHub file content was not valid UTF-8 text.',
    );
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodePathSegment).join('/');
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function usableLicenseValue(value: string | undefined): string | undefined {
  if (!value || value.toUpperCase() === 'NOASSERTION') return undefined;
  return value;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}
