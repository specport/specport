import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  type GitHubFetchInit,
  type GitHubFetchResponse,
  type GitHubSpecFetch,
  GitHubSpecPullError,
  parseGitHubSpecReference,
  pullGitHubSpec,
} from '../src/spec/pull.js';

const commit = '0123456789abcdef0123456789abcdef01234567';

describe('GitHub spec pull', () => {
  it('parses an exact source and defaults the path to SPEC.md', () => {
    expect(parseGitHubSpecReference('acme/ledger@release/v2')).toEqual({
      source: 'acme/ledger@release/v2',
      canonicalSource: 'acme/ledger@release/v2:SPEC.md',
      owner: 'acme',
      repository: 'ledger',
      ref: 'release/v2',
      path: 'SPEC.md',
    });

    expect(parseGitHubSpecReference('acme/ledger@main:docs/SPEC.md').path).toBe(
      'docs/SPEC.md',
    );
  });

  it.each([
    'acme/ledger@main:../SECRET.md',
    'acme/ledger@main:docs/../../SECRET.md',
    'acme/ledger@main:/absolute/SPEC.md',
    'acme/ledger@main:docs\\SPEC.md',
    'acme/ledger@main:%2e%2e/SECRET.md',
    'acme/ledger@main:docs//SPEC.md',
  ])('rejects unsafe path syntax before any request: %s', (source) => {
    expect(() => parseGitHubSpecReference(source)).toThrowError(
      expect.objectContaining<Partial<GitHubSpecPullError>>({
        code: 'unsafe-path',
      }),
    );
  });

  it('resolves the ref first and fetches content from the resolved commit', async () => {
    const requested: Array<{ url: string; init: GitHubFetchInit }> = [];
    const rawContent = '# Ledger contract\n\nShip only with evidence.\n';
    const fetcher: GitHubSpecFetch = async (url, init) => {
      requested.push({ url, init });
      const parsed = new URL(url);
      if (parsed.pathname === '/repos/acme/ledger') {
        return jsonResponse({
          full_name: 'acme/ledger',
          html_url: 'https://github.com/acme/ledger',
          default_branch: 'main',
          private: false,
          archived: false,
          license: {
            key: 'mit',
            name: 'MIT License',
            spdx_id: 'MIT',
            url: 'https://choosealicense.com/licenses/mit/',
          },
        });
      }
      if (parsed.pathname === '/repos/acme/ledger/commits/release%2Fv2') {
        return jsonResponse({ sha: commit });
      }
      if (parsed.pathname === '/repos/acme/ledger/contents/docs/SPEC.md') {
        expect(parsed.searchParams.get('ref')).toBe(commit);
        return jsonResponse({
          type: 'file',
          path: 'docs/SPEC.md',
          sha: 'file-sha',
          encoding: 'base64',
          content: encodeBase64(rawContent),
          html_url:
            'https://github.com/acme/ledger/blob/release/v2/docs/SPEC.md',
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await pullGitHubSpec('acme/ledger@release/v2:docs/SPEC.md', {
      fetch: fetcher,
      apiBaseUrl: 'https://api.github.test',
    });

    expect(result.rawContent).toBe(rawContent);
    expect(result.content).toBe(rawContent);
    expect(result.receipt).toEqual(
      expect.objectContaining({
        receiptKind: 'github-spec-pull',
        source: 'acme/ledger@release/v2:docs/SPEC.md',
        canonicalSource: 'acme/ledger@release/v2:docs/SPEC.md',
        owner: 'acme',
        repository: 'ledger',
        ref: 'release/v2',
        commit,
        path: 'docs/SPEC.md',
        license: 'MIT',
        contentSha256: createHash('sha256')
          .update(rawContent, 'utf8')
          .digest('hex'),
        execution: 'none',
      }),
    );
    expect(result.receipt.provenance).toEqual(
      expect.objectContaining({
        provider: 'github',
        source: 'acme/ledger@release/v2:docs/SPEC.md',
        repository: 'acme/ledger',
        ref: 'release/v2',
        commit,
        path: 'docs/SPEC.md',
        license: 'MIT',
      }),
    );
    expect(result.receipt.content).toEqual({
      path: 'docs/SPEC.md',
      sha: 'file-sha',
      encoding: 'base64',
    });
    expect(requested).toHaveLength(3);
    expect(requested.every(({ init }) => init.method === 'GET')).toBe(true);
    expect(
      requested.every(
        ({ init }) => init.headers.Accept === 'application/vnd.github+json',
      ),
    ).toBe(true);
  });

  it('defaults the path and does not execute content or repository code', async () => {
    const requested: string[] = [];
    const fetcher: GitHubSpecFetch = async (url) => {
      requested.push(url);
      const parsed = new URL(url);
      if (parsed.pathname === '/repos/acme/ledger') {
        return jsonResponse({
          license: { spdx_id: 'Apache-2.0', name: 'Apache License 2.0' },
        });
      }
      if (parsed.pathname === '/repos/acme/ledger/commits/main') {
        return jsonResponse({ sha: commit });
      }
      return jsonResponse({
        type: 'file',
        path: 'SPEC.md',
        encoding: 'base64',
        content: encodeBase64('#!/bin/sh\nprintf dangerous\n'),
      });
    };

    const result = await pullGitHubSpec('acme/ledger@main', {
      fetch: fetcher,
      apiBaseUrl: 'https://api.github.test',
    });

    expect(result.receipt.path).toBe('SPEC.md');
    expect(result.receipt.execution).toBe('none');
    expect(result.rawContent).toContain('#!/bin/sh');
    expect(requested).toHaveLength(3);
  });

  it('fails closed when repository metadata has no license', async () => {
    let calls = 0;
    const fetcher: GitHubSpecFetch = async () => {
      calls += 1;
      return jsonResponse({ full_name: 'acme/ledger', license: null });
    };

    await expect(
      pullGitHubSpec('acme/ledger@main', {
        fetch: fetcher,
        apiBaseUrl: 'https://api.github.test',
      }),
    ).rejects.toMatchObject({
      code: 'missing-license',
    });
    expect(calls).toBe(1);
  });

  it('fails closed for missing, empty, or non-file content', async () => {
    for (const body of [
      { type: 'file', encoding: 'base64', content: '' },
      { type: 'file', encoding: 'base64', content: encodeBase64('   \n') },
      { type: 'directory', path: 'SPEC.md' },
      {
        type: 'file',
        encoding: 'base64',
        size: 2 * 1024 * 1024 + 1,
        content: encodeBase64('# too large by metadata\n'),
      },
    ]) {
      const fetcher: GitHubSpecFetch = async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/commits/main'))
          return jsonResponse({ sha: commit });
        if (parsed.pathname.endsWith('/contents/SPEC.md'))
          return jsonResponse(body);
        return jsonResponse({ license: { spdx_id: 'MIT' } });
      };

      await expect(
        pullGitHubSpec('acme/ledger@main', {
          fetch: fetcher,
          apiBaseUrl: 'https://api.github.test',
        }),
      ).rejects.toBeInstanceOf(GitHubSpecPullError);
    }
  });

  it('fails closed when ref resolution does not return a commit SHA', async () => {
    const fetcher: GitHubSpecFetch = async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/commits/main'))
        return jsonResponse({ sha: 'not-a-commit' });
      return jsonResponse({ license: { spdx_id: 'MIT' } });
    };

    await expect(
      pullGitHubSpec('acme/ledger@main', {
        fetch: fetcher,
        apiBaseUrl: 'https://api.github.test',
      }),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('surfaces HTTP failures without attempting later lifecycle steps', async () => {
    const urls: string[] = [];
    const fetcher: GitHubSpecFetch = async (url) => {
      urls.push(url);
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ message: 'Not Found' }),
      };
    };

    await expect(
      pullGitHubSpec('acme/ledger@missing', {
        fetch: fetcher,
        apiBaseUrl: 'https://api.github.test',
      }),
    ).rejects.toMatchObject({
      code: 'github-error',
      status: 404,
    });
    expect(urls).toHaveLength(1);
  });
});

function jsonResponse(body: unknown, status = 200): GitHubFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function encodeBase64(value: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
