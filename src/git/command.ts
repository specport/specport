import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export class GitCommandError extends Error {
  readonly command: readonly string[];
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(
    command: readonly string[],
    message: string,
    exitCode: number | null,
    stderr: string,
  ) {
    super(message);
    this.name = 'GitCommandError';
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export async function runGit(
  cwd: string,
  args: readonly string[],
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<string> {
  try {
    const result = await execFile('git', [...args], {
      cwd,
      env: { ...process.env, ...environment },
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      windowsHide: true,
    });
    return result.stdout;
  } catch (error) {
    const cause = error as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    const exitCode = typeof cause.code === 'number' ? cause.code : null;
    const stderr = cause.stderr ?? '';
    const detail = stderr.trim() || cause.message || 'Git command failed';
    throw new GitCommandError(args, detail, exitCode, stderr);
  }
}

export async function tryRunGit(
  cwd: string,
  args: readonly string[],
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  try {
    return await runGit(cwd, args, environment);
  } catch {
    return null;
  }
}
