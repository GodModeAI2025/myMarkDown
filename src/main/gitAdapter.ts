import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitDiffTarget, GitRemoteTarget, GitStatusEntry, GitStatusResult } from '../shared/contracts';

const execFileAsync = promisify(execFile);

let currentRepositoryPath: string | null = null;

function parseBranchLine(line: string): {
  branch: string | null;
  trackingBranch: string | null;
  ahead: number;
  behind: number;
} {
  const withoutPrefix = line.replace(/^##\s*/, '');

  let branchPart = withoutPrefix;
  let trackingBranch: string | null = null;
  let ahead = 0;
  let behind = 0;

  if (withoutPrefix.startsWith('No commits yet on ')) {
    branchPart = withoutPrefix.replace('No commits yet on ', '').trim();
  } else if (withoutPrefix.includes('...')) {
    const [branch, rest] = withoutPrefix.split('...');
    branchPart = branch?.trim() || withoutPrefix;

    const trackingMatch = rest?.match(/^([^\s]+)(?:\s+\[(.+)\])?$/);
    if (trackingMatch) {
      trackingBranch = trackingMatch[1]?.trim() ?? null;
      const details = trackingMatch[2] ?? '';
      const aheadMatch = details.match(/ahead\s+(\d+)/);
      const behindMatch = details.match(/behind\s+(\d+)/);
      ahead = aheadMatch ? Number.parseInt(aheadMatch[1], 10) : 0;
      behind = behindMatch ? Number.parseInt(behindMatch[1], 10) : 0;
    } else {
      trackingBranch = rest?.trim() || null;
    }
  }

  if (branchPart === 'HEAD (no branch)') {
    return { branch: null, trackingBranch, ahead, behind };
  }

  return {
    branch: branchPart || null,
    trackingBranch,
    ahead,
    behind
  };
}

function parseStatusEntries(lines: string[]): GitStatusEntry[] {
  return lines
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.startsWith('??')) {
        return {
          path: line.slice(3),
          indexStatus: '?',
          workTreeStatus: '?'
        };
      }

      const indexStatus = line[0] ?? ' ';
      const workTreeStatus = line[1] ?? ' ';
      const details = line.slice(3);

      if (details.includes(' -> ')) {
        const [originalPath, newPath] = details.split(' -> ');
        return {
          path: newPath,
          originalPath,
          indexStatus,
          workTreeStatus
        };
      }

      return {
        path: details,
        indexStatus,
        workTreeStatus
      };
    });
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], {
    maxBuffer: 10 * 1024 * 1024,
    encoding: 'utf8'
  });

  return stdout;
}

export function getOpenRepositoryPath(): string {
  if (!currentRepositoryPath) {
    throw new Error('No repository is currently open.');
  }

  return currentRepositoryPath;
}

export async function openRepository(repositoryPath: string): Promise<string> {
  const resolvedPath = path.resolve(repositoryPath);
  await access(resolvedPath, constants.R_OK | constants.W_OK);

  await runGit(resolvedPath, ['rev-parse', '--is-inside-work-tree']);
  const topLevel = (await runGit(resolvedPath, ['rev-parse', '--show-toplevel'])).trim();

  currentRepositoryPath = topLevel;
  return topLevel;
}

export async function getStatus(): Promise<GitStatusResult> {
  const repositoryPath = getOpenRepositoryPath();
  const stdout = await runGit(repositoryPath, ['status', '--porcelain', '-b']);
  const lines = stdout.split('\n').filter((line) => line.length > 0);

  const branchLine = lines[0]?.startsWith('##') ? lines[0] : '## HEAD (no branch)';
  const branchInfo = parseBranchLine(branchLine);
  const fileLines = lines[0]?.startsWith('##') ? lines.slice(1) : lines;
  const files = parseStatusEntries(fileLines);

  return {
    repositoryPath,
    branch: branchInfo.branch,
    trackingBranch: branchInfo.trackingBranch,
    ahead: branchInfo.ahead,
    behind: branchInfo.behind,
    isClean: files.length === 0,
    files
  };
}

export async function getDiff(target: GitDiffTarget = {}): Promise<string> {
  const repositoryPath = getOpenRepositoryPath();
  const args = ['diff', '--no-color'];

  if (target.staged) {
    args.push('--staged');
  }

  if (target.ref) {
    args.push(target.ref);
  }

  if (target.pathspec) {
    args.push('--', target.pathspec);
  }

  return runGit(repositoryPath, args);
}

export async function stage(paths: string[]): Promise<void> {
  const repositoryPath = getOpenRepositoryPath();
  if (paths.length === 0) {
    return;
  }

  await runGit(repositoryPath, ['add', '--', ...paths]);
}

export async function unstage(paths: string[]): Promise<void> {
  const repositoryPath = getOpenRepositoryPath();
  if (paths.length === 0) {
    return;
  }

  await runGit(repositoryPath, ['restore', '--staged', '--', ...paths]);
}

export async function commit(message: string): Promise<void> {
  const repositoryPath = getOpenRepositoryPath();
  const commitMessage = message.trim();

  if (!commitMessage) {
    throw new Error('Commit message cannot be empty.');
  }

  await runGit(repositoryPath, ['commit', '-m', commitMessage]);
}

export async function fetch(options: GitRemoteTarget = {}): Promise<void> {
  const repositoryPath = getOpenRepositoryPath();
  const args = ['fetch', options.remote || 'origin'];

  if (options.branch) {
    args.push(options.branch);
  }

  await runGit(repositoryPath, args);
}

export async function pull(options: GitRemoteTarget = {}): Promise<void> {
  const repositoryPath = getOpenRepositoryPath();
  const args = ['pull', '--rebase', options.remote || 'origin'];

  if (options.branch) {
    args.push(options.branch);
  }

  await runGit(repositoryPath, args);
}

export async function push(options: GitRemoteTarget = {}): Promise<void> {
  const repositoryPath = getOpenRepositoryPath();
  const args = ['push', options.remote || 'origin'];

  if (options.branch) {
    args.push(options.branch);
  }

  await runGit(repositoryPath, args);
}

export async function getGitIdentity(): Promise<{ name: string | null; email: string | null }> {
  const repositoryPath = getOpenRepositoryPath();

  const safeGetConfig = async (key: string): Promise<string | null> => {
    try {
      const value = (await runGit(repositoryPath, ['config', '--get', key])).trim();
      return value || null;
    } catch {
      return null;
    }
  };

  const [name, email] = await Promise.all([safeGetConfig('user.name'), safeGetConfig('user.email')]);
  return { name, email };
}

export async function ensureWorkingTreeClean(): Promise<void> {
  const repositoryPath = getOpenRepositoryPath();
  const porcelain = (await runGit(repositoryPath, ['status', '--porcelain'])).trim();
  if (porcelain.length > 0) {
    throw new Error('Release requires a clean working tree (no staged or unstaged changes).');
  }
}

export async function createAnnotatedTag(tag: string, targetRef: string, message: string): Promise<void> {
  const repositoryPath = getOpenRepositoryPath();
  const trimmedTag = tag.trim();
  if (!trimmedTag) {
    throw new Error('Release tag cannot be empty.');
  }

  await runGit(repositoryPath, ['tag', '-a', trimmedTag, targetRef, '-m', message]);
}

export async function pushTag(tag: string, remote = 'origin'): Promise<void> {
  const repositoryPath = getOpenRepositoryPath();
  await runGit(repositoryPath, ['push', remote, tag]);
}
