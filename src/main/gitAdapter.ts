import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  GitCreateBranchInput,
  GitDiffTarget,
  GitRemoteTarget,
  GitStatusEntry,
  GitStatusResult,
  IncomingDeltaResult
} from '../shared/contracts';

const execFileAsync = promisify(execFile);

let currentRepositoryPath: string | null = null;

type GitFailure = {
  code: string;
  message: string;
  hint?: string;
};

export class GitCommandError extends Error {
  code: string;
  hint?: string;
  raw?: string;

  constructor(input: { code: string; message: string; hint?: string; raw?: string }) {
    super(input.message);
    this.name = 'GitCommandError';
    this.code = input.code;
    this.hint = input.hint;
    this.raw = input.raw;
  }
}

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

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((item) => item.trim()).filter((item) => item.length > 0))];
}

function classifyGitFailure(rawOutput: string, args: string[]): GitFailure {
  const lower = rawOutput.toLowerCase();

  if (
    /gh006|protected branch|protected branch hook declined|branch is protected|cannot push to protected branch/.test(lower)
  ) {
    return {
      code: 'GIT_POLICY_PROTECTED_BRANCH',
      message: 'Push blocked by remote branch protection policy.',
      hint: 'Arbeite auf einem Feature-Branch und integriere über Pull Request.'
    };
  }

  if (
    /authentication failed|could not read username|permission denied \(publickey\)|repository not found|access denied|fatal: could not/gi.test(
      lower
    )
  ) {
    return {
      code: 'GIT_AUTH_REQUIRED',
      message: 'Authentication to the remote repository failed.',
      hint: 'Prüfe Git-Login (PAT/SSH/OAuth) und wiederhole Fetch/Pull/Push.'
    };
  }

  if (/has no upstream branch/.test(lower)) {
    return {
      code: 'GIT_UPSTREAM_REQUIRED',
      message: 'Push failed because no upstream branch is configured.',
      hint: 'Gib im UI den Branch an oder setze den Upstream für den aktuellen Branch.'
    };
  }

  if (/a branch named .* already exists/.test(lower)) {
    return {
      code: 'GIT_BRANCH_EXISTS',
      message: 'Branch creation failed because the branch already exists.',
      hint: 'Nutze einen anderen Branch-Namen oder wechsle auf den bestehenden Branch.'
    };
  }

  if (/pathspec .* did not match any file\(s\) known to git|unknown revision or path not in the working tree/.test(lower)) {
    return {
      code: 'GIT_BRANCH_NOT_FOUND',
      message: 'Git could not find the requested branch or ref.',
      hint: 'Prüfe Branch-/Ref-Namen und führe ggf. vorher Fetch aus.'
    };
  }

  if (/not a valid branch name|fatal: '.+' is not a valid branch name/.test(lower)) {
    return {
      code: 'GIT_INVALID_BRANCH',
      message: 'The branch name is invalid.',
      hint: 'Verwende einen gültigen Git-Branchnamen ohne ungültige Zeichen.'
    };
  }

  if (/non-fast-forward|\[rejected\]|fetch first|failed to push some refs/.test(lower)) {
    return {
      code: 'GIT_NON_FAST_FORWARD',
      message: 'Push rejected because remote contains newer commits.',
      hint: 'Führe zuerst Fetch/Pull (Rebase) aus, löse Konflikte und pushe danach erneut.'
    };
  }

  if (/merge conflict|conflict|could not apply|resolve all conflicts manually/.test(lower)) {
    return {
      code: 'GIT_MERGE_CONFLICT',
      message: 'Git operation reported merge/rebase conflicts.',
      hint: 'Konflikte lokal auflösen, Dateien stage/committen und danach erneut synchronisieren.'
    };
  }

  return {
    code: 'GIT_COMMAND_FAILED',
    message: `Git command failed: git ${args.join(' ')}`,
    hint: 'Prüfe die Git-Ausgabe und den Repository-Status.'
  };
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], {
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8'
    });

    return stdout;
  } catch (error) {
    const gitError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };

    const raw = [gitError.stdout, gitError.stderr, gitError.message]
      .filter((chunk): chunk is string => typeof chunk === 'string' && chunk.trim().length > 0)
      .join('\n')
      .trim();

    const classified = classifyGitFailure(raw, args);
    throw new GitCommandError({
      ...classified,
      raw
    });
  }
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

function ensureBranchName(input: string): string {
  const branch = input.trim();
  if (!branch) {
    throw new Error('Branch name cannot be empty.');
  }

  return branch;
}

export async function createBranch(input: GitCreateBranchInput): Promise<string> {
  const repositoryPath = getOpenRepositoryPath();
  const branchName = ensureBranchName(input.name);
  const fromRef = input.from?.trim() || 'HEAD';

  await runGit(repositoryPath, ['check-ref-format', '--branch', branchName]);
  await runGit(repositoryPath, ['branch', branchName, fromRef]);

  if (input.checkout ?? true) {
    await runGit(repositoryPath, ['checkout', branchName]);
  }

  return branchName;
}

export async function checkoutBranch(branch: string): Promise<string> {
  const repositoryPath = getOpenRepositoryPath();
  const branchName = ensureBranchName(branch);
  await runGit(repositoryPath, ['checkout', branchName]);
  return branchName;
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

export async function setUpstream(options: GitRemoteTarget = {}): Promise<string> {
  const repositoryPath = getOpenRepositoryPath();
  const remote = options.remote?.trim() || 'origin';
  const status = await getStatus();
  const branchName = ensureBranchName(options.branch?.trim() || status.branch || '');
  await runGit(repositoryPath, ['push', '--set-upstream', remote, branchName]);
  return `${remote}/${branchName}`;
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

export async function getIncomingDelta(options: GitRemoteTarget = {}): Promise<IncomingDeltaResult> {
  const repositoryPath = getOpenRepositoryPath();
  const status = await getStatus();

  const baseRef = status.branch ?? 'HEAD';
  const remote = options.remote?.trim() || 'origin';
  const branch = options.branch?.trim() || status.branch;
  const remoteRef = status.trackingBranch || (branch ? `${remote}/${branch}` : null);

  if (!remoteRef) {
    return {
      baseRef,
      remoteRef: null,
      incomingCommitCount: 0,
      incomingFiles: [],
      conflictCandidates: []
    };
  }

  try {
    await runGit(repositoryPath, ['rev-parse', '--verify', remoteRef]);
  } catch {
    return {
      baseRef,
      remoteRef,
      incomingCommitCount: 0,
      incomingFiles: [],
      conflictCandidates: []
    };
  }

  const [incomingFilesRaw, incomingCountRaw, localStatusRaw] = await Promise.all([
    runGit(repositoryPath, ['diff', '--name-only', `HEAD..${remoteRef}`]),
    runGit(repositoryPath, ['rev-list', '--count', `HEAD..${remoteRef}`]),
    runGit(repositoryPath, ['status', '--porcelain'])
  ]);

  const incomingFiles = uniquePaths(incomingFilesRaw.split('\n'));
  const localEntries = parseStatusEntries(localStatusRaw.split('\n'));
  const localPaths = new Set(
    localEntries.flatMap((entry) => [entry.path, entry.originalPath || '']).filter((item) => item.length > 0)
  );

  const conflictCandidates = incomingFiles.filter((filePath) => localPaths.has(filePath));
  const incomingCommitCount = Number.parseInt(incomingCountRaw.trim(), 10);

  return {
    baseRef,
    remoteRef,
    incomingCommitCount: Number.isFinite(incomingCommitCount) ? incomingCommitCount : 0,
    incomingFiles,
    conflictCandidates
  };
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
