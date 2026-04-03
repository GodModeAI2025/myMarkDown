import { access, mkdir, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ConnectRepositoryInput,
  ConnectRepositoryResult,
  GitConflictResolveInput,
  GitCreateBranchInput,
  GitDiffTarget,
  GitRemoteTarget,
  GitStatusEntry,
  GitStatusResult,
  IncomingDeltaResult,
  RuntimeInfo,
  RepositoryState
} from '../shared/contracts';

const execFileAsync = promisify(execFile);

let currentRepositoryPath: string | null = null;
let currentRuntimeMode: RuntimeInfo['mode'] = 'git';
let gitBinaryAvailableCache: boolean | null = null;

const IGNORED_DEMO_DIRS = new Set(['.git', 'node_modules', 'dist']);

type GitFailure = {
  code: string;
  message: string;
  hint?: string;
};

const DEFAULT_REMOTE_NAME = 'origin';

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

export function parseBranchLine(line: string): {
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

export function parseStatusEntries(lines: string[]): GitStatusEntry[] {
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

function normalizeRemoteName(input?: string): string {
  return input?.trim() || DEFAULT_REMOTE_NAME;
}

function normalizeBranchName(input?: string): string | null {
  const value = input?.trim() || '';
  return value.length > 0 ? value : null;
}

function sanitizeCredentialString(value: string): string {
  return value
    .replace(/(https?:\/\/[^:@\s]+:)([^@\s/]+)@/gi, '$1***@')
    .replace(/(oauth2:)([^@\s/]+)@/gi, '$1***@');
}

function sanitizeGitArgs(args: string[]): string[] {
  return args.map((arg) => sanitizeCredentialString(arg));
}

function ensureHttpsRemoteUrl(remoteUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    throw new GitCommandError({
      code: 'GIT_REMOTE_URL_INVALID',
      message: 'Remote URL is invalid.',
      hint: 'Bitte eine gültige Remote-URL eingeben (z. B. https://...).'
    });
  }

  if (parsed.protocol !== 'https:') {
    throw new GitCommandError({
      code: 'GIT_REMOTE_URL_PROTOCOL_UNSUPPORTED',
      message: 'Token authentication requires an HTTPS remote URL.',
      hint: 'Nutze für Token-Login eine https:// Remote-URL.'
    });
  }

  return parsed;
}

function buildAuthRemoteUrl(remoteUrl: string, inputAuth?: ConnectRepositoryInput['auth']): string {
  const normalizedRemoteUrl = remoteUrl.trim();
  if (!normalizedRemoteUrl) {
    throw new GitCommandError({
      code: 'GIT_REMOTE_URL_REQUIRED',
      message: 'Remote URL is required.',
      hint: 'Bitte eine Remote-URL angeben.'
    });
  }

  const authMode = inputAuth?.mode ?? 'system';
  if (authMode !== 'https-token') {
    return normalizedRemoteUrl;
  }

  const token = inputAuth?.token?.trim() || '';
  if (!token) {
    throw new GitCommandError({
      code: 'GIT_AUTH_TOKEN_REQUIRED',
      message: 'Token authentication was selected but no token was provided.',
      hint: 'Bitte ein Personal Access Token eingeben.'
    });
  }

  const parsed = ensureHttpsRemoteUrl(normalizedRemoteUrl);
  parsed.username = inputAuth?.username?.trim() || 'git';
  parsed.password = token;
  return parsed.toString();
}

async function isGitBinaryAvailable(): Promise<boolean> {
  if (gitBinaryAvailableCache !== null) {
    return gitBinaryAvailableCache;
  }

  try {
    await execFileAsync('git', ['--version'], {
      maxBuffer: 256 * 1024,
      encoding: 'utf8'
    });
    gitBinaryAvailableCache = true;
    return true;
  } catch {
    gitBinaryAvailableCache = false;
    return false;
  }
}

function ensureGitMode(action: string): void {
  if (currentRuntimeMode === 'demo') {
    throw new GitCommandError({
      code: 'DEMO_MODE_GIT_UNAVAILABLE',
      message: `Git action "${action}" is unavailable in demo mode.`,
      hint: 'Installiere Git und öffne ein echtes Git-Repository für diesen Workflow.'
    });
  }
}

async function countWorkspaceFiles(rootDir: string, currentDir: string): Promise<number> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DEMO_DIRS.has(entry.name)) {
        continue;
      }

      count += await countWorkspaceFiles(rootDir, path.join(currentDir, entry.name));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    if (!absolutePath.startsWith(rootDir)) {
      continue;
    }

    count += 1;
  }

  return count;
}

async function isDirectoryEmpty(directoryPath: string): Promise<boolean> {
  try {
    const entries = await readdir(directoryPath);
    return entries.length === 0;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return true;
    }
    throw error;
  }
}

async function isGitRepositoryDirectory(directoryPath: string): Promise<boolean> {
  try {
    await runGit(directoryPath, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

async function remoteExists(repositoryPath: string, remoteName: string): Promise<boolean> {
  try {
    await runGit(repositoryPath, ['remote', 'get-url', remoteName]);
    return true;
  } catch {
    return false;
  }
}

async function setOrAddRemote(repositoryPath: string, remoteName: string, remoteUrl: string): Promise<void> {
  if (await remoteExists(repositoryPath, remoteName)) {
    await runGit(repositoryPath, ['remote', 'set-url', remoteName, remoteUrl]);
    return;
  }

  await runGit(repositoryPath, ['remote', 'add', remoteName, remoteUrl]);
}

async function verifyRemoteAuthentication(
  repositoryPath: string,
  remoteUrl: string,
  auth?: ConnectRepositoryInput['auth']
): Promise<void> {
  const authUrl = buildAuthRemoteUrl(remoteUrl, auth);
  await runGit(repositoryPath, ['ls-remote', '--heads', '--tags', authUrl]);
}

export function deriveRepositoryState(input: {
  repositoryPath: string;
  trackedFilesRaw: string;
  statusPorcelainRaw: string;
  hasCommits: boolean;
}): RepositoryState {
  const trackedFiles = uniquePaths(input.trackedFilesRaw.split('\n'));
  const statusLines = input.statusPorcelainRaw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const untrackedFileCount = statusLines.filter((line) => line.startsWith('?? ')).length;

  return {
    repositoryPath: input.repositoryPath,
    hasCommits: input.hasCommits,
    trackedFileCount: trackedFiles.length,
    untrackedFileCount,
    isEmpty: !input.hasCommits && trackedFiles.length === 0 && statusLines.length === 0
  };
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
    /authentication failed|could not read username|permission denied \(publickey\)|repository not found|access denied|fatal: could not/i.test(
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

    if (gitError.code === 'ENOENT') {
      gitBinaryAvailableCache = false;
      throw new GitCommandError({
        code: 'GIT_NOT_INSTALLED',
        message: 'Git binary was not found on this system.',
        hint: 'Installiere Git, oder starte den Demo-Modus ohne Git.'
      });
    }

    const raw = sanitizeCredentialString(
      [gitError.stdout, gitError.stderr, gitError.message]
      .filter((chunk): chunk is string => typeof chunk === 'string' && chunk.trim().length > 0)
      .join('\n')
      .trim()
    );

    const classified = classifyGitFailure(raw, sanitizeGitArgs(args));
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

export async function getRuntimeInfo(): Promise<RuntimeInfo> {
  return {
    gitAvailable: await isGitBinaryAvailable(),
    mode: currentRuntimeMode,
    repositoryOpen: currentRepositoryPath !== null
  };
}

export async function openRepository(repositoryPath: string): Promise<string> {
  const resolvedPath = path.resolve(repositoryPath);
  await access(resolvedPath, constants.R_OK | constants.W_OK);

  const gitAvailable = await isGitBinaryAvailable();
  if (!gitAvailable) {
    currentRepositoryPath = resolvedPath;
    currentRuntimeMode = 'demo';
    return resolvedPath;
  }

  await runGit(resolvedPath, ['rev-parse', '--is-inside-work-tree']);
  const topLevel = (await runGit(resolvedPath, ['rev-parse', '--show-toplevel'])).trim();

  currentRepositoryPath = topLevel;
  currentRuntimeMode = 'git';
  return topLevel;
}

export async function openDemoRepository(repositoryPath: string): Promise<string> {
  const resolvedPath = path.resolve(repositoryPath);
  await access(resolvedPath, constants.R_OK | constants.W_OK);

  currentRepositoryPath = resolvedPath;
  currentRuntimeMode = 'demo';
  return resolvedPath;
}

export async function connectRepository(input: ConnectRepositoryInput): Promise<ConnectRepositoryResult> {
  const localPath = path.resolve(input.localPath.trim());
  if (!input.localPath.trim()) {
    throw new GitCommandError({
      code: 'REPOSITORY_PATH_REQUIRED',
      message: 'Local repository path is required.',
      hint: 'Bitte einen lokalen Ordner für das Repository auswählen.'
    });
  }

  const remoteUrl = input.remoteUrl?.trim() || '';
  const remoteName = normalizeRemoteName(input.remoteName);
  const defaultBranch = normalizeBranchName(input.defaultBranch);
  const gitAvailable = await isGitBinaryAvailable();

  if (!gitAvailable) {
    if (remoteUrl) {
      throw new GitCommandError({
        code: 'GIT_NOT_INSTALLED',
        message: 'Git is required for remote authentication and remote repository access.',
        hint: 'Installiere Git oder starte ohne Remote im Demo-Modus.'
      });
    }

    await mkdir(localPath, { recursive: true });
    const repositoryPath = await openDemoRepository(localPath);
    return {
      repositoryPath,
      mode: 'demo',
      remoteConfigured: false,
      clonedFromRemote: false,
      initializedRepository: false,
      authVerified: false
    };
  }

  await mkdir(localPath, { recursive: true });

  let repositoryPath = '';
  let clonedFromRemote = false;
  let initializedRepository = false;
  let remoteConfigured = false;
  let authVerified = false;

  const isGitRepo = await isGitRepositoryDirectory(localPath);
  if (isGitRepo) {
    repositoryPath = await openRepository(localPath);
  } else if (remoteUrl) {
    const isEmptyDirectory = await isDirectoryEmpty(localPath);
    if (!isEmptyDirectory) {
      throw new GitCommandError({
        code: 'REPOSITORY_TARGET_NOT_EMPTY',
        message: 'The selected local folder is not empty and cannot be used for cloning.',
        hint: 'Wähle einen leeren Zielordner oder ein bereits vorhandenes Git-Repository.'
      });
    }

    const authUrl = buildAuthRemoteUrl(remoteUrl, input.auth);
    const parentPath = path.dirname(localPath);
    const folderName = path.basename(localPath);
    await runGit(parentPath, ['clone', authUrl, folderName]);
    repositoryPath = await openRepository(localPath);
    clonedFromRemote = true;
  } else {
    await runGit(localPath, ['init']);
    if (defaultBranch) {
      await runGit(localPath, ['check-ref-format', '--branch', defaultBranch]);
      await runGit(localPath, ['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
    }

    repositoryPath = await openRepository(localPath);
    initializedRepository = true;
  }

  if (remoteUrl) {
    await setOrAddRemote(repositoryPath, remoteName, remoteUrl);
    await verifyRemoteAuthentication(repositoryPath, remoteUrl, input.auth);
    remoteConfigured = true;
    authVerified = true;
  }

  return {
    repositoryPath,
    mode: 'git',
    remoteConfigured,
    clonedFromRemote,
    initializedRepository,
    authVerified
  };
}

async function hasHeadCommit(repositoryPath: string): Promise<boolean> {
  try {
    await runGit(repositoryPath, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

export async function inspectRepositoryState(): Promise<RepositoryState> {
  const repositoryPath = getOpenRepositoryPath();
  if (currentRuntimeMode === 'demo') {
    const fileCount = await countWorkspaceFiles(repositoryPath, repositoryPath);
    return {
      repositoryPath,
      hasCommits: false,
      trackedFileCount: fileCount,
      untrackedFileCount: 0,
      isEmpty: fileCount === 0
    };
  }

  const [trackedRaw, statusRaw, hasCommits] = await Promise.all([
    runGit(repositoryPath, ['ls-files']),
    runGit(repositoryPath, ['status', '--porcelain']),
    hasHeadCommit(repositoryPath)
  ]);

  return deriveRepositoryState({
    repositoryPath,
    trackedFilesRaw: trackedRaw,
    statusPorcelainRaw: statusRaw,
    hasCommits
  });
}

export async function getStatus(): Promise<GitStatusResult> {
  const repositoryPath = getOpenRepositoryPath();
  if (currentRuntimeMode === 'demo') {
    return {
      repositoryPath,
      branch: 'demo',
      trackingBranch: null,
      ahead: 0,
      behind: 0,
      isClean: true,
      files: []
    };
  }

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
  if (currentRuntimeMode === 'demo') {
    if (target.pathspec) {
      return `Demo mode: Git diff is unavailable for ${target.pathspec}.`;
    }

    return 'Demo mode: Git diff is unavailable without Git.';
  }

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
  ensureGitMode('create-branch');
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
  ensureGitMode('checkout-branch');
  const repositoryPath = getOpenRepositoryPath();
  const branchName = ensureBranchName(branch);
  await runGit(repositoryPath, ['checkout', branchName]);
  return branchName;
}

export async function stage(paths: string[]): Promise<void> {
  ensureGitMode('stage');
  const repositoryPath = getOpenRepositoryPath();
  if (paths.length === 0) {
    return;
  }

  await runGit(repositoryPath, ['add', '--', ...paths]);
}

export async function unstage(paths: string[]): Promise<void> {
  ensureGitMode('unstage');
  const repositoryPath = getOpenRepositoryPath();
  if (paths.length === 0) {
    return;
  }

  await runGit(repositoryPath, ['restore', '--staged', '--', ...paths]);
}

export async function commit(message: string): Promise<void> {
  ensureGitMode('commit');
  const repositoryPath = getOpenRepositoryPath();
  const commitMessage = message.trim();

  if (!commitMessage) {
    throw new Error('Commit message cannot be empty.');
  }

  await runGit(repositoryPath, ['commit', '-m', commitMessage]);
}

export async function fetch(options: GitRemoteTarget = {}): Promise<void> {
  ensureGitMode('fetch');
  const repositoryPath = getOpenRepositoryPath();
  const args = ['fetch', options.remote || 'origin'];

  if (options.branch) {
    args.push(options.branch);
  }

  await runGit(repositoryPath, args);
}

export async function pull(options: GitRemoteTarget = {}): Promise<void> {
  ensureGitMode('pull');
  const repositoryPath = getOpenRepositoryPath();
  const args = ['pull', '--rebase', options.remote || 'origin'];

  if (options.branch) {
    args.push(options.branch);
  }

  await runGit(repositoryPath, args);
}

export async function push(options: GitRemoteTarget = {}): Promise<void> {
  ensureGitMode('push');
  const repositoryPath = getOpenRepositoryPath();
  const args = ['push', options.remote || 'origin'];

  if (options.branch) {
    args.push(options.branch);
  }

  await runGit(repositoryPath, args);
}

export async function resolveConflict(input: GitConflictResolveInput): Promise<void> {
  ensureGitMode('resolve-conflict');
  const repositoryPath = getOpenRepositoryPath();
  const pathspec = input.path.trim();
  if (!pathspec) {
    throw new Error('Conflict file path cannot be empty.');
  }

  const strategyFlag = input.strategy === 'theirs' ? '--theirs' : '--ours';
  await runGit(repositoryPath, ['checkout', strategyFlag, '--', pathspec]);
  await runGit(repositoryPath, ['add', '--', pathspec]);
}

export async function setUpstream(options: GitRemoteTarget = {}): Promise<string> {
  ensureGitMode('set-upstream');
  const repositoryPath = getOpenRepositoryPath();
  const remote = options.remote?.trim() || 'origin';
  const status = await getStatus();
  const branchName = ensureBranchName(options.branch?.trim() || status.branch || '');
  await runGit(repositoryPath, ['push', '--set-upstream', remote, branchName]);
  return `${remote}/${branchName}`;
}

export async function getGitIdentity(): Promise<{ name: string | null; email: string | null }> {
  if (currentRuntimeMode === 'demo') {
    return { name: 'demo-user', email: null };
  }

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
  if (currentRuntimeMode === 'demo') {
    return {
      baseRef: 'demo',
      remoteRef: null,
      incomingCommitCount: 0,
      incomingFiles: [],
      conflictCandidates: []
    };
  }

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
  ensureGitMode('ensure-working-tree-clean');
  const repositoryPath = getOpenRepositoryPath();
  const porcelain = (await runGit(repositoryPath, ['status', '--porcelain'])).trim();
  if (porcelain.length > 0) {
    throw new Error('Release requires a clean working tree (no staged or unstaged changes).');
  }
}

export async function createAnnotatedTag(tag: string, targetRef: string, message: string): Promise<void> {
  ensureGitMode('create-annotated-tag');
  const repositoryPath = getOpenRepositoryPath();
  const trimmedTag = tag.trim();
  if (!trimmedTag) {
    throw new Error('Release tag cannot be empty.');
  }

  await runGit(repositoryPath, ['tag', '-a', trimmedTag, targetRef, '-m', message]);
}

export async function pushTag(tag: string, remote = 'origin'): Promise<void> {
  ensureGitMode('push-tag');
  const repositoryPath = getOpenRepositoryPath();
  await runGit(repositoryPath, ['push', remote, tag]);
}
