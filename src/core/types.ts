import { VERSION } from '../version.js';

export const SCHEMA_VERSION = VERSION;

export type CoverageStatus = 'complete' | 'partial' | 'unknown';
export type CoverageBasis =
  | 'receiver-source'
  | 'approved-scope'
  | 'unavailable';
export type PathStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'typechanged'
  | 'conflicted';

export interface ChangeState {
  index: string;
  worktree: string;
  staged: boolean;
  unstaged: boolean;
}

export interface ChangedPath {
  path: string;
  status: PathStatus;
  oldPath?: string;
  fingerprint?: string;
  state?: ChangeState;
}

export interface FinalTreeSnapshot {
  repositoryPath: string;
  repositoryId: string;
  headCommit: string | null;
  baseCommit: string | null;
  baseKind: 'commit' | 'empty-tree';
  entries: readonly ChangedPath[];
  fingerprint: string;
  patchFingerprint?: string;
  stable: boolean;
}

export interface ReceiverSource {
  receiverName: string;
  receiverVersion?: string;
  reviewId: string;
  repositoryPath: string;
  repositoryId?: string;
  sourceKind: 'staged' | 'branch' | 'commits' | 'approved-scope' | 'unknown';
  baseCommit?: string | null;
  sourceIdentity?: string | null;
  sourceFingerprint?: string | null;
  sourceFingerprintKind?: 'tree' | 'patch';
  entries: readonly ChangedPath[];
  pathFingerprints?: Readonly<Record<string, string>>;
}

export interface ExpectedScope {
  identity: string;
  repositoryPath?: string;
  repositoryId?: string;
  baseCommit?: string | null;
  paths: readonly string[];
}

export interface CoverageRequest {
  actual: FinalTreeSnapshot;
  receiver?: ReceiverSource;
  expectedScope?: ExpectedScope;
}

export type CoverageFindingCode =
  | 'unreviewed-paths'
  | 'unexpected-paths'
  | 'changed-after-review'
  | 'source-fingerprint-mismatch';

export type CoverageNextActionCode = 'review-receiver-paths';

export interface CoverageFinding {
  code: CoverageFindingCode;
  title: string;
  paths: readonly string[];
  nextActionCode: CoverageNextActionCode;
  nextAction: string;
  detail: string;
}

export interface CoverageResult {
  coverage: CoverageStatus;
  status: CoverageStatus;
  basis: CoverageBasis;
  actualPaths: readonly string[];
  reviewedPaths: readonly string[];
  expectedPaths: readonly string[];
  unreviewedPaths: readonly string[];
  unexpectedPaths: readonly string[];
  changedAfterReviewPaths: readonly string[];
  identityGap: readonly string[];
  findings: readonly CoverageFinding[];
  finding?: CoverageFinding;
}

/** Minimal pure input used by adapters and by the public core test contract. */
export interface ReceiverCoverageTree {
  repositoryId: string;
  baseCommit: string;
  fingerprint: string;
  paths: readonly string[];
}

export interface ReceiverCoverageSource {
  repositoryId: string;
  baseCommit: string;
  sourceFingerprint?: string;
  paths: readonly string[];
}

export interface ReceiverCoverageInput {
  actualTree: ReceiverCoverageTree;
  reviewedSource: ReceiverCoverageSource;
  expectedScope?: ExpectedScope;
}

export type ReceiverCoverageResult = CoverageResult;
