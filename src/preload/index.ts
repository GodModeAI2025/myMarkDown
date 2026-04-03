import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppendCommentInput,
  AppMenuAction,
  AppResult,
  CloseCommentInput,
  CodeOwnerHintsResult,
  CommentScope,
  CommentThread,
  CreateCommentInput,
  FileContentResult,
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
  ReleaseGateStatus,
  ReleaseScope,
  ReleaseVersionInput,
  ReleaseVersionResult,
  SaveFileInput
} from '../shared/contracts';

const api = {
  openRepository(repositoryPath: string): Promise<AppResult<OpenRepositoryResult>> {
    return ipcRenderer.invoke('git:openRepository', repositoryPath);
  },
  getStatus(): Promise<AppResult<GitStatusResult>> {
    return ipcRenderer.invoke('git:getStatus');
  },
  getDiff(target: GitDiffTarget): Promise<AppResult<string>> {
    return ipcRenderer.invoke('git:getDiff', target);
  },
  getIdentity(): Promise<AppResult<GitIdentity>> {
    return ipcRenderer.invoke('git:getIdentity');
  },
  getIncomingDelta(options: GitRemoteTarget): Promise<AppResult<IncomingDeltaResult>> {
    return ipcRenderer.invoke('git:getIncomingDelta', options);
  },
  createBranch(input: GitCreateBranchInput): Promise<AppResult<string>> {
    return ipcRenderer.invoke('git:createBranch', input);
  },
  checkoutBranch(branchName: string): Promise<AppResult<string>> {
    return ipcRenderer.invoke('git:checkoutBranch', branchName);
  },
  setUpstream(options: GitRemoteTarget): Promise<AppResult<string>> {
    return ipcRenderer.invoke('git:setUpstream', options);
  },
  pickRepositoryDirectory(): Promise<AppResult<string | null>> {
    return ipcRenderer.invoke('app:pickRepositoryDirectory');
  },
  onMenuAction(listener: (action: AppMenuAction) => void): () => void {
    const channel = 'app:menuAction';
    const wrapped = (_event: Electron.IpcRendererEvent, action: AppMenuAction) => {
      listener(action);
    };

    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
  stage(paths: string[]): Promise<AppResult<null>> {
    return ipcRenderer.invoke('git:stage', paths);
  },
  unstage(paths: string[]): Promise<AppResult<null>> {
    return ipcRenderer.invoke('git:unstage', paths);
  },
  commit(message: string): Promise<AppResult<null>> {
    return ipcRenderer.invoke('git:commit', message);
  },
  fetch(options: GitRemoteTarget): Promise<AppResult<null>> {
    return ipcRenderer.invoke('git:fetch', options);
  },
  pull(options: GitRemoteTarget): Promise<AppResult<null>> {
    return ipcRenderer.invoke('git:pull', options);
  },
  push(options: GitRemoteTarget): Promise<AppResult<null>> {
    return ipcRenderer.invoke('git:push', options);
  },
  listMarkdownFiles(): Promise<AppResult<MarkdownFileEntry[]>> {
    return ipcRenderer.invoke('repo:listMarkdownFiles');
  },
  readMarkdownFile(targetPath: string): Promise<AppResult<FileContentResult>> {
    return ipcRenderer.invoke('repo:readMarkdownFile', targetPath);
  },
  writeMarkdownFile(input: SaveFileInput): Promise<AppResult<FileContentResult>> {
    return ipcRenderer.invoke('repo:writeMarkdownFile', input);
  },
  searchMarkdown(input: MarkdownSearchInput): Promise<AppResult<MarkdownSearchResult>> {
    return ipcRenderer.invoke('repo:searchMarkdown', input);
  },
  getCodeOwnerHints(paths: string[]): Promise<AppResult<CodeOwnerHintsResult>> {
    return ipcRenderer.invoke('repo:getCodeOwnerHints', paths);
  },
  getComments(scope: CommentScope): Promise<AppResult<CommentThread[]>> {
    return ipcRenderer.invoke('comments:get', scope);
  },
  createComment(input: CreateCommentInput): Promise<AppResult<CommentThread>> {
    return ipcRenderer.invoke('comments:create', input);
  },
  appendComment(input: AppendCommentInput): Promise<AppResult<CommentThread>> {
    return ipcRenderer.invoke('comments:append', input);
  },
  closeComment(input: CloseCommentInput): Promise<AppResult<CommentThread>> {
    return ipcRenderer.invoke('comments:close', input);
  },
  getOpenCommentCount(scope: CommentScope): Promise<AppResult<OpenCommentCountResult>> {
    return ipcRenderer.invoke('comments:getOpenCount', scope);
  },
  getCommentSidecarPath(targetPath: string): Promise<AppResult<string>> {
    return ipcRenderer.invoke('comments:getSidecarPath', targetPath);
  },
  validateNoInlineComments(targetPath: string): Promise<AppResult<boolean>> {
    return ipcRenderer.invoke('comments:validateNoInline', targetPath);
  },
  canReleaseVersion(scope: ReleaseScope): Promise<AppResult<ReleaseGateStatus>> {
    return ipcRenderer.invoke('release:can', scope);
  },
  releaseVersion(input: ReleaseVersionInput): Promise<AppResult<ReleaseVersionResult>> {
    return ipcRenderer.invoke('release:create', input);
  }
};

contextBridge.exposeInMainWorld('myMarkdown', api);
