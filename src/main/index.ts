import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import type { MenuItemConstructorOptions, OpenDialogOptions } from 'electron';
import {
  checkoutBranch,
  connectRepository,
  commit,
  createBranch,
  fetch,
  getDiff,
  getGitIdentity,
  getIncomingDelta,
  getRuntimeInfo,
  getStatus,
  openDemoRepository,
  openRepository,
  pull,
  push,
  resolveConflict,
  setUpstream,
  stage,
  unstage
} from './gitAdapter';
import {
  bootstrapProjectStructureIfEmpty,
  getRepositoryState,
  listMarkdownFiles,
  readMarkdownFile,
  searchMarkdown,
  writeMarkdownFile
} from './repositoryFiles';
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
  AppMenuAction,
  AppError,
  RuntimeInfo,
  AppResult,
  ConnectRepositoryInput,
  ConnectRepositoryResult,
  CloseCommentInput,
  CommentScope,
  CommentThread,
  CodeOwnerHintsResult,
  CreateCommentInput,
  FileContentResult,
  BootstrapProjectResult,
  GitConflictResolveInput,
  GitCreateBranchInput,
  GitIdentity,
  GitDiffTarget,
  GitRemoteTarget,
  GitStatusResult,
  IncomingDeltaResult,
  MarkdownSearchInput,
  MarkdownSearchResult,
  MarkdownFileEntry,
  OpenCommentCountResult,
  OpenRepositoryResult,
  RepositoryState,
  ReleaseGateStatus,
  ReleaseScope,
  ReleaseVersionInput,
  ReleaseVersionResult,
  SaveFileInput
} from '../shared/contracts';

const isMac = process.platform === 'darwin';
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let workflowsWindow: BrowserWindow | null = null;
type UtilityWindowKind = 'settings' | 'workflows';

function emitMenuAction(action: AppMenuAction): void {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const targetWindow = focusedWindow && !focusedWindow.isDestroyed() ? focusedWindow : mainWindow;
  targetWindow?.webContents.send('app:menuAction', action);
}

function closeWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) {
    return;
  }

  win.close();
}

function loadRendererWindow(win: BrowserWindow, windowKind: UtilityWindowKind | null): void {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    const targetUrl = new URL(devServerUrl);
    if (windowKind) {
      targetUrl.searchParams.set('window', windowKind);
      targetUrl.hash = `window=${windowKind}`;
    }

    win.loadURL(targetUrl.toString()).catch((error) => {
      console.error('Failed to load renderer URL', error);
    });
    return;
  }

  const rendererIndexPath = path.join(__dirname, '../renderer/index.html');
  const loadOptions = windowKind ? { query: { window: windowKind }, hash: `window=${windowKind}` } : undefined;
  win.loadFile(rendererIndexPath, loadOptions).catch((error) => {
    console.error('Failed to load renderer index.html', error);
  });
}

function createUtilityWindow(windowKind: UtilityWindowKind): BrowserWindow {
  const existingWindow = windowKind === 'settings' ? settingsWindow : workflowsWindow;
  if (existingWindow && !existingWindow.isDestroyed()) {
    existingWindow.focus();
    return existingWindow;
  }

  const win = new BrowserWindow({
    width: 1040,
    height: 780,
    minWidth: 860,
    minHeight: 620,
    title: windowKind === 'settings' ? 'myMarkDown Settings' : 'myMarkDown Workflows',
    parent: mainWindow ?? undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (windowKind === 'settings') {
    settingsWindow = win;
  } else {
    workflowsWindow = win;
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    if (windowKind === 'settings' && settingsWindow === win) {
      settingsWindow = null;
      return;
    }

    if (windowKind === 'workflows' && workflowsWindow === win) {
      workflowsWindow = null;
    }
  });

  loadRendererWindow(win, windowKind);
  return win;
}

function configureApplicationMenu(): void {
  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'Open Repository...',
        accelerator: 'CmdOrCtrl+O',
        click: () => emitMenuAction('open-repository')
      },
      { type: 'separator' },
      {
        label: 'Refresh Status',
        accelerator: 'CmdOrCtrl+R',
        click: () => emitMenuAction('refresh-status')
      },
      { type: 'separator' },
      {
        label: 'Save File',
        accelerator: 'CmdOrCtrl+S',
        click: () => emitMenuAction('save-file')
      },
      {
        label: 'Commit',
        accelerator: 'CmdOrCtrl+Enter',
        click: () => emitMenuAction('commit')
      },
      { type: 'separator' },
      {
        label: 'Fetch',
        accelerator: 'Shift+CmdOrCtrl+F',
        click: () => emitMenuAction('fetch')
      },
      {
        label: 'Pull (Rebase)',
        accelerator: 'Shift+CmdOrCtrl+P',
        click: () => emitMenuAction('pull')
      },
      {
        label: 'Push',
        accelerator: 'Shift+CmdOrCtrl+U',
        click: () => emitMenuAction('push')
      },
      {
        label: 'Incoming Delta',
        accelerator: 'Alt+CmdOrCtrl+I',
        click: () => emitMenuAction('incoming-delta')
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      { type: 'separator' },
      {
        label: 'Find in Markdown',
        accelerator: 'CmdOrCtrl+F',
        click: () => emitMenuAction('focus-search')
      }
    ]
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      {
        label: 'Open Settings Window',
        accelerator: 'CmdOrCtrl+,',
        click: () => {
          createUtilityWindow('settings');
        }
      },
      {
        label: 'Open Workflow Window',
        accelerator: 'Shift+CmdOrCtrl+W',
        click: () => {
          createUtilityWindow('workflows');
        }
      },
      { type: 'separator' },
      {
        label: 'Toggle Zen Mode',
        accelerator: 'Alt+CmdOrCtrl+Z',
        click: () => emitMenuAction('toggle-zen-mode')
      },
      {
        label: 'Toggle Left Sidebar',
        accelerator: 'Alt+CmdOrCtrl+1',
        click: () => emitMenuAction('toggle-left-sidebar')
      },
      {
        label: 'Toggle Right Sidebar',
        accelerator: 'Alt+CmdOrCtrl+2',
        click: () => emitMenuAction('toggle-right-sidebar')
      },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  };

  const menuTemplate: MenuItemConstructorOptions[] = [];
  if (isMac) {
    menuTemplate.push({ role: 'appMenu' });
  }

  menuTemplate.push(fileMenu, editMenu, viewMenu, { role: 'windowMenu' });
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

async function pickRepositoryDirectory(): Promise<string | null> {
  const dialogOptions: OpenDialogOptions = {
    title: 'Open Git Repository',
    properties: ['openDirectory']
  };
  const ownerWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;
  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
}

async function prepareDemoWorkspacePath(): Promise<string> {
  const demoRoot = path.join(app.getPath('userData'), 'myMarkDown-demo-workspace');
  await mkdir(demoRoot, { recursive: true });
  return demoRoot;
}

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
  ipcMain.handle('repo:connect', async (_event, input: ConnectRepositoryInput): Promise<AppResult<ConnectRepositoryResult>> =>
    runQuery(() => connectRepository(input))
  );

  ipcMain.handle('git:openRepository', async (_event, repositoryPath: string): Promise<AppResult<OpenRepositoryResult>> =>
    runQuery(async () => ({ repositoryPath: await openRepository(repositoryPath) }))
  );

  ipcMain.handle('git:getStatus', async (): Promise<AppResult<GitStatusResult>> => runQuery(() => getStatus()));

  ipcMain.handle('git:getDiff', async (_event, target: GitDiffTarget): Promise<AppResult<string>> =>
    runQuery(() => getDiff(target))
  );

  ipcMain.handle('git:getIdentity', async (): Promise<AppResult<GitIdentity>> => runQuery(() => getGitIdentity()));

  ipcMain.handle('app:getRuntimeInfo', async (): Promise<AppResult<RuntimeInfo>> => runQuery(() => getRuntimeInfo()));

  ipcMain.handle('git:resolveConflict', async (_event, input: GitConflictResolveInput): Promise<AppResult<null>> =>
    runMutation(() => resolveConflict(input))
  );

  ipcMain.handle(
    'git:getIncomingDelta',
    async (_event, options: GitRemoteTarget): Promise<AppResult<IncomingDeltaResult>> =>
      runQuery(() => getIncomingDelta(options))
  );

  ipcMain.handle('git:createBranch', async (_event, input: GitCreateBranchInput): Promise<AppResult<string>> =>
    runQuery(() => createBranch(input))
  );

  ipcMain.handle('git:checkoutBranch', async (_event, branchName: string): Promise<AppResult<string>> =>
    runQuery(() => checkoutBranch(branchName))
  );

  ipcMain.handle('git:setUpstream', async (_event, options: GitRemoteTarget): Promise<AppResult<string>> =>
    runQuery(() => setUpstream(options))
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

  ipcMain.handle('app:pickRepositoryDirectory', async (): Promise<AppResult<string | null>> =>
    runQuery(() => pickRepositoryDirectory())
  );

  ipcMain.handle('app:openDemoWorkspace', async (): Promise<AppResult<OpenRepositoryResult>> =>
    runQuery(async () => {
      const demoPath = await prepareDemoWorkspacePath();
      await openDemoRepository(demoPath);
      await bootstrapProjectStructureIfEmpty();
      return { repositoryPath: demoPath };
    })
  );

  ipcMain.handle('app:openSettingsWindow', async (): Promise<AppResult<boolean>> =>
    runQuery(async () => {
      createUtilityWindow('settings');
      return true;
    })
  );

  ipcMain.handle('app:openWorkflowWindow', async (): Promise<AppResult<boolean>> =>
    runQuery(async () => {
      createUtilityWindow('workflows');
      return true;
    })
  );

  ipcMain.handle('repo:listMarkdownFiles', async (): Promise<AppResult<MarkdownFileEntry[]>> =>
    runQuery(() => listMarkdownFiles())
  );

  ipcMain.handle('repo:getState', async (): Promise<AppResult<RepositoryState>> => runQuery(() => getRepositoryState()));

  ipcMain.handle('repo:bootstrapIfEmpty', async (): Promise<AppResult<BootstrapProjectResult>> =>
    runQuery(() => bootstrapProjectStructureIfEmpty())
  );

  ipcMain.handle('repo:readMarkdownFile', async (_event, targetPath: string): Promise<AppResult<FileContentResult>> =>
    runQuery(() => readMarkdownFile(targetPath))
  );

  ipcMain.handle('repo:writeMarkdownFile', async (_event, input: SaveFileInput): Promise<AppResult<FileContentResult>> =>
    runQuery(() => writeMarkdownFile(input))
  );

  ipcMain.handle('repo:searchMarkdown', async (_event, input: MarkdownSearchInput): Promise<AppResult<MarkdownSearchResult>> =>
    runQuery(() => searchMarkdown(input))
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
  mainWindow = win;
  configureApplicationMenu();
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
      closeWindow(settingsWindow);
      closeWindow(workflowsWindow);
      settingsWindow = null;
      workflowsWindow = null;
    }
  });

  loadRendererWindow(win, null);
  if (process.env.VITE_DEV_SERVER_URL) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  configureApplicationMenu();
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
