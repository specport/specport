import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkSpecFile,
  createSpecDraft,
  renderSpecDraftMarkdown,
} from '../src/spec/authoring.js';
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
    expect(result.issues.some((issue) => issue.path === '$.provenance')).toBe(
      true,
    );
    expect(
      result.issues.some((issue) => issue.path === '$.intent.outcome'),
    ).toBe(true);
    expect(result.issues.some((issue) => issue.path === '$.acceptance')).toBe(
      true,
    );
    expect(
      result.issues.some((issue) => issue.path === '$.taste.reviewer'),
    ).toBe(true);
    expect(
      result.issues.some((issue) => issue.path === '$.release.compatibility'),
    ).toBe(true);
  });

  it('turns arbitrary input into a provenance-preserving draft', async () => {
    const draft = await createSpecDraft(
      '# A small import tool\n\nIt should help a maintainer move data safely.\n',
    );
    const markdown = renderSpecDraftMarkdown(draft);

    expect(draft.specKind).toBe('authoring-draft');
    expect(draft.status).toBe('draft');
    expect(draft.source.kind).toBe('inline');
    expect(draft.source.headings).toEqual(['A small import tool']);
    expect(draft.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(markdown).toContain('Source SHA-256');
    expect(markdown).toContain('It should help a maintainer move data safely.');
    expect(markdown).toContain('[NEEDS HUMAN INPUT]');
  });

  it('distinguishes a grounded draft from an accepted, checkable spec', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'specport-authoring-'));
    try {
      const draftPath = join(directory, 'draft.md');
      const acceptedPath = join(directory, 'accepted.md');
      await writeFile(
        draftPath,
        renderSpecDraftMarkdown(
          await createSpecDraft('## Notes\n\nKeep the workflow small.\n'),
        ),
        'utf8',
      );
      await writeFile(
        acceptedPath,
        [
          '# Product spec',
          '',
          'Status: accepted',
          'Source: maintainer interview and repository evidence',
          '',
          '## Intent',
          '',
          'The owner is the maintainer. The user job is safe import.',
          '',
          '## Workflow',
          '',
          'The user previews the import and can cancel before writing.',
          '',
          '## Acceptance',
          '',
          'AC-001: Given a valid file, when import is confirmed, then the records are written.',
          '',
          '## Verification',
          '',
          'Check: `npm test`',
          '',
          '## Taste and human review',
          '',
          'Reviewer: maintainer',
          'Rubric: clear, reversible, and understandable under pressure.',
          '',
          '## Release',
          '',
          'Release target and artifact: npm package.',
          'Compatibility: Node 20 and newer. Rollback: previous package version.',
          '',
        ].join('\n'),
        'utf8',
      );

      const draftResult = await checkSpecFile(draftPath);
      const acceptedResult = await checkSpecFile(acceptedPath);

      expect(draftResult.readiness).toBe('draft');
      expect(draftResult.accepted).toBe(false);
      expect(draftResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'unresolved-input' }),
          expect.objectContaining({ code: 'not-accepted' }),
        ]),
      );
      expect(acceptedResult).toEqual(
        expect.objectContaining({
          readiness: 'ready',
          accepted: true,
          issues: [],
        }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
