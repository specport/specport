import { createHash } from 'node:crypto';
import { access, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { VERSION } from '../version.js';
import { checkSpecFile, type SpecCheckResult } from './authoring.js';
import { readAndValidateProductContract } from './contract.js';
import { mapRepository, type RepositoryMap } from './map.js';

export type LifecycleGateStatus = 'pass' | 'blocked' | 'unknown' | 'not-run';

export interface LifecycleGate {
  id: string;
  status: LifecycleGateStatus;
  evidence: string;
  nextAction: string | null;
}

export interface ParentSpecIdentity {
  path: string;
  specId: string | null;
  version: string | null;
  sha256: string;
  bytes: number;
  readiness: SpecCheckResult['readiness'];
  accepted: boolean;
  sourceLicense: LicenseEvidence;
}

export interface LicenseEvidence {
  expression: string | null;
  scope: 'file' | 'repository' | 'unknown';
  status: 'verified' | 'declared' | 'unknown' | 'failed';
  evidence: string | null;
  attributionRequired: boolean;
}

export interface TargetEvidence {
  path: string;
  stack: string | null;
  repository: RepositoryMap['repository'];
  observedLanguages: readonly string[];
  observedSurfaces: number;
  unknownCount: number;
  mapSafety: RepositoryMap['safety'];
}

export interface ContractEvidence {
  path: string;
  provided: boolean;
  valid: boolean;
  contentSha256: string | null;
  bytes: number;
  issueCount: number;
  issues: readonly { path: string; message: string }[];
}

export interface AcceptanceEvidence {
  path: string;
  provided: boolean;
  sha256: string | null;
  bytes: number;
  decision: 'accepted' | 'invalid' | 'missing';
  actor: string | null;
  at: string | null;
  inputDigest: string | null;
  contractPath: string | null;
  decisionSource: string | null;
}

export interface CoverPlan {
  schemaVersion: string;
  artifactKind: 'spec-cover';
  status: 'blocked' | 'ready';
  generatedAt: string;
  identity: ArtifactIdentity;
  lineage: {
    relation: 'cover';
    parents: readonly ParentSpecIdentity[];
  };
  target: TargetEvidence;
  contract: ContractEvidence;
  license: {
    source: LicenseEvidence;
    derivedArtifact: LicenseEvidence;
    target: LicenseEvidence;
  };
  compatibility: {
    status: 'unverified';
    requestedStack: string | null;
    note: string;
  };
  deviations: readonly string[];
  verification: {
    status: 'not-run';
    checks: readonly string[];
  };
  authority: {
    execution: 'none';
    implementation: 'human-or-bounded-agent';
    shipDecision: 'human-owner-required';
  };
  gates: readonly LifecycleGate[];
  gateState: GateState;
  decision: LifecycleDecision;
  nextActions: readonly string[];
}

export interface RemixArtifact {
  schemaVersion: string;
  artifactKind: 'spec-remix';
  status: 'draft';
  generatedAt: string;
  identity: ArtifactIdentity;
  lineage: {
    relationship: 'remix';
    parents: readonly ParentSpecIdentity[];
    attributionRequired: true;
    licenseStatus: 'inherited-requires-review';
  };
  license: {
    source: LicenseEvidence;
    derivedArtifact: LicenseEvidence;
  };
  changeSet: readonly {
    id: string;
    statement: string;
  }[];
  reason: string;
  acceptance: {
    status: 'not-accepted';
    owner: 'human-required';
  };
  decision: LifecycleDecision;
  source: string;
  unknowns: readonly string[];
  nextActions: readonly string[];
}

export interface BuildHandoff {
  schemaVersion: string;
  artifactKind: 'spec-build-handoff';
  status: 'blocked' | 'ready';
  generatedAt: string;
  identity: ArtifactIdentity;
  lineage: {
    relation: 'build';
    parents: readonly ParentSpecIdentity[];
  };
  target: TargetEvidence;
  contract: ContractEvidence;
  acceptance: AcceptanceEvidence;
  license: {
    source: LicenseEvidence;
    target: LicenseEvidence;
  };
  requestedStack: string | null;
  execution: {
    mode: 'handoff';
    codeGenerated: false;
    repositoryCodeExecuted: false;
    networkAccessed: false;
    checksRun: false;
    shipDecision: 'human-owner-required';
  };
  gates: readonly LifecycleGate[];
  gateState: GateState;
  decision: LifecycleDecision;
  nextActions: readonly string[];
}

export interface ArtifactIdentity {
  specId: string | null;
  version: string | null;
  contentSha256: string;
}

export interface GateState {
  license: 'pass' | 'fail' | 'unknown';
  compatibility: 'pass' | 'fail' | 'unknown';
  acceptance: 'pass' | 'pending' | 'rejected';
  taste: 'pass' | 'pending' | 'not-required';
  release: 'pass' | 'pending' | 'blocked';
}

export interface LifecycleDecision {
  state: 'pending' | 'accepted' | 'rejected';
  actor: string | null;
  at: string | null;
  source: string | null;
  inputDigest: string | null;
}

export type LifecycleArtifact = CoverPlan | RemixArtifact | BuildHandoff;

export async function createCoverPlan(
  specPath: string,
  targetPath: string,
  targetStack?: string,
  contractPath?: string,
  provenancePath?: string,
  generatedAt = new Date().toISOString(),
): Promise<CoverPlan> {
  const parent = await readParentSpec(specPath, provenancePath);
  const target = await inspectTarget(targetPath, targetStack, generatedAt);
  const contract = await inspectContract(
    contractPath ?? resolve(target.path, '.specport', 'contract.json'),
  );
  const gates = [
    specGate(parent.check),
    licenseGate(parent.identity.sourceLicense),
    contractGate(contract),
    targetProfileGate(target.stack),
    targetGate(target),
  ];
  const ready = gates.every((gate) => gate.status === 'pass');

  return {
    schemaVersion: VERSION,
    artifactKind: 'spec-cover',
    status: ready ? 'ready' : 'blocked',
    generatedAt,
    identity: createArtifactIdentity(parent.identity, {
      relation: 'cover',
      target: stableTargetIdentity(target.repository),
      stack: target.stack,
      contractDigest: contract.contentSha256,
    }),
    lineage: {
      relation: 'cover',
      parents: [parent.identity],
    },
    target,
    contract,
    license: {
      source: parent.identity.sourceLicense,
      derivedArtifact: inheritedLicense(parent.identity.sourceLicense),
      target: unknownLicense(),
    },
    compatibility: {
      status: 'unverified',
      requestedStack: target.stack,
      note: 'A target map records evidence, but it does not prove framework compatibility or product equivalence.',
    },
    deviations: [],
    verification: {
      status: 'not-run',
      checks: [],
    },
    authority: {
      execution: 'none',
      implementation: 'human-or-bounded-agent',
      shipDecision: 'human-owner-required',
    },
    gates,
    gateState: coverGateState(parent.identity.sourceLicense, contract, target),
    decision: pendingDecision(),
    nextActions: coverNextActions(gates, target),
  };
}

export async function createRemixArtifact(
  specPath: string,
  changes: readonly string[],
  reason = 'Human-requested adaptation',
  provenancePath?: string,
  generatedAt = new Date().toISOString(),
): Promise<RemixArtifact> {
  const parent = await readParentSpec(specPath, provenancePath);
  const normalizedChanges = changes
    .map((change) => change.trim())
    .filter(Boolean)
    .map((statement, index) => ({
      id: `CHANGE-${String(index + 1).padStart(3, '0')}`,
      statement,
    }));
  if (!normalizedChanges.length)
    throw new Error('spec-remix: provide at least one non-empty --change.');

  return {
    schemaVersion: VERSION,
    artifactKind: 'spec-remix',
    status: 'draft',
    generatedAt,
    identity: createArtifactIdentity(parent.identity, {
      relation: 'remix',
      changes: normalizedChanges,
      reason: reason.trim() || 'Human-requested adaptation',
    }),
    lineage: {
      relationship: 'remix',
      parents: [parent.identity],
      attributionRequired: true,
      licenseStatus: 'inherited-requires-review',
    },
    license: {
      source: parent.identity.sourceLicense,
      derivedArtifact: inheritedLicense(parent.identity.sourceLicense),
    },
    changeSet: normalizedChanges,
    reason: reason.trim() || 'Human-requested adaptation',
    acceptance: {
      status: 'not-accepted',
      owner: 'human-required',
    },
    decision: pendingDecision(),
    source: parent.text,
    unknowns: [
      'The parent license and attribution obligations require human review before redistribution.',
      'The change set is a requested adaptation, not evidence that the remix is compatible or correct.',
      'Acceptance criteria, verification, taste review, release, and rollback must be re-evaluated for the remix.',
    ],
    nextActions: [
      'Review the parent license and record attribution in the remixed spec.',
      'Edit the preserved parent source into an accepted spec with explicit criteria for every requested change.',
      'Run `spec check` and create a fresh contract; do not reuse parent acceptance without review.',
    ],
  };
}

export async function createBuildHandoff(
  specPath: string,
  targetPath: string,
  targetStack: string | undefined,
  contractPath: string | undefined,
  acceptanceRecordPath: string | undefined,
  provenancePath: string | undefined,
  generatedAt = new Date().toISOString(),
): Promise<BuildHandoff> {
  const parent = await readParentSpec(specPath, provenancePath);
  const target = await inspectTarget(targetPath, targetStack, generatedAt);
  const contract = await inspectContract(
    contractPath ?? resolve(target.path, '.specport', 'contract.json'),
  );
  const acceptance = await inspectAcceptanceRecord(
    acceptanceRecordPath,
    contract.path,
    contract.contentSha256,
  );
  const gates = [
    specGate(parent.check),
    licenseGate(parent.identity.sourceLicense),
    contractGate(contract),
    acceptanceGate(acceptance),
    targetProfileGate(target.stack),
    targetGate(target),
  ];
  const ready = gates.every((gate) => gate.status === 'pass');

  return {
    schemaVersion: VERSION,
    artifactKind: 'spec-build-handoff',
    status: ready ? 'ready' : 'blocked',
    generatedAt,
    identity: createArtifactIdentity(parent.identity, {
      relation: 'build',
      target: stableTargetIdentity(target.repository),
      stack: target.stack,
      contractDigest: contract.contentSha256,
      acceptanceDigest: acceptance.sha256,
    }),
    lineage: {
      relation: 'build',
      parents: [parent.identity],
    },
    target,
    contract,
    acceptance,
    license: {
      source: parent.identity.sourceLicense,
      target: unknownLicense(),
    },
    requestedStack: target.stack,
    execution: {
      mode: 'handoff',
      codeGenerated: false,
      repositoryCodeExecuted: false,
      networkAccessed: false,
      checksRun: false,
      shipDecision: 'human-owner-required',
    },
    gates,
    gateState: buildGateState(
      parent.identity.sourceLicense,
      contract,
      target,
      acceptance,
    ),
    decision: pendingDecision(),
    nextActions: buildNextActions(gates, target, acceptance),
  };
}

export function renderLifecycleMarkdown(artifact: LifecycleArtifact): string {
  if (artifact.artifactKind === 'spec-remix')
    return renderRemixMarkdown(artifact);

  const kind =
    artifact.artifactKind === 'spec-cover' ? 'Cover Plan' : 'Build Handoff';
  const gates = artifact.gates.map(
    (gate) =>
      `- **${gate.id}**: ${gate.status} — ${gate.evidence}` +
      (gate.nextAction ? ` Next: ${gate.nextAction}` : ''),
  );
  const nextActions = artifact.nextActions.map((action) => `- ${action}`);
  const targetLines = [
    `- Path: \`${artifact.target.path}\``,
    `- Stack requested: ${artifact.target.stack ?? 'not declared'}`,
    `- Repository identity: \`${artifact.target.repository.repositoryId ?? 'not available'}\``,
    `- Head commit: \`${artifact.target.repository.headCommit ?? 'not available'}\``,
    `- Languages observed: ${artifact.target.observedLanguages.join(', ') || 'none'}`,
    `- Static surfaces observed: ${artifact.target.observedSurfaces}`,
    `- Unknowns in map: ${artifact.target.unknownCount}`,
  ];
  const contractLines = [
    `- Contract: \`${artifact.contract.path}\``,
    `- Provided: **${artifact.contract.provided ? 'yes' : 'no'}**`,
    `- Structurally valid: **${artifact.contract.valid ? 'yes' : 'no'}**`,
  ];
  const executionLines =
    artifact.artifactKind === 'spec-build-handoff'
      ? [
          '- Code generated: **no**',
          '- Repository code executed: **no**',
          '- Declared checks run: **no**',
          '- Ship decision: **human owner required**',
        ]
      : [
          '- Repository code executed: **no**',
          '- Implementation: **human or bounded agent**',
          '- Ship decision: **human owner required**',
        ];

  return [
    `# SpecPort ${kind}`,
    '',
    '> This artifact is a gated handoff. It is not generated code, a test pass, or a ship approval.',
    '',
    `- Status: **${artifact.status}**`,
    `- Generated: \`${artifact.generatedAt}\``,
    `- Parent spec: \`${artifact.lineage.parents[0]?.path ?? 'not available'}\``,
    `- Parent SHA-256: \`${artifact.lineage.parents[0]?.sha256 ?? 'not available'}\``,
    '',
    '## Target evidence',
    '',
    ...targetLines,
    '',
    '## Contract gate',
    '',
    ...contractLines,
    '',
    '## Execution boundary',
    '',
    ...executionLines,
    '',
    '## Gates',
    '',
    ...gates,
    '',
    '## Next actions',
    '',
    ...nextActions,
    '',
    '## Machine-readable artifact',
    '',
    '```json',
    JSON.stringify(artifact, null, 2),
    '```',
    '',
  ].join('\n');
}

function renderRemixMarkdown(artifact: RemixArtifact): string {
  const changes = artifact.changeSet.map(
    (change) => `- **${change.id}**: ${change.statement}`,
  );
  const unknowns = artifact.unknowns.map((unknown) => `- ${unknown}`);
  return [
    '# SpecPort Spec Remix Draft',
    '',
    '> The parent source is preserved below. This remix records lineage and requested changes; it is not accepted until a human rechecks the contract.',
    '',
    '- Status: **draft**',
    `- Generated: \`${artifact.generatedAt}\``,
    `- Parent: \`${artifact.lineage.parents[0]?.path ?? 'not available'}\``,
    `- Parent SHA-256: \`${artifact.lineage.parents[0]?.sha256 ?? 'not available'}\``,
    '- Relationship: **remix**',
    '- Attribution: **required**',
    `- Reason: ${artifact.reason}`,
    '',
    '## Requested change set',
    '',
    ...changes,
    '',
    '## Human acceptance required',
    '',
    '- Status: **not accepted**',
    '- Owner: **human required**',
    '',
    '## Unknowns',
    '',
    ...unknowns,
    '',
    '## Parent source preserved',
    '',
    artifact.source,
    '',
    '## Machine-readable artifact',
    '',
    '```json',
    JSON.stringify(artifact, null, 2),
    '```',
    '',
  ].join('\n');
}

async function readParentSpec(
  path: string,
  provenancePath?: string,
): Promise<{
  text: string;
  identity: ParentSpecIdentity;
  check: SpecCheckResult;
}> {
  const absolute = resolve(path);
  const buffer = await readFile(absolute);
  if (buffer.includes(0))
    throw new Error('spec-lifecycle: binary specs are not supported.');
  const text = buffer.toString('utf8');
  const check = await checkSpecFile(absolute);
  const metadata = specMetadata(text);
  const sourceLicense = await readLicenseEvidence(text, buffer, provenancePath);
  return {
    text,
    check,
    identity: {
      path: absolute,
      specId: metadata.specId,
      version: metadata.version,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      bytes: buffer.byteLength,
      readiness: check.readiness,
      accepted: check.accepted,
      sourceLicense,
    },
  };
}

function specMetadata(text: string): {
  specId: string | null;
  version: string | null;
} {
  return {
    specId: metadataValue(text, 'spec[- ]?id|id'),
    version: metadataValue(text, 'version|spec[- ]?version'),
  };
}

function metadataValue(text: string, label: string): string | null {
  const match = new RegExp(`^\\s*(?:${label})\\s*:\\s*([^\\r\\n]+)`, 'im').exec(
    text,
  );
  const value = match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  return value || null;
}

async function readLicenseEvidence(
  text: string,
  content: Buffer,
  provenancePath?: string,
): Promise<LicenseEvidence> {
  const declared = metadataValue(text, 'license|licence');
  if (!provenancePath) {
    return declared
      ? {
          expression: declared,
          scope: 'unknown',
          status: 'declared',
          evidence: 'parent spec license field',
          attributionRequired: true,
        }
      : unknownLicense();
  }

  const absolute = resolve(provenancePath);
  try {
    const receipt = JSON.parse(await readFile(absolute, 'utf8')) as unknown;
    if (!isRecord(receipt) || receipt.receiptKind !== 'github-spec-pull')
      return failedLicense(
        absolute,
        'The provenance file is not a GitHub spec pull receipt.',
      );
    const receiptDigest =
      typeof receipt.contentSha256 === 'string' ? receipt.contentSha256 : null;
    const expectedDigest = createHash('sha256').update(content).digest('hex');
    const license =
      typeof receipt.license === 'string' ? receipt.license : null;
    if (!license || !receiptDigest || receiptDigest !== expectedDigest)
      return failedLicense(
        absolute,
        'The receipt has no usable license or its content digest does not match the parent spec.',
      );
    return {
      expression: license,
      scope: 'repository',
      status: 'verified',
      evidence: absolute,
      attributionRequired: true,
    };
  } catch (error) {
    return failedLicense(
      absolute,
      `The provenance receipt could not be verified: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function unknownLicense(): LicenseEvidence {
  return {
    expression: null,
    scope: 'unknown',
    status: 'unknown',
    evidence: null,
    attributionRequired: true,
  };
}

function failedLicense(path: string, message: string): LicenseEvidence {
  return {
    expression: null,
    scope: 'unknown',
    status: 'failed',
    evidence: `${path}: ${message}`,
    attributionRequired: true,
  };
}

function inheritedLicense(source: LicenseEvidence): LicenseEvidence {
  return {
    expression: source.expression,
    scope: source.scope,
    status: source.status === 'verified' ? 'declared' : source.status,
    evidence: source.evidence,
    attributionRequired: true,
  };
}

async function inspectTarget(
  path: string,
  stack: string | undefined,
  generatedAt: string,
): Promise<TargetEvidence> {
  const absolute = resolve(path);
  const targetStats = await stat(absolute);
  if (!targetStats.isDirectory())
    throw new Error(`spec-lifecycle: target must be a directory: ${absolute}`);
  const map = await mapRepository(absolute, generatedAt);
  return {
    path: absolute,
    stack: stack?.trim() || null,
    repository: map.repository,
    observedLanguages: [...new Set(map.files.map((file) => file.language))]
      .filter((language) => language !== 'unknown')
      .sort(),
    observedSurfaces: map.surfaces.length,
    unknownCount: map.unknowns.length,
    mapSafety: map.safety,
  };
}

async function inspectContract(path: string): Promise<ContractEvidence> {
  const absolute = resolve(path);
  let provided = false;
  let contentSha256: string | null = null;
  let bytes = 0;
  try {
    await access(absolute);
    provided = true;
  } catch {
    // The validator below produces the durable missing-contract reason.
  }
  if (provided) {
    try {
      const content = await readFile(absolute);
      bytes = content.byteLength;
      contentSha256 = createHash('sha256').update(content).digest('hex');
    } catch {
      provided = false;
    }
  }
  const validation = await readAndValidateProductContract(absolute);
  return {
    path: absolute,
    provided,
    valid: validation.valid,
    contentSha256,
    bytes,
    issueCount: validation.issues.length,
    issues: validation.issues,
  };
}

async function inspectAcceptanceRecord(
  path: string | undefined,
  contractPath: string,
  contractDigest: string | null,
): Promise<AcceptanceEvidence> {
  if (!path)
    return {
      path: '(not supplied)',
      provided: false,
      sha256: null,
      bytes: 0,
      decision: 'missing',
      actor: null,
      at: null,
      inputDigest: null,
      contractPath: null,
      decisionSource: null,
    };
  const absolute = resolve(path);
  try {
    const buffer = await readFile(absolute);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    if (!buffer.toString('utf8').trim())
      return {
        path: absolute,
        provided: false,
        sha256: null,
        bytes: buffer.byteLength,
        decision: 'missing',
        actor: null,
        at: null,
        inputDigest: null,
        contractPath: null,
        decisionSource: null,
      };
    const parsed = JSON.parse(buffer.toString('utf8')) as unknown;
    const actor = isRecord(parsed)
      ? (nonEmptyString(parsed.acceptedBy) ?? nonEmptyString(parsed.actor))
      : null;
    const at = isRecord(parsed)
      ? (nonEmptyString(parsed.acceptedAt) ?? nonEmptyString(parsed.at))
      : null;
    const decision = isRecord(parsed) ? nonEmptyString(parsed.decision) : null;
    const inputDigest = isRecord(parsed)
      ? (nonEmptyString(parsed.contractSha256) ??
        nonEmptyString(parsed.inputDigest))
      : null;
    const declaredContractPath = isRecord(parsed)
      ? nonEmptyString(parsed.contractPath)
      : null;
    const decisionSource = isRecord(parsed)
      ? nonEmptyString(parsed.decisionSource)
      : null;
    const declaredContractMatches = declaredContractPath
      ? [
          resolve(declaredContractPath),
          resolve(absolute, '..', declaredContractPath),
        ].includes(resolve(contractPath))
      : false;
    const valid =
      decision === 'accepted' &&
      Boolean(actor) &&
      Boolean(at && isIsoTimestamp(at)) &&
      Boolean(decisionSource) &&
      declaredContractMatches &&
      Boolean(contractDigest) &&
      inputDigest === contractDigest;
    return {
      path: absolute,
      provided: valid,
      sha256,
      bytes: buffer.byteLength,
      decision: valid ? 'accepted' : 'invalid',
      actor,
      at,
      inputDigest,
      contractPath: declaredContractPath,
      decisionSource,
    };
  } catch {
    return {
      path: absolute,
      provided: false,
      sha256: null,
      bytes: 0,
      decision: 'invalid',
      actor: null,
      at: null,
      inputDigest: null,
      contractPath: null,
      decisionSource: null,
    };
  }
}

function specGate(check: SpecCheckResult): LifecycleGate {
  return check.readiness === 'ready'
    ? {
        id: 'spec-readiness',
        status: 'pass',
        evidence:
          'spec check returned ready with explicit acceptance and no unresolved inputs',
        nextAction: null,
      }
    : {
        id: 'spec-readiness',
        status: 'blocked',
        evidence: `spec check returned ${check.readiness} with ${check.issues.length} issue(s)`,
        nextAction:
          'Edit the parent spec, resolve human decisions, and rerun spec check.',
      };
}

function licenseGate(license: LicenseEvidence): LifecycleGate {
  return license.status === 'verified' || license.status === 'declared'
    ? {
        id: 'license',
        status: license.status === 'verified' ? 'pass' : 'unknown',
        evidence: license.evidence
          ? `${license.status} license ${license.expression ?? 'NOASSERTION'} from ${license.evidence}`
          : 'license was declared but its scope is not independently verified',
        nextAction:
          license.status === 'verified'
            ? null
            : 'Attach a provenance receipt or independently verify license scope and attribution obligations.',
      }
    : {
        id: 'license',
        status: 'blocked',
        evidence:
          license.status === 'failed'
            ? 'license provenance failed closed'
            : 'no usable license evidence was supplied',
        nextAction:
          'Provide a verified source license and attribution evidence before reuse.',
      };
}

function contractGate(contract: ContractEvidence): LifecycleGate {
  return contract.valid
    ? {
        id: 'product-contract',
        status: 'pass',
        evidence: `validated ${contract.path}`,
        nextAction: null,
      }
    : {
        id: 'product-contract',
        status: 'blocked',
        evidence: `${contract.path} is missing or invalid (${contract.issueCount} issue(s))`,
        nextAction:
          'Provide a human-owned contract and run spec validate before implementation.',
      };
}

function acceptanceGate(acceptance: AcceptanceEvidence): LifecycleGate {
  return acceptance.provided
    ? {
        id: 'contract-acceptance',
        status: 'pass',
        evidence: `accepted by ${acceptance.actor ?? 'unknown'} at ${acceptance.at ?? 'unknown'}; record SHA-256 ${acceptance.sha256}`,
        nextAction: null,
      }
    : {
        id: 'contract-acceptance',
        status: 'blocked',
        evidence:
          acceptance.decision === 'invalid'
            ? 'the human acceptance record is invalid or does not match the inspected contract'
            : 'no non-empty durable human acceptance record was supplied',
        nextAction:
          'Record the human approver, ISO timestamp, decision source, exact contract path, and exact contract digest.',
      };
}

function isIsoTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:?\d{2})$/.test(
      value,
    ) && !Number.isNaN(Date.parse(value))
  );
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function targetProfileGate(stack: string | null): LifecycleGate {
  return stack
    ? {
        id: 'target-profile',
        status: 'pass',
        evidence: `target stack declared as ${stack}`,
        nextAction: null,
      }
    : {
        id: 'target-profile',
        status: 'blocked',
        evidence: 'no target stack or compatibility profile was supplied',
        nextAction:
          'Declare the target stack and compatibility boundary before build handoff.',
      };
}

function createArtifactIdentity(
  parent: ParentSpecIdentity,
  stablePayload: unknown,
): ArtifactIdentity {
  const canonical = canonicalJson({
    parentDigest: parent.sha256,
    specId: parent.specId,
    version: parent.version,
    stablePayload,
  });
  return {
    specId: parent.specId,
    version: parent.version,
    contentSha256: createHash('sha256').update(canonical, 'utf8').digest('hex'),
  };
}

function stableTargetIdentity(
  repository: TargetEvidence['repository'],
): Record<string, unknown> {
  return {
    repositoryId: repository.repositoryId,
    headCommit: repository.headCommit,
    baseCommit: repository.baseCommit,
    stable: repository.stable,
    fileCount: repository.fileCount,
  };
}

function coverGateState(
  sourceLicense: LicenseEvidence,
  contract: ContractEvidence,
  target: TargetEvidence,
): GateState {
  return {
    license: sourceLicense.status === 'verified' ? 'pass' : 'unknown',
    compatibility: target.stack ? 'unknown' : 'fail',
    acceptance: contract.valid ? 'pass' : 'pending',
    taste: 'pending',
    release: 'blocked',
  };
}

function buildGateState(
  sourceLicense: LicenseEvidence,
  contract: ContractEvidence,
  target: TargetEvidence,
  acceptance: AcceptanceEvidence,
): GateState {
  return {
    license: sourceLicense.status === 'verified' ? 'pass' : 'unknown',
    compatibility: target.stack ? 'unknown' : 'fail',
    acceptance: contract.valid && acceptance.provided ? 'pass' : 'pending',
    taste: 'pending',
    release: 'blocked',
  };
}

function pendingDecision(): LifecycleDecision {
  return {
    state: 'pending',
    actor: null,
    at: null,
    source: null,
    inputDigest: null,
  };
}

function targetGate(target: TargetEvidence): LifecycleGate {
  return target.mapSafety.codeExecuted === false &&
    target.mapSafety.networkAccessed === false
    ? {
        id: 'target-inspection',
        status: 'pass',
        evidence: `read-only static map captured ${target.repository.fileCount} observed file(s)`,
        nextAction: null,
      }
    : {
        id: 'target-inspection',
        status: 'blocked',
        evidence: 'target inspection safety boundary was not proven',
        nextAction: 'Stop and establish a read-only inspection boundary.',
      };
}

function coverNextActions(
  gates: readonly LifecycleGate[],
  target: TargetEvidence,
): string[] {
  const actions = gates
    .filter((gate) => gate.nextAction)
    .map((gate) => gate.nextAction as string);
  if (target.unknownCount)
    actions.push(
      'Review target-map unknowns before claiming compatibility or implementation completeness.',
    );
  actions.push(
    'Record deviations and run the declared checks after implementation; this plan is not a ship receipt.',
  );
  return [...new Set(actions)];
}

function buildNextActions(
  gates: readonly LifecycleGate[],
  target: TargetEvidence,
  acceptance: AcceptanceEvidence,
): string[] {
  const actions = gates
    .filter((gate) => gate.nextAction)
    .map((gate) => gate.nextAction as string);
  if (target.unknownCount)
    actions.push(
      'Resolve or explicitly accept target-map unknowns before implementation expands scope.',
    );
  if (acceptance.provided)
    actions.push(
      'Run the bounded implementation skill, then rerun verification, final-tree coverage, taste review, packaging, and rollback gates.',
    );
  else
    actions.push(
      'Do not run implementation until the owner supplies the missing acceptance record.',
    );
  return [...new Set(actions)];
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
