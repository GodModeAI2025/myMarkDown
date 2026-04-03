export interface AppError {
  code: string;
  message: string;
  hint?: string;
  raw?: string;
}

export type AppResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: AppError;
    };

export interface OpenRepositoryResult {
  repositoryPath: string;
}

export interface GitStatusEntry {
  path: string;
  indexStatus: string;
  workTreeStatus: string;
  originalPath?: string;
}

export interface GitStatusResult {
  repositoryPath: string;
  branch: string | null;
  trackingBranch: string | null;
  ahead: number;
  behind: number;
  isClean: boolean;
  files: GitStatusEntry[];
}

export interface GitDiffTarget {
  pathspec?: string;
  staged?: boolean;
  ref?: string;
}

export interface GitRemoteTarget {
  remote?: string;
  branch?: string;
}

export interface GitIdentity {
  name: string | null;
  email: string | null;
}

export interface MarkdownFileEntry {
  path: string;
}

export interface FileContentResult {
  path: string;
  content: string;
}

export interface SaveFileInput {
  path: string;
  content: string;
}

export type EditorMode = 'wysiwyg' | 'markdown';

export interface CommentAnchor {
  line?: number;
  excerpt?: string;
}

export interface CommentMessage {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

export interface CommentThread {
  id: string;
  targetPath: string;
  anchor: CommentAnchor;
  author: string;
  state: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
  thread: CommentMessage[];
}

export interface CommentScope {
  paths?: string[];
}

export interface CreateCommentInput {
  targetPath: string;
  text: string;
  line?: number;
  excerpt?: string;
  author?: string;
}

export interface AppendCommentInput {
  targetPath: string;
  commentId: string;
  text: string;
  author?: string;
}

export interface CloseCommentInput {
  targetPath: string;
  commentId: string;
  author?: string;
}

export interface OpenCommentCountResult {
  openComments: number;
  totalComments: number;
}

export interface ReleaseScope {
  targetRef: string;
  paths: string[];
  releaseId: string;
}

export interface ReleaseGateStatus {
  releasable: boolean;
  openComments: number;
  blockingCommentIds: string[];
}

export interface ReleaseVersionInput extends ReleaseScope {
  pushTag?: boolean;
  remote?: string;
}

export interface ReleaseVersionResult {
  tag: string;
  targetRef: string;
  pushed: boolean;
}
