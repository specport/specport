#!/usr/bin/env node

import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareCoverage,
  normalizePathList,
  pathsForEntries,
} from './core/coverage.js';
import type {
  CoverageResult,
  ExpectedScope,
  FinalTreeSnapshot,
  ReceiverSource,
} from './core/types.js';
import { tryRunGit } from './git/command.js';
import { captureFinalTree, repositoryIdentity } from './git/snapshot.js';
import { formatCoverageTodo, GitHumanAdapter } from './receiver/githuman.js';
import {
  checkSpecFile,
  createSpecDraft,
  renderSpecCheckHuman,
  renderSpecDraftMarkdown,
} from './spec/authoring.js';
import { readAndValidateProductContract } from './spec/contract.js';
import {
  discoverRepositorySpec,
  renderRepositoryBaselineMarkdown,
} from './spec/repository.js';
import { VERSION } from './version.js';

export interface CliIo {
  stdin?: NodeJS.ReadableStream;
  prompt?: (question: string) => Promise<string>;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

interface Options {
  command:
    | 'coverage'
    | 'help'
    | 'spec-check'
    | 'spec-create'
    | 'spec-discover'
    | 'spec-validate'
    | 'skill-export'
    | 'skill-list'
    | 'version';
  path: string;
  json: boolean;
  writePath?: string;
  force: boolean;
  interactive: boolean;
  baseRef?: string;
  receiver?: string;
  reviewId?: string;
  expectedScopePath?: string;
  receiverUrl?: string;
  contractPath?: string;
  skillName?: string;
}

interface HandoffAnswers {
  intent: string;
  scopeSelection:
    | 'missing'
    | 'all-displayed'
    | 'selected-subset'
    | 'unresolved';
  reviewRequest: 'missing' | 'generated-order' | 'user-selected';
  verification: string;
  verificationSelection: 'selected' | 'explicitly-skipped' | 'none';
  selectedPaths: readonly string[];
}

interface DiscoveredCheck {
  name: string;
  command: string;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = {},
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const stdin = io.stdin ?? process.stdin;
  try {
    const options = parseArgs(argv);
    if (options.command === 'version') {
      stdout.write(`${VERSION}\n`);
      return 0;
    }
    if (options.command === 'help') {
      stdout.write(helpText());
      return 0;
    }
    if (options.command === 'spec-discover') {
      const spec = await discoverRepositorySpec(options.path);
      await writeSpecArtifact(options, spec, stdout);
      return 0;
    }
    if (options.command === 'spec-create') {
      const draft = await createSpecDraft(options.path, stdin);
      await writeSpecDraftArtifact(options, draft, stdout);
      return 0;
    }
    if (options.command === 'spec-check') {
      const result = await checkSpecFile(options.path);
      await writeSpecCheckArtifact(options, result, stdout);
      return result.readiness === 'ready' ? 0 : 5;
    }
    if (options.command === 'spec-validate') {
      const contractPath = resolve(
        options.contractPath ?? '.specport/contract.json',
      );
      const validation = await readAndValidateProductContract(contractPath);
      writeContractValidation(options, contractPath, validation, stdout);
      return validation.valid ? 0 : 5;
    }
    if (options.command === 'skill-list') {
      const skills = await discoverSkills();
      writeSkillList(options, skills, stdout);
      return 0;
    }
    if (options.command === 'skill-export') {
      if (!options.skillName || !options.writePath) {
        throw new UsageError(
          'skill export requires a skill name and --out <directory>.',
        );
      }
      const exported = await exportSkill(
        options.skillName,
        options.writePath,
        options.force,
      );
      writeSkillExport(options, exported, stdout);
      return 0;
    }

    const actual = await captureFinalTree(options.path, options.baseRef);
    const discoveredChecks = await discoverChecks(actual.repositoryPath);
    const expectedScope = options.expectedScopePath
      ? await readExpectedScope(options.expectedScopePath, actual)
      : undefined;
    let result = compareCoverage({
      actual,
      ...(expectedScope ? { expectedScope } : {}),
    });
    let receiverBrief: ReceiverBrief = {
      status: 'none',
      coverage: result.coverage,
      unreviewedPaths: result.unreviewedPaths,
      unexpectedPaths: result.unexpectedPaths,
      changedAfterReviewPaths: result.changedAfterReviewPaths,
      identityGap: result.identityGap,
    };
    let exitCode =
      result.coverage === 'partial' ||
      (result.coverage === 'unknown' && expectedScope)
        ? 5
        : 0;
    let handoff: HandoffAnswers | undefined;

    if (options.receiver) {
      if (options.receiver !== 'githuman') {
        throw new UsageError(
          `Unsupported receiver: ${options.receiver}. v0.1 supports githuman.`,
        );
      }
      const adapter = new GitHumanAdapter(
        options.receiverUrl ? { baseUrl: options.receiverUrl } : {},
      );
      let source: ReceiverSource | undefined;
      try {
        source = (await adapter.getReview(actual, options.reviewId)).source;
        result = compareCoverage({
          actual,
          receiver: source,
          ...(expectedScope ? { expectedScope } : {}),
        });
        const after = await captureFinalTree(
          actual.repositoryPath,
          options.baseRef,
        );
        if (
          after.fingerprint !== actual.fingerprint ||
          after.baseCommit !== actual.baseCommit
        ) {
          result = unknownAfterMutation(result);
        }
        receiverBrief = receiverDetails(result, source, 'connected');
        exitCode = result.coverage === 'complete' ? 0 : 5;
        if (result.coverage === 'partial' && result.finding) {
          try {
            const todo = await adapter.attachTodo(
              source.reviewId,
              formatCoverageTodo(result),
            );
            receiverBrief = receiverDetails(
              result,
              source,
              'attached',
              todo.id,
            );
          } catch (error) {
            receiverBrief = receiverDetails(
              result,
              source,
              'adapter-unavailable',
            );
            receiverBrief.identityGap = [
              ...receiverBrief.identityGap,
              error instanceof Error
                ? `receiver-attach-failed: ${error.message}`
                : 'receiver-attach-failed',
            ];
            exitCode = 7;
          }
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'GitHuman adapter unavailable';
        receiverBrief = {
          status: 'adapter-unavailable',
          coverage: 'unknown',
          unreviewedPaths: [],
          unexpectedPaths: [],
          changedAfterReviewPaths: [],
          identityGap: [message],
        };
        exitCode = 7;
        result = {
          ...result,
          coverage: 'unknown',
          status: 'unknown',
          identityGap: [...result.identityGap, 'adapter-unavailable'],
          findings: [],
        };
      }
    }

    if (options.interactive) {
      stderr.write(
        renderInteractivePreview(
          actual,
          result,
          receiverBrief,
          discoveredChecks,
        ),
      );
      handoff = await collectHandoff(
        actual,
        stderr,
        stdin,
        io.prompt,
        discoveredChecks,
      );
      if (!options.receiver && handoff.intent.trim()) exitCode = 5;
    }

    const brief = buildBrief(
      actual,
      result,
      receiverBrief,
      expectedScope,
      handoff,
      discoveredChecks,
    );
    await writeResult(options, brief, stdout);
    return exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`specport: ${message}\n`);
    if (error instanceof UsageError) stderr.write(`\n${helpText()}`);
    return error instanceof OutputError ? 4 : 2;
  }
}

interface ReceiverBrief {
  status:
    | 'none'
    | 'requested'
    | 'connected'
    | 'attached'
    | 'adapter-unavailable';
  coverage: CoverageResult['coverage'];
  receiverName?: string;
  receiverVersion?: string;
  reviewId?: string;
  sourceKind?: ReceiverSource['sourceKind'];
  sourceIdentity?: string | null;
  repositoryPath?: string;
  repositoryId?: string;
  baseCommit?: string | null;
  sourceFingerprint?: string | null;
  sourceFingerprintKind?: 'tree' | 'patch';
  reviewedChanges?: readonly ReceiverSource['entries'][number][];
  reviewedPaths?: readonly string[];
  attachment?: { id: string; reviewId: string; visible: boolean };
  attachmentId?: string;
  unreviewedPaths: readonly string[];
  unexpectedPaths: readonly string[];
  changedAfterReviewPaths: readonly string[];
  identityGap: readonly string[];
}

function parseArgs(argv: readonly string[]): Options {
  const args = [...argv];
  const rawCommand = args.shift() ?? 'help';
  if (rawCommand === '--version' || rawCommand === '-v')
    return baseOptions('version');
  if (rawCommand === '--help' || rawCommand === '-h' || rawCommand === 'help')
    return baseOptions('help');
  if (rawCommand === 'spec') {
    return parseSpecArgs(args);
  }
  if (
    rawCommand === 'create' ||
    rawCommand === 'check' ||
    rawCommand === 'map'
  ) {
    return parseSpecArgs([rawCommand, ...args]);
  }
  if (rawCommand === 'skill') return parseSkillArgs(args);
  const isLegacyReview = rawCommand === 'review';
  if (rawCommand !== 'coverage' && !isLegacyReview) {
    throw new UsageError(`Unknown command: ${rawCommand}`);
  }

  if (isLegacyReview) {
    const quickIndex = args.indexOf('--quick');
    if (quickIndex < 0)
      throw new UsageError(
        'Only `review --quick` is available in the v0.1 spike; use `coverage`.',
      );
    args.splice(quickIndex, 1);
  }

  const options: Options = {
    ...baseOptions('coverage'),
    path: '.',
    json: false,
    force: false,
    interactive: false,
  };
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    switch (arg) {
      case '--json':
        options.json = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--interactive':
        options.interactive = true;
        break;
      case '--receiver':
        options.receiver = requiredValue(args, ++index, arg);
        break;
      case '--review':
      case '--receiver-review':
        options.reviewId = requiredValue(args, ++index, arg);
        break;
      case '--base':
        options.baseRef = requiredValue(args, ++index, arg);
        break;
      case '--write':
        options.writePath = requiredValue(args, ++index, arg);
        break;
      case '--expected-scope':
        options.expectedScopePath = requiredValue(args, ++index, arg);
        break;
      case '--receiver-url':
        options.receiverUrl = requiredValue(args, ++index, arg);
        break;
      case '--quick':
        break;
      case '--help':
        throw new UsageError(helpText());
      default:
        if (arg.startsWith('-')) throw new UsageError(`Unknown option: ${arg}`);
        positional.push(arg);
    }
  }
  if (positional.length > 1)
    throw new UsageError('Only one repository path may be supplied.');
  if (positional[0]) options.path = positional[0];
  return options;
}

function parseSpecArgs(args: string[]): Options {
  const requestedSubcommand = args.shift();
  const subcommand =
    requestedSubcommand === 'map' ? 'discover' : requestedSubcommand;
  if (subcommand === 'discover') {
    const options: Options = {
      ...baseOptions('spec-discover'),
      path: '.',
      json: false,
      force: false,
      interactive: false,
    };
    const positional: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (!arg) continue;
      switch (arg) {
        case '--json':
          options.json = true;
          break;
        case '--force':
          options.force = true;
          break;
        case '--write':
        case '--out':
          options.writePath = requiredValue(args, ++index, arg);
          break;
        case '--help':
        case '-h':
          throw new UsageError(helpText());
        default:
          if (arg.startsWith('-'))
            throw new UsageError(`Unknown option: ${arg}`);
          positional.push(arg);
      }
    }
    if (positional.length > 1)
      throw new UsageError('Only one repository path may be supplied.');
    if (positional[0]) options.path = positional[0];
    return options;
  }
  if (subcommand === 'validate') {
    const options: Options = {
      ...baseOptions('spec-validate'),
      path: '.',
      json: false,
      force: false,
      interactive: false,
    };
    const positional: string[] = [];
    for (const arg of args) {
      if (arg === '--json') {
        options.json = true;
        continue;
      }
      if (arg === '--help' || arg === '-h') throw new UsageError(helpText());
      if (arg.startsWith('-')) throw new UsageError(`Unknown option: ${arg}`);
      positional.push(arg);
    }
    if (positional.length > 1)
      throw new UsageError('Only one contract path may be supplied.');
    options.contractPath = positional[0] ?? '.specport/contract.json';
    return options;
  }
  if (subcommand === 'create') {
    const options: Options = {
      ...baseOptions('spec-create'),
      path: '',
      json: false,
      force: false,
      interactive: false,
    };
    const positional: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (!arg) continue;
      switch (arg) {
        case '--json':
          options.json = true;
          break;
        case '--force':
          options.force = true;
          break;
        case '--write':
        case '--out':
          options.writePath = requiredValue(args, ++index, arg);
          break;
        case '--help':
        case '-h':
          throw new UsageError(helpText());
        default:
          if (arg.startsWith('-'))
            throw new UsageError(`Unknown option: ${arg}`);
          positional.push(arg);
      }
    }
    if (positional.length !== 1)
      throw new UsageError(
        'spec create requires one input path, `-`, or inline text.',
      );
    options.path = positional[0] ?? '';
    return options;
  }
  if (subcommand === 'check') {
    const options: Options = {
      ...baseOptions('spec-check'),
      path: '',
      json: false,
      force: false,
      interactive: false,
    };
    const positional: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (!arg) continue;
      switch (arg) {
        case '--json':
          options.json = true;
          break;
        case '--force':
          options.force = true;
          break;
        case '--write':
        case '--out':
          options.writePath = requiredValue(args, ++index, arg);
          break;
        case '--help':
        case '-h':
          throw new UsageError(helpText());
        default:
          if (arg.startsWith('-'))
            throw new UsageError(`Unknown option: ${arg}`);
          positional.push(arg);
      }
    }
    if (positional.length !== 1)
      throw new UsageError('spec check requires one SPEC.md path.');
    options.path = positional[0] ?? '';
    return options;
  }
  throw new UsageError(
    'Use `spec create <input>`, `spec check <SPEC.md>`, `spec discover [path]`, or `spec validate <contract.json>`.',
  );
}

function parseSkillArgs(args: string[]): Options {
  const subcommand = args.shift() ?? 'list';
  if (subcommand === 'list') {
    const options: Options = {
      ...baseOptions('skill-list'),
      path: '.',
      json: false,
      force: false,
      interactive: false,
    };
    for (const arg of args) {
      if (arg === '--json') {
        options.json = true;
        continue;
      }
      if (arg === '--help' || arg === '-h') throw new UsageError(helpText());
      throw new UsageError(`Unknown option: ${arg}`);
    }
    return options;
  }
  if (subcommand === 'export') {
    const options: Options = {
      ...baseOptions('skill-export'),
      path: '.',
      json: false,
      force: false,
      interactive: false,
    };
    const positional: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (!arg) continue;
      switch (arg) {
        case '--json':
          options.json = true;
          break;
        case '--force':
          options.force = true;
          break;
        case '--out':
        case '--write':
          options.writePath = requiredValue(args, ++index, arg);
          break;
        case '--help':
        case '-h':
          throw new UsageError(helpText());
        default:
          if (arg.startsWith('-'))
            throw new UsageError(`Unknown option: ${arg}`);
          positional.push(arg);
      }
    }
    if (positional.length !== 1)
      throw new UsageError('skill export requires one skill name.');
    const skillName = positional[0];
    if (!skillName)
      throw new UsageError('skill export requires one skill name.');
    options.skillName = skillName;
    if (!options.writePath)
      throw new UsageError('skill export requires --out <directory>.');
    return options;
  }
  throw new UsageError(
    'Use `skill list` or `skill export <name> --out <directory>`.',
  );
}

function baseOptions(command: Options['command']): Options {
  return {
    command,
    path: '.',
    json: false,
    force: false,
    interactive: false,
  };
}

function requiredValue(
  args: readonly string[],
  index: number,
  option: string,
): string {
  const value = args[index];
  if (!value || value.startsWith('-'))
    throw new UsageError(`${option} requires a value.`);
  return value;
}

async function readExpectedScope(
  path: string,
  actual: FinalTreeSnapshot,
): Promise<ExpectedScope> {
  const absolute = isAbsolute(path)
    ? path
    : resolve(actual.repositoryPath, path);
  const parsed: unknown = JSON.parse(await readFile(absolute, 'utf8'));
  if (
    !isRecord(parsed) ||
    typeof parsed.identity !== 'string' ||
    !Array.isArray(parsed.paths)
  ) {
    throw new UsageError(
      'Expected scope must be JSON with a non-empty identity and a paths array.',
    );
  }
  const paths = parsed.paths.filter(
    (value): value is string => typeof value === 'string',
  );
  if (paths.length !== parsed.paths.length)
    throw new UsageError('Expected scope paths must all be strings.');
  const scopeRepositoryId =
    typeof parsed.repositoryId === 'string'
      ? parsed.repositoryId
      : typeof parsed.repositoryPath === 'string'
        ? repositoryIdentity(parsed.repositoryPath)
        : actual.repositoryId;
  return {
    identity: parsed.identity,
    ...(typeof parsed.repositoryPath === 'string'
      ? { repositoryPath: parsed.repositoryPath }
      : {}),
    repositoryId: scopeRepositoryId,
    ...(typeof parsed.baseCommit === 'string' || parsed.baseCommit === null
      ? { baseCommit: parsed.baseCommit }
      : {}),
    paths: normalizePathList(paths),
  };
}

function receiverDetails(
  result: CoverageResult,
  source: ReceiverSource,
  status: ReceiverBrief['status'],
  attachmentId?: string,
): ReceiverBrief {
  return {
    status,
    coverage: result.coverage,
    receiverName: source.receiverName,
    ...(source.receiverVersion
      ? { receiverVersion: source.receiverVersion }
      : {}),
    reviewId: source.reviewId,
    sourceKind: source.sourceKind,
    sourceIdentity: source.sourceIdentity ?? null,
    repositoryPath: source.repositoryPath,
    ...(source.repositoryId ? { repositoryId: source.repositoryId } : {}),
    baseCommit: source.baseCommit ?? null,
    sourceFingerprint: source.sourceFingerprint ?? null,
    ...(source.sourceFingerprintKind
      ? { sourceFingerprintKind: source.sourceFingerprintKind }
      : {}),
    reviewedPaths: result.reviewedPaths,
    reviewedChanges: source.entries,
    ...(attachmentId
      ? {
          attachment: {
            id: attachmentId,
            reviewId: source.reviewId,
            visible: true,
          },
        }
      : {}),
    unreviewedPaths: result.unreviewedPaths,
    unexpectedPaths: result.unexpectedPaths,
    changedAfterReviewPaths: result.changedAfterReviewPaths,
    identityGap: result.identityGap,
  };
}

function unknownAfterMutation(result: CoverageResult): CoverageResult {
  const { finding: _finding, ...withoutFinding } = result;
  return {
    ...withoutFinding,
    coverage: 'unknown',
    status: 'unknown',
    identityGap: [...result.identityGap, 'working-tree-mutated'],
    findings: [],
  };
}

function buildBrief(
  actual: FinalTreeSnapshot,
  result: CoverageResult,
  receiver: ReceiverBrief,
  expectedScope: ExpectedScope | undefined,
  handoff: HandoffAnswers | undefined,
  discoveredChecks: readonly DiscoveredCheck[],
): Record<string, unknown> {
  const finding = result.finding ?? result.findings[0];
  const posthoc = Boolean(handoff?.intent.trim()) && receiver.status === 'none';
  const limitations = [...result.identityGap];
  if (actual.baseKind === 'empty-tree') limitations.push('base-uncertain');
  if (result.coverage === 'unknown' && limitations.length === 0) {
    limitations.push('coverage-cannot-be-established');
  }
  const handoffBrief = handoffSummary(handoff, discoveredChecks);
  const verification = isRecord(handoffBrief.verification)
    ? handoffBrief.verification
    : verificationSummary(handoff, discoveredChecks);
  const nextActions = buildNextActions(
    actual,
    result,
    finding,
    handoff,
    discoveredChecks,
  );
  return {
    schemaVersion: VERSION,
    receiptKind: 'coverage-preflight',
    authority: posthoc ? 'ephemeral' : 'none',
    contractTiming: posthoc ? 'posthoc' : 'none',
    provenance: {
      instrumentation: 'none',
      source: 'observed-git-state',
      intentSource: posthoc ? 'user-entered' : 'unknown',
    },
    receiver,
    handoff: handoffBrief,
    reviewOrder: buildReviewOrder(actual),
    verdict: verdictFor(result, receiver, posthoc),
    coverage: result.coverage,
    scopeBasis: posthoc ? 'user-selected-after-change' : result.basis,
    comparison: {
      repositoryPath: actual.repositoryPath,
      repositoryId: actual.repositoryId,
      headCommit: actual.headCommit,
      baseCommit: actual.baseCommit,
      baseKind: actual.baseKind,
      finalTreeFingerprint: actual.fingerprint,
      stable: actual.stable,
      expectedScopeIdentity: expectedScope?.identity ?? null,
    },
    contract: null,
    changes: actual.entries,
    paths: {
      actual: result.actualPaths,
      reviewed: result.reviewedPaths,
      expected: result.expectedPaths,
      unreviewed: result.unreviewedPaths,
      unexpected: result.unexpectedPaths,
      changedAfterReview: result.changedAfterReviewPaths,
    },
    verification: [verification],
    findings: result.findings,
    limitations,
    nextActions,
    ciEligible: false,
  };
}

function handoffSummary(
  answers: HandoffAnswers | undefined,
  discoveredChecks: readonly DiscoveredCheck[],
): Record<string, unknown> {
  const intentProvided = Boolean(answers?.intent.trim());
  const scopeSelected =
    answers?.scopeSelection === 'all-displayed' ||
    answers?.scopeSelection === 'selected-subset';
  const verification = verificationSummary(answers, discoveredChecks);
  return {
    status: intentProvided ? 'posthoc' : 'incomplete',
    readiness:
      intentProvided && scopeSelected && verification.selection === 'selected'
        ? 'attachable'
        : 'incomplete',
    intent: {
      status: intentProvided ? 'provided' : 'missing',
      source: intentProvided ? 'user-entered' : 'unknown',
    },
    scope:
      intentProvided && scopeSelected
        ? 'user-selected-after-change'
        : 'observed-inventory',
    scopeSelection: answers?.scopeSelection ?? 'missing',
    reviewRequest: answers?.reviewRequest ?? 'missing',
    scopePaths: answers?.selectedPaths ?? [],
    verification,
  };
}

function verificationSummary(
  answers: HandoffAnswers | undefined,
  discoveredChecks: readonly DiscoveredCheck[],
): Record<string, unknown> {
  const declaredCheck = answers?.verification.trim() ?? '';
  const selection = declaredCheck
    ? 'selected'
    : (answers?.verificationSelection ??
      (discoveredChecks.length ? 'discovered-not-selected' : 'none'));
  return {
    declaration: declaredCheck
      ? 'user-declared'
      : discoveredChecks.length
        ? 'discovered'
        : 'absent',
    selection,
    state: 'not-run',
    stateStability: 'unknown',
    result: null,
    preRunIdentity: null,
    discoveredChecks: discoveredChecks.map((check) => check.name),
    ...(declaredCheck ? { declaredCommand: declaredCheck } : {}),
  };
}

function buildNextActions(
  actual: FinalTreeSnapshot,
  result: CoverageResult,
  finding: CoverageResult['finding'] | undefined,
  handoff: HandoffAnswers | undefined,
  discoveredChecks: readonly DiscoveredCheck[],
): Array<{ code: string; text: string }> {
  const actions: Array<{ code: string; text: string }> = [];
  const add = (code: string, text: string): void => {
    if (!actions.some((action) => action.code === code))
      actions.push({ code, text });
  };
  if (finding) add(finding.nextActionCode, finding.nextAction);
  if (result.coverage === 'unknown' && !finding) {
    add(
      'provide-comparison-basis',
      'Supply an exact receiver source or an approved expected scope, then run coverage again.',
    );
  }
  if (actual.baseKind === 'empty-tree') {
    add(
      'base-invalid',
      'Select or create a committed comparison base before treating this inventory as a bounded change.',
    );
  }
  if (actual.entries.length > 20) {
    add(
      'broad-scope',
      'Review the broad change surface in groups before approval; the first-review list is intentionally capped.',
    );
  }
  if (handoff) {
    if (!handoff.intent.trim()) {
      add(
        'incomplete-intent',
        'Provide one sentence describing the intended outcome before treating the handoff as post-hoc context.',
      );
    }
    if (
      handoff.scopeSelection !== 'all-displayed' &&
      handoff.scopeSelection !== 'selected-subset'
    ) {
      add(
        'incomplete-scope',
        'Choose all displayed paths or a concrete subset before relying on the handoff scope.',
      );
    }
    if (
      handoff.verification.trim() ||
      handoff.verificationSelection === 'explicitly-skipped' ||
      discoveredChecks.length > 0
    ) {
      add(
        'not-run',
        'The declared or discovered project check was not run by the v0.1 spike; run it separately and review its result.',
      );
    }
  }
  return actions;
}

function buildReviewOrder(
  actual: FinalTreeSnapshot,
): Array<Record<string, string>> {
  return actual.entries.slice(0, 20).map((entry) => ({
    targetKind: 'path',
    target: entry.path,
    reasonCode: reasonForPath(entry, actual),
    nextActionCode: 'inspect-path',
    nextAction: `Inspect ${entry.path} before approval.`,
  }));
}

function reasonForPath(
  entry: FinalTreeSnapshot['entries'][number],
  actual: FinalTreeSnapshot,
): string {
  const path = entry.path;
  if (actual.baseCommit === null) return 'base-uncertain';
  if (
    entry.status === 'untracked' ||
    entry.state?.index === '?' ||
    entry.state?.worktree === '?'
  )
    return 'untracked';
  if (entry.status === 'deleted') return 'delete';
  if (entry.status === 'renamed') return 'renamed';
  if (path === 'package.json' || path === 'package-lock.json')
    return 'dependency-change';
  if (path.startsWith('.github/') || path.includes('/workflows/'))
    return 'workflow-change';
  if (
    path.startsWith('.env') ||
    path.includes('secret') ||
    path.includes('credential')
  )
    return 'sensitive-path';
  if (actual.entries.length > 20) return 'large-surface';
  return 'changed-path';
}

function verdictFor(
  result: CoverageResult,
  receiver: ReceiverBrief,
  posthoc: boolean,
): string {
  if (receiver.status === 'adapter-unavailable') return 'adapter-unavailable';
  if (posthoc) return 'review-required';
  if (result.basis === 'unavailable') return 'inventory-only';
  if (result.coverage === 'complete') return 'clean';
  return 'review-required';
}

async function writeResult(
  options: Options,
  brief: Record<string, unknown>,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  const json = `${JSON.stringify(brief, null, 2)}\n`;
  const markdown = renderMarkdown(brief);
  if (options.writePath) {
    const target = isAbsolute(options.writePath)
      ? options.writePath
      : resolve(options.path, options.writePath);
    await assertDisposableWriteTarget(target, brief);
    const fileContent =
      options.json || !target.toLowerCase().endsWith('.md') ? json : markdown;
    if (!options.force) {
      try {
        await access(target);
        throw new OutputError(`Refusing to overwrite ${target}; pass --force.`);
      } catch (error) {
        if (error instanceof OutputError) throw error;
      }
    }
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, fileContent, 'utf8');
    } catch (error) {
      throw new OutputError(
        `Could not write ${target}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (options.json) {
    stdout.write(json);
  } else {
    stdout.write(renderHuman(brief));
    if (options.writePath) stdout.write(`WROTE      ${options.writePath}\n`);
  }
}

async function writeSpecArtifact(
  options: Options,
  spec: Awaited<ReturnType<typeof discoverRepositorySpec>>,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  const json = `${JSON.stringify(spec, null, 2)}\n`;
  const markdown = renderRepositoryBaselineMarkdown(spec);
  if (options.writePath) {
    const target = isAbsolute(options.writePath)
      ? options.writePath
      : resolve(options.path, options.writePath);
    if (!options.force) {
      try {
        await access(target);
        throw new OutputError(`Refusing to overwrite ${target}; pass --force.`);
      } catch (error) {
        if (error instanceof OutputError) throw error;
      }
    }
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, options.json ? json : markdown, 'utf8');
    } catch (error) {
      throw new OutputError(
        `Could not write ${target}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  stdout.write(options.json ? json : markdown);
}

async function writeSpecDraftArtifact(
  options: Options,
  draft: Awaited<ReturnType<typeof createSpecDraft>>,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  const json = `${JSON.stringify(draft, null, 2)}\n`;
  const markdown = renderSpecDraftMarkdown(draft);
  let wroteTarget: string | undefined;
  if (options.writePath) {
    const target = isAbsolute(options.writePath)
      ? options.writePath
      : resolve(options.writePath);
    await writeSpecOutput(
      target,
      options.json ? json : markdown,
      options.force,
    );
    wroteTarget = target;
  }
  stdout.write(options.json ? json : markdown);
  if (!options.json && wroteTarget) stdout.write(`WROTE      ${wroteTarget}\n`);
}

async function writeSpecCheckArtifact(
  options: Options,
  result: Awaited<ReturnType<typeof checkSpecFile>>,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  const json = `${JSON.stringify(result, null, 2)}\n`;
  const human = renderSpecCheckHuman(result);
  let wroteTarget: string | undefined;
  if (options.writePath) {
    const target = isAbsolute(options.writePath)
      ? options.writePath
      : resolve(options.writePath);
    await writeSpecOutput(target, options.json ? json : human, options.force);
    wroteTarget = target;
  }
  stdout.write(options.json ? json : human);
  if (!options.json && wroteTarget) stdout.write(`WROTE      ${wroteTarget}\n`);
}

async function writeSpecOutput(
  target: string,
  content: string,
  force: boolean,
): Promise<void> {
  if (!force) {
    try {
      await access(target);
      throw new OutputError(`Refusing to overwrite ${target}; pass --force.`);
    } catch (error) {
      if (error instanceof OutputError) throw error;
    }
  }
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  } catch (error) {
    throw new OutputError(
      `Could not write ${target}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function writeContractValidation(
  options: Options,
  contractPath: string,
  validation: Awaited<ReturnType<typeof readAndValidateProductContract>>,
  stdout: NodeJS.WritableStream,
): void {
  const brief = {
    schemaVersion: VERSION,
    artifactKind: 'contract-validation',
    contractPath,
    valid: validation.valid,
    issues: validation.issues,
  };
  if (options.json) {
    stdout.write(`${JSON.stringify(brief, null, 2)}\n`);
    return;
  }
  const lines = [
    `CONTRACT  ${validation.valid ? 'valid' : 'invalid'}`,
    `FILE      ${contractPath}`,
    ...(validation.issues.length
      ? validation.issues.map(
          (item) => `ISSUE     ${item.path}: ${item.message}`,
        )
      : ['ISSUE     none']),
  ];
  stdout.write(`${lines.join('\n')}\n`);
}

interface SkillInfo {
  name: string;
  description: string;
}

interface SkillExportResult {
  schemaVersion: string;
  artifactKind: 'skill-export';
  name: string;
  source: string;
  target: string;
  files: readonly string[];
}

async function discoverSkills(): Promise<readonly SkillInfo[]> {
  const root = skillsRoot();
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Skill catalog is unavailable at ${root}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(root, entry.name, 'SKILL.md');
    try {
      const text = await readFile(skillPath, 'utf8');
      const description =
        /^description:\s*(.+)$/im.exec(text)?.[1]?.trim() ??
        'No description declared.';
      skills.push({
        name: entry.name,
        description: description.replace(/^['"]|['"]$/g, ''),
      });
    } catch {
      // A directory without a SKILL.md is not an exportable skill.
    }
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

async function exportSkill(
  name: string,
  requestedTarget: string,
  force: boolean,
): Promise<SkillExportResult> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    throw new UsageError(`Invalid skill name: ${name}`);
  const source = join(skillsRoot(), name);
  const sourceSkills = await discoverSkills();
  if (!sourceSkills.some((skill) => skill.name === name))
    throw new UsageError(`Unknown skill: ${name}`);
  const target = isAbsolute(requestedTarget)
    ? requestedTarget
    : resolve(requestedTarget);
  const sourceToTarget = relative(source, target);
  const targetIsInsideSource =
    sourceToTarget !== '' &&
    !sourceToTarget.startsWith('..') &&
    !isAbsolute(sourceToTarget);
  if (!sourceToTarget || targetIsInsideSource)
    throw new UsageError(
      'Skill export target must not be the skill source or a child of it.',
    );
  if (!force) {
    try {
      await access(target);
      throw new OutputError(`Refusing to overwrite ${target}; pass --force.`);
    } catch (error) {
      if (error instanceof OutputError) throw error;
      if (!isMissingPathError(error))
        throw new OutputError(
          `Could not inspect ${target}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  }
  try {
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, force });
  } catch (error) {
    throw new OutputError(
      `Could not export ${name} to ${target}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    schemaVersion: VERSION,
    artifactKind: 'skill-export',
    name,
    source,
    target,
    files: await listRelativeFiles(source),
  };
}

function writeSkillList(
  options: Options,
  skills: readonly SkillInfo[],
  stdout: NodeJS.WritableStream,
): void {
  const payload = {
    schemaVersion: VERSION,
    artifactKind: 'skill-list',
    skills,
  };
  if (options.json) {
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  stdout.write(
    `SKILLS     ${skills.length}\n${skills
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join('\n')}\n`,
  );
}

function writeSkillExport(
  options: Options,
  result: SkillExportResult,
  stdout: NodeJS.WritableStream,
): void {
  if (options.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  stdout.write(
    `EXPORTED   ${result.name}\nTARGET     ${result.target}\nFILES      ${result.files.length}\n`,
  );
}

function skillsRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
}

async function listRelativeFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  await collectFiles(root, root, files);
  return files.sort();
}

async function collectFiles(
  root: string,
  current: string,
  files: string[],
): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, absolute, files);
    } else if (entry.isFile()) {
      files.push(relative(root, absolute).replaceAll('\\', '/'));
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function renderHuman(brief: Record<string, unknown>): string {
  const coverage = String(brief.coverage);
  const receiver = isRecord(brief.receiver) ? brief.receiver : {};
  const handoff = isRecord(brief.handoff) ? brief.handoff : {};
  const verification = isRecord(handoff.verification)
    ? handoff.verification
    : {};
  const paths = isRecord(brief.paths) ? brief.paths : {};
  const actual = arrayValue(paths.actual);
  const unreviewed = arrayValue(paths.unreviewed);
  const unexpected = arrayValue(paths.unexpected);
  const changed = arrayValue(paths.changedAfterReview);
  const reviewOrder = recordArray(brief.reviewOrder);
  const firstPaths = reviewOrder
    .slice(0, 3)
    .map((entry) => String(entry.target ?? ''))
    .filter(Boolean);
  const next = nextActionValues(brief.nextActions);
  const lines = [
    `HANDOFF    ${String(handoff.status ?? 'incomplete')}`,
    `VERDICT    ${String(brief.verdict ?? 'unknown')}`,
    `AUTHORITY  ${String(brief.authority ?? 'none')}`,
    `CHANGED    ${actual.length} path${actual.length === 1 ? '' : 's'}`,
    `FIRST      ${firstPaths.length ? firstPaths.join(', ') : '(none)'}`,
    `CHECK      ${String(verification.state ?? 'not-run')}`,
    `NEXT       ${next[0]?.text ?? 'none'}`,
    `RECEIVER    ${String(receiver.status ?? 'none')}${receiver.reviewId ? ` | ${String(receiver.reviewId)}` : ''}`,
    `COVERAGE   ${coverage}`,
  ];
  if (unreviewed.length) lines.push(`UNREVIEWED  ${unreviewed.join(', ')}`);
  if (unexpected.length) lines.push(`UNEXPECTED   ${unexpected.join(', ')}`);
  if (changed.length) lines.push(`CHANGED     ${changed.join(', ')}`);
  const limitations = arrayValue(brief.limitations);
  if (limitations.length) lines.push(`LIMITATION  ${limitations.join('; ')}`);
  return `${lines.join('\n')}\n`;
}

function renderMarkdown(brief: Record<string, unknown>): string {
  const paths = isRecord(brief.paths) ? brief.paths : {};
  const receiver = isRecord(brief.receiver) ? brief.receiver : {};
  const comparison = isRecord(brief.comparison) ? brief.comparison : {};
  const handoff = isRecord(brief.handoff) ? brief.handoff : {};
  const verification = isRecord(handoff.verification)
    ? handoff.verification
    : {};
  const actual = arrayValue(paths.actual);
  const unreviewed = arrayValue(paths.unreviewed);
  const unexpected = arrayValue(paths.unexpected);
  const next = nextActionValues(brief.nextActions);
  const lines = [
    '# SpecPort Coverage',
    '',
    '## Verdict',
    '',
    `- Verdict: \`${String(brief.verdict ?? 'unknown')}\``,
    `- Coverage: \`${String(brief.coverage ?? 'unknown')}\``,
    `- Authority: \`${String(brief.authority ?? 'none')}\``,
    `- Handoff: \`${String(handoff.status ?? 'incomplete')}\``,
    `- Receiver: \`${String(receiver.status ?? 'none')}\`${receiver.reviewId ? ` (${String(receiver.reviewId)})` : ''}`,
    `- Check: \`${String(verification.state ?? 'not-run')}\``,
    '',
    '## Changed paths',
    '',
    ...markdownList(actual),
    '',
    '## Coverage details',
    '',
    `- Repository: \`${String(comparison.repositoryId ?? 'unknown')}\``,
    `- Base: \`${String(comparison.baseCommit ?? comparison.baseKind ?? 'unknown')}\``,
    `- Unreviewed: ${unreviewed.length ? unreviewed.join(', ') : 'none'}`,
    `- Unexpected: ${unexpected.length ? unexpected.join(', ') : 'none'}`,
    `- Identity gaps: ${arrayValue(receiver.identityGap).length ? arrayValue(receiver.identityGap).join(', ') : 'none'}`,
    '',
    '## Findings',
    '',
    ...markdownFindings(brief.findings),
    '',
    '## Limitations',
    '',
    ...markdownList(arrayValue(brief.limitations)),
    '',
    '## Next actions',
    '',
    ...(next.length
      ? next.map((action) => `- \`${action.code}\`: ${action.text}`)
      : ['- None']),
    '',
    '## Stable brief',
    '',
    'The fenced JSON below is the complete machine-readable brief represented by this artifact.',
    '',
    '```json',
    JSON.stringify(brief, null, 2),
    '```',
  ];
  return `${lines.join('\n')}\n`;
}

async function assertDisposableWriteTarget(
  target: string,
  brief: Record<string, unknown>,
): Promise<void> {
  const comparison = isRecord(brief.comparison) ? brief.comparison : {};
  const repositoryPath =
    typeof comparison.repositoryPath === 'string'
      ? comparison.repositoryPath
      : undefined;
  if (!repositoryPath) return;
  const repoRelative = relative(repositoryPath, target).replaceAll(sep, '/');
  if (
    !repoRelative ||
    repoRelative === '..' ||
    repoRelative.startsWith('../') ||
    repoRelative.startsWith('/')
  ) {
    return;
  }
  const lower = repoRelative.toLowerCase();
  if (
    lower === '.specport/contracts' ||
    lower.startsWith('.specport/contracts/')
  ) {
    throw new OutputError(
      'Quick coverage must not write .specport/contracts; use a disposable evidence path.',
    );
  }
  const tracked = await tryRunGit(repositoryPath, [
    'ls-files',
    '--error-unmatch',
    '--',
    repoRelative,
  ]);
  if (tracked?.trim()) {
    throw new OutputError(
      `Refusing to overwrite tracked repository file ${repoRelative}; choose a disposable evidence path.`,
    );
  }
}

function markdownFindings(value: unknown): string[] {
  const findings = recordArray(value);
  return findings.length
    ? findings.map((finding) => {
        const code = String(finding.code ?? 'finding');
        const title = String(finding.title ?? 'Review finding');
        const paths = arrayValue(finding.paths);
        return `- \`${code}\`: ${title}${paths.length ? ` (${paths.join(', ')})` : ''}`;
      })
    : ['- None'];
}

function markdownList(values: readonly string[]): string[] {
  return values.length ? values.map((value) => `- \`${value}\``) : ['- None'];
}

function nextActionValues(
  value: unknown,
): Array<{ code: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return [{ code: 'next', text: item }];
    if (!isRecord(item)) return [];
    if (typeof item.code !== 'string' || typeof item.text !== 'string')
      return [];
    return [{ code: item.code, text: item.text }];
  });
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

async function discoverChecks(
  repositoryPath: string,
): Promise<DiscoveredCheck[]> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(repositoryPath, 'package.json'), 'utf8'),
    );
    if (!isRecord(parsed) || !isRecord(parsed.scripts)) return [];
    return Object.keys(parsed.scripts)
      .filter((name) =>
        /(^|:)(test|lint|typecheck|check|verify|build|ci)(:|$)/i.test(name),
      )
      .sort()
      .map((name) => ({ name, command: `npm run ${name}` }));
  } catch {
    return [];
  }
}

function renderInteractivePreview(
  actual: FinalTreeSnapshot,
  result: CoverageResult,
  receiver: ReceiverBrief,
  discoveredChecks: readonly DiscoveredCheck[],
): string {
  const reviewOrder = buildReviewOrder(actual);
  const highImpact = [
    ...new Set(
      actual.entries
        .map((entry) => reasonForPath(entry, actual))
        .filter((reason) => reason !== 'changed-path'),
    ),
  ];
  if (actual.entries.length > 20 && !highImpact.includes('broad-scope')) {
    highImpact.push('broad-scope');
  }
  const inventory = actual.entries.length
    ? actual.entries.map((entry) => {
        const state = entry.state
          ? ` index=${entry.state.index} worktree=${entry.state.worktree}`
          : '';
        const rename = entry.oldPath ? ` from ${entry.oldPath}` : '';
        return `  - ${entry.path} [${entry.status}${rename}]${state}`;
      })
    : ['  - (none)'];
  const firstReview = reviewOrder
    .slice(0, 3)
    .map((entry) => String(entry.target ?? ''))
    .filter(Boolean);
  const checkText = discoveredChecks.length
    ? discoveredChecks.map((check) => check.command).join(', ')
    : 'none discovered';
  return [
    'SCAN PREVIEW',
    `BASE       ${actual.baseCommit ?? 'empty-tree'} (${actual.baseKind}; ${actual.stable ? 'stable' : 'unstable'})`,
    `COVERAGE   ${result.coverage} | RECEIVER ${receiver.status}`,
    `CHANGED    ${actual.entries.length} path${actual.entries.length === 1 ? '' : 's'}`,
    'INVENTORY',
    ...inventory,
    `HIGH-IMPACT ${highImpact.length ? highImpact.join(', ') : 'none'}`,
    'HANDOFF    incomplete | readiness incomplete',
    `REVIEW     ${firstReview.length ? firstReview.join(', ') : '(none)'}`,
    `CHECKS     ${checkText} (not run by the spike)`,
    'NEXT       Answer intent, scope/reviewer request, and one check (or skip).',
    '',
  ].join('\n');
}

async function collectHandoff(
  actual: FinalTreeSnapshot,
  stdout: NodeJS.WritableStream,
  stdin: NodeJS.ReadableStream,
  prompt?: (question: string) => Promise<string>,
  discoveredChecks: readonly DiscoveredCheck[] = [],
): Promise<HandoffAnswers> {
  if (!prompt && !(stdin as NodeJS.ReadStream).isTTY)
    throw new UsageError('--interactive requires a TTY.');
  const readline = prompt ? undefined : await import('node:readline/promises');
  const rl = readline?.createInterface({ input: stdin, output: stdout });
  const ask =
    prompt ??
    ((question: string) =>
      rl?.question(question) ??
      Promise.reject(new Error('readline was closed')));
  try {
    const intent = (
      await ask('Intended outcome (one sentence, or blank): ')
    ).trim();
    const scopeAnswer = (
      await ask(
        `Scope and reviewer request (${actual.entries.length} paths; all | subset:path1,path2 | unresolved; request/skip): `,
      )
    ).trim();
    const scope = parseScopeAnswer(scopeAnswer, actual);
    const verification = (
      await ask(
        discoveredChecks.length
          ? `Check to declare (${discoveredChecks.map((check) => check.name).join(', ')}; blank to skip): `
          : 'Check to declare (none discovered; blank to skip): ',
      )
    ).trim();
    return {
      intent,
      scopeSelection: scope.selection,
      reviewRequest: scopeAnswer.includes('request')
        ? 'user-selected'
        : scopeAnswer
          ? 'generated-order'
          : 'missing',
      verification,
      verificationSelection: verification
        ? 'selected'
        : discoveredChecks.length
          ? 'explicitly-skipped'
          : 'none',
      selectedPaths: scope.selectedPaths,
    };
  } finally {
    rl?.close();
  }
}

function parseScopeAnswer(
  value: string,
  actual: FinalTreeSnapshot,
): {
  selection: HandoffAnswers['scopeSelection'];
  selectedPaths: readonly string[];
} {
  const actualPaths = pathsForEntries(actual.entries);
  const lower = value.toLowerCase();
  if (lower.startsWith('all')) {
    return { selection: 'all-displayed', selectedPaths: actualPaths };
  }
  if (lower.startsWith('unresolved')) {
    return { selection: 'unresolved', selectedPaths: [] };
  }
  if (!lower.startsWith('subset')) {
    return { selection: 'missing', selectedPaths: [] };
  }
  const rawSubset = value
    .replace(/^subset\s*:?/i, '')
    .replace(/^subset\s*:?”?/i, '')
    .replace(/^subset\s*:?/i, '')
    .replace(/\b(request|skip)\b/gi, ' ')
    .trim();
  const candidates = rawSubset
    .split(rawSubset.includes(',') ? ',' : /\s+/)
    .map((candidate) => candidate.trim())
    .map((candidate) => candidate.replace(/[;]+$/g, ''))
    .filter(Boolean);
  let selectedPaths: string[];
  try {
    selectedPaths = normalizePathList(candidates);
  } catch {
    return { selection: 'unresolved', selectedPaths: [] };
  }
  const actualSet = new Set(actualPaths);
  if (
    selectedPaths.length === 0 ||
    selectedPaths.some((path) => !actualSet.has(path))
  ) {
    return { selection: 'unresolved', selectedPaths: [] };
  }
  return { selection: 'selected-subset', selectedPaths };
}

function arrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function helpText(): string {
  return `SpecPort ${VERSION} - catch unreviewed files before approval.

Usage:
  specport coverage [path] [options]
  specport review --quick [path] [options]  (legacy alias)
  specport spec create <input> [--out SPEC.md] [--json] [--force]
  specport spec check <SPEC.md> [--json] [--write REPORT]
  specport spec discover [path] [--out SPEC.md] [--json] [--force]
  specport spec validate [contract.json] [--json]
  specport skill list [--json]
  specport skill export <name> --out <directory> [--json] [--force]
  specport create <input> ...  (alias)
  specport check <SPEC.md> ... (alias)
  specport map [path] ...       (alias of spec discover)
  specport --version

Spec workflows:
  spec create      turn text into a deterministic draft while preserving source
  spec check       check a spec for implementability and explicit human decisions
  spec discover    generate a grounded repository baseline; it is a draft, not intent
  spec validate    validate a human-owned product contract before implementation
  skill list       list the packaged agent playbooks
  skill export     copy one playbook to a host agent's skill directory

Options:
  --receiver githuman       compare with an existing local GitHuman review
  --review <id|last>         pin the receiver review (required for scripts)
  --expected-scope <file>    compare against JSON {identity, paths[]}
  --base <ref>               choose the Git comparison base
  --json                     print the complete machine-readable result
  --write <file>             save JSON, or Markdown for a .md target
  --force                    allow replacing --write target
  --interactive              optional post-hoc handoff questions
  --receiver-url <url>       explicit local receiver URL

Exit codes:
  0  diagnostic completed or exact coverage is complete
  2  usage, Git, or input error
  4  requested output could not be written
  5  coverage is partial or cannot be established
  7  requested receiver is unavailable or could not consume a finding
`;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

class OutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutputError';
  }
}

const isEntrypoint =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `specport: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 2;
    });
}
