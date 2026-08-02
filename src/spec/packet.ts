import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { VERSION } from '../version.js';
import { checkSpecText, type SpecCheckResult } from './authoring.js';
import { mapRepository, type RepositoryMap } from './map.js';
import {
  discoverRepositorySpec,
  type RepositoryBaselineSpec,
  renderRepositoryBaselineMarkdown,
} from './repository.js';

const SPEC_PATH = 'SPEC.md';
const BASELINE_PATH = '.specport/repository-baseline.json';
const MAP_PATH = '.specport/repo-map.json';
const LEDGER_PATH = '.specport/repo-to-spec/evidence-ledger.json';
const CHECK_PATH = '.specport/repo-to-spec/spec-check.json';
const PACKET_PATH = '.specport/repo-to-spec/packet.json';

export interface EvidenceSource {
  kind: 'artifact' | 'file' | 'git' | 'command';
  path: string;
  locator: string;
  ref: string;
}

export interface EvidenceObservation {
  id: string;
  claim: string;
  sources: readonly EvidenceSource[];
}

export interface EvidenceInference {
  id: string;
  claim: string;
  basis: readonly string[];
  confidence: 'low' | 'medium' | 'high';
  needsHumanConfirmation: true;
}

export interface EvidenceUnknown {
  id: string;
  question: string;
  materiality: 'blocks' | 'important' | 'informational';
  blocks: readonly string[];
  owner: 'human';
}

export interface EvidenceCommand {
  id: string;
  command: string;
  purpose: string;
  ranAt: string;
  exitCode: number;
  evidencePath: string;
  execution: 'internal-read-only';
}

export interface RepoToSpecEvidenceLedger {
  schemaVersion: '1';
  artifactKind: 'repo-to-spec-evidence-ledger';
  generatedAt: string;
  repository: {
    root: string;
    identity: string | null;
    headCommit: string | null;
    authoritativeTree: string;
    baselineArtifact: typeof BASELINE_PATH;
    mapArtifact: typeof MAP_PATH;
  };
  observed: readonly EvidenceObservation[];
  inferred: readonly EvidenceInference[];
  unknown: readonly EvidenceUnknown[];
  accepted: readonly [];
  commands: readonly EvidenceCommand[];
  handoff: {
    specPath: typeof SPEC_PATH;
    contractPath: '.specport/contract.json';
    nextSkill: 'specport-spec-to-production';
    status: 'draft-only';
    ownerDecision: 'pending';
    limitations: readonly string[];
  };
}

export interface RepoToSpecOutputFile {
  path: string;
  kind: 'markdown' | 'json';
  bytes: number;
  sha256: string;
}

export interface RepoToSpecPacket {
  schemaVersion: string;
  artifactKind: 'repo-to-spec-packet';
  status: 'draft-only';
  generatedAt: string;
  repository: {
    root: string;
    identity: string | null;
    headCommit: string | null;
    baseCommit: string | null;
    baseKind: RepositoryBaselineSpec['repository']['baseKind'];
    stable: boolean | null;
    authoritativeTree: string;
  };
  safety: {
    codeExecuted: false;
    networkAccessed: false;
  };
  outputs: {
    root: string;
    packetPath: typeof PACKET_PATH;
    files: readonly RepoToSpecOutputFile[];
  };
  summary: {
    observedFiles: number;
    mappedFiles: number;
    mappedSymbols: number;
    mappedImports: number;
    mappedSurfaces: number;
    unknowns: number;
  };
  specCheck: {
    readiness: SpecCheckResult['readiness'];
    accepted: boolean;
    issueCount: number;
  };
  handoff: {
    status: 'draft-only';
    ownerDecision: 'pending';
    nextSkill: 'specport-spec-to-production';
  };
}

export interface RepoToSpecPacketArtifacts {
  packet: RepoToSpecPacket;
  specMarkdown: string;
  baselineJson: string;
  mapJson: string;
  ledgerJson: string;
  specCheckJson: string;
  packetJson: string;
}

export async function createRepoToSpecPacket(
  requestedPath = '.',
  outputPath?: string,
  generatedAt = new Date().toISOString(),
): Promise<RepoToSpecPacketArtifacts> {
  const baseline = await discoverRepositorySpec(requestedPath, generatedAt);
  const map = await mapRepository(baseline.repository.path, generatedAt);
  const outputRoot = resolve(outputPath ?? baseline.repository.path);
  const specPath = join(outputRoot, SPEC_PATH);
  const specMarkdown = renderPacketSpec(baseline, map);
  const specCheck = checkSpecText(specPath, specMarkdown);
  const ledger = createEvidenceLedger(baseline, map, specCheck, generatedAt);
  const baselineJson = `${JSON.stringify(baseline, null, 2)}\n`;
  const mapJson = `${JSON.stringify(map, null, 2)}\n`;
  const ledgerJson = `${JSON.stringify(ledger, null, 2)}\n`;
  const specCheckJson = `${JSON.stringify(specCheck, null, 2)}\n`;
  const outputFiles = [
    outputFile(SPEC_PATH, 'markdown', specMarkdown),
    outputFile(BASELINE_PATH, 'json', baselineJson),
    outputFile(MAP_PATH, 'json', mapJson),
    outputFile(LEDGER_PATH, 'json', ledgerJson),
    outputFile(CHECK_PATH, 'json', specCheckJson),
  ];
  const packet: RepoToSpecPacket = {
    schemaVersion: VERSION,
    artifactKind: 'repo-to-spec-packet',
    status: 'draft-only',
    generatedAt,
    repository: {
      root: baseline.repository.path,
      identity: baseline.repository.repositoryId,
      headCommit: baseline.repository.headCommit,
      baseCommit: baseline.repository.baseCommit,
      baseKind: baseline.repository.baseKind,
      stable: baseline.repository.stable,
      authoritativeTree:
        baseline.repository.headCommit ?? baseline.repository.baseKind,
    },
    safety: {
      codeExecuted: false,
      networkAccessed: false,
    },
    outputs: {
      root: outputRoot,
      packetPath: PACKET_PATH,
      files: outputFiles,
    },
    summary: {
      observedFiles: baseline.evidence.fileCount,
      mappedFiles: map.files.length,
      mappedSymbols: map.symbols.length,
      mappedImports: map.imports.length,
      mappedSurfaces: map.surfaces.length,
      unknowns:
        baseline.gaps.length + map.unknowns.length + ledger.unknown.length,
    },
    specCheck: {
      readiness: specCheck.readiness,
      accepted: specCheck.accepted,
      issueCount: specCheck.issues.length,
    },
    handoff: {
      status: 'draft-only',
      ownerDecision: 'pending',
      nextSkill: 'specport-spec-to-production',
    },
  };
  const packetJson = `${JSON.stringify(packet, null, 2)}\n`;

  return {
    packet,
    specMarkdown,
    baselineJson,
    mapJson,
    ledgerJson,
    specCheckJson,
    packetJson,
  };
}

function renderPacketSpec(
  baseline: RepositoryBaselineSpec,
  map: RepositoryMap,
): string {
  const baselineMarkdown = renderRepositoryBaselineMarkdown(baseline).trimEnd();
  return [
    baselineMarkdown,
    '',
    '## Product behavior',
    '',
    '- The repository exposes the files, declared entrypoints, checks, and statically inferred surfaces recorded in the baseline and map.',
    '- Runtime behavior, failure semantics, user-visible outcomes, and forbidden behavior remain human decisions until verified.',
    '',
    '## Acceptance scenarios',
    '',
    '- `AC-001` (draft): Given a human-selected repository workflow, when the accepted verification command runs, then the expected observable result is recorded by the owner.',
    '- Replace this placeholder with product-specific criteria and forbidden behavior before implementation.',
    '',
    '## Verification details',
    '',
    '- Verification command: `[NEEDS HUMAN INPUT]`',
    '- The checks observed in the baseline were discovered, not run by this packet.',
    '',
    '## Static implementation map',
    '',
    '> This section is bounded static evidence. It describes code shape, not product intent, runtime correctness, or human approval.',
    '',
    `- Machine-readable map: \`${MAP_PATH}\``,
    `- Files mapped: **${map.files.length}**`,
    `- Symbols inferred: **${map.symbols.length}**`,
    `- Imports inferred: **${map.imports.length}**`,
    `- Product surfaces inferred or observed: **${map.surfaces.length}**`,
    `- Unknowns recorded: **${map.unknowns.length}**`,
    `- Code executed: **${map.safety.codeExecuted ? 'yes' : 'no'}**`,
    `- Network accessed: **${map.safety.networkAccessed ? 'yes' : 'no'}**`,
    '',
    'Review the map and evidence ledger before treating any inferred structure as a requirement.',
    '',
  ].join('\n');
}

function createEvidenceLedger(
  baseline: RepositoryBaselineSpec,
  map: RepositoryMap,
  specCheck: SpecCheckResult,
  generatedAt: string,
): RepoToSpecEvidenceLedger {
  const ref = baseline.repository.headCommit ?? baseline.repository.baseKind;
  const artifactSource = (path: string, locator: string): EvidenceSource => ({
    kind: 'artifact',
    path,
    locator,
    ref,
  });
  const gitSource = (locator: string): EvidenceSource => ({
    kind: 'git',
    path: baseline.repository.path,
    locator,
    ref,
  });
  const observed: EvidenceObservation[] = [
    {
      id: 'OBS-001',
      claim: `The repository root is ${baseline.repository.path} and its authoritative tree is ${ref}.`,
      sources: [
        gitSource('repository root, HEAD/base snapshot'),
        artifactSource(BASELINE_PATH, 'repository'),
      ],
    },
    {
      id: 'OBS-002',
      claim: `The baseline observed ${baseline.evidence.fileCount} non-ignored files, ${baseline.project.languages.join(', ') || 'no detected language'}, and ${baseline.project.checks.length} declared repeatable checks.`,
      sources: [
        artifactSource(BASELINE_PATH, 'evidence/project'),
        artifactSource(BASELINE_PATH, 'project.checks'),
      ],
    },
    {
      id: 'OBS-003',
      claim: `The bounded static map recorded ${map.files.length} files, ${map.symbols.length} inferred symbols, ${map.imports.length} inferred imports, and ${map.unknowns.length} explicit map unknowns without executing code or accessing the network.`,
      sources: [
        artifactSource(MAP_PATH, 'files, symbols, imports, unknowns'),
        artifactSource(MAP_PATH, 'safety'),
      ],
    },
    {
      id: 'OBS-004',
      claim: `The generated SPEC.md remains ${specCheck.readiness} and accepted=${specCheck.accepted}; its structural check recorded ${specCheck.issues.length} issue(s).`,
      sources: [artifactSource(CHECK_PATH, 'readiness, accepted, issues')],
    },
  ];

  const inferred: EvidenceInference[] = [
    {
      id: 'INF-001',
      claim:
        'The repository evidence is sufficient to start a contract conversation, but it does not establish the product intent, user job, or ship boundary.',
      basis: ['OBS-001', 'OBS-002', 'OBS-004'],
      confidence: 'high',
      needsHumanConfirmation: true,
    },
    {
      id: 'INF-002',
      claim:
        'The static map can guide an implementation agent toward likely surfaces, but every inferred symbol, import, and route still needs confirmation before it becomes an acceptance requirement.',
      basis: ['OBS-003'],
      confidence: 'high',
      needsHumanConfirmation: true,
    },
  ];

  const unknown: EvidenceUnknown[] = [
    {
      id: 'UNK-001',
      question: 'Who owns the product decision, target user, and user job?',
      materiality: 'blocks',
      blocks: ['intent', 'acceptance', 'release'],
      owner: 'human',
    },
    {
      id: 'UNK-002',
      question:
        'Which behaviors are mandatory, measurable, and explicitly forbidden?',
      materiality: 'blocks',
      blocks: ['acceptance'],
      owner: 'human',
    },
    {
      id: 'UNK-003',
      question:
        'What taste, usability, accessibility, or operational review is required for this product?',
      materiality: 'blocks',
      blocks: ['taste', 'release'],
      owner: 'human',
    },
    {
      id: 'UNK-004',
      question:
        'What artifact, version, compatibility range, security boundary, and rollback path may ship?',
      materiality: 'blocks',
      blocks: ['release'],
      owner: 'human',
    },
  ];

  for (const [index, gap] of baseline.gaps.entries()) {
    unknown.push({
      id: `UNK-${String(unknown.length + 1).padStart(3, '0')}`,
      question: gap,
      materiality: 'important',
      blocks: ['implementation'],
      owner: 'human',
    });
    observed.push({
      id: `OBS-${String(observed.length + 1).padStart(3, '0')}`,
      claim: `The repository baseline reported this gap: ${gap}`,
      sources: [artifactSource(BASELINE_PATH, `gaps[${index}]`)],
    });
  }
  for (const [index, mapUnknown] of map.unknowns.entries()) {
    unknown.push({
      id: `UNK-${String(unknown.length + 1).padStart(3, '0')}`,
      question: mapUnknown.message,
      materiality: 'important',
      blocks: ['implementation', 'verification'],
      owner: 'human',
    });
    observed.push({
      id: `OBS-${String(observed.length + 1).padStart(3, '0')}`,
      claim: `The bounded map recorded an explicit unknown: ${mapUnknown.message}`,
      sources: [artifactSource(MAP_PATH, `unknowns[${index}]`)],
    });
  }

  return {
    schemaVersion: '1',
    artifactKind: 'repo-to-spec-evidence-ledger',
    generatedAt,
    repository: {
      root: baseline.repository.path,
      identity: baseline.repository.repositoryId,
      headCommit: baseline.repository.headCommit,
      authoritativeTree: ref,
      baselineArtifact: BASELINE_PATH,
      mapArtifact: MAP_PATH,
    },
    observed,
    inferred,
    unknown,
    accepted: [],
    commands: [
      {
        id: 'CMD-001',
        command: 'SpecPort internal read-only stage: discoverRepositorySpec',
        purpose:
          'Capture the repository baseline without executing repository code.',
        ranAt: generatedAt,
        exitCode: 0,
        evidencePath: BASELINE_PATH,
        execution: 'internal-read-only',
      },
      {
        id: 'CMD-002',
        command: 'SpecPort internal read-only stage: mapRepository',
        purpose:
          'Build a bounded static implementation map with explicit unknowns.',
        ranAt: generatedAt,
        exitCode: 0,
        evidencePath: MAP_PATH,
        execution: 'internal-read-only',
      },
      {
        id: 'CMD-003',
        command: 'SpecPort internal read-only stage: checkSpecText',
        purpose:
          'Check the generated draft for structure and unresolved human gates.',
        ranAt: generatedAt,
        exitCode: specCheck.readiness === 'ready' ? 0 : 5,
        evidencePath: CHECK_PATH,
        execution: 'internal-read-only',
      },
    ],
    handoff: {
      specPath: SPEC_PATH,
      contractPath: '.specport/contract.json',
      nextSkill: 'specport-spec-to-production',
      status: 'draft-only',
      ownerDecision: 'pending',
      limitations: [
        'Repository code was not executed and no network service was contacted.',
        'Static syntax and declared metadata do not prove runtime behavior, security, taste, or release readiness.',
        'No product intent or acceptance decision was inferred from the repository.',
        'The generated contract remains human-owned and is not created by this packet.',
      ],
    },
  };
}

function outputFile(
  path: string,
  kind: RepoToSpecOutputFile['kind'],
  content: string,
): RepoToSpecOutputFile {
  return {
    path,
    kind,
    bytes: Buffer.byteLength(content, 'utf8'),
    sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
  };
}

export function packetOutputPaths(outputRoot: string): {
  specPath: string;
  baselinePath: string;
  mapPath: string;
  ledgerPath: string;
  checkPath: string;
  packetPath: string;
} {
  const root = resolve(outputRoot);
  return {
    specPath: join(root, SPEC_PATH),
    baselinePath: join(root, BASELINE_PATH),
    mapPath: join(root, MAP_PATH),
    ledgerPath: join(root, LEDGER_PATH),
    checkPath: join(root, CHECK_PATH),
    packetPath: join(root, PACKET_PATH),
  };
}

export function renderPacketHuman(
  packet: RepoToSpecPacket,
  outputPaths: ReturnType<typeof packetOutputPaths>,
): string {
  return [
    `PACKET     ${packet.status}`,
    `REPOSITORY ${packet.repository.root}`,
    `TREE       ${packet.repository.authoritativeTree}`,
    `FILES      ${packet.summary.observedFiles} observed / ${packet.summary.mappedFiles} mapped`,
    `MAP        ${packet.summary.mappedSymbols} symbols / ${packet.summary.mappedImports} imports / ${packet.summary.mappedSurfaces} surfaces`,
    `SPEC       ${packet.specCheck.readiness}; ${packet.specCheck.issueCount} issue(s); accepted=${packet.specCheck.accepted ? 'yes' : 'no'}`,
    `SAFETY     code=${packet.safety.codeExecuted ? 'executed' : 'not executed'} network=${packet.safety.networkAccessed ? 'accessed' : 'not accessed'}`,
    `WROTE      ${outputPaths.specPath}`,
    `WROTE      ${outputPaths.baselinePath}`,
    `WROTE      ${outputPaths.mapPath}`,
    `WROTE      ${outputPaths.ledgerPath}`,
    `WROTE      ${outputPaths.checkPath}`,
    `WROTE      ${outputPaths.packetPath}`,
    'NEXT       human acceptance, contract creation, and verification are required',
    '',
  ].join('\n');
}
