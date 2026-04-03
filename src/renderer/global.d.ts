import type {
  AppendCommentInput,
  AppMenuAction,
  AppResult,
  BootstrapProjectResult,
  ConnectRepositoryInput,
  ConnectRepositoryResult,
  CloseCommentInput,
  CodeOwnerHintsResult,
  CommentScope,
  CommentThread,
  CreateCommentInput,
  FileContentResult,
  GitConflictResolveInput,
  GitCreateBranchInput,
  GitIdentity,
  GitDiffTarget,
  GitRemoteTarget,
  GitStatusResult,
  IncomingDeltaResult,
  MarkdownFileEntry,
  MarkdownSearchInput,
  MarkdownSearchResult,
  OpenCommentCountResult,
  OpenRepositoryResult,
  RuntimeInfo,
  RepositoryState,
  ReleaseGateStatus,
  ReleaseScope,
  ReleaseVersionInput,
  ReleaseVersionResult,
  SaveFileInput
} from '../shared/contracts';

declare global {
  interface Window {
    myMarkdown: {
      connectRepository(input: ConnectRepositoryInput): Promise<AppResult<ConnectRepositoryResult>>;
      openRepository(repositoryPath: string): Promise<AppResult<OpenRepositoryResult>>;
      getRuntimeInfo(): Promise<AppResult<RuntimeInfo>>;
      getStatus(): Promise<AppResult<GitStatusResult>>;
      getDiff(target: GitDiffTarget): Promise<AppResult<string>>;
      getIdentity(): Promise<AppResult<GitIdentity>>;
      resolveConflict(input: GitConflictResolveInput): Promise<AppResult<null>>;
      getIncomingDelta(options: GitRemoteTarget): Promise<AppResult<IncomingDeltaResult>>;
      createBranch(input: GitCreateBranchInput): Promise<AppResult<string>>;
      checkoutBranch(branchName: string): Promise<AppResult<string>>;
      setUpstream(options: GitRemoteTarget): Promise<AppResult<string>>;
      pickRepositoryDirectory(): Promise<AppResult<string | null>>;
      openDemoWorkspace(): Promise<AppResult<OpenRepositoryResult>>;
      openSettingsWindow(): Promise<AppResult<boolean>>;
      openWorkflowWindow(): Promise<AppResult<boolean>>;
      onMenuAction(listener: (action: AppMenuAction) => void): () => void;
      stage(paths: string[]): Promise<AppResult<null>>;
      unstage(paths: string[]): Promise<AppResult<null>>;
      commit(message: string): Promise<AppResult<null>>;
      fetch(options: GitRemoteTarget): Promise<AppResult<null>>;
      pull(options: GitRemoteTarget): Promise<AppResult<null>>;
      push(options: GitRemoteTarget): Promise<AppResult<null>>;
      listMarkdownFiles(): Promise<AppResult<MarkdownFileEntry[]>>;
      getRepositoryState(): Promise<AppResult<RepositoryState>>;
      bootstrapProjectStructureIfEmpty(): Promise<AppResult<BootstrapProjectResult>>;
      readMarkdownFile(targetPath: string): Promise<AppResult<FileContentResult>>;
      writeMarkdownFile(input: SaveFileInput): Promise<AppResult<FileContentResult>>;
      searchMarkdown(input: MarkdownSearchInput): Promise<AppResult<MarkdownSearchResult>>;
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
