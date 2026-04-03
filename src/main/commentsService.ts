import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AppendCommentInput,
  CloseCommentInput,
  CommentScope,
  CommentThread,
  CreateCommentInput,
  OpenCommentCountResult
} from '../shared/contracts';
import { getGitIdentity, getOpenRepositoryPath } from './gitAdapter';
import { ensurePathInsideRepo, toPosixPath } from './pathUtils';

type SidecarPayload = {
  version: 1;
  targetPath: string;
  comments: CommentThread[];
};

const COMMENTS_DIR = '.comments';

function nowIso(): string {
  return new Date().toISOString();
}

function escapedTargetPath(targetPath: string): string {
  return encodeURIComponent(toPosixPath(targetPath)).replace(/%/g, '~');
}

export function getCommentSidecarPath(targetPath: string): string {
  return `${COMMENTS_DIR}/${escapedTargetPath(targetPath)}.comments.json`;
}

function emptySidecar(targetPath: string): SidecarPayload {
  return {
    version: 1,
    targetPath: toPosixPath(targetPath),
    comments: []
  };
}

async function ensureCommentsDirectory(repositoryPath: string): Promise<string> {
  const absoluteCommentsDir = path.join(repositoryPath, COMMENTS_DIR);
  await mkdir(absoluteCommentsDir, { recursive: true });
  return absoluteCommentsDir;
}

async function readJsonFile<T>(absolutePath: string): Promise<T> {
  const raw = await readFile(absolutePath, 'utf8');
  return JSON.parse(raw) as T;
}

async function loadSidecar(repositoryPath: string, targetPath: string): Promise<SidecarPayload> {
  const normalizedTargetPath = toPosixPath(targetPath);
  const relativeSidecarPath = getCommentSidecarPath(normalizedTargetPath);
  const absoluteSidecarPath = ensurePathInsideRepo(repositoryPath, relativeSidecarPath);

  try {
    const payload = await readJsonFile<SidecarPayload>(absoluteSidecarPath);
    if (!Array.isArray(payload.comments)) {
      return emptySidecar(normalizedTargetPath);
    }

    return {
      version: 1,
      targetPath: normalizedTargetPath,
      comments: payload.comments
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return emptySidecar(normalizedTargetPath);
    }

    throw error;
  }
}

async function saveSidecar(repositoryPath: string, targetPath: string, payload: SidecarPayload): Promise<void> {
  await ensureCommentsDirectory(repositoryPath);

  const relativeSidecarPath = getCommentSidecarPath(targetPath);
  const absoluteSidecarPath = ensurePathInsideRepo(repositoryPath, relativeSidecarPath);

  const normalizedPayload: SidecarPayload = {
    version: 1,
    targetPath: toPosixPath(targetPath),
    comments: payload.comments
  };

  await writeFile(absoluteSidecarPath, `${JSON.stringify(normalizedPayload, null, 2)}\n`, 'utf8');
}

async function resolveActor(explicitAuthor?: string): Promise<string> {
  if (explicitAuthor?.trim()) {
    return explicitAuthor.trim();
  }

  try {
    const identity = await getGitIdentity();
    return identity.name || identity.email || 'unknown';
  } catch {
    return 'unknown';
  }
}

function collectComments(payloads: SidecarPayload[]): CommentThread[] {
  return payloads
    .flatMap((payload) => payload.comments)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function loadAllSidecars(repositoryPath: string): Promise<SidecarPayload[]> {
  const absoluteCommentsDir = path.join(repositoryPath, COMMENTS_DIR);

  let entries;
  try {
    entries = await readdir(absoluteCommentsDir, { withFileTypes: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const payloads: SidecarPayload[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const absolutePath = path.join(absoluteCommentsDir, entry.name);
    const payload = await readJsonFile<SidecarPayload>(absolutePath);
    if (payload && Array.isArray(payload.comments) && typeof payload.targetPath === 'string') {
      payloads.push({
        version: 1,
        targetPath: toPosixPath(payload.targetPath),
        comments: payload.comments
      });
    }
  }

  return payloads;
}

async function loadSidecarsForScope(repositoryPath: string, scope: CommentScope = {}): Promise<SidecarPayload[]> {
  const normalizedPaths = (scope.paths || []).map((item) => toPosixPath(item));
  if (normalizedPaths.length === 0) {
    return loadAllSidecars(repositoryPath);
  }

  const payloads: SidecarPayload[] = [];
  for (const targetPath of normalizedPaths) {
    payloads.push(await loadSidecar(repositoryPath, targetPath));
  }

  return payloads;
}

export async function getComments(scope: CommentScope = {}): Promise<CommentThread[]> {
  const repositoryPath = getOpenRepositoryPath();
  const payloads = await loadSidecarsForScope(repositoryPath, scope);
  return collectComments(payloads);
}

export async function getOpenCommentCount(scope: CommentScope = {}): Promise<OpenCommentCountResult> {
  const comments = await getComments(scope);
  const openComments = comments.filter((comment) => comment.state === 'open').length;

  return {
    openComments,
    totalComments: comments.length
  };
}

export async function createComment(input: CreateCommentInput): Promise<CommentThread> {
  const repositoryPath = getOpenRepositoryPath();
  const targetPath = toPosixPath(input.targetPath);
  const markdownPath = ensurePathInsideRepo(repositoryPath, targetPath);
  const text = input.text.trim();

  if (!markdownPath.toLowerCase().endsWith('.md')) {
    throw new Error('Comments can only be created for markdown files (*.md).');
  }

  if (!text) {
    throw new Error('Comment text cannot be empty.');
  }

  const actor = await resolveActor(input.author);
  const timestamp = nowIso();
  const sidecar = await loadSidecar(repositoryPath, targetPath);

  const commentThread: CommentThread = {
    id: randomUUID(),
    targetPath,
    anchor: {
      line: input.line,
      excerpt: input.excerpt
    },
    author: actor,
    state: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
    thread: [
      {
        id: randomUUID(),
        author: actor,
        text,
        createdAt: timestamp
      }
    ]
  };

  sidecar.comments.push(commentThread);
  await saveSidecar(repositoryPath, targetPath, sidecar);
  return commentThread;
}

export async function appendComment(input: AppendCommentInput): Promise<CommentThread> {
  const repositoryPath = getOpenRepositoryPath();
  const targetPath = toPosixPath(input.targetPath);
  const text = input.text.trim();
  const actor = await resolveActor(input.author);
  const timestamp = nowIso();
  const sidecar = await loadSidecar(repositoryPath, targetPath);

  if (!text) {
    throw new Error('Reply text cannot be empty.');
  }

  const comment = sidecar.comments.find((thread) => thread.id === input.commentId);
  if (!comment) {
    throw new Error(`Comment ${input.commentId} not found for ${targetPath}.`);
  }

  comment.thread.push({
    id: randomUUID(),
    author: actor,
    text,
    createdAt: timestamp
  });

  comment.updatedAt = timestamp;
  await saveSidecar(repositoryPath, targetPath, sidecar);
  return comment;
}

export async function closeComment(input: CloseCommentInput): Promise<CommentThread> {
  const repositoryPath = getOpenRepositoryPath();
  const targetPath = toPosixPath(input.targetPath);
  const sidecar = await loadSidecar(repositoryPath, targetPath);

  const comment = sidecar.comments.find((thread) => thread.id === input.commentId);
  if (!comment) {
    throw new Error(`Comment ${input.commentId} not found for ${targetPath}.`);
  }

  comment.state = 'closed';
  comment.updatedAt = nowIso();

  if (input.author?.trim()) {
    comment.thread.push({
      id: randomUUID(),
      author: input.author.trim(),
      text: '[closed]',
      createdAt: nowIso()
    });
  }

  await saveSidecar(repositoryPath, targetPath, sidecar);
  return comment;
}

export async function validateNoInlineComments(targetPath: string): Promise<boolean> {
  const repositoryPath = getOpenRepositoryPath();
  const absolutePath = ensurePathInsideRepo(repositoryPath, toPosixPath(targetPath));
  const content = await readFile(absolutePath, 'utf8');

  const disallowedPatterns = [/<!--\s*comment/i, /\[\/\/\]:\s*#\s*\(comment/i];
  return !disallowedPatterns.some((pattern) => pattern.test(content));
}
