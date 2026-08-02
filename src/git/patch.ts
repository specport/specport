import { fingerprintCanonical } from '../core/coverage.js';

export interface DiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  noNewline?: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface PatchFile {
  oldPath: string;
  newPath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface ParsedPatch {
  files: PatchFile[];
  binary: boolean;
}

export function parseUnifiedDiff(diffText: string): ParsedPatch {
  if (!diffText.trim()) return { files: [], binary: false };
  const chunks = splitFiles(diffText);
  const files: PatchFile[] = [];
  let binary = false;
  for (const chunk of chunks) {
    if (/^Binary files |^GIT binary patch/m.test(chunk)) {
      binary = true;
    }
    const file = parseFile(chunk);
    if (file) files.push(file);
  }
  return { files, binary };
}

export function fingerprintPatch(
  baseCommit: string,
  files: readonly PatchFile[],
): string {
  return fingerprintCanonical({
    algorithm: 'sha256',
    normalizationVersion: 'patch-v1',
    baseCommit,
    files: [...files]
      .sort((left, right) => {
        const leftKey = `${left.newPath}\0${left.oldPath}`;
        const rightKey = `${right.newPath}\0${right.oldPath}`;
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      })
      .map((file) => ({
        oldPath: file.oldPath,
        newPath: file.newPath,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        hunks: file.hunks,
      })),
  });
}

function splitFiles(diffText: string): string[] {
  const files: string[] = [];
  let current: string[] = [];
  for (const line of diffText.replaceAll('\r\n', '\n').split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current.length > 0) files.push(current.join('\n'));
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    }
  }
  if (current.length > 0) files.push(current.join('\n'));
  return files;
}

function parseFile(chunk: string): PatchFile | null {
  const lines = chunk.split('\n');
  const header = lines.find((line) => line.startsWith('diff --git '));
  if (!header) return null;
  const separator = header.lastIndexOf(' b/');
  if (separator < 0) return null;
  const oldPath = unquotePath(header.slice('diff --git a/'.length, separator));
  const newPath = unquotePath(header.slice(separator + ' b/'.length));
  const status = lines.some((line) => line.startsWith('deleted file mode'))
    ? 'deleted'
    : lines.some((line) => line.startsWith('new file mode'))
      ? 'added'
      : lines.some((line) => line.startsWith('copy from'))
        ? 'copied'
        : lines.some((line) => line.startsWith('rename from')) ||
            oldPath !== newPath
          ? 'renamed'
          : 'modified';
  const hunks = parseHunks(lines);
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'added') additions += 1;
      if (line.type === 'removed') deletions += 1;
    }
  }
  return { oldPath, newPath, status, additions, deletions, hunks };
}

function parseHunks(lines: readonly string[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  for (const line of lines) {
    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (match) {
      if (current) hunks.push(current);
      oldLine = Number(match[1]);
      newLine = Number(match[3]);
      current = {
        oldStart: oldLine,
        oldLines: Number(match[2] ?? '1'),
        newStart: newLine,
        newLines: Number(match[4] ?? '1'),
        lines: [],
      };
      continue;
    }
    if (line === '\\ No newline at end of file') {
      const previous = current?.lines.at(-1);
      if (previous) previous.noNewline = true;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) {
      current.lines.push({
        type: 'added',
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine,
      });
      newLine += 1;
    } else if (line.startsWith('-')) {
      current.lines.push({
        type: 'removed',
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: null,
      });
      oldLine += 1;
    } else if (line.startsWith(' ')) {
      current.lines.push({
        type: 'context',
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine += 1;
      newLine += 1;
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

function unquotePath(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}
