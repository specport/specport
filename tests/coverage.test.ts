import { describe, expect, it } from 'vitest';

import {
  compareCoverage,
  compareReceiverCoverage,
  normalizeRepoPath,
} from '../src/core/coverage.js';
import type {
  ChangedPath,
  ReceiverCoverageInput,
  ReceiverCoverageResult,
} from '../src/core/types.js';

const repositoryId = 'repo:specport';
const otherRepositoryId = 'repo:other';
const baseCommit = '1111111111111111111111111111111111111111';
const otherBaseCommit = '2222222222222222222222222222222222222222';
const finalTreeFingerprint = 'sha256:final-tree';
const reviewedSourceFingerprint = 'sha256:reviewed-source';

type InputOverrides = {
  actualTree?: Partial<ReceiverCoverageInput['actualTree']>;
  reviewedSource?: Partial<ReceiverCoverageInput['reviewedSource']>;
  expectedScope?: ReceiverCoverageInput['expectedScope'];
};

function makeInput(overrides: InputOverrides = {}): ReceiverCoverageInput {
  const actualTree: ReceiverCoverageInput['actualTree'] = {
    repositoryId,
    baseCommit,
    fingerprint: finalTreeFingerprint,
    paths: ['src/index.ts', 'src/core.ts'],
    ...overrides.actualTree,
  };
  const reviewedSource: ReceiverCoverageInput['reviewedSource'] = {
    repositoryId,
    baseCommit,
    sourceFingerprint: finalTreeFingerprint,
    paths: ['src/index.ts', 'src/core.ts'],
    ...overrides.reviewedSource,
  };

  if (overrides.expectedScope === undefined) {
    return { actualTree, reviewedSource };
  }

  return { actualTree, reviewedSource, expectedScope: overrides.expectedScope };
}

function withoutSourceFingerprint(
  input: ReceiverCoverageInput = makeInput(),
): ReceiverCoverageInput {
  const reviewedSource = { ...input.reviewedSource };
  delete reviewedSource.sourceFingerprint;
  return { ...input, reviewedSource };
}

function run(input: ReceiverCoverageInput): ReceiverCoverageResult {
  return compareReceiverCoverage(input);
}

describe('compareReceiverCoverage', () => {
  it('reports complete only when the source fingerprint and repository/base identities match exactly', () => {
    const result = run(makeInput());

    expect(result.coverage).toBe('complete');
    expect(result.unreviewedPaths).toEqual([]);
    expect(result.unexpectedPaths).toEqual([]);
    expect(result.finding).toBeUndefined();
  });

  it.each([
    ['the source fingerprint is absent', withoutSourceFingerprint()],
    [
      'the source fingerprint differs',
      makeInput({
        reviewedSource: { sourceFingerprint: reviewedSourceFingerprint },
      }),
    ],
    [
      'the repository identity differs',
      makeInput({ reviewedSource: { repositoryId: otherRepositoryId } }),
    ],
    [
      'the base identity differs',
      makeInput({ reviewedSource: { baseCommit: otherBaseCommit } }),
    ],
  ])('does not report complete when %s', (_reason, input) => {
    expect(run(input).coverage).not.toBe('complete');
  });

  it('reports unknown when the paths overlap but the receiver source has no fingerprint', () => {
    const result = run(withoutSourceFingerprint());

    expect(result.coverage).toBe('unknown');
    expect(result.unreviewedPaths).toEqual([]);
    expect(result.unexpectedPaths).toEqual([]);
    expect(result.finding).toBeUndefined();
  });

  it('reports unknown instead of partial when a binary patch cannot be fingerprinted locally', () => {
    const entries: ChangedPath[] = [
      { path: 'assets/logo.bin', status: 'modified' },
    ];
    const result = compareCoverage({
      actual: {
        repositoryPath: repositoryId,
        repositoryId,
        headCommit: baseCommit,
        baseCommit,
        baseKind: 'commit',
        entries,
        fingerprint: finalTreeFingerprint,
        stable: true,
      },
      receiver: {
        receiverName: 'githuman',
        reviewId: 'review-binary',
        repositoryPath: repositoryId,
        repositoryId,
        sourceKind: 'staged',
        baseCommit,
        sourceFingerprint: reviewedSourceFingerprint,
        sourceFingerprintKind: 'patch',
        entries,
      },
    });

    expect(result.coverage).toBe('unknown');
    expect(result.findings).toEqual([]);
    expect(result.identityGap).toContain('source-fingerprint-missing');
  });

  it('reports unknown without a finding when a path-only receiver omits a path', () => {
    const result = compareCoverage({
      actual: {
        repositoryPath: repositoryId,
        repositoryId,
        headCommit: baseCommit,
        baseCommit,
        baseKind: 'commit',
        entries: [
          { path: 'src/index.ts', status: 'modified' },
          { path: 'src/omitted.ts', status: 'modified' },
        ],
        fingerprint: finalTreeFingerprint,
        stable: true,
      },
      receiver: {
        receiverName: 'githuman',
        reviewId: 'review-path-only-subset',
        repositoryPath: repositoryId,
        repositoryId,
        sourceKind: 'staged',
        baseCommit,
        entries: [{ path: 'src/index.ts', status: 'modified' }],
      },
    });

    expect(result.coverage).toBe('unknown');
    expect(result.findings).toEqual([]);
    expect(result.identityGap).toContain('source-fingerprint-missing');
  });

  it('fails closed when a receiver source kind is unknown', () => {
    const result = compareCoverage({
      actual: {
        repositoryPath: repositoryId,
        repositoryId,
        headCommit: baseCommit,
        baseCommit,
        baseKind: 'commit',
        entries: [{ path: 'src/index.ts', status: 'modified' }],
        fingerprint: finalTreeFingerprint,
        stable: true,
      },
      receiver: {
        receiverName: 'githuman',
        reviewId: 'review-unknown-source-kind',
        repositoryPath: repositoryId,
        repositoryId,
        sourceKind: 'unknown',
        baseCommit,
        sourceFingerprint: finalTreeFingerprint,
        entries: [{ path: 'src/index.ts', status: 'modified' }],
      },
    });

    expect(result.coverage).toBe('unknown');
    expect(result.findings).toEqual([]);
    expect(result.identityGap).toContain('source-kind-unknown');
  });

  it('treats an explicit null expected base as an empty-tree binding', () => {
    const result = compareCoverage({
      actual: {
        repositoryPath: repositoryId,
        repositoryId,
        headCommit: baseCommit,
        baseCommit,
        baseKind: 'commit',
        entries: [{ path: 'src/index.ts', status: 'modified' }],
        fingerprint: finalTreeFingerprint,
        stable: true,
      },
      expectedScope: {
        identity: 'scope:empty-tree',
        repositoryId,
        baseCommit: null,
        paths: ['src/index.ts'],
      },
    });

    expect(result.coverage).toBe('unknown');
    expect(result.identityGap).toContain('base-identity-mismatch');
  });

  it.each(['.', './.', 'src//file.ts', 'src/'])(
    'rejects non-canonical path %s',
    (path) => {
      expect(() => normalizeRepoPath(path)).toThrow();
    },
  );

  it('reports partial coverage with deduplicated unreviewed paths', () => {
    const result = run(
      makeInput({
        actualTree: {
          paths: [
            'src/missing.ts',
            'src/missing.ts',
            'src/other-missing.ts',
            'src/other-missing.ts',
            'src/index.ts',
          ],
        },
        reviewedSource: {
          sourceFingerprint: reviewedSourceFingerprint,
          paths: ['src/index.ts', 'src/index.ts'],
        },
      }),
    );

    expect(result.coverage).toBe('partial');
    expect(result.unreviewedPaths).toEqual([
      'src/missing.ts',
      'src/other-missing.ts',
    ]);
  });

  it('populates unexpectedPaths only when an explicit expected scope is supplied', () => {
    const actualPaths = ['src/index.ts', 'src/unexpected.ts'];
    const reviewedPaths = [...actualPaths];

    const withScope = run(
      makeInput({
        actualTree: { paths: actualPaths },
        reviewedSource: { paths: reviewedPaths },
        expectedScope: {
          identity: 'scope:task-1',
          paths: ['src/index.ts'],
        },
      }),
    );
    const withoutScope = run(
      makeInput({
        actualTree: { paths: actualPaths },
        reviewedSource: { paths: reviewedPaths },
      }),
    );

    expect(withScope.unexpectedPaths).toEqual(['src/unexpected.ts']);
    expect(withoutScope.unexpectedPaths).toEqual([]);
  });

  it.each([
    ['the repository identity differs', { repositoryId: otherRepositoryId }],
    ['the base identity differs', { baseCommit: otherBaseCommit }],
  ])(
    'fails closed as unknown on %s without a synthetic finding',
    (_reason, identity) => {
      const result = run(makeInput({ reviewedSource: identity }));

      expect(result.coverage).toBe('unknown');
      expect(result.unreviewedPaths).toEqual([]);
      expect(result.unexpectedPaths).toEqual([]);
      expect(result.identityGap).not.toEqual([]);
      expect(result.finding).toBeUndefined();
    },
  );

  it('returns at most one finding payload naming every affected path and a next action', () => {
    const result = run(
      makeInput({
        actualTree: {
          paths: [
            'src/first-missing.ts',
            'src/second-missing.ts',
            'src/second-missing.ts',
            'src/index.ts',
          ],
        },
        reviewedSource: {
          sourceFingerprint: reviewedSourceFingerprint,
          paths: ['src/index.ts'],
        },
      }),
    );

    expect(result.coverage).toBe('partial');
    expect(result.finding).toEqual(
      expect.objectContaining({
        paths: ['src/first-missing.ts', 'src/second-missing.ts'],
        nextAction: expect.any(String),
      }),
    );
    expect(result.finding?.nextAction).not.toHaveLength(0);
    expect(result.finding?.paths).toHaveLength(2);
    expect(result.finding?.nextActionCode).toBe('review-receiver-paths');
  });
});
