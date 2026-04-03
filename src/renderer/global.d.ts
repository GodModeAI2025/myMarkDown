import type {
  AppendCommentInput,
  AppResult,
  CloseCommentInput,
  CodeOwnerHintsResult,
  CommentScope,
  CommentThread,
  CreateCommentInput,
  FileContentResult,
  GitIdentity,
  GitDiffTarget,
  GitRemoteTarget,
  GitStatusResult,
  IncomingDeltaResult,
  MarkdownFileEntry,
  OpenCommentCountResult,
  OpenRepositoryResult,
  ReleaseGateStatus,
  ReleaseScope,
  ReleaseVersionInput,
  ReleaseVersionResult,
  SaveFileInput
} from '../shared/contracts';

declare global {
  interface Window {
    myMarkdown: {
      openRepository(repositoryPath: string): Promise<AppResult<OpenRepositoryResult>>;
      getStatus(): Promise<AppResult<GitStatusResult>>;
      getDiff(target: GitDiffTarget): Promise<AppResult<string>>;
      getIdentity(): Promise<AppResult<GitIdentity>>;
      getIncomingDelta(options: GitRemoteTarget): Promise<AppResult<IncomingDeltaResult>>;
      stage(paths: string[]): Promise<AppResult<null>>;
      unstage(paths: string[]): Promise<AppResult<null>>;
      commit(message: string): Promise<AppResult<null>>;
      fetch(options: GitRemoteTarget): Promise<AppResult<null>>;
      pull(options: GitRemoteTarget): Promise<AppResult<null>>;
      push(options: GitRemoteTarget): Promise<AppResult<null>>;
      listMarkdownFiles(): Promise<AppResult<MarkdownFileEntry[]>>;
      readMarkdownFile(targetPath: string): Promise<AppResult<FileContentResult>>;
      writeMarkdownFile(input: SaveFileInput): Promise<AppResult<FileContentResult>>;
      getCodeOwnerHints(paths: string[]): Promise<AppResult<CodeOwnerHintsResult>>;
      getComments(scope: CommentScope): Promise<AppResult<CommentThread[]>>;
      createComment(input: CreateCommentInput): Promise<AppResult<CommentThread>>;
      appendComment(input: AppendCommentInput): Promise<AppResult<CommentThread>>;
      closeComment(input: CloseCommentInput): Promise<AppResult<CommentThread>>;
      getOpenCommentCount(scope: CommentScope): Promise<AppResult<OpenCommentCountResult>>;
      getCommentSidecarPath(targetPath: string): Promise<AppResult<string>>;
      validateNoInlineComments(targetPath: string): Promise<AppResult<boolean>>;
      canReleaseVersion(scope: ReleaseScope): Promise<AppResult<ReleaseGateStatus>>;
      releaseVersion(input: ReleaseVersionInput): Promise<AppResult<ReleaseVersionResult>>;
    };
  }
}

export {};
