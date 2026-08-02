import { normalizeRepoPath } from '../core/coverage.js';
import type {
  ChangedPath,
  CoverageResult,
  FinalTreeSnapshot,
  ReceiverSource,
} from '../core/types.js';
import {
  type DiffHunk,
  fingerprintPatch,
  type PatchFile,
} from '../git/patch.js';
import { repositoryIdentity } from '../git/snapshot.js';

export interface GitHumanOptions {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface GitHumanReviewResult {
  source: ReceiverSource;
  rawReview: Record<string, unknown>;
}

export interface GitHumanTodoResult {
  id: string;
}

export class GitHumanAdapterError extends Error {
  readonly code: 'unavailable' | 'invalid-source' | 'not-found';

  constructor(
    message: string,
    code: GitHumanAdapterError['code'] = 'unavailable',
  ) {
    super(message);
    this.name = 'GitHumanAdapterError';
    this.code = code;
  }
}

export class GitHumanAdapter {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GitHumanOptions = {}) {
    this.baseUrl = (
      options.baseUrl ??
      process.env.GITHUMAN_URL ??
      'http://localhost:3847'
    ).replace(/\/$/, '');
    this.token = options.token ?? process.env.GITHUMAN_TOKEN;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async getReview(
    repository: FinalTreeSnapshot,
    requestedId?: string,
  ): Promise<GitHumanReviewResult> {
    const review =
      requestedId && requestedId !== 'last'
        ? await this.getJson(`/api/reviews/${encodeURIComponent(requestedId)}`)
        : await this.findLastReview(repository);
    return {
      source: await toReceiverSource(this, review, repository),
      rawReview: review,
    };
  }

  async attachTodo(
    reviewId: string,
    content: string,
  ): Promise<GitHumanTodoResult> {
    const result = await this.request('/api/todos', {
      method: 'POST',
      body: JSON.stringify({ content, reviewId }),
    });
    if (!isRecord(result) || typeof result.id !== 'string') {
      throw new GitHumanAdapterError(
        'GitHuman returned an invalid todo response.',
      );
    }
    return { id: result.id };
  }

  async getFileHunks(reviewId: string, filePath: string): Promise<DiffHunk[]> {
    const result = await this.getJson(
      `/api/reviews/${encodeURIComponent(reviewId)}/files/hunks?path=${encodeURIComponent(filePath)}`,
    );
    if (!Array.isArray(result.hunks)) {
      throw new GitHumanAdapterError(
        'GitHuman returned an invalid hunk response.',
      );
    }
    return result.hunks as DiffHunk[];
  }

  async findLastReview(
    repository: FinalTreeSnapshot,
  ): Promise<Record<string, unknown>> {
    const result = await this.getJson('/api/reviews?page=1&pageSize=100');
    if (!isRecord(result) || !Array.isArray(result.reviews)) {
      throw new GitHumanAdapterError(
        'GitHuman returned an invalid review list.',
      );
    }
    const matches = result.reviews.filter(
      (item): item is Record<string, unknown> => {
        if (!isRecord(item) || typeof item.repositoryPath !== 'string')
          return false;
        return (
          repositoryIdentity(item.repositoryPath) === repository.repositoryId &&
          (item.status === 'in_progress' || item.status === 'approved')
        );
      },
    );
    if (matches.length !== 1) {
      throw new GitHumanAdapterError(
        matches.length === 0
          ? 'No unambiguous GitHuman review exists for this repository.'
          : 'More than one GitHuman review matches this repository; pass --review explicitly.',
        'not-found',
      );
    }
    const match = matches[0];
    if (!match)
      throw new GitHumanAdapterError(
        'GitHuman review selection was empty.',
        'not-found',
      );
    return match;
  }

  private async getJson(path: string): Promise<Record<string, unknown>> {
    const result = await this.request(path);
    if (!isRecord(result))
      throw new GitHumanAdapterError(
        'GitHuman returned a non-object response.',
      );
    return result;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/json');
      if (init.body !== undefined)
        headers.set('Content-Type', 'application/json');
      if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          payload = text;
        }
      }
      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.error === 'string'
            ? payload.error
            : `GitHuman HTTP ${response.status}`;
        throw new GitHumanAdapterError(
          message,
          response.status === 404 ? 'not-found' : 'unavailable',
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof GitHumanAdapterError) throw error;
      const message =
        error instanceof Error ? error.message : 'GitHuman request failed';
      throw new GitHumanAdapterError(message);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function toReceiverSource(
  adapter: GitHumanAdapter,
  review: Record<string, unknown>,
  repository: FinalTreeSnapshot,
): Promise<ReceiverSource> {
  const reviewId = stringValue(review.id);
  const repositoryPath = stringValue(review.repositoryPath);
  const sourceKind = sourceKindValue(review.sourceType);
  const baseCommit = nullableString(review.baseRef);
  const reviewRepositoryId = repositoryIdentity(repositoryPath);
  const files = Array.isArray(review.files) ? review.files : [];
  const entries = files.flatMap((file): ChangedPath[] => {
    if (!isRecord(file)) return [];
    const newPath = stringValue(file.newPath ?? file.filePath);
    const oldPath = nullableString(file.oldPath);
    const status = pathStatus(file.status);
    if (!newPath) return [];
    const entry: ChangedPath = {
      path: normalizeRepoPath(newPath),
      status,
      ...(oldPath && oldPath !== newPath
        ? { oldPath: normalizeRepoPath(oldPath) }
        : {}),
    };
    return [entry];
  });
  let sourceFingerprint = firstString(
    review.sourceFingerprint,
    review.snapshotFingerprint,
    review.fingerprint,
  );
  const sourceIdentity = firstString(
    review.sourceIdentity,
    review.resolvedSourceCommit,
  );
  let sourceFingerprintKind: ReceiverSource['sourceFingerprintKind'] =
    review.sourceFingerprintKind === 'patch' ||
    review.sourceFingerprintKind === 'tree'
      ? review.sourceFingerprintKind
      : undefined;
  if (
    !sourceFingerprint &&
    sourceKind === 'staged' &&
    isFullCommit(baseCommit) &&
    files.length > 0
  ) {
    const patch = await derivePatch(adapter, reviewId, files);
    if (patch) {
      sourceFingerprint = fingerprintPatch(baseCommit, patch);
      sourceFingerprintKind = 'patch';
    }
  }
  const receiverVersion = firstString(review.receiverVersion, review.version);
  const repositoryMismatch = reviewRepositoryId !== repository.repositoryId;
  return {
    receiverName: 'githuman',
    ...(receiverVersion ? { receiverVersion } : {}),
    reviewId,
    repositoryPath,
    repositoryId: repositoryMismatch
      ? reviewRepositoryId
      : repository.repositoryId,
    sourceKind,
    baseCommit,
    ...(sourceIdentity ? { sourceIdentity } : {}),
    ...(sourceFingerprint ? { sourceFingerprint } : {}),
    ...(sourceFingerprintKind ? { sourceFingerprintKind } : {}),
    entries,
  };
}

async function derivePatch(
  adapter: GitHumanAdapter,
  reviewId: string,
  files: unknown[],
): Promise<PatchFile[] | null> {
  const patchFiles: PatchFile[] = [];
  for (const file of files) {
    if (!isRecord(file)) return null;
    if (file.binary === true) return null;
    const newPath = stringValue(file.newPath ?? file.filePath);
    const oldPath = nullableString(file.oldPath) ?? newPath;
    if (!newPath) return null;
    let hunks: DiffHunk[];
    try {
      hunks = await adapter.getFileHunks(reviewId, newPath);
    } catch {
      return null;
    }
    if (!Array.isArray(hunks)) return null;
    const status = pathStatus(file.status);
    if (
      status !== 'added' &&
      status !== 'modified' &&
      status !== 'deleted' &&
      status !== 'renamed' &&
      status !== 'copied'
    )
      return null;
    patchFiles.push({
      oldPath: normalizeRepoPath(oldPath),
      newPath: normalizeRepoPath(newPath),
      status,
      additions: numberValue(file.additions),
      deletions: numberValue(file.deletions),
      hunks,
    });
  }
  return patchFiles;
}

function sourceKindValue(value: unknown): ReceiverSource['sourceKind'] {
  return value === 'staged' || value === 'branch' || value === 'commits'
    ? value
    : 'unknown';
}

function pathStatus(value: unknown): ChangedPath['status'] {
  switch (value) {
    case 'added':
      return 'added';
    case 'deleted':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    case 'copied':
      return 'copied';
    case 'typechanged':
      return 'typechanged';
    default:
      return 'modified';
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function firstString(...values: unknown[]): string | undefined {
  const value = values.find(
    (candidate) => typeof candidate === 'string' && candidate.length > 0,
  );
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : 0;
}

function isFullCommit(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{40}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function formatCoverageTodo(result: CoverageResult): string {
  const finding = result.finding ?? result.findings[0];
  if (!finding)
    return 'SpecPort found a receiver coverage limitation; inspect the local JSON result.';
  const paths =
    finding.paths.length > 0
      ? finding.paths.join(', ')
      : '(source fingerprint mismatch; review the receiver diff)';
  return `SpecPort: ${finding.title}. Paths: ${paths}. Next: ${finding.nextAction}`;
}
