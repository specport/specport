import { readFile } from 'node:fs/promises';

export interface ContractValidationIssue {
  path: string;
  message: string;
}

export interface ContractValidationResult {
  valid: boolean;
  issues: readonly ContractValidationIssue[];
}

export async function readAndValidateProductContract(
  path: string,
): Promise<ContractValidationResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    return {
      valid: false,
      issues: [
        {
          path: '$',
          message:
            error instanceof SyntaxError
              ? 'The contract is not valid JSON.'
              : `The contract could not be read: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  return validateProductContract(parsed);
}

export function validateProductContract(
  value: unknown,
): ContractValidationResult {
  const issues: ContractValidationIssue[] = [];
  const root = recordAt(value, '$', issues);
  if (!root) return result(issues);

  requireNonEmptyString(root, 'contractVersion', '$', issues);
  requireLiteral(root, 'kind', 'product-contract', '$', issues);
  requireNonEmptyString(root, 'id', '$', issues);
  requireNonEmptyString(root, 'title', '$', issues);

  const intent = recordAt(root.intent, '$.intent', issues);
  if (intent) {
    requireNonEmptyString(intent, 'owner', '$.intent', issues);
    requireNonEmptyString(intent, 'userJob', '$.intent', issues);
    requireNonEmptyString(intent, 'outcome', '$.intent', issues);
    requireStringArray(intent, 'nonGoals', '$.intent', issues);
  }

  requireStringArray(root, 'constraints', '$', issues);
  validateAcceptance(root.acceptance, issues);
  validateVerification(root.verification, issues);
  validateTaste(root.taste, issues);
  validateRelease(root.release, issues);
  validateOptionalStringArray(
    root.boundaries,
    'allowedPaths',
    '$.boundaries',
    issues,
  );
  validateOptionalStringArray(
    root.boundaries,
    'forbiddenPaths',
    '$.boundaries',
    issues,
  );

  return result(issues);
}

function validateAcceptance(
  value: unknown,
  issues: ContractValidationIssue[],
): void {
  const items = arrayAt(value, '$.acceptance', issues);
  if (!items) return;
  if (!items.length)
    issue(issues, '$.acceptance', 'must contain at least one criterion.');
  items.forEach((item, index) => {
    const path = `$.acceptance[${index}]`;
    const record = recordAt(item, path, issues);
    if (!record) return;
    requireNonEmptyString(record, 'id', path, issues);
    requireNonEmptyString(record, 'statement', path, issues);
    requireNonEmptyStringArray(record, 'evidence', path, issues);
    validateOptionalString(record, 'risk', path, issues);
  });
}

function validateVerification(
  value: unknown,
  issues: ContractValidationIssue[],
): void {
  const items = arrayAt(value, '$.verification', issues);
  if (!items) return;
  if (!items.length)
    issue(issues, '$.verification', 'must contain at least one check.');
  items.forEach((item, index) => {
    const path = `$.verification[${index}]`;
    const record = recordAt(item, path, issues);
    if (!record) return;
    requireNonEmptyString(record, 'id', path, issues);
    requireNonEmptyString(record, 'command', path, issues);
    requireNonEmptyString(record, 'purpose', path, issues);
    validateOptionalString(record, 'environment', path, issues);
  });
}

function validateTaste(
  value: unknown,
  issues: ContractValidationIssue[],
): void {
  const taste = recordAt(value, '$.taste', issues);
  if (!taste) return;
  requireBoolean(taste, 'required', '$.taste', issues);
  requireNonEmptyString(taste, 'reviewer', '$.taste', issues);
  requireStringArray(taste, 'rubric', '$.taste', issues);
  if (taste.required === true) {
    requireNonEmptyStringArray(taste, 'rubric', '$.taste', issues);
  }
}

function validateRelease(
  value: unknown,
  issues: ContractValidationIssue[],
): void {
  const release = recordAt(value, '$.release', issues);
  if (!release) return;
  requireNonEmptyString(release, 'target', '$.release', issues);
  requireNonEmptyString(release, 'version', '$.release', issues);
  requireNonEmptyStringArray(release, 'readiness', '$.release', issues);
  validateOptionalStringArray(release, 'rollback', '$.release', issues);
}

function validateOptionalStringArray(
  parentValue: unknown,
  key: string,
  parentPath: string,
  issues: ContractValidationIssue[],
): void {
  if (!isRecord(parentValue) || parentValue[key] === undefined) return;
  requireStringArray(parentValue, key, parentPath, issues);
}

function validateOptionalString(
  parent: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: ContractValidationIssue[],
): void {
  if (parent[key] !== undefined) requireString(parent, key, parentPath, issues);
}

function requireLiteral(
  parent: Record<string, unknown>,
  key: string,
  expected: string,
  parentPath: string,
  issues: ContractValidationIssue[],
): void {
  if (parent[key] !== expected)
    issue(issues, `${parentPath}.${key}`, `must equal "${expected}".`);
}

function requireString(
  parent: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: ContractValidationIssue[],
): void {
  if (typeof parent[key] !== 'string')
    issue(issues, `${parentPath}.${key}`, 'must be a string.');
}

function requireNonEmptyString(
  parent: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: ContractValidationIssue[],
): void {
  if (typeof parent[key] !== 'string' || parent[key].trim() === '')
    issue(issues, `${parentPath}.${key}`, 'must be a non-empty string.');
}

function requireBoolean(
  parent: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: ContractValidationIssue[],
): void {
  if (typeof parent[key] !== 'boolean')
    issue(issues, `${parentPath}.${key}`, 'must be a boolean.');
}

function requireStringArray(
  parent: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: ContractValidationIssue[],
): void {
  const value = parent[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    issue(issues, `${parentPath}.${key}`, 'must be an array of strings.');
}

function requireNonEmptyStringArray(
  parent: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: ContractValidationIssue[],
): void {
  const value = parent[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || item.trim() === '')
  )
    issue(
      issues,
      `${parentPath}.${key}`,
      'must contain at least one non-empty string.',
    );
}

function recordAt(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  issue(issues, path, 'must be an object.');
  return null;
}

function arrayAt(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): readonly unknown[] | null {
  if (Array.isArray(value)) return value;
  issue(issues, path, 'must be an array.');
  return null;
}

function issue(
  issues: ContractValidationIssue[],
  path: string,
  message: string,
): void {
  issues.push({ path, message });
}

function result(
  issues: readonly ContractValidationIssue[],
): ContractValidationResult {
  return { valid: issues.length === 0, issues };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
