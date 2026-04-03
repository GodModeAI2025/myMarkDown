import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor as ToastEditor } from '@toast-ui/editor';
import type {
  AppMenuAction,
  AppResult,
  CommentThread,
  CodeOwnerHint,
  EditorMode,
  GitDiffTarget,
  GitStatusEntry,
  GitStatusResult,
  IncomingDeltaResult,
  MarkdownFileEntry,
  MarkdownSearchResult,
  RemoteAuthMode,
  RuntimeInfo,
  ReleaseGateStatus
} from '../shared/contracts';

type Notice = {
  kind: 'info' | 'error';
  text: string;
};

type ReleaseScopeType = 'active' | 'all';
type Locale = 'de' | 'en';
type ThemeMode = 'light' | 'dark';
type RightSidebarTab = 'comments' | 'outline' | 'insights';

type HeadingItem = {
  line: number;
  level: number;
  text: string;
};

type SetupConfig = {
  repositoryPath: string;
  remote: string;
  defaultBranch: string;
  remoteUrl?: string;
  authMode?: RemoteAuthMode;
  configuredAt: string;
};

type MenuRuntimeState = {
  busy: boolean;
  isRepoOpen: boolean;
  isDemoMode: boolean;
  hasCommitMessage: boolean;
  openRepositoryPicker: () => void;
  refreshStatus: () => void;
  saveActiveFile: () => void;
  commitChanges: () => void;
  fetchRemote: () => void;
  pullRemote: () => void;
  pushRemote: () => void;
  refreshIncomingDelta: () => void;
};

const SETUP_CONFIG_KEY = 'mymarkdown:setup:v1';

function statusLabel(entry: GitStatusEntry): string {
  return `${entry.indexStatus}${entry.workTreeStatus}`.trim();
}

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

function isConflictEntry(entry: GitStatusEntry): boolean {
  return CONFLICT_CODES.has(`${entry.indexStatus}${entry.workTreeStatus}`);
}

function normalizeReleaseId(input: string): string {
  return input.trim().replace(/\s+/g, '-');
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/').trim();
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((item) => normalizePath(item)).filter(Boolean))];
}

function draftStorageKey(repositoryPath: string, targetPath: string): string {
  return `mymarkdown:draft:${encodeURIComponent(repositoryPath)}:${encodeURIComponent(targetPath)}`;
}

function extractHeadings(markdown: string): HeadingItem[] {
  const lines = markdown.split(/\r?\n/);
  const headings: HeadingItem[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }

    headings.push({
      line: index + 1,
      level: match[1].length,
      text: match[2]
    });
  }

  return headings;
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const name = normalized.split('/').pop();
  return name && name.length > 0 ? name : path;
}

function loadLocale(): Locale {
  const value = localStorage.getItem('mymarkdown:locale');
  return value === 'de' ? 'de' : 'en';
}

function loadTheme(): ThemeMode {
  const value = localStorage.getItem('mymarkdown:theme');
  return value === 'dark' ? 'dark' : 'light';
}

function loadSetupConfig(): SetupConfig | null {
  try {
    const raw = localStorage.getItem(SETUP_CONFIG_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<SetupConfig>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    if (
      typeof parsed.repositoryPath !== 'string' ||
      typeof parsed.remote !== 'string' ||
      typeof parsed.defaultBranch !== 'string'
    ) {
      return null;
    }

    const repositoryPath = parsed.repositoryPath.trim();
    const remote = parsed.remote.trim() || 'origin';
    const defaultBranch = parsed.defaultBranch.trim();
    if (!repositoryPath) {
      return null;
    }

    return {
      repositoryPath,
      remote,
      defaultBranch,
      remoteUrl: typeof parsed.remoteUrl === 'string' ? parsed.remoteUrl.trim() : undefined,
      authMode: parsed.authMode === 'https-token' ? 'https-token' : 'system',
      configuredAt: typeof parsed.configuredAt === 'string' ? parsed.configuredAt : new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function persistSetupConfig(config: SetupConfig): void {
  try {
    localStorage.setItem(SETUP_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Ignore local storage errors.
  }
}

export default function App(): JSX.Element {
  const editorMountRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<ToastEditor | null>(null);
  const suppressChangeRef = useRef(false);
  const repoInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const commitInputRef = useRef<HTMLInputElement | null>(null);
  const autoOpenAttemptedRef = useRef(false);
  const menuRuntimeRef = useRef<MenuRuntimeState>({
    busy: false,
    isRepoOpen: false,
    isDemoMode: false,
    hasCommitMessage: false,
    openRepositoryPicker: () => {},
    refreshStatus: () => {},
    saveActiveFile: () => {},
    commitChanges: () => {},
    fetchRemote: () => {},
    pullRemote: () => {},
    pushRemote: () => {},
    refreshIncomingDelta: () => {}
  });
  const initialSetupConfig = useMemo(() => loadSetupConfig(), []);

  const [showOnboarding, setShowOnboarding] = useState(() => initialSetupConfig === null);
  const [repoInput, setRepoInput] = useState(initialSetupConfig?.repositoryPath ?? '');
  const [onboardingRemoteUrl, setOnboardingRemoteUrl] = useState(initialSetupConfig?.remoteUrl ?? '');
  const [onboardingAuthMode, setOnboardingAuthMode] = useState<RemoteAuthMode>(initialSetupConfig?.authMode ?? 'system');
  const [onboardingRemoteUsername, setOnboardingRemoteUsername] = useState('');
  const [onboardingRemoteToken, setOnboardingRemoteToken] = useState('');
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo>({
    gitAvailable: true,
    mode: 'git',
    repositoryOpen: false
  });
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [selectedChangedPath, setSelectedChangedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  const [locale, setLocale] = useState<Locale>(loadLocale);
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadTheme);
  const [notice, setNotice] = useState<Notice>({ kind: 'info', text: 'Open a repository to get started.' });
  const [busy, setBusy] = useState(false);

  const [commitMessage, setCommitMessage] = useState('');
  const [remoteInput, setRemoteInput] = useState(initialSetupConfig?.remote || 'origin');
  const [branchInput, setBranchInput] = useState(initialSetupConfig?.defaultBranch || '');
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchFromRef, setNewBranchFromRef] = useState('HEAD');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<MarkdownSearchResult | null>(null);
  const [controlTab, setControlTab] = useState<'sync' | 'branch' | 'search'>('sync');
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [rightSidebarTab, setRightSidebarTab] = useState<RightSidebarTab>('comments');
  const [editorSnapshot, setEditorSnapshot] = useState('');

  const [gitIdentity, setGitIdentity] = useState<string>('unknown');
  const [markdownFiles, setMarkdownFiles] = useState<MarkdownFileEntry[]>([]);
  const [activeMarkdownPath, setActiveMarkdownPath] = useState('');
  const [editorMode, setEditorMode] = useState<EditorMode>('wysiwyg');
  const [editorDirty, setEditorDirty] = useState(false);

  const [comments, setComments] = useState<CommentThread[]>([]);
  const [newCommentText, setNewCommentText] = useState('');
  const [newCommentLine, setNewCommentLine] = useState('');
  const [activeCommentId, setActiveCommentId] = useState('');
  const [replyText, setReplyText] = useState('');
  const [commentSidecarPath, setCommentSidecarPath] = useState('');
  const [codeownerHintsByPath, setCodeownerHintsByPath] = useState<Record<string, CodeOwnerHint>>({});
  const [hasCodeownersFile, setHasCodeownersFile] = useState(false);
  const [codeownersPath, setCodeownersPath] = useState('');
  const [incomingDelta, setIncomingDelta] = useState<IncomingDeltaResult | null>(null);

  const [releaseTargetRef, setReleaseTargetRef] = useState('HEAD');
  const [releaseId, setReleaseId] = useState('release/v0.1.0');
  const [releaseScopeType, setReleaseScopeType] = useState<ReleaseScopeType>('active');
  const [pushReleaseTag, setPushReleaseTag] = useState(true);
  const [releaseGate, setReleaseGate] = useState<ReleaseGateStatus | null>(null);

  const changedFiles = status?.files ?? [];
  const conflictFiles = changedFiles.filter((entry) => isConflictEntry(entry));
  const selectedChangedEntry = selectedChangedPath
    ? changedFiles.find((entry) => entry.path === selectedChangedPath) ?? null
    : null;
  const selectedIsConflict = selectedChangedEntry ? isConflictEntry(selectedChangedEntry) : false;
  const isDemoMode = runtimeInfo.mode === 'demo';
  const isRepoOpen = status !== null;
  const tt = (en: string, de: string): string => (locale === 'de' ? de : en);
  const activeCodeownerHint = activeMarkdownPath
    ? codeownerHintsByPath[normalizePath(activeMarkdownPath)] ?? null
    : null;

  const branchSummary = useMemo(() => {
    if (!status) {
      return tt('No repository selected', 'Kein Repository ausgewählt');
    }

    const branch = status.branch ?? tt('detached HEAD', 'detached HEAD');
    const tracking = status.trackingBranch ? ` -> ${status.trackingBranch}` : '';
    return `${branch}${tracking} | ${tt('ahead', 'voraus')} ${status.ahead} / ${tt('behind', 'hinterher')} ${status.behind}`;
  }, [status, locale]);

  const releaseScopePaths = useMemo(() => {
    if (releaseScopeType === 'active') {
      return activeMarkdownPath ? [activeMarkdownPath] : [];
    }

    return markdownFiles.map((file) => file.path);
  }, [activeMarkdownPath, markdownFiles, releaseScopeType]);

  const openCommentsInPanel = comments.filter((comment) => comment.state === 'open').length;
  const headingItems = useMemo(() => extractHeadings(editorSnapshot), [editorSnapshot]);
  const windowTitle = activeMarkdownPath ? fileNameFromPath(activeMarkdownPath) : tt('Workspace', 'Arbeitsbereich');

  const editorInsights = useMemo(() => {
    const plain = editorSnapshot.replace(/```[\s\S]*?```/g, ' ');
    const lines = editorSnapshot.length === 0 ? 0 : editorSnapshot.split(/\r?\n/).length;
    const words = plain.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9_-]+/g) ?? [];
    const wordCount = words.length;
    const charCount = editorSnapshot.length;
    const readingMinutes = wordCount === 0 ? 0 : Math.max(1, Math.ceil(wordCount / 220));

    const frequency = new Map<string, number>();
    words.forEach((word) => {
      const key = word.toLowerCase();
      if (key.length < 4) {
        return;
      }

      frequency.set(key, (frequency.get(key) ?? 0) + 1);
    });

    const topWords = [...frequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      lines,
      wordCount,
      charCount,
      readingMinutes,
      headingCount: headingItems.length,
      topWords
    };
  }, [editorSnapshot, headingItems.length]);

  menuRuntimeRef.current = {
    busy,
    isRepoOpen,
    isDemoMode,
    hasCommitMessage: commitMessage.trim().length > 0,
    openRepositoryPicker: () => {
      void pickRepositoryAndOpen();
    },
    refreshStatus: () => {
      void refreshStatus(true);
    },
    saveActiveFile: () => {
      void saveActiveFile();
    },
    commitChanges: () => {
      void commitChanges();
    },
    fetchRemote: () => {
      void fetchRemote();
    },
    pullRemote: () => {
      void pullRemote();
    },
    pushRemote: () => {
      void pushRemote();
    },
    refreshIncomingDelta: () => {
      void refreshIncomingDelta(true);
    }
  };

  useEffect(() => {
    if (!status) {
      setCodeownerHintsByPath({});
      setHasCodeownersFile(false);
      setCodeownersPath('');
      setIncomingDelta(null);
      setSearchResult(null);
      return;
    }

    void refreshCodeOwnerHintsForPaths([...status.files.map((file) => file.path), activeMarkdownPath]);
  }, [status, activeMarkdownPath]);

  useEffect(() => {
    void refreshRuntimeInfo();
  }, []);

  useEffect(() => {
    if (!status) {
      setNotice({ kind: 'info', text: tt('Open a repository to get started.', 'Öffne ein Repository, um zu starten.') });
    }
  }, [locale, status]);

  useEffect(() => {
    if (showOnboarding) {
      return;
    }

    if (autoOpenAttemptedRef.current) {
      return;
    }

    if (!repoInput.trim()) {
      return;
    }

    autoOpenAttemptedRef.current = true;
    void (async () => {
      const opened = await openRepository(repoInput, {
        showOpenSuccessNotice: false,
        bootstrapIfEmpty: false,
        persistConfig: false
      });

      if (!opened) {
        setShowOnboarding(true);
      }
    })();
  }, [showOnboarding, repoInput]);

  useEffect(() => {
    localStorage.setItem('mymarkdown:locale', locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    localStorage.setItem('mymarkdown:theme', themeMode);
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    if (!isDemoMode) {
      return;
    }

    if (controlTab !== 'search') {
      setControlTab('search');
    }
  }, [isDemoMode, controlTab]);

  useEffect(() => {
    if (showOnboarding || !status?.repositoryPath) {
      return;
    }

    persistSetupConfig({
      repositoryPath: status.repositoryPath,
      remote: remoteInput.trim() || 'origin',
      defaultBranch: branchInput.trim(),
      remoteUrl: onboardingRemoteUrl.trim() || undefined,
      authMode: onboardingAuthMode,
      configuredAt: new Date().toISOString()
    });
  }, [showOnboarding, status?.repositoryPath, remoteInput, branchInput, onboardingRemoteUrl, onboardingAuthMode]);

  useEffect(() => {
    let cancelled = false;

    const setupEditor = async (): Promise<void> => {
      if (!editorMountRef.current || editorRef.current) {
        return;
      }

      const { Editor } = await import('@toast-ui/editor');
      if (cancelled || !editorMountRef.current || editorRef.current) {
        return;
      }

      const editor = new Editor({
        el: editorMountRef.current,
        height: '420px',
        initialEditType: 'wysiwyg',
        previewStyle: 'vertical',
        usageStatistics: false,
        hideModeSwitch: true,
        placeholder: tt('Select a markdown file and start editing...', 'Wähle eine Markdown-Datei und starte die Bearbeitung...')
      });

      editor.on('change', () => {
        if (!suppressChangeRef.current) {
          setEditorDirty(true);
        }

        setEditorSnapshot(editor.getMarkdown());
      });

      editorRef.current = editor;
    };

    void setupEditor();

    return () => {
      cancelled = true;
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.myMarkdown.onMenuAction((action: AppMenuAction) => {
      const runtime = menuRuntimeRef.current;
      if (runtime.busy && action !== 'focus-search') {
        return;
      }

      switch (action) {
        case 'open-repository':
          runtime.openRepositoryPicker();
          break;
        case 'refresh-status':
          if (runtime.isRepoOpen) {
            runtime.refreshStatus();
          }
          break;
        case 'save-file':
          if (runtime.isRepoOpen) {
            runtime.saveActiveFile();
          }
          break;
        case 'commit':
          if (runtime.isRepoOpen && !runtime.isDemoMode) {
            if (!runtime.hasCommitMessage) {
              commitInputRef.current?.focus();
            }
            runtime.commitChanges();
          }
          break;
        case 'fetch':
          if (runtime.isRepoOpen && !runtime.isDemoMode) {
            runtime.fetchRemote();
          }
          break;
        case 'pull':
          if (runtime.isRepoOpen && !runtime.isDemoMode) {
            runtime.pullRemote();
          }
          break;
        case 'push':
          if (runtime.isRepoOpen && !runtime.isDemoMode) {
            runtime.pushRemote();
          }
          break;
        case 'incoming-delta':
          if (runtime.isRepoOpen && !runtime.isDemoMode) {
            runtime.refreshIncomingDelta();
          }
          break;
        case 'focus-search':
          setControlTab('search');
          window.setTimeout(() => searchInputRef.current?.focus(), 0);
          break;
        case 'toggle-left-sidebar':
          setShowLeftSidebar((previous) => !previous);
          break;
        case 'toggle-right-sidebar':
          setShowRightSidebar((previous) => !previous);
          break;
        default:
          break;
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!editorDirty || !activeMarkdownPath || !status?.repositoryPath) {
      return;
    }

    const key = draftStorageKey(status.repositoryPath, activeMarkdownPath);

    const persistDraft = (): void => {
      try {
        localStorage.setItem(key, getEditorMarkdown());
      } catch {
        // Ignore local storage errors.
      }
    };

    persistDraft();
    const timer = window.setInterval(persistDraft, 1500);
    return () => {
      window.clearInterval(timer);
    };
  }, [activeMarkdownPath, editorDirty, status?.repositoryPath]);

  function setEditorMarkdown(content: string): void {
    if (!editorRef.current) {
      return;
    }

    suppressChangeRef.current = true;
    editorRef.current.setMarkdown(content, false);
    suppressChangeRef.current = false;
    setEditorSnapshot(content);
    setEditorDirty(false);
  }

  function getEditorMarkdown(): string {
    return editorRef.current?.getMarkdown() ?? '';
  }

  async function runQuery<T>(query: () => Promise<AppResult<T>>, successText?: string): Promise<T | null> {
    try {
      const result = await query();
      if (!result.ok) {
        const errorDetails = [result.error.message];
        if (result.error.hint) {
          errorDetails.push(result.error.hint);
        }
        if (result.error.code && result.error.code !== 'APP_ERROR' && result.error.code !== 'UNKNOWN_ERROR') {
          errorDetails.push(`(${result.error.code})`);
        }

        setNotice({ kind: 'error', text: errorDetails.join(' ') });
        return null;
      }

      if (successText) {
        setNotice({ kind: 'info', text: successText });
      }

      return result.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice({ kind: 'error', text: `${tt('Unexpected error', 'Unerwarteter Fehler')}: ${message}` });
      return null;
    }
  }

  async function refreshIdentity(): Promise<void> {
    const identity = await runQuery(() => window.myMarkdown.getIdentity());
    if (!identity) {
      return;
    }

    setGitIdentity(identity.name || identity.email || 'unknown');
  }

  async function refreshRuntimeInfo(): Promise<void> {
    try {
      const result = await window.myMarkdown.getRuntimeInfo();
      if (result.ok) {
        setRuntimeInfo(result.data);
      }
    } catch {
      // Ignore runtime info refresh errors.
    }
  }

  async function refreshCommentsForPath(targetPath: string): Promise<void> {
    if (!targetPath) {
      setComments([]);
      return;
    }

    const commentData = await runQuery(() => window.myMarkdown.getComments({ paths: [targetPath] }));
    if (!commentData) {
      return;
    }

    setComments(commentData);
  }

  async function refreshCommentSidecarPathForPath(targetPath: string): Promise<void> {
    if (!targetPath) {
      setCommentSidecarPath('');
      return;
    }

    const sidecarPath = await runQuery(() => window.myMarkdown.getCommentSidecarPath(targetPath));
    if (!sidecarPath) {
      return;
    }

    setCommentSidecarPath(sidecarPath);
  }

  async function refreshCodeOwnerHintsForPaths(paths: string[]): Promise<void> {
    const targetPaths = uniquePaths(paths);
    const hintsData = await runQuery(() => window.myMarkdown.getCodeOwnerHints(targetPaths));
    if (!hintsData) {
      return;
    }

    const nextHints: Record<string, CodeOwnerHint> = {};
    hintsData.hints.forEach((hint) => {
      nextHints[normalizePath(hint.path)] = hint;
    });

    setCodeownerHintsByPath(nextHints);
    setHasCodeownersFile(hintsData.hasCodeownersFile);
    setCodeownersPath(hintsData.codeownersPath ?? '');
  }

  async function refreshMarkdownFiles(): Promise<void> {
    const files = await runQuery(() => window.myMarkdown.listMarkdownFiles());
    if (!files) {
      return;
    }

    setMarkdownFiles(files);

    if (files.length === 0) {
      setActiveMarkdownPath('');
      setComments([]);
      setCommentSidecarPath('');
      setEditorMarkdown('');
      return;
    }

    const currentStillExists = activeMarkdownPath && files.some((file) => file.path === activeMarkdownPath);
    if (!currentStillExists) {
      await loadMarkdownFile(files[0].path);
      return;
    }
  }

  function currentRemoteTarget(): { remote: string; branch?: string } {
    return {
      remote: remoteInput.trim() || 'origin',
      branch: branchInput.trim() || undefined
    };
  }

  function currentBranchTarget(): string {
    return branchInput.trim() || status?.branch || '';
  }

  async function refreshIncomingDelta(showNotice = false): Promise<void> {
    const target = currentRemoteTarget();
    const incoming = await runQuery(
      () => window.myMarkdown.getIncomingDelta(target),
      showNotice ? tt('Incoming delta refreshed.', 'Eingehende Deltas aktualisiert.') : undefined
    );

    if (!incoming) {
      return;
    }

    setIncomingDelta(incoming);
  }

  async function searchRepository(): Promise<void> {
    if (!searchQuery.trim()) {
      setNotice({ kind: 'error', text: tt('Please enter a search term.', 'Bitte einen Suchbegriff eingeben.') });
      return;
    }

    setBusy(true);
    const result = await runQuery(
      () =>
        window.myMarkdown.searchMarkdown({
          query: searchQuery.trim(),
          maxResults: 120
        }),
      `${tt('Search finished for', 'Suche abgeschlossen für')} "${searchQuery.trim()}".`
    );

    if (result) {
      setSearchResult(result);
    }

    setBusy(false);
  }

  async function refreshStatus(showSpinner = false): Promise<void> {
    if (showSpinner) {
      setBusy(true);
    }

    const statusData = await runQuery(() => window.myMarkdown.getStatus());

    if (showSpinner) {
      setBusy(false);
    }

    if (!statusData) {
      return;
    }

    setStatus(statusData);

    if (selectedChangedPath && !statusData.files.some((file) => file.path === selectedChangedPath)) {
      setSelectedChangedPath(null);
      setDiff('');
    }
  }

  async function refreshComments(): Promise<void> {
    await refreshCommentsForPath(activeMarkdownPath);
  }

  async function maybeBootstrapRepositoryIfEmpty(): Promise<void> {
    const repositoryState = await runQuery(() => window.myMarkdown.getRepositoryState());
    if (!repositoryState) {
      return;
    }

    if (!repositoryState.isEmpty) {
      return;
    }

    const bootstrap = await runQuery(
      () => window.myMarkdown.bootstrapProjectStructureIfEmpty(),
      tt(
        'Empty repository detected. Project structure was initialized.',
        'Leeres Repository erkannt. Projektstruktur wurde initialisiert.'
      )
    );

    if (!bootstrap || bootstrap.skipped) {
      return;
    }

    await refreshStatus(false);
  }

  async function openRepository(
    explicitRepositoryPath?: string,
    options?: {
      showOpenSuccessNotice?: boolean;
      bootstrapIfEmpty?: boolean;
      persistConfig?: boolean;
    }
  ): Promise<boolean> {
    const showOpenSuccessNotice = options?.showOpenSuccessNotice ?? true;
    const bootstrapIfEmpty = options?.bootstrapIfEmpty ?? false;
    const persistConfigAfterOpen = options?.persistConfig ?? false;
    const targetPath = (explicitRepositoryPath ?? repoInput).trim();
    if (!targetPath) {
      setNotice({ kind: 'error', text: tt('Please enter a repository path.', 'Bitte einen Repository-Pfad eingeben.') });
      repoInputRef.current?.focus();
      return false;
    }

    if (repoInput !== targetPath) {
      setRepoInput(targetPath);
    }

    setBusy(true);
    try {
      const opened = await runQuery(
        () => window.myMarkdown.openRepository(targetPath),
        showOpenSuccessNotice ? `${tt('Repository opened', 'Repository geöffnet')}: ${targetPath}` : undefined
      );

      if (!opened) {
        return false;
      }

      if (repoInput !== opened.repositoryPath) {
        setRepoInput(opened.repositoryPath);
      }

      await refreshRuntimeInfo();
      await refreshStatus(false);
      if (bootstrapIfEmpty) {
        await maybeBootstrapRepositoryIfEmpty();
      }
      await Promise.all([refreshMarkdownFiles(), refreshIdentity()]);
      await refreshIncomingDelta(false);

      if (persistConfigAfterOpen) {
        persistSetupConfig({
          repositoryPath: opened.repositoryPath,
          remote: remoteInput.trim() || 'origin',
          defaultBranch: branchInput.trim(),
          remoteUrl: onboardingRemoteUrl.trim() || undefined,
          authMode: onboardingAuthMode,
          configuredAt: new Date().toISOString()
        });
      }

      return true;
    } finally {
      setBusy(false);
    }
  }

  async function pickRepositoryPath(): Promise<string | null> {
    const picked = await runQuery(() => window.myMarkdown.pickRepositoryDirectory());
    if (!picked) {
      return null;
    }

    return picked;
  }

  async function pickRepositoryAndOpen(): Promise<void> {
    const picked = await pickRepositoryPath();
    if (!picked) {
      return;
    }

    setRepoInput(picked);
    const opened = await openRepository(picked, {
      showOpenSuccessNotice: true,
      bootstrapIfEmpty: false,
      persistConfig: true
    });

    if (opened && showOnboarding) {
      autoOpenAttemptedRef.current = true;
      setShowOnboarding(false);
    }
  }

  async function completeOnboarding(): Promise<void> {
    const localPath = repoInput.trim();
    if (!localPath) {
      setNotice({ kind: 'error', text: tt('Please enter a repository path.', 'Bitte einen Repository-Pfad eingeben.') });
      repoInputRef.current?.focus();
      return;
    }

    const remoteUrl = onboardingRemoteUrl.trim();
    const remoteName = remoteInput.trim() || 'origin';
    const defaultBranch = branchInput.trim() || undefined;
    const authInput =
      remoteUrl.length === 0
        ? undefined
        : onboardingAuthMode === 'https-token'
          ? {
              mode: 'https-token' as const,
              username: onboardingRemoteUsername.trim() || 'git',
              token: onboardingRemoteToken
            }
          : { mode: 'system' as const };

    if (remoteUrl.length > 0 && onboardingAuthMode === 'https-token' && onboardingRemoteToken.trim().length === 0) {
      setNotice({
        kind: 'error',
        text: tt('Please enter a token for HTTPS login.', 'Bitte einen Token für HTTPS-Login eingeben.')
      });
      return;
    }

    setBusy(true);
    try {
      const connected = await runQuery(
        () =>
          window.myMarkdown.connectRepository({
            localPath,
            remoteName,
            remoteUrl: remoteUrl || undefined,
            defaultBranch,
            auth: authInput
          }),
        tt('Repository connection established.', 'Repository-Verbindung hergestellt.')
      );

      if (!connected) {
        return;
      }

      setRepoInput(connected.repositoryPath);
      setOnboardingRemoteToken('');

      await refreshRuntimeInfo();
      await refreshStatus(false);
      await maybeBootstrapRepositoryIfEmpty();
      await Promise.all([refreshMarkdownFiles(), refreshIdentity()]);
      if (connected.mode === 'git') {
        await refreshIncomingDelta(false);
      }

      persistSetupConfig({
        repositoryPath: connected.repositoryPath,
        remote: remoteName,
        defaultBranch: defaultBranch ?? '',
        remoteUrl: remoteUrl || undefined,
        authMode: onboardingAuthMode,
        configuredAt: new Date().toISOString()
      });

      autoOpenAttemptedRef.current = true;
      setShowOnboarding(false);
    } finally {
      setBusy(false);
    }
  }

  async function startDemoMode(): Promise<void> {
    const demoWorkspace = await runQuery(
      () => window.myMarkdown.openDemoWorkspace(),
      tt('Demo workspace prepared.', 'Demo-Workspace vorbereitet.')
    );
    if (!demoWorkspace) {
      return;
    }

    setRepoInput(demoWorkspace.repositoryPath);
    const opened = await openRepository(demoWorkspace.repositoryPath, {
      showOpenSuccessNotice: false,
      bootstrapIfEmpty: false,
      persistConfig: true
    });

    if (!opened) {
      return;
    }

    autoOpenAttemptedRef.current = true;
    setShowOnboarding(false);
    setNotice({
      kind: 'info',
      text: tt('Demo mode is active. Git actions are disabled.', 'Demo-Modus ist aktiv. Git-Aktionen sind deaktiviert.')
    });
  }

  async function showDiff(pathspec: string): Promise<void> {
    setSelectedChangedPath(pathspec);
    const target: GitDiffTarget = { pathspec };
    const diffData = await runQuery(() => window.myMarkdown.getDiff(target));
    if (!diffData) {
      return;
    }

    setDiff(diffData || tt('(No diff output for selected file)', '(Keine Diff-Ausgabe für die gewählte Datei)'));
  }

  async function resolveSelectedConflict(strategy: 'ours' | 'theirs'): Promise<void> {
    if (!selectedChangedPath) {
      setNotice({ kind: 'error', text: tt('Select a conflict file first.', 'Bitte zuerst eine Konfliktdatei auswählen.') });
      return;
    }

    if (!selectedIsConflict) {
      setNotice({
        kind: 'error',
        text: tt(
          'The selected file is not marked as a merge/rebase conflict.',
          'Die ausgewählte Datei ist nicht als Merge-/Rebase-Konflikt markiert.'
        )
      });
      return;
    }

    setBusy(true);
    const resolved = await runQuery(
      () =>
        window.myMarkdown.resolveConflict({
          path: selectedChangedPath,
          strategy
        }),
      strategy === 'ours'
        ? tt('Conflict resolved using local changes (ours).', 'Konflikt mit lokalen Änderungen (ours) aufgelöst.')
        : tt('Conflict resolved using incoming changes (theirs).', 'Konflikt mit eingehenden Änderungen (theirs) aufgelöst.')
    );

    if (resolved !== null) {
      await refreshStatus(false);
      await refreshMarkdownFiles();
      await showDiff(selectedChangedPath);

      if (activeMarkdownPath === selectedChangedPath) {
        await loadMarkdownFile(selectedChangedPath);
      }
    }

    setBusy(false);
  }

  async function stageSelected(): Promise<void> {
    if (!selectedChangedPath) {
      return;
    }

    setBusy(true);
    const result = await runQuery(
      () => window.myMarkdown.stage([selectedChangedPath]),
      `${tt('Staged', 'Gestaged')}: ${selectedChangedPath}`
    );

    if (result !== null) {
      await refreshStatus(false);
      await showDiff(selectedChangedPath);
    }

    setBusy(false);
  }

  async function unstageSelected(): Promise<void> {
    if (!selectedChangedPath) {
      return;
    }

    setBusy(true);
    const result = await runQuery(
      () => window.myMarkdown.unstage([selectedChangedPath]),
      `${tt('Unstaged', 'Unstaged rückgängig')}: ${selectedChangedPath}`
    );

    if (result !== null) {
      await refreshStatus(false);
      await showDiff(selectedChangedPath);
    }

    setBusy(false);
  }

  async function stageAll(): Promise<void> {
    if (changedFiles.length === 0) {
      return;
    }

    setBusy(true);
    const staged = await runQuery(
      () => window.myMarkdown.stage(changedFiles.map((file) => file.path)),
      tt('Staged all changed files.', 'Alle geänderten Dateien wurden gestaged.')
    );

    if (staged !== null) {
      await refreshStatus(false);
    }

    setBusy(false);
  }

  async function unstageAll(): Promise<void> {
    const staged = changedFiles
      .filter((file) => file.indexStatus !== ' ' && file.indexStatus !== '?')
      .map((file) => file.path);

    if (staged.length === 0) {
      setNotice({ kind: 'info', text: tt('No staged files to unstage.', 'Keine gestagten Dateien zum Unstage.') });
      return;
    }

    setBusy(true);
    const result = await runQuery(
      () => window.myMarkdown.unstage(staged),
      tt('Unstaged all staged files.', 'Alle gestagten Dateien wurden zurückgesetzt.')
    );

    if (result !== null) {
      await refreshStatus(false);
    }

    setBusy(false);
  }

  async function commitChanges(): Promise<void> {
    if (!commitMessage.trim()) {
      setNotice({ kind: 'error', text: tt('Please enter a commit message.', 'Bitte eine Commit-Nachricht eingeben.') });
      return;
    }

    setBusy(true);
    const committed = await runQuery(
      () => window.myMarkdown.commit(commitMessage.trim()),
      tt('Commit created successfully.', 'Commit erfolgreich erstellt.')
    );

    if (committed !== null) {
      setCommitMessage('');
      await refreshStatus(false);
      await refreshMarkdownFiles();
    }

    setBusy(false);
  }

  async function fetchRemote(): Promise<void> {
    setBusy(true);
    const target = currentRemoteTarget();

    const fetched = await runQuery(
      () => window.myMarkdown.fetch(target),
      `${tt('Fetched from', 'Geholt von')} ${target.remote}.`
    );
    if (fetched !== null) {
      await refreshStatus(false);
      await refreshIncomingDelta(false);
    }

    setBusy(false);
  }

  async function pullRemote(): Promise<void> {
    setBusy(true);
    const target = currentRemoteTarget();

    const pulled = await runQuery(
      () => window.myMarkdown.pull(target),
      `${tt('Pulled from', 'Gezogen von')} ${target.remote}.`
    );
    if (pulled !== null) {
      await refreshStatus(false);
      await refreshMarkdownFiles();
      await refreshComments();
      await refreshIncomingDelta(false);
    }

    setBusy(false);
  }

  async function pushRemote(): Promise<void> {
    setBusy(true);
    const target = currentRemoteTarget();

    const pushed = await runQuery(
      () => window.myMarkdown.push(target),
      `${tt('Pushed to', 'Gepusht zu')} ${target.remote}.`
    );
    if (pushed !== null) {
      await refreshStatus(false);
      await refreshIncomingDelta(false);
    }

    setBusy(false);
  }

  async function createAndCheckoutBranch(): Promise<void> {
    if (!newBranchName.trim()) {
      setNotice({ kind: 'error', text: tt('Please enter a new branch name.', 'Bitte einen neuen Branch-Namen eingeben.') });
      return;
    }

    setBusy(true);
    const createdBranch = await runQuery(
      () =>
        window.myMarkdown.createBranch({
          name: newBranchName.trim(),
          from: newBranchFromRef.trim() || undefined,
          checkout: true
        }),
      `${tt('Created and checked out', 'Erstellt und ausgecheckt')}: ${newBranchName.trim()}.`
    );

    if (createdBranch) {
      setBranchInput(createdBranch);
      setNewBranchName('');
      await refreshStatus(false);
      await refreshIncomingDelta(false);
      await refreshMarkdownFiles();
      await refreshComments();
    }

    setBusy(false);
  }

  async function checkoutBranchNow(): Promise<void> {
    const branchName = currentBranchTarget();
    if (!branchName) {
      setNotice({ kind: 'error', text: tt('Please enter a branch to checkout.', 'Bitte einen Branch zum Auschecken eingeben.') });
      return;
    }

    setBusy(true);
    const checkedOutBranch = await runQuery(
      () => window.myMarkdown.checkoutBranch(branchName),
      `${tt('Checked out', 'Ausgecheckt')}: ${branchName}.`
    );

    if (checkedOutBranch) {
      setBranchInput(checkedOutBranch);
      await refreshStatus(false);
      await refreshIncomingDelta(false);
      await refreshMarkdownFiles();
      await refreshComments();
    }

    setBusy(false);
  }

  async function setUpstreamNow(): Promise<void> {
    const branchName = currentBranchTarget();
    if (!branchName) {
      setNotice({
        kind: 'error',
        text: tt(
          'No current branch available to set upstream.',
          'Kein aktueller Branch für Upstream-Konfiguration verfügbar.'
        )
      });
      return;
    }

    const remote = remoteInput.trim() || 'origin';
    setBusy(true);
    const upstream = await runQuery(
      () =>
        window.myMarkdown.setUpstream({
          remote,
          branch: branchName
        }),
      `${tt('Upstream set to', 'Upstream gesetzt auf')} ${remote}/${branchName}.`
    );

    if (upstream) {
      await refreshStatus(false);
      await refreshIncomingDelta(false);
    }

    setBusy(false);
  }

  async function loadMarkdownFile(targetPath: string): Promise<void> {
    if (!targetPath) {
      return;
    }

    if (editorDirty && activeMarkdownPath && activeMarkdownPath !== targetPath) {
      const proceed = window.confirm(
        tt(
          'You have unsaved changes. Switch file and discard local editor changes?',
          'Es gibt ungespeicherte Änderungen. Datei wechseln und lokale Editor-Änderungen verwerfen?'
        )
      );
      if (!proceed) {
        return;
      }
    }

    setBusy(true);
    const file = await runQuery(() => window.myMarkdown.readMarkdownFile(targetPath));
    if (file) {
      const draftKey =
        status?.repositoryPath && file.path ? draftStorageKey(status.repositoryPath, file.path) : null;
      let resolvedContent = file.content;

      if (draftKey) {
        try {
          const draftContent = localStorage.getItem(draftKey);
          if (draftContent !== null && draftContent !== file.content) {
            const restoreDraft = window.confirm(
              `${tt('Recovered local draft for', 'Lokaler Entwurf gefunden für')} ${file.path}. ${tt(
                'Restore draft content?',
                'Entwurf wiederherstellen?'
              )}`
            );
            if (restoreDraft) {
              resolvedContent = draftContent;
              setEditorDirty(true);
            } else {
              localStorage.removeItem(draftKey);
            }
          }
        } catch {
          // Ignore local storage errors.
        }
      }

      setActiveMarkdownPath(file.path);
      setEditorMarkdown(resolvedContent);
      if (resolvedContent !== file.content) {
        setEditorDirty(true);
      }
      setReleaseGate(null);
      await refreshCommentsForPath(file.path);
      await refreshCommentSidecarPathForPath(file.path);
      setNotice({ kind: 'info', text: `${tt('Loaded', 'Geladen')}: ${file.path}` });
    }

    setBusy(false);
  }

  async function saveActiveFile(): Promise<void> {
    if (!activeMarkdownPath) {
      setNotice({ kind: 'error', text: tt('Select a markdown file first.', 'Bitte zuerst eine Markdown-Datei auswählen.') });
      return;
    }

    setBusy(true);
    const saveResult = await runQuery(
      () =>
        window.myMarkdown.writeMarkdownFile({
          path: activeMarkdownPath,
          content: getEditorMarkdown()
        }),
      `${tt('Saved', 'Gespeichert')}: ${activeMarkdownPath}`
    );

    if (saveResult) {
      setEditorDirty(false);
      if (status?.repositoryPath) {
        try {
          localStorage.removeItem(draftStorageKey(status.repositoryPath, activeMarkdownPath));
        } catch {
          // Ignore local storage errors.
        }
      }
      await refreshStatus(false);
      await refreshMarkdownFiles();
    }

    setBusy(false);
  }

  function switchEditorMode(mode: EditorMode): void {
    if (!editorRef.current) {
      return;
    }

    editorRef.current.changeMode(mode, true);
    setEditorMode(mode);
  }

  function jumpToHeadingLine(line: number): void {
    if (!editorRef.current || line <= 0) {
      return;
    }

    const editor = editorRef.current as unknown as {
      changeMode: (mode: EditorMode, withoutFocus?: boolean) => void;
      setSelection?: (start: [number, number], end?: [number, number]) => void;
      focus?: () => void;
    };

    editor.changeMode('markdown', false);
    setEditorMode('markdown');

    if (editor.setSelection) {
      editor.setSelection([line, 0], [line, 0]);
    }

    editor.focus?.();
  }

  async function createCommentForActiveFile(): Promise<void> {
    if (!activeMarkdownPath) {
      setNotice({
        kind: 'error',
        text: tt('Select an active markdown file first.', 'Bitte zuerst eine aktive Markdown-Datei auswählen.')
      });
      return;
    }

    if (!newCommentText.trim()) {
      setNotice({ kind: 'error', text: tt('Comment text cannot be empty.', 'Kommentartext darf nicht leer sein.') });
      return;
    }

    const lineValue = Number.parseInt(newCommentLine, 10);

    setBusy(true);
    const created = await runQuery(
      () =>
        window.myMarkdown.createComment({
          targetPath: activeMarkdownPath,
          text: newCommentText.trim(),
          line: Number.isFinite(lineValue) ? lineValue : undefined,
          author: gitIdentity
        }),
      tt('Comment created.', 'Kommentar erstellt.')
    );

    if (created) {
      setNewCommentText('');
      setNewCommentLine('');
      setActiveCommentId(created.id);
      await refreshComments();
      await refreshStatus(false);
    }

    setBusy(false);
  }

  async function appendReply(): Promise<void> {
    if (!activeMarkdownPath || !activeCommentId) {
      setNotice({ kind: 'error', text: tt('Select a comment thread first.', 'Bitte zuerst einen Kommentar-Thread auswählen.') });
      return;
    }

    if (!replyText.trim()) {
      setNotice({ kind: 'error', text: tt('Reply text cannot be empty.', 'Antworttext darf nicht leer sein.') });
      return;
    }

    setBusy(true);
    const appended = await runQuery(
      () =>
        window.myMarkdown.appendComment({
          targetPath: activeMarkdownPath,
          commentId: activeCommentId,
          text: replyText.trim(),
          author: gitIdentity
        }),
      tt('Reply added.', 'Antwort hinzugefügt.')
    );

    if (appended) {
      setReplyText('');
      await refreshComments();
      await refreshStatus(false);
    }

    setBusy(false);
  }

  async function closeActiveComment(): Promise<void> {
    if (!activeMarkdownPath || !activeCommentId) {
      setNotice({ kind: 'error', text: tt('Select a comment thread first.', 'Bitte zuerst einen Kommentar-Thread auswählen.') });
      return;
    }

    setBusy(true);
    const closed = await runQuery(
      () =>
        window.myMarkdown.closeComment({
          targetPath: activeMarkdownPath,
          commentId: activeCommentId,
          author: gitIdentity
        }),
      tt('Comment closed.', 'Kommentar geschlossen.')
    );

    if (closed) {
      await refreshComments();
      await refreshStatus(false);
    }

    setBusy(false);
  }

  async function checkReleaseGate(): Promise<void> {
    const normalizedReleaseId = normalizeReleaseId(releaseId);
    if (!normalizedReleaseId) {
      setNotice({ kind: 'error', text: tt('Release ID is required.', 'Release-ID ist erforderlich.') });
      return;
    }

    if (releaseScopePaths.length === 0) {
      setNotice({ kind: 'error', text: tt('Release scope is empty.', 'Release-Scope ist leer.') });
      return;
    }

    setBusy(true);
    const gate = await runQuery(
      () =>
        window.myMarkdown.canReleaseVersion({
          releaseId: normalizedReleaseId,
          targetRef: releaseTargetRef.trim() || 'HEAD',
          paths: releaseScopePaths
        }),
      tt('Release gate checked.', 'Release-Gate geprüft.')
    );

    if (gate) {
      setReleaseGate(gate);
      setReleaseId(normalizedReleaseId);
    }

    setBusy(false);
  }

  async function releaseVersionNow(): Promise<void> {
    const normalizedReleaseId = normalizeReleaseId(releaseId);
    if (!normalizedReleaseId) {
      setNotice({ kind: 'error', text: tt('Release ID is required.', 'Release-ID ist erforderlich.') });
      return;
    }

    if (releaseScopePaths.length === 0) {
      setNotice({ kind: 'error', text: tt('Release scope is empty.', 'Release-Scope ist leer.') });
      return;
    }

    if (!releaseGate || !releaseGate.releasable) {
      setNotice({
        kind: 'error',
        text: tt(
          'Release is blocked. Run gate check and close open comments first.',
          'Release ist blockiert. Bitte zuerst Gate prüfen und offene Kommentare schließen.'
        )
      });
      return;
    }

    setBusy(true);
    const result = await runQuery(
      () =>
        window.myMarkdown.releaseVersion({
          releaseId: normalizedReleaseId,
          targetRef: releaseTargetRef.trim() || 'HEAD',
          paths: releaseScopePaths,
          pushTag: pushReleaseTag,
          remote: remoteInput.trim() || 'origin'
        }),
      `${tt('Released', 'Freigegeben')}: ${normalizedReleaseId}`
    );

    if (result) {
      setNotice({
        kind: 'info',
        text: result.pushed
          ? `${tt('Release tag created and pushed', 'Release-Tag erstellt und gepusht')}: ${result.tag}.`
          : `${tt('Release tag created locally', 'Release-Tag lokal erstellt')}: ${result.tag}.`
      });

      await refreshStatus(false);
      setReleaseGate(null);
    }

    setBusy(false);
  }

  if (showOnboarding) {
    return (
      <div className="app-shell onboarding-shell">
        <section className="onboarding-card">
          <h1>{tt('Welcome to myMarkDown', 'Willkommen bei myMarkDown')}</h1>
          <p className="onboarding-lead">
            {tt(
              'Connect a local folder and optionally configure remote Git login. If the repository is empty, myMarkDown will initialize the required project structure.',
              'Verbinde einen lokalen Ordner und optional die Remote-Git-Anmeldung. Wenn das Repository leer ist, initialisiert myMarkDown die benötigte Projektstruktur automatisch.'
            )}
          </p>

          <label className="onboarding-field">
            <span>{tt('Git Repository Path', 'Git-Repository-Pfad')}</span>
            <div className="onboarding-row">
              <input
                ref={repoInputRef}
                value={repoInput}
                onChange={(event) => setRepoInput(event.target.value)}
                placeholder={tt('/absolute/path/to/repository', '/absoluter/pfad/zum/repository')}
                disabled={busy}
              />
              <button
                onClick={() => {
                  void (async () => {
                    const picked = await pickRepositoryPath();
                    if (picked) {
                      setRepoInput(picked);
                    }
                  })();
                }}
                disabled={busy}
              >
                {tt('Browse', 'Durchsuchen')}
              </button>
            </div>
          </label>

          <label className="onboarding-field">
            <span>{tt('Remote Name', 'Remote-Name')}</span>
            <input
              value={remoteInput}
              onChange={(event) => setRemoteInput(event.target.value)}
              placeholder={tt('origin', 'origin')}
              disabled={busy}
            />
          </label>

          <label className="onboarding-field">
            <span>{tt('Remote URL (optional)', 'Remote-URL (optional)')}</span>
            <input
              value={onboardingRemoteUrl}
              onChange={(event) => setOnboardingRemoteUrl(event.target.value)}
              placeholder={tt('https://github.com/org/repo.git', 'https://github.com/org/repo.git')}
              disabled={busy}
            />
          </label>

          <label className="onboarding-field">
            <span>{tt('Remote Login', 'Remote-Anmeldung')}</span>
            <div className="toggle-group">
              <button
                className={onboardingAuthMode === 'system' ? 'toggle-active' : ''}
                onClick={() => setOnboardingAuthMode('system')}
                disabled={busy || onboardingRemoteUrl.trim().length === 0}
              >
                {tt('System Credentials', 'System-Credentials')}
              </button>
              <button
                className={onboardingAuthMode === 'https-token' ? 'toggle-active' : ''}
                onClick={() => setOnboardingAuthMode('https-token')}
                disabled={busy || onboardingRemoteUrl.trim().length === 0}
              >
                {tt('HTTPS User/Token', 'HTTPS User/Token')}
              </button>
            </div>
          </label>

          {onboardingRemoteUrl.trim().length > 0 && onboardingAuthMode === 'https-token' ? (
            <>
              <label className="onboarding-field">
                <span>{tt('Remote Username', 'Remote-Benutzername')}</span>
                <input
                  value={onboardingRemoteUsername}
                  onChange={(event) => setOnboardingRemoteUsername(event.target.value)}
                  placeholder={tt('git', 'git')}
                  disabled={busy}
                />
              </label>

              <label className="onboarding-field">
                <span>{tt('Personal Access Token', 'Personal Access Token')}</span>
                <input
                  type="password"
                  value={onboardingRemoteToken}
                  onChange={(event) => setOnboardingRemoteToken(event.target.value)}
                  placeholder={tt('token', 'token')}
                  disabled={busy}
                />
              </label>
            </>
          ) : null}

          <label className="onboarding-field">
            <span>{tt('Default Branch (optional)', 'Standard-Branch (optional)')}</span>
            <input
              value={branchInput}
              onChange={(event) => setBranchInput(event.target.value)}
              placeholder={tt('main', 'main')}
              disabled={busy}
            />
          </label>

          <div className="onboarding-hint">
            <p>
              {tt(
                'Folders are created Git-friendly with placeholder files when needed (for example .gitkeep), because Git does not track empty directories.',
                'Ordner werden Git-kompatibel mit Platzhalterdateien angelegt (z. B. .gitkeep), da Git keine leeren Verzeichnisse versioniert.'
              )}
            </p>
            <p>
              {tt(
                'If a remote URL is set, myMarkDown can clone or attach the remote and verify login. Without remote URL, a local Git repository is initialized if needed.',
                'Wenn eine Remote-URL gesetzt ist, kann myMarkDown das Remote klonen oder anbinden und die Anmeldung prüfen. Ohne Remote-URL wird bei Bedarf ein lokales Git-Repository initialisiert.'
              )}
            </p>
          </div>

          <div className="onboarding-actions">
            {!runtimeInfo.gitAvailable ? (
              <button onClick={startDemoMode} disabled={busy}>
                {tt('Start Demo Mode', 'Demo-Modus starten')}
              </button>
            ) : null}
            <button className="primary" onClick={completeOnboarding} disabled={busy}>
              {tt('Connect Repository', 'Repository verbinden')}
            </button>
          </div>

          {!runtimeInfo.gitAvailable ? (
            <p className="onboarding-note">
              {tt(
                'Git was not detected on this system. You can still use myMarkDown in demo mode.',
                'Auf diesem System wurde kein Git erkannt. Du kannst myMarkDown trotzdem im Demo-Modus verwenden.'
              )}
            </p>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="header toolbar-strip">
        <div className="title-stack">
          <h1>{windowTitle}</h1>
          <p className="header-subtitle">myMarkDown</p>
        </div>
        <div className="header-tools">
          <p className={`mode-pill ${isDemoMode ? 'demo-mode' : ''}`}>
            {isDemoMode ? tt('Mode: Demo', 'Modus: Demo') : tt('Mode: Git', 'Modus: Git')}
          </p>
          <p>{tt('Git identity', 'Git-Identität')}: {gitIdentity}</p>
          <div className="toggle-group">
            <button className={showLeftSidebar ? 'toggle-active' : ''} onClick={() => setShowLeftSidebar((value) => !value)}>
              {tt('Left Nav', 'Links Nav')}
            </button>
            <button className={showRightSidebar ? 'toggle-active' : ''} onClick={() => setShowRightSidebar((value) => !value)}>
              {tt('Right Sidebar', 'Rechte Sidebar')}
            </button>
          </div>
        </div>
      </header>

      <section className="repo-open toolbar-strip">
        <input
          ref={repoInputRef}
          value={repoInput}
          onChange={(event) => setRepoInput(event.target.value)}
          placeholder={tt('/absolute/path/to/repository', '/absoluter/pfad/zum/repository')}
        />
        <button onClick={pickRepositoryAndOpen} disabled={busy}>
          {tt('Browse', 'Durchsuchen')}
        </button>
        <button
          className="primary"
          onClick={() => {
            void openRepository(undefined, {
              showOpenSuccessNotice: true,
              bootstrapIfEmpty: false,
              persistConfig: true
            });
          }}
          disabled={busy}
        >
          {tt('Open Repository', 'Repository öffnen')}
        </button>
        <button onClick={() => refreshStatus(true)} disabled={busy || !isRepoOpen}>
          {tt('Refresh Status', 'Status aktualisieren')}
        </button>
      </section>

      <section className={`notice ${notice.kind}`}>{notice.text}</section>

      <section className="status-bar toolbar-strip">
        <span>
          <strong>{tt('Branch', 'Branch')}:</strong> {branchSummary}
        </span>
        <span>
          <strong>CODEOWNERS:</strong> {hasCodeownersFile ? codeownersPath || 'CODEOWNERS' : tt('not found', 'nicht gefunden')}
        </span>
        {!isDemoMode ? (
          <span>
            <strong>{tt('Incoming', 'Eingehend')}:</strong>{' '}
            {incomingDelta
              ? incomingDelta.remoteRef
                ? `${incomingDelta.incomingCommitCount} ${tt('commit(s)', 'Commit(s)')}, ${incomingDelta.incomingFiles.length} ${tt('file(s)', 'Datei(en)')}`
                : tt('no tracking branch', 'kein Tracking-Branch')
              : tt('not checked', 'nicht geprüft')}
          </span>
        ) : (
          <span>
            <strong>{tt('Incoming', 'Eingehend')}:</strong> {tt('not available in demo mode', 'im Demo-Modus nicht verfügbar')}
          </span>
        )}
        {!isDemoMode ? (
          <span className={conflictFiles.length > 0 ? 'status-conflicts' : ''}>
            <strong>{tt('Conflicts', 'Konflikte')}:</strong> {conflictFiles.length}
          </span>
        ) : null}
      </section>

      <section className="settings-section toolbar-strip">
        <h2>{tt('Settings', 'Einstellungen')}</h2>
        <div className="settings-grid">
          <div className="setting-row">
            <span className="setting-label">{tt('Language', 'Sprache')}</span>
            <div className="toggle-group">
              <button className={locale === 'de' ? 'toggle-active' : ''} onClick={() => setLocale('de')} disabled={busy}>
                DE
              </button>
              <button className={locale === 'en' ? 'toggle-active' : ''} onClick={() => setLocale('en')} disabled={busy}>
                EN
              </button>
            </div>
          </div>

          <div className="setting-row">
            <span className="setting-label">{tt('Theme', 'Darstellung')}</span>
            <div className="toggle-group">
              <button
                className={themeMode === 'light' ? 'toggle-active' : ''}
                onClick={() => setThemeMode('light')}
                disabled={busy}
              >
                {tt('Light', 'Hell')}
              </button>
              <button
                className={themeMode === 'dark' ? 'toggle-active' : ''}
                onClick={() => setThemeMode('dark')}
                disabled={busy}
              >
                {tt('Dark', 'Dunkel')}
              </button>
            </div>
          </div>

          <div className="setting-row">
            <span className="setting-label">{tt('Remote', 'Remote')}</span>
            <input
              value={remoteInput}
              onChange={(event) => setRemoteInput(event.target.value)}
              placeholder={tt('remote', 'remote')}
              disabled={busy || isDemoMode}
            />
          </div>

          <div className="setting-row">
            <span className="setting-label">{tt('Default Branch', 'Standard-Branch')}</span>
            <input
              value={branchInput}
              onChange={(event) => setBranchInput(event.target.value)}
              placeholder={tt('branch (optional)', 'Branch (optional)')}
              disabled={busy || isDemoMode}
            />
          </div>
        </div>
      </section>

      <section className="control-card toolbar-strip">
        <div className="control-tabs">
          {!isDemoMode ? (
            <button
              className={controlTab === 'sync' ? 'active-tab' : ''}
              onClick={() => setControlTab('sync')}
              disabled={busy}
            >
              {tt('Sync', 'Sync')}
            </button>
          ) : null}
          {!isDemoMode ? (
            <button
              className={controlTab === 'branch' ? 'active-tab' : ''}
              onClick={() => setControlTab('branch')}
              disabled={busy}
            >
              {tt('Branch', 'Branch')}
            </button>
          ) : null}
          <button
            className={controlTab === 'search' ? 'active-tab' : ''}
            onClick={() => setControlTab('search')}
            disabled={busy}
          >
            {tt('Search', 'Suche')}
          </button>
        </div>

        {!isDemoMode && controlTab === 'sync' ? (
          <div className="sync-controls">
            <button onClick={fetchRemote} disabled={busy || !isRepoOpen}>
              {tt('Fetch', 'Fetch')}
            </button>
            <button onClick={pullRemote} disabled={busy || !isRepoOpen}>
              {tt('Pull (rebase)', 'Pull (Rebase)')}
            </button>
            <button onClick={pushRemote} disabled={busy || !isRepoOpen}>
              {tt('Push', 'Push')}
            </button>
            <button onClick={() => refreshIncomingDelta(true)} disabled={busy || !isRepoOpen}>
              {tt('Incoming Delta', 'Eingehende Deltas')}
            </button>
          </div>
        ) : null}

        {!isDemoMode && controlTab === 'branch' ? (
          <div className="branch-controls">
            <input
              value={newBranchName}
              onChange={(event) => setNewBranchName(event.target.value)}
              placeholder={tt('new branch name', 'neuer Branch-Name')}
            />
            <input
              value={newBranchFromRef}
              onChange={(event) => setNewBranchFromRef(event.target.value)}
              placeholder={tt('from ref (default HEAD)', 'von Ref (Standard HEAD)')}
            />
            <button onClick={createAndCheckoutBranch} disabled={busy || !isRepoOpen}>
              {tt('Create + Checkout', 'Erstellen + Checkout')}
            </button>
            <button onClick={checkoutBranchNow} disabled={busy || !isRepoOpen}>
              {tt('Checkout Branch', 'Branch auschecken')}
            </button>
            <button onClick={setUpstreamNow} disabled={busy || !isRepoOpen}>
              {tt('Set Upstream', 'Upstream setzen')}
            </button>
          </div>
        ) : null}

        {controlTab === 'search' ? (
          <div className="search-panel">
            <div className="search-row">
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void searchRepository();
                  }
                }}
                placeholder={tt('Search markdown content...', 'Markdown-Inhalte durchsuchen...')}
                disabled={busy || !isRepoOpen}
              />
            <button className="primary" onClick={searchRepository} disabled={busy || !isRepoOpen}>
              {tt('Search', 'Suche')}
            </button>
            </div>
            {searchResult ? (
              <div className="search-results">
                <p>
                  {tt('Results for', 'Ergebnisse für')} <strong>{searchResult.query}</strong>:{' '}
                  {searchResult.totalMatches}
                  {searchResult.truncated ? tt(' (truncated)', ' (gekürzt)') : ''}
                </p>
                <ul>
                  {searchResult.items.map((item, index) => (
                    <li key={`${item.path}:${item.line}:${index}`}>
                      <button
                        onClick={() => {
                          void loadMarkdownFile(item.path);
                        }}
                        disabled={busy}
                      >
                        <span className="search-hit-path">
                          {item.path}:{item.line}
                        </span>
                        <span className="search-hit-excerpt">{item.excerpt || tt('(empty line)', '(leere Zeile)')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <main
        className={`main-grid ${showLeftSidebar ? 'with-left' : 'without-left'} ${
          showRightSidebar ? 'with-right' : 'without-right'
        }`}
      >
        {showLeftSidebar ? (
          <aside className="panel sidebar-panel files-panel">
            <div className="panel-header">
              <h2>{tt('Navigation', 'Navigation')}</h2>
            </div>

            <div className="nav-block">
              <h3>{tt('Documents', 'Dokumente')}</h3>
              <ul className="doc-list">
                {markdownFiles.length === 0 ? (
                  <li className="muted">{tt('No markdown files', 'Keine Markdown-Dateien')}</li>
                ) : (
                  markdownFiles.map((file) => (
                    <li key={file.path}>
                      <button
                        className={activeMarkdownPath === file.path ? 'selected' : ''}
                        onClick={() => {
                          void loadMarkdownFile(file.path);
                        }}
                        disabled={busy}
                      >
                        <span className="path">{file.path}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>

            {!isDemoMode ? (
              <>
                <div className="panel-header">
                  <h3>{tt('Changed Files', 'Geänderte Dateien')}</h3>
                  <div className="file-actions">
                    <button onClick={stageSelected} disabled={busy || !selectedChangedPath}>
                      {tt('Stage Selected', 'Auswahl stagen')}
                    </button>
                    <button onClick={unstageSelected} disabled={busy || !selectedChangedPath}>
                      {tt('Unstage Selected', 'Auswahl unstage')}
                    </button>
                    <button onClick={stageAll} disabled={busy || changedFiles.length === 0}>
                      {tt('Stage All', 'Alle stagen')}
                    </button>
                    <button onClick={unstageAll} disabled={busy || changedFiles.length === 0}>
                      {tt('Unstage All', 'Alle unstage')}
                    </button>
                  </div>
                </div>

                <div className="incoming-box">
                  <strong>{tt('Remote Delta', 'Remote-Delta')}</strong>
                  {incomingDelta ? (
                    incomingDelta.remoteRef ? (
                      <>
                        <p>
                          {tt('Source', 'Quelle')}: {incomingDelta.remoteRef} | {tt('commits', 'Commits')}:{' '}
                          {incomingDelta.incomingCommitCount} | {tt('files', 'Dateien')}:{' '}
                          {incomingDelta.incomingFiles.length}
                        </p>
                        <p className={incomingDelta.conflictCandidates.length > 0 ? 'incoming-warning' : ''}>
                          {tt('Conflict candidates', 'Konfliktkandidaten')}:{' '}
                          {incomingDelta.conflictCandidates.length > 0
                            ? incomingDelta.conflictCandidates.join(', ')
                            : tt('none', 'keine')}
                        </p>
                      </>
                    ) : (
                      <p>{tt('No tracking branch configured.', 'Kein Tracking-Branch konfiguriert.')}</p>
                    )
                  ) : (
                    <p>
                      {tt(
                        'Run fetch or Incoming Delta to inspect remote changes.',
                        'Führe Fetch oder Eingehende Deltas aus, um Remote-Änderungen zu sehen.'
                      )}
                    </p>
                  )}
                </div>

                {changedFiles.length === 0 ? (
                  <p className="muted">{tt('No changes.', 'Keine Änderungen.')}</p>
                ) : (
                  <ul>
                    {changedFiles.map((file) => {
                      const hint = codeownerHintsByPath[normalizePath(file.path)];
                      const hasOwners = Boolean(hint && hint.owners.length > 0);

                      return (
                        <li key={`${file.path}-${file.indexStatus}-${file.workTreeStatus}`}>
                          <button
                            className={`${selectedChangedPath === file.path ? 'selected' : ''} ${
                              isConflictEntry(file) ? 'selected-conflict' : ''
                            }`.trim()}
                            onClick={() => showDiff(file.path)}
                          >
                            <span className="status-pill">{statusLabel(file)}</span>
                            <span className="path">{file.path}</span>
                            {isConflictEntry(file) ? <span className="conflict-pill">{tt('CONFLICT', 'KONFLIKT')}</span> : null}
                            {hasOwners ? (
                              <span
                                className="owner-pill"
                                title={hint?.matchedPattern ? `CODEOWNERS pattern: ${hint.matchedPattern}` : 'CODEOWNERS'}
                              >
                                {hint?.owners.join(', ')}
                              </span>
                            ) : hasCodeownersFile ? (
                              <span className="owner-pill owner-pill-none">{tt('unowned', 'ohne Owner')}</span>
                            ) : null}
                            {file.originalPath ? <span className="rename">(from {file.originalPath})</span> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="commit-box">
                  <h3>{tt('Create Commit', 'Commit erstellen')}</h3>
                  <input
                    ref={commitInputRef}
                    value={commitMessage}
                    onChange={(event) => setCommitMessage(event.target.value)}
                    placeholder={tt('Commit message', 'Commit-Nachricht')}
                  />
                  <button className="primary" onClick={commitChanges} disabled={busy || !isRepoOpen}>
                    {tt('Commit', 'Commit')}
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">{tt('Demo mode: Git workflow panel is disabled.', 'Demo-Modus: Git-Workflow ist deaktiviert.')}</p>
            )}
          </aside>
        ) : null}

        <section className="panel editor-panel">
          <div className="panel-header">
            <h2>{tt('Markdown Editor', 'Markdown-Editor')}</h2>
            <div className="editor-toolbar">
              <select
                value={activeMarkdownPath}
                onChange={(event) => {
                  void loadMarkdownFile(event.target.value);
                }}
                disabled={busy || markdownFiles.length === 0}
              >
                {markdownFiles.length === 0 ? <option value="">{tt('No markdown files', 'Keine Markdown-Dateien')}</option> : null}
                {markdownFiles.map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.path}
                  </option>
                ))}
              </select>
              <button
                className={editorMode === 'wysiwyg' ? 'active-mode' : ''}
                onClick={() => switchEditorMode('wysiwyg')}
                disabled={busy}
              >
                WYSIWYG
              </button>
              <button
                className={editorMode === 'markdown' ? 'active-mode' : ''}
                onClick={() => switchEditorMode('markdown')}
                disabled={busy}
              >
                {tt('Markdown Code', 'Markdown-Code')}
              </button>
              <button className="primary" onClick={saveActiveFile} disabled={busy || !activeMarkdownPath}>
                {tt('Save File', 'Datei speichern')}
              </button>
            </div>
          </div>

          <div className="editor-meta">
            <span>{tt('Active File', 'Aktive Datei')}: {activeMarkdownPath || tt('none', 'keine')}</span>
            <span>{tt('Dirty', 'Ungespeichert')}: {editorDirty ? tt('yes', 'ja') : tt('no', 'nein')}</span>
            <span>{tt('Sidecar', 'Sidecar')}: {commentSidecarPath || '-'}</span>
            <span>
              {tt('Owners', 'Owner')}:{' '}
              {activeCodeownerHint && activeCodeownerHint.owners.length > 0
                ? activeCodeownerHint.owners.join(', ')
                : hasCodeownersFile
                  ? tt('unowned', 'ohne Owner')
                  : '-'}
            </span>
          </div>

          <div ref={editorMountRef} className="editor-mount" />

          <div className="diff-preview">
            <h3>{tt('Selected Diff', 'Ausgewähltes Diff')}</h3>
            {selectedIsConflict ? (
              <div className="conflict-actions">
                <p>
                  {tt(
                    'Conflict detected. Resolve via Git strategy:',
                    'Konflikt erkannt. Über Git-Strategie auflösen:'
                  )}
                </p>
                <div className="reply-actions">
                  <button onClick={() => resolveSelectedConflict('ours')} disabled={busy || !selectedChangedPath}>
                    {tt('Use Ours', 'Ours verwenden')}
                  </button>
                  <button onClick={() => resolveSelectedConflict('theirs')} disabled={busy || !selectedChangedPath}>
                    {tt('Use Theirs', 'Theirs verwenden')}
                  </button>
                </div>
              </div>
            ) : null}
            <pre>{diff || tt('Select a changed file to view diff output.', 'Wähle eine geänderte Datei für die Diff-Ausgabe.')}</pre>
          </div>
        </section>

        {showRightSidebar ? (
          <aside className="panel sidebar-panel comments-panel">
            <div className="panel-header sidebar-tabs">
              <button
                className={rightSidebarTab === 'comments' ? 'active-tab' : ''}
                onClick={() => setRightSidebarTab('comments')}
                disabled={busy}
              >
                {tt('Comments', 'Kommentare')}
              </button>
              <button
                className={rightSidebarTab === 'outline' ? 'active-tab' : ''}
                onClick={() => setRightSidebarTab('outline')}
                disabled={busy}
              >
                {tt('Outline', 'Dokument-Navigation')}
              </button>
              <button
                className={rightSidebarTab === 'insights' ? 'active-tab' : ''}
                onClick={() => setRightSidebarTab('insights')}
                disabled={busy}
              >
                {tt('Insights', 'Statistiken')}
              </button>
            </div>

            {rightSidebarTab === 'comments' ? (
              <>
                <h2>
                  {tt('Comments', 'Kommentare')} ({openCommentsInPanel} {tt('open', 'offen')})
                </h2>

                <div className="comment-create">
                  <input
                    value={newCommentLine}
                    onChange={(event) => setNewCommentLine(event.target.value)}
                    placeholder={tt('line (optional)', 'Zeile (optional)')}
                  />
                  <textarea
                    value={newCommentText}
                    onChange={(event) => setNewCommentText(event.target.value)}
                    placeholder={tt('Create comment', 'Kommentar erstellen')}
                  />
                  <button className="primary" onClick={createCommentForActiveFile} disabled={busy || !activeMarkdownPath}>
                    {tt('Add Comment', 'Kommentar hinzufügen')}
                  </button>
                </div>

                <ul className="comment-list">
                  {comments.map((comment) => (
                    <li
                      key={comment.id}
                      className={activeCommentId === comment.id ? 'active-thread' : ''}
                      onClick={() => setActiveCommentId(comment.id)}
                    >
                      <div className="comment-head">
                        <strong>{comment.state.toUpperCase()}</strong>
                        <span>{comment.author}</span>
                        <span>
                          {comment.anchor.line ? `${tt('line', 'Zeile')} ${comment.anchor.line}` : `${tt('line', 'Zeile')} -`}
                        </span>
                      </div>
                      <div className="comment-body">
                        {comment.thread.map((message) => (
                          <p key={message.id}>
                            <strong>{message.author}:</strong> {message.text}
                          </p>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="comment-reply">
                  <textarea
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
                    placeholder={tt('Reply to selected thread', 'Auf ausgewählten Thread antworten')}
                  />
                  <div className="reply-actions">
                    <button onClick={appendReply} disabled={busy || !activeCommentId}>
                      {tt('Reply', 'Antworten')}
                    </button>
                    <button onClick={closeActiveComment} disabled={busy || !activeCommentId}>
                      {tt('Close Thread', 'Thread schließen')}
                    </button>
                  </div>
                </div>

                <div className="release-box">
                  <h3>{tt('Release Gate', 'Release-Gate')}</h3>
                  <input
                    value={releaseId}
                    onChange={(event) => setReleaseId(event.target.value)}
                    placeholder={tt('release tag (e.g. release/v0.1.0)', 'Release-Tag (z. B. release/v0.1.0)')}
                  />
                  <input
                    value={releaseTargetRef}
                    onChange={(event) => setReleaseTargetRef(event.target.value)}
                    placeholder={tt('target ref (default HEAD)', 'Ziel-Ref (Standard HEAD)')}
                  />
                  <select
                    value={releaseScopeType}
                    onChange={(event) => setReleaseScopeType(event.target.value as ReleaseScopeType)}
                  >
                    <option value="active">{tt('Scope: active markdown file', 'Scope: aktive Markdown-Datei')}</option>
                    <option value="all">{tt('Scope: all markdown files', 'Scope: alle Markdown-Dateien')}</option>
                  </select>

                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={pushReleaseTag}
                      onChange={(event) => setPushReleaseTag(event.target.checked)}
                    />
                    {tt('Push tag to remote after release', 'Tag nach Release zum Remote pushen')}
                  </label>

                  <div className="reply-actions">
                    <button onClick={checkReleaseGate} disabled={busy || !isRepoOpen}>
                      {tt('Check Gate', 'Gate prüfen')}
                    </button>
                    <button className="primary" onClick={releaseVersionNow} disabled={busy || !isRepoOpen}>
                      {tt('Release Version', 'Version freigeben')}
                    </button>
                  </div>

                  {releaseGate ? (
                    <div className="release-state">
                      <p>
                        {tt('Releasable', 'Freigabefähig')}: {releaseGate.releasable ? tt('yes', 'ja') : tt('no', 'nein')}
                      </p>
                      <p>{tt('Open comments', 'Offene Kommentare')}: {releaseGate.openComments}</p>
                      <p>
                        {tt('Blocking IDs', 'Blockierende IDs')}:{' '}
                        {releaseGate.blockingCommentIds.length > 0
                          ? releaseGate.blockingCommentIds.join(', ')
                          : tt('none', 'keine')}
                      </p>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}

            {rightSidebarTab === 'outline' ? (
              <div className="outline-panel">
                <h2>{tt('Document Navigation', 'Dokument-Navigation')}</h2>
                {headingItems.length === 0 ? (
                  <p className="muted">{tt('No headings in current document.', 'Keine Überschriften im aktuellen Dokument.')}</p>
                ) : (
                  <ul className="outline-list">
                    {headingItems.map((heading) => (
                      <li key={`${heading.line}-${heading.text}`}>
                        <button
                          className="outline-item"
                          style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 14 + 8}px` }}
                          onClick={() => jumpToHeadingLine(heading.line)}
                          disabled={busy}
                        >
                          <span className="outline-hash">{'#'.repeat(heading.level)}</span>
                          <span>{heading.text}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {rightSidebarTab === 'insights' ? (
              <div className="insights-panel">
                <h2>{tt('Statistics & Analysis', 'Statistiken & Analyse')}</h2>
                <div className="insight-grid">
                  <p>{tt('Lines', 'Zeilen')}: {editorInsights.lines}</p>
                  <p>{tt('Words', 'Wörter')}: {editorInsights.wordCount}</p>
                  <p>{tt('Characters', 'Zeichen')}: {editorInsights.charCount}</p>
                  <p>{tt('Headings', 'Überschriften')}: {editorInsights.headingCount}</p>
                  <p>{tt('Estimated reading time', 'Geschätzte Lesezeit')}: {editorInsights.readingMinutes} {tt('min', 'Min')}</p>
                  <p>{tt('Open comments', 'Offene Kommentare')}: {openCommentsInPanel}</p>
                  <p>{tt('Changed files', 'Geänderte Dateien')}: {changedFiles.length}</p>
                  <p>{tt('Conflict files', 'Konfliktdateien')}: {conflictFiles.length}</p>
                </div>
                <div className="insight-words">
                  <h3>{tt('Top Terms', 'Häufige Begriffe')}</h3>
                  {editorInsights.topWords.length === 0 ? (
                    <p className="muted">{tt('No significant terms yet.', 'Noch keine relevanten Begriffe.')}</p>
                  ) : (
                    <ul>
                      {editorInsights.topWords.map(([word, count]) => (
                        <li key={word}>
                          <span>{word}</span>
                          <strong>{count}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </aside>
        ) : null}
      </main>
    </div>
  );
}
