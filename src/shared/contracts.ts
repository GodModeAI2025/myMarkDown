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

export interface GitCreateBranchInput {
  name: string;
  from?: string;
  checkout?: boolean;
}

export interface GitConflictResolveInput {
  path: string;
  strategy: 'ours' | 'theirs';
}

export type AppMenuAction =
  | 'open-repository'
  | 'refresh-status'
  | 'save-file'
  | 'commit'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'incoming-delta'
  | 'focus-search'
  | 'toggle-left-sidebar'
  | 'toggle-right-sidebar';

export interface GitIdentity {
  name: string | null;
  email: string | null;
}

export interface IncomingDeltaResult {
  baseRef: string;
  remoteRef: string | null;
  incomingCommitCount: number;
  incomingFiles: string[];
  conflictCandidates: string[];
}

export interface MarkdownSearchInput {
  query: string;
  maxResults?: number;
}

export interface MarkdownSearchMatch {
  path: string;
  line: number;
  excerpt: string;
}

export interface MarkdownSearchResult {
  query: string;
  totalMatches: number;
  truncated: boolean;
  items: MarkdownSearchMatch[];
}

export interface MarkdownFileEntry {
  path: string;
}

export interface RepositoryState {
  repositoryPath: string;
  hasCommits: boolean;
  trackedFileCount: number;
  untrackedFileCount: number;
  isEmpty: boolean;
}

export interface BootstrapProjectResult {
  skipped: boolean;
  reason?: string;
  createdDirectories: string[];
  createdFiles: string[];
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

export interface CodeOwnerHint {
  path: string;
  owners: string[];
  matchedPattern: string | null;
  sourceLine: number | null;
}

export interface CodeOwnerHintsResult {
  hasCodeownersFile: boolean;
  codeownersPath: string | null;
  hints: CodeOwnerHint[];
}
