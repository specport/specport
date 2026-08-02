import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validateProductContract } from '../src/spec/contract.js';
import {
  discoverRepositorySpec,
  renderRepositoryBaselineMarkdown,
} from '../src/spec/repository.js';

describe('SpecPort contract workflow', () => {
  it('discovers a grounded baseline without claiming accepted intent', async () => {
    const spec = await discoverRepositorySpec(process.cwd());

    expect(spec.specKind).toBe('repository-baseline');
    expect(spec.status).toBe('draft');
    expect(spec.project.name).toBe('@specport/specport');
    expect(spec.project.checks.some((check) => check.name === 'test')).toBe(
      true,
    );
    expect(spec.contract.intent).toBe('missing');
    expect(spec.gaps.some((gap) => gap.includes('human input'))).toBe(true);

    const markdown = renderRepositoryBaselineMarkdown(spec);
    expect(markdown).toContain('# Repository Contract Draft');
    expect(markdown).toContain('[NEEDS HUMAN INPUT]');
    expect(markdown).toContain('Machine-readable baseline');
  });

  it('accepts the documented product contract shape', async () => {
    const example = JSON.parse(
      await readFile('examples/product-contract.json', 'utf8'),
    ) as unknown;

    expect(validateProductContract(example)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('reports missing contract fields instead of guessing them', () => {
    const result = validateProductContract({
      kind: 'product-contract',
      title: 'Incomplete',
      intent: {},
      acceptance: [],
      verification: [],
      taste: { required: true, reviewer: '', rubric: [] },
      release: {},
    });

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.path === '$.contractVersion'),
    ).toBe(true);
    expect(
      result.issues.some((issue) => issue.path === '$.intent.outcome'),
    ).toBe(true);
    expect(result.issues.some((issue) => issue.path === '$.acceptance')).toBe(
      true,
    );
    expect(
      result.issues.some((issue) => issue.path === '$.taste.reviewer'),
    ).toBe(true);
  });
});
