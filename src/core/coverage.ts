import { createHash } from 'node:crypto';
import type {
  ChangedPath,
  CoverageFinding,
  CoverageRequest,
  CoverageResult,
  ExpectedScope,
  FinalTreeSnapshot,
  ReceiverCoverageInput,
  ReceiverCoverageResult,
  ReceiverSource,
} from './types.js';

const FULL_COMMIT = /^[0-9a-f]{40}$/i;

export function normalizeRepoPath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    throw new Error(`Expected a repository-relative path: ${value}`);
  }
  const parts = normalized.split('/');
  if (parts.some((part) => part === '' || part === '..')) {
    throw new Error(`Path escapes the repository: ${value}`);
  }
  const canonical = parts.filter((part) => part !== '.').join('/');
  if (!canonical)
    throw new Error(`Expected a repository-relative path: ${value}`);
  return canonical;
}

export function normalizePathList(paths: readonly string[]): string[] {
  return [...new Set(paths.map(normalizeRepoPath))].sort(compareStrings);
}

export function pathsForEntries(entries: readonly ChangedPath[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    paths.push(entry.path);
    if (entry.oldPath) paths.push(entry.oldPath);
  }
  return normalizePathList(paths);
}

export function fingerprintCanonical(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function compareCoverage(request: CoverageRequest): CoverageResult {
  const actualPaths = pathsForEntries(request.actual.entries);
  const expectedPaths = request.expectedScope
    ? normalizePathList(request.expectedScope.paths)
    : [];
  const receiver = request.receiver;
  const reviewedPaths = receiver ? pathsForEntries(receiver.entries) : [];
  const unreviewedPaths = receiver
    ? difference(actualPaths, reviewedPaths)
    : [];
  const unexpectedPaths = request.expectedScope
    ? difference(actualPaths, expectedPaths)
    : [];
  const identityGap = receiver
    ? receiverIdentityGaps(request.actual, receiver)
    : request.expectedScope
      ? expectedScopeIdentityGaps(request.actual, request.expectedScope)
      : ['comparison-basis-missing'];

  const changedAfterReviewPaths = receiver
    ? changedPaths(request.actual.entries, receiver)
    : [];
  const actualFingerprint =
    receiver?.sourceFingerprintKind === 'patch'
      ? request.actual.patchFingerprint
      : request.actual.fingerprint;
  if (receiver?.sourceFingerprint && !actualFingerprint) {
    identityGap.push('source-fingerprint-missing');
  }
  const sourceFingerprintMismatch = Boolean(
    receiver?.sourceFingerprint &&
      actualFingerprint &&
      receiver.sourceFingerprint !== actualFingerprint,
  );
  const sourceFingerprintUnavailable = Boolean(
    receiver?.sourceFingerprint && !actualFingerprint,
  );
  const hardIdentityGap = identityGap.some(isHardIdentityGap);

  let coverage: CoverageResult['coverage'];
  let basis: CoverageResult['basis'];

  if (receiver) {
    basis = 'receiver-source';
    if (hardIdentityGap) {
      coverage = 'unknown';
    } else if (!receiver.sourceFingerprint || sourceFingerprintUnavailable) {
      coverage = 'unknown';
    } else if (
      unreviewedPaths.length > 0 ||
      unexpectedPaths.length > 0 ||
      changedAfterReviewPaths.length > 0 ||
      sourceFingerprintMismatch
    ) {
      coverage = 'partial';
    } else {
      coverage = 'complete';
    }
  } else if (request.expectedScope) {
    basis = 'approved-scope';
    if (hardIdentityGap) {
      coverage = 'unknown';
    } else if (unexpectedPaths.length > 0) {
      coverage = 'partial';
    } else {
      coverage = 'complete';
    }
  } else {
    basis = 'unavailable';
    coverage = 'unknown';
  }

  const finding =
    coverage === 'partial'
      ? makeFinding({
          unreviewedPaths,
          unexpectedPaths,
          changedAfterReviewPaths,
          sourceFingerprintMismatch,
          actualPaths,
          reviewedPaths,
        })
      : undefined;
  const findings = finding ? [finding] : [];

  return {
    coverage,
    status: coverage,
    basis,
    actualPaths,
    reviewedPaths,
    expectedPaths,
    unreviewedPaths,
    unexpectedPaths,
    changedAfterReviewPaths,
    identityGap,
    findings,
    ...(finding ? { finding } : {}),
  };
}

export function compareReceiverCoverage(
  input: ReceiverCoverageInput,
): ReceiverCoverageResult {
  const actual: FinalTreeSnapshot = {
    repositoryPath: input.actualTree.repositoryId,
    repositoryId: input.actualTree.repositoryId,
    headCommit: input.actualTree.baseCommit,
    baseCommit: input.actualTree.baseCommit,
    baseKind: 'commit',
    entries: input.actualTree.paths.map((path) => ({
      path: normalizeRepoPath(path),
      status: 'modified',
    })),
    fingerprint: input.actualTree.fingerprint,
    stable: true,
  };
  const receiver: ReceiverSource = {
    receiverName: 'test-receiver',
    reviewId: 'test-review',
    repositoryPath: input.reviewedSource.repositoryId,
    repositoryId: input.reviewedSource.repositoryId,
    sourceKind: 'staged',
    baseCommit: input.reviewedSource.baseCommit,
    entries: input.reviewedSource.paths.map((path) => ({
      path: normalizeRepoPath(path),
      status: 'modified',
    })),
    ...(input.reviewedSource.sourceFingerprint
      ? { sourceFingerprint: input.reviewedSource.sourceFingerprint }
      : {}),
  };
  return compareCoverage({
    actual,
    receiver,
    ...(input.expectedScope ? { expectedScope: input.expectedScope } : {}),
  });
}

function receiverIdentityGaps(
  actual: FinalTreeSnapshot,
  receiver: ReceiverSource,
): string[] {
  const gaps: string[] = [];
  if (!actual.repositoryId || !receiver.repositoryId) {
    gaps.push('repository-identity-missing');
  } else if (actual.repositoryId !== receiver.repositoryId) {
    gaps.push('repository-identity-mismatch');
  }

  const actualBase = actual.baseCommit;
  const receiverBase = receiver.baseCommit ?? null;
  if (
    actualBase === null ||
    receiverBase === null ||
    !FULL_COMMIT.test(actualBase) ||
    !FULL_COMMIT.test(receiverBase)
  ) {
    gaps.push('base-identity-missing');
  } else if (actualBase.toLowerCase() !== receiverBase.toLowerCase()) {
    gaps.push('base-identity-mismatch');
  }

  if (!receiver.reviewId) gaps.push('review-identity-missing');
  if (receiver.sourceKind === 'unknown') gaps.push('source-kind-unknown');
  if (
    receiver.sourceKind === 'branch' &&
    (!receiver.sourceIdentity || !FULL_COMMIT.test(receiver.sourceIdentity))
  ) {
    gaps.push('symbolic-source-identity');
  }
  if (!receiver.sourceFingerprint) gaps.push('source-fingerprint-missing');
  if (!actual.stable) gaps.push('working-tree-unstable');
  return gaps;
}

function expectedScopeIdentityGaps(
  actual: FinalTreeSnapshot,
  scope: ExpectedScope,
): string[] {
  const gaps: string[] = [];
  if (!scope.identity.trim()) gaps.push('expected-scope-identity-missing');
  if (scope.repositoryId && scope.repositoryId !== actual.repositoryId) {
    gaps.push('repository-identity-mismatch');
  }
  if (scope.baseCommit !== undefined) {
    const baseMatches =
      scope.baseCommit === null
        ? actual.baseCommit === null
        : scope.baseCommit === actual.baseCommit;
    if (!baseMatches) gaps.push('base-identity-mismatch');
  }
  if (!actual.stable) gaps.push('working-tree-unstable');
  return gaps;
}

function isHardIdentityGap(value: string): boolean {
  return value !== 'source-fingerprint-missing';
}

function changedPaths(
  actualEntries: readonly ChangedPath[],
  receiver: ReceiverSource,
): string[] {
  if (!receiver.pathFingerprints) return [];
  const actualByPath = new Map<string, string>();
  for (const entry of actualEntries) {
    if (entry.fingerprint) actualByPath.set(entry.path, entry.fingerprint);
  }
  const changed: string[] = [];
  for (const [path, fingerprint] of Object.entries(receiver.pathFingerprints)) {
    const actualFingerprint = actualByPath.get(path);
    if (actualFingerprint && actualFingerprint !== fingerprint)
      changed.push(path);
  }
  return normalizePathList(changed);
}

function makeFinding(input: {
  unreviewedPaths: readonly string[];
  unexpectedPaths: readonly string[];
  changedAfterReviewPaths: readonly string[];
  sourceFingerprintMismatch: boolean;
  actualPaths: readonly string[];
  reviewedPaths: readonly string[];
}): CoverageFinding {
  const paths = normalizePathList([
    ...input.unreviewedPaths,
    ...input.unexpectedPaths,
    ...input.changedAfterReviewPaths,
    ...(input.sourceFingerprintMismatch &&
    input.unreviewedPaths.length === 0 &&
    input.unexpectedPaths.length === 0 &&
    input.changedAfterReviewPaths.length === 0
      ? [...input.actualPaths, ...input.reviewedPaths]
      : []),
  ]);
  const codes: string[] = [];
  if (input.unreviewedPaths.length) codes.push('unreviewed');
  if (input.unexpectedPaths.length) codes.push('unexpected');
  if (input.changedAfterReviewPaths.length) codes.push('changed-after-review');
  if (input.sourceFingerprintMismatch) codes.push('source-fingerprint');
  const code =
    input.unexpectedPaths.length > 0
      ? 'unexpected-paths'
      : input.changedAfterReviewPaths.length > 0
        ? 'changed-after-review'
        : input.sourceFingerprintMismatch
          ? 'source-fingerprint-mismatch'
          : 'unreviewed-paths';
  return {
    code,
    title: 'Review coverage is incomplete',
    paths,
    nextActionCode: 'review-receiver-paths',
    nextAction:
      'Review the listed paths in the pinned receiver before approval.',
    detail: `Coverage gap: ${codes.join(', ')}.`,
  };
}

function difference(
  left: readonly string[],
  right: readonly string[],
): string[] {
  const rightSet = new Set(right);
  return left.filter((path) => !rightSet.has(path));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
