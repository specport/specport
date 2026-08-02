import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { CoverageResult, FinalTreeSnapshot } from '../core/types.js';
import { VERSION } from '../version.js';
import { checkSpecFile, type SpecCheckResult } from './authoring.js';
import {
  type ContractValidationResult,
  readAndValidateProductContract,
} from './contract.js';
import {
  type AcceptanceEvidence,
  inspectAcceptanceRecord,
} from './lifecycle.js';
import { checkSpecDrift, type SpecDriftReport } from './lock.js';

export type GuardGateStatus = 'pass' | 'blocked' | 'not-run';

export interface GuardGate {
  id:
    | 'tree'
    | 'coverage'
    | 'spec'
    | 'contract'
    | 'acceptance'
    | 'verification'
    | 'taste'
    | 'drift';
  status: GuardGateStatus;
  evidence: string;
  nextAction: string | null;
}

export interface GuardCheckSummary {
  name: string;
  command: string;
}

export interface GuardReceipt {
  schemaVersion: string;
  artifactKind: 'spec-guard';
  status: 'hold' | 'pass';
  verdict: 'review-required' | 'merge-ready';
  generatedAt: string;
  repository: {
    path: string;
    id: string;
    headCommit: string | null;
    baseCommit: string | null;
    baseKind: FinalTreeSnapshot['baseKind'];
    finalTreeFingerprint: string;
    stable: boolean;
    changedPathCount: number;
  };
  comparison: {
    basis: CoverageResult['basis'];
    coverage: CoverageResult['coverage'];
    actualPaths: readonly string[];
    reviewedPaths: readonly string[];
    expectedPaths: readonly string[];
    unreviewedPaths: readonly string[];
    unexpectedPaths: readonly string[];
    changedAfterReviewPaths: readonly string[];
    identityGap: readonly string[];
    findings: CoverageResult['findings'];
  };
  inputs: {
    spec: {
      path: string;
      readiness: SpecCheckResult['readiness'];
      accepted: boolean;
      issueCount: number;
    };
    contract: {
      path: string;
      valid: boolean;
      issueCount: number;
    };
    lock: {
      path: string;
      status: SpecDriftReport['status'];
      issueCount: number;
    };
    acceptance: {
      path: string;
      status: 'accepted' | 'invalid' | 'missing';
      actor: string | null;
      issueCount: number;
    };
    verification: {
      path: string;
      status: 'passed' | 'invalid' | 'missing';
      checkCount: number;
      issueCount: number;
    };
    taste: {
      path: string | null;
      status: 'passed' | 'not-required' | 'invalid' | 'missing';
      reviewer: string | null;
      issueCount: number;
    };
  };
  gates: readonly GuardGate[];
  verification: {
    status: 'evidence-provided' | 'blocked';
    discoveredChecks: readonly GuardCheckSummary[];
    checkCount: number;
  };
  humanReview: {
    taste: 'evidence-provided' | 'not-required' | 'blocked';
    release: 'not-run';
    shipAuthority: 'human-required';
  };
  safety: {
    codeExecuted: false;
    networkAccessed: boolean;
  };
  decision: {
    state: 'hold' | 'merge-ready';
    shipDecision: 'human-required';
    note: string;
  };
  nextActions: readonly string[];
}

export interface CreateGuardReceiptInput {
  actual: FinalTreeSnapshot;
  coverage: CoverageResult;
  specPath: string;
  contractPath: string;
  lockPath: string;
  acceptancePath: string;
  verificationPath: string;
  tastePath?: string;
  discoveredChecks?: readonly GuardCheckSummary[];
  networkAccessed?: boolean;
  recapture?: () => Promise<FinalTreeSnapshot>;
  generatedAt?: string;
}

export async function createGuardReceipt(
  input: CreateGuardReceiptInput,
): Promise<GuardReceipt> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const [spec, contract, drift] = await Promise.all([
    checkSpecFile(input.specPath),
    readAndValidateProductContract(input.contractPath),
    checkSpecDrift(input.specPath, input.lockPath, generatedAt),
  ]);
  const contractRead = await readJsonRecord(input.contractPath);
  const contractValue =
    contractRead.status === 'present' ? contractRead.value : null;
  const contractSha256 = await fileSha256(input.contractPath);
  const [acceptance, verificationRead, tasteRead] = await Promise.all([
    inspectAcceptanceRecord(
      input.acceptancePath,
      input.contractPath,
      contractSha256,
    ),
    readJsonRecord(input.verificationPath),
    input.tastePath
      ? readJsonRecord(input.tastePath)
      : Promise.resolve<JsonEvidenceRead>({ status: 'missing', value: null }),
  ]);
  const verification = verificationEvidence(
    verificationRead,
    input.verificationPath,
    input.actual,
    contractSha256,
    recordValue(contractValue),
  );
  const taste = tasteEvidence(
    tasteRead,
    input.tastePath,
    input.actual,
    contractSha256,
    recordValue(contractValue),
  );
  const finalActual = input.recapture ? await input.recapture() : input.actual;
  const mutationDetected =
    finalActual.fingerprint !== input.actual.fingerprint ||
    finalActual.baseCommit !== input.actual.baseCommit;
  const effectiveCoverage = mutationDetected
    ? {
        ...input.coverage,
        coverage: 'unknown' as const,
        status: 'unknown' as const,
        identityGap: [...input.coverage.identityGap, 'working-tree-mutated'],
        findings: [],
      }
    : input.coverage;
  const gates = [
    treeGate(finalActual, mutationDetected),
    coverageGate(effectiveCoverage),
    specGate(spec),
    contractGate(contract),
    acceptanceGate(acceptance),
    verificationGate(verification),
    tasteGate(taste),
    driftGate(drift),
  ];
  const ready = gates.every((gate) => gate.status === 'pass');
  const status = ready ? 'pass' : 'hold';
  const nextActions = buildNextActions(gates, ready);

  return {
    schemaVersion: VERSION,
    artifactKind: 'spec-guard',
    status,
    verdict: ready ? 'merge-ready' : 'review-required',
    generatedAt,
    repository: {
      path: finalActual.repositoryPath,
      id: finalActual.repositoryId,
      headCommit: finalActual.headCommit,
      baseCommit: finalActual.baseCommit,
      baseKind: finalActual.baseKind,
      finalTreeFingerprint: finalActual.fingerprint,
      stable: finalActual.stable,
      changedPathCount: finalActual.entries.length,
    },
    comparison: {
      basis: effectiveCoverage.basis,
      coverage: effectiveCoverage.coverage,
      actualPaths: effectiveCoverage.actualPaths,
      reviewedPaths: effectiveCoverage.reviewedPaths,
      expectedPaths: effectiveCoverage.expectedPaths,
      unreviewedPaths: effectiveCoverage.unreviewedPaths,
      unexpectedPaths: effectiveCoverage.unexpectedPaths,
      changedAfterReviewPaths: effectiveCoverage.changedAfterReviewPaths,
      identityGap: effectiveCoverage.identityGap,
      findings: effectiveCoverage.findings,
    },
    inputs: {
      spec: {
        path: spec.path,
        readiness: spec.readiness,
        accepted: spec.accepted,
        issueCount: spec.issues.length,
      },
      contract: {
        path: input.contractPath,
        valid: contract.valid,
        issueCount: contract.issues.length,
      },
      lock: {
        path: drift.lockPath,
        status: drift.status,
        issueCount: drift.issues.length,
      },
      acceptance: {
        path: input.acceptancePath,
        status: acceptanceStatus(acceptance),
        actor: acceptance.actor,
        issueCount: acceptance.provided ? 0 : 1,
      },
      verification: {
        path: input.verificationPath,
        status: verification.status,
        checkCount: verification.checkCount,
        issueCount: verification.issues.length,
      },
      taste: {
        path: input.tastePath ?? null,
        status: taste.status,
        reviewer: taste.reviewer,
        issueCount: taste.issues.length,
      },
    },
    gates,
    verification: {
      status:
        verification.status === 'passed' ? 'evidence-provided' : 'blocked',
      discoveredChecks: input.discoveredChecks ?? [],
      checkCount: verification.checkCount,
    },
    humanReview: {
      taste:
        taste.status === 'passed'
          ? 'evidence-provided'
          : taste.status === 'not-required'
            ? 'not-required'
            : 'blocked',
      release: 'not-run',
      shipAuthority: 'human-required',
    },
    safety: {
      codeExecuted: false,
      networkAccessed: input.networkAccessed ?? false,
    },
    decision: {
      state: ready ? 'merge-ready' : 'hold',
      shipDecision: 'human-required',
      note: ready
        ? 'The exact final tree is merge-ready against the supplied evidence. Release, rollback, and human ship authority remain separate gates.'
        : 'Hold the merge until every blocked machine guard gate is resolved.',
    },
    nextActions,
  };
}

export function renderGuardReceiptHuman(receipt: GuardReceipt): string {
  const gateLines = receipt.gates.map(
    (gate) =>
      `${gate.id.toUpperCase().padEnd(9)} ${gate.status.toUpperCase().padEnd(8)} ${gate.evidence}`,
  );
  const nextLines = receipt.nextActions.map((action) => `- ${action}`);
  return [
    `GUARD      ${receipt.status} (${receipt.verdict})`,
    `REPOSITORY ${receipt.repository.path}`,
    `TREE       ${receipt.repository.finalTreeFingerprint}`,
    `COVERAGE   ${receipt.comparison.coverage} (${receipt.comparison.basis})`,
    'GATES',
    ...gateLines,
    `VERIFY     ${receipt.verification.status} (${receipt.verification.checkCount} evidence record(s))`,
    `TASTE      ${receipt.humanReview.taste}`,
    `RELEASE    ${receipt.humanReview.release}`,
    `DECISION   ${receipt.decision.state}; ${receipt.decision.shipDecision}`,
    'NEXT',
    ...(nextLines.length ? nextLines : ['- None']),
    '',
  ].join('\n');
}

function treeGate(
  actual: FinalTreeSnapshot,
  mutationDetected = false,
): GuardGate {
  if (mutationDetected) {
    return {
      id: 'tree',
      status: 'blocked',
      evidence:
        'The repository changed while the guard evidence was being assembled.',
      nextAction:
        'Recapture all identity-bound evidence against the final tree and rerun guard.',
    };
  }
  if (actual.baseKind !== 'commit' || !actual.baseCommit) {
    return {
      id: 'tree',
      status: 'blocked',
      evidence: 'No committed comparison base was established.',
      nextAction:
        'Choose an exact committed base before treating the final tree as bounded.',
    };
  }
  if (!actual.stable) {
    return {
      id: 'tree',
      status: 'blocked',
      evidence:
        'The final Git-visible tree contains an unstable or conflicted state.',
      nextAction: 'Resolve conflicts and recapture the final tree.',
    };
  }
  return {
    id: 'tree',
    status: 'pass',
    evidence: `Stable tree captured at ${actual.fingerprint}.`,
    nextAction: null,
  };
}

function coverageGate(coverage: CoverageResult): GuardGate {
  if (coverage.coverage === 'complete') {
    return {
      id: 'coverage',
      status: 'pass',
      evidence: `Every final path is covered by ${coverage.basis}.`,
      nextAction: null,
    };
  }
  return {
    id: 'coverage',
    status: 'blocked',
    evidence:
      coverage.coverage === 'partial'
        ? `Coverage is partial; ${coverage.unreviewedPaths.length + coverage.unexpectedPaths.length + coverage.changedAfterReviewPaths.length} path-level gap(s) remain.`
        : 'Coverage could not be established from an exact receiver or approved scope.',
    nextAction:
      'Review the listed paths and rerun guard with an exact receiver or approved expected scope.',
  };
}

function specGate(spec: SpecCheckResult): GuardGate {
  if (spec.readiness === 'ready') {
    return {
      id: 'spec',
      status: 'pass',
      evidence: `Accepted spec is structurally ready (${spec.path}).`,
      nextAction: null,
    };
  }
  return {
    id: 'spec',
    status: 'blocked',
    evidence: `Spec readiness is ${spec.readiness} with ${spec.issues.length} issue(s).`,
    nextAction:
      'Resolve the spec-check issues and record explicit human acceptance.',
  };
}

function contractGate(contract: ContractValidationResult): GuardGate {
  if (contract.valid) {
    return {
      id: 'contract',
      status: 'pass',
      evidence: 'Product contract passed structural validation.',
      nextAction: null,
    };
  }
  return {
    id: 'contract',
    status: 'blocked',
    evidence: `Product contract is invalid with ${contract.issues.length} issue(s).`,
    nextAction:
      'Fix or human-review the contract, then rerun contract validation.',
  };
}

function driftGate(drift: SpecDriftReport): GuardGate {
  if (drift.status === 'clean') {
    return {
      id: 'drift',
      status: 'pass',
      evidence:
        'SPEC.lock inputs and source-tree basis match the current state.',
      nextAction: null,
    };
  }
  return {
    id: 'drift',
    status: 'blocked',
    evidence: `SPEC.lock drift status is ${drift.status} with ${drift.issues.length} issue(s).`,
    nextAction:
      'Inspect the drift report and refresh or restore the locked handoff intentionally.',
  };
}

interface VerificationEvidenceResult {
  status: 'passed' | 'invalid' | 'missing';
  checkCount: number;
  issues: readonly string[];
}

interface TasteEvidenceResult {
  status: 'passed' | 'not-required' | 'invalid' | 'missing';
  reviewer: string | null;
  issues: readonly string[];
}

type JsonEvidenceRead =
  | { status: 'missing'; value: null }
  | { status: 'invalid'; value: null; issue: string }
  | { status: 'present'; value: unknown };

function acceptanceStatus(
  acceptance: AcceptanceEvidence,
): 'accepted' | 'invalid' | 'missing' {
  return acceptance.decision;
}

function acceptanceGate(acceptance: AcceptanceEvidence): GuardGate {
  if (acceptance.provided) {
    return {
      id: 'acceptance',
      status: 'pass',
      evidence: `Accepted by ${acceptance.actor ?? 'named owner'} and bound to the exact contract digest.`,
      nextAction: null,
    };
  }
  return {
    id: 'acceptance',
    status: 'blocked',
    evidence: `Contract acceptance is ${acceptance.decision}.`,
    nextAction:
      'Create a durable human acceptance record for the exact contract bytes.',
  };
}

function verificationGate(evidence: VerificationEvidenceResult): GuardGate {
  if (evidence.status === 'passed') {
    return {
      id: 'verification',
      status: 'pass',
      evidence: `${evidence.checkCount} verification result(s) passed and match the final-tree identity.`,
      nextAction: null,
    };
  }
  return {
    id: 'verification',
    status: 'blocked',
    evidence:
      evidence.status === 'missing'
        ? 'No verification evidence record was supplied.'
        : `Verification evidence is invalid (${evidence.issues.length} issue(s)).`,
    nextAction:
      'Run the contract-declared checks and save identity-bound verification evidence.',
  };
}

function tasteGate(evidence: TasteEvidenceResult): GuardGate {
  if (evidence.status === 'passed') {
    return {
      id: 'taste',
      status: 'pass',
      evidence: `Taste review passed by ${evidence.reviewer ?? 'named reviewer'}.`,
      nextAction: null,
    };
  }
  if (evidence.status === 'not-required') {
    return {
      id: 'taste',
      status: 'pass',
      evidence: 'The accepted contract declares taste review not required.',
      nextAction: null,
    };
  }
  return {
    id: 'taste',
    status: 'blocked',
    evidence:
      evidence.status === 'missing'
        ? 'The contract requires taste review but no review record was supplied.'
        : `Taste evidence is invalid (${evidence.issues.length} issue(s)).`,
    nextAction:
      'Complete and record a product-specific human taste review against the final tree.',
  };
}

function verificationEvidence(
  read: JsonEvidenceRead,
  path: string,
  actual: FinalTreeSnapshot,
  contractSha256: string | null,
  contract: Record<string, unknown> | null,
): VerificationEvidenceResult {
  if (read.status === 'missing')
    return { status: 'missing', checkCount: 0, issues: [] };
  if (read.status === 'invalid')
    return { status: 'invalid', checkCount: 0, issues: [read.issue] };
  const issues: string[] = [];
  const root = recordValue(read.value);
  if (!root)
    return { status: 'invalid', checkCount: 0, issues: ['not a JSON object'] };
  if (root.artifactKind !== 'specport-verification-evidence')
    issues.push('artifactKind must be specport-verification-evidence');
  if (root.status !== 'passed' && root.status !== 'pass')
    issues.push('status must be passed');
  if (root.contractSha256 !== contractSha256)
    issues.push(`contractSha256 does not match ${path}`);
  compareIdentity(root, actual, issues);
  const checks = Array.isArray(root.checks) ? root.checks : [];
  if (!checks.length) issues.push('checks must contain at least one result');
  const declaredCommands = new Set(declaredVerificationCommands(contract));
  const observedCommands = new Set<string>();
  for (const [index, item] of checks.entries()) {
    const check = recordValue(item);
    if (!check) {
      issues.push(`checks[${index}] must be an object`);
      continue;
    }
    if (!nonEmptyString(check.id))
      issues.push(`checks[${index}].id is required`);
    const command = nonEmptyString(check.command);
    if (!command) issues.push(`checks[${index}].command is required`);
    else {
      observedCommands.add(command);
      if (!declaredCommands.has(command))
        issues.push(`checks[${index}].command is not declared by the contract`);
    }
    if (check.status !== 'passed' && check.status !== 'pass')
      issues.push(`checks[${index}].status must be passed`);
    if (check.exitCode !== 0)
      issues.push(`checks[${index}].exitCode must be 0`);
  }
  for (const command of declaredCommands) {
    if (!observedCommands.has(command))
      issues.push(
        `missing result for contract verification command: ${command}`,
      );
  }
  return {
    status: issues.length ? 'invalid' : 'passed',
    checkCount: checks.length,
    issues,
  };
}

function declaredVerificationCommands(
  contract: Record<string, unknown> | null,
): string[] {
  const items = Array.isArray(contract?.verification)
    ? contract.verification
    : [];
  return items.flatMap((item) => {
    const record = recordValue(item);
    const command = nonEmptyString(record?.command);
    return command ? [command] : [];
  });
}

function tasteEvidence(
  read: JsonEvidenceRead,
  path: string | undefined,
  actual: FinalTreeSnapshot,
  contractSha256: string | null,
  contract: Record<string, unknown> | null,
): TasteEvidenceResult {
  const taste = recordValue(contract?.taste);
  const required = taste?.required !== false;
  if (!path) {
    return required
      ? { status: 'missing', reviewer: null, issues: [] }
      : { status: 'not-required', reviewer: null, issues: [] };
  }
  if (read.status === 'missing')
    return { status: 'missing', reviewer: null, issues: [] };
  if (read.status === 'invalid')
    return { status: 'invalid', reviewer: null, issues: [read.issue] };
  const issues: string[] = [];
  const root = recordValue(read.value);
  if (!root)
    return { status: 'invalid', reviewer: null, issues: ['not a JSON object'] };
  if (root.artifactKind !== 'specport-taste-review')
    issues.push('artifactKind must be specport-taste-review');
  if (root.status !== 'passed' && root.status !== 'pass')
    issues.push('status must be passed');
  const reviewer = nonEmptyString(root.reviewer);
  if (!reviewer) issues.push('reviewer is required');
  const reviewedAt = nonEmptyString(root.reviewedAt);
  if (!reviewedAt || Number.isNaN(Date.parse(reviewedAt)))
    issues.push('reviewedAt must be an ISO-8601 timestamp');
  if (root.contractSha256 !== contractSha256)
    issues.push(`contractSha256 does not match ${path}`);
  compareIdentity(root, actual, issues);
  const rubric = Array.isArray(root.rubric) ? root.rubric : [];
  if (!rubric.length) issues.push('rubric must contain at least one item');
  const evidence = Array.isArray(root.evidence) ? root.evidence : [];
  if (!evidence.length) issues.push('evidence must contain at least one item');
  return {
    status: issues.length ? 'invalid' : 'passed',
    reviewer,
    issues,
  };
}

function compareIdentity(
  root: Record<string, unknown>,
  actual: FinalTreeSnapshot,
  issues: string[],
): void {
  if (root.repositoryId !== actual.repositoryId)
    issues.push('repositoryId does not match the final tree');
  if (root.baseCommit !== actual.baseCommit)
    issues.push('baseCommit does not match the final tree');
  if (root.finalTreeFingerprint !== actual.fingerprint)
    issues.push('finalTreeFingerprint does not match the final tree');
}

async function readJsonRecord(path: string): Promise<JsonEvidenceRead> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch {
    return { status: 'missing', value: null };
  }
  try {
    return { status: 'present', value: JSON.parse(content) as unknown };
  } catch {
    return {
      status: 'invalid',
      value: null,
      issue: `${path} is not valid JSON`,
    };
  }
}

async function fileSha256(path: string): Promise<string | null> {
  try {
    return createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  } catch {
    return null;
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildNextActions(
  gates: readonly GuardGate[],
  ready: boolean,
): string[] {
  const actions = gates
    .filter((gate) => gate.status === 'blocked' && gate.nextAction)
    .map((gate) => gate.nextAction as string);
  if (ready) {
    actions.push(
      'Review the guard receipt and merge only within the covered final-tree boundary.',
      'Verify release, observability, rollback, and the human ship decision separately.',
    );
  }
  return [...new Set(actions)];
}
