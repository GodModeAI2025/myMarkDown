import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import {
  commit,
  fetch,
  getDiff,
  getGitIdentity,
  getIncomingDelta,
  getStatus,
  openRepository,
  pull,
  push,
  stage,
  unstage
} from './gitAdapter';
import { listMarkdownFiles, readMarkdownFile, writeMarkdownFile } from './repositoryFiles';
import { getCodeOwnerHints } from './codeownersService';
import {
  appendComment,
  closeComment,
  createComment,
  getCommentSidecarPath,
  getComments,
  getOpenCommentCount,
  validateNoInlineComments
} from './commentsService';
import { canReleaseVersion, releaseVersion } from './releaseService';
import type {
  AppendCommentInput,
  AppError,
  AppResult,
  CloseCommentInput,
  CommentScope,
  CommentThread,
  CodeOwnerHintsResult,
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

const isMac = process.platform === 'darwin';

function toAppError(error: unknown): AppError {
  if (error instanceof Error) {
    const candidate = error as Error & {
      code?: unknown;
      hint?: unknown;
      raw?: unknown;
    };

    return {
      code: typeof candidate.code === 'string' ? candidate.code : 'APP_ERROR',
      message: error.message,
      hint: typeof candidate.hint === 'string' ? candidate.hint : undefined,
      raw: typeof candidate.raw === 'string' ? candidate.raw : undefined
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: 'Unknown error'
  };
}

function success<T>(data: T): AppResult<T> {
  return { ok: true, data };
}

function failure<T>(error: unknown): AppResult<T> {
  return { ok: false, error: toAppError(error) };
}

async function runMutation(action: () => Promise<void>): Promise<AppResult<null>> {
  try {
    await action();
    return success(null);
  } catch (error) {
    return failure(error);
  }
}

async function runQuery<T>(query: () => Promise<T>): Promise<AppResult<T>> {
  try {
    return success(await query());
  } catch (error) {
    return failure(error);
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('git:openRepository', async (_event, repositoryPath: string): Promise<AppResult<OpenRepositoryResult>> =>
    runQuery(async () => ({ repositoryPath: await openRepository(repositoryPath) }))
  );

  ipcMain.handle('git:getStatus', async (): Promise<AppResult<GitStatusResult>> => runQuery(() => getStatus()));

  ipcMain.handle('git:getDiff', async (_event, target: GitDiffTarget): Promise<AppResult<string>> =>
    runQuery(() => getDiff(target))
  );

  ipcMain.handle('git:getIdentity', async (): Promise<AppResult<GitIdentity>> => runQuery(() => getGitIdentity()));

  ipcMain.handle(
    'git:getIncomingDelta',
    async (_event, options: GitRemoteTarget): Promise<AppResult<IncomingDeltaResult>> =>
      runQuery(() => getIncomingDelta(options))
  );

  ipcMain.handle('git:stage', async (_event, paths: string[]): Promise<AppResult<null>> => runMutation(() => stage(paths)));

  ipcMain.handle('git:unstage', async (_event, paths: string[]): Promise<AppResult<null>> =>
    runMutation(() => unstage(paths))
  );

  ipcMain.handle('git:commit', async (_event, message: string): Promise<AppResult<null>> => runMutation(() => commit(message)));

  ipcMain.handle('git:fetch', async (_event, options: GitRemoteTarget): Promise<AppResult<null>> =>
    runMutation(() => fetch(options))
  );

  ipcMain.handle('git:pull', async (_event, options: GitRemoteTarget): Promise<AppResult<null>> =>
    runMutation(() => pull(options))
  );

  ipcMain.handle('git:push', async (_event, options: GitRemoteTarget): Promise<AppResult<null>> =>
    runMutation(() => push(options))
  );

  ipcMain.handle('repo:listMarkdownFiles', async (): Promise<AppResult<MarkdownFileEntry[]>> =>
    runQuery(() => listMarkdownFiles())
  );

  ipcMain.handle('repo:readMarkdownFile', async (_event, targetPath: string): Promise<AppResult<FileContentResult>> =>
    runQuery(() => readMarkdownFile(targetPath))
  );

  ipcMain.handle('repo:writeMarkdownFile', async (_event, input: SaveFileInput): Promise<AppResult<FileContentResult>> =>
    runQuery(() => writeMarkdownFile(input))
  );

  ipcMain.handle('repo:getCodeOwnerHints', async (_event, paths: string[]): Promise<AppResult<CodeOwnerHintsResult>> =>
    runQuery(() => getCodeOwnerHints(paths))
  );

  ipcMain.handle('comments:get', async (_event, scope: CommentScope): Promise<AppResult<CommentThread[]>> =>
    runQuery(() => getComments(scope))
  );

  ipcMain.handle('comments:create', async (_event, input: CreateCommentInput): Promise<AppResult<CommentThread>> =>
    runQuery(() => createComment(input))
  );

  ipcMain.handle('comments:append', async (_event, input: AppendCommentInput): Promise<AppResult<CommentThread>> =>
    runQuery(() => appendComment(input))
  );

  ipcMain.handle('comments:close', async (_event, input: CloseCommentInput): Promise<AppResult<CommentThread>> =>
    runQuery(() => closeComment(input))
  );

  ipcMain.handle('comments:getOpenCount', async (_event, scope: CommentScope): Promise<AppResult<OpenCommentCountResult>> =>
    runQuery(() => getOpenCommentCount(scope))
  );

  ipcMain.handle('comments:getSidecarPath', async (_event, targetPath: string): Promise<AppResult<string>> =>
    runQuery(async () => getCommentSidecarPath(targetPath))
  );

  ipcMain.handle('comments:validateNoInline', async (_event, targetPath: string): Promise<AppResult<boolean>> =>
    runQuery(() => validateNoInlineComments(targetPath))
  );

  ipcMain.handle('release:can', async (_event, scope: ReleaseScope): Promise<AppResult<ReleaseGateStatus>> =>
    runQuery(() => canReleaseVersion(scope))
  );

  ipcMain.handle('release:create', async (_event, input: ReleaseVersionInput): Promise<AppResult<ReleaseVersionResult>> =>
    runQuery(() => releaseVersion(input))
  );
}

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    title: 'myMarkDown',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    win.loadURL(devServerUrl).catch((error) => {
      console.error('Failed to load dev server URL', error);
    });
    win.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  win.loadFile(path.join(__dirname, '../renderer/index.html')).catch((error) => {
    console.error('Failed to load renderer index.html', error);
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit();
  }
});
