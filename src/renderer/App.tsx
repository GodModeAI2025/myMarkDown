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
  ReleaseGateStatus
} from '../shared/contracts';

type Notice = {
  kind: 'info' | 'error';
  text: string;
};

type ReleaseScopeType = 'active' | 'all';
type Locale = 'de' | 'en';
type ThemeMode = 'light' | 'dark';

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

function loadLocale(): Locale {
  const value = localStorage.getItem('mymarkdown:locale');
  return value === 'de' ? 'de' : 'en';
}

function loadTheme(): ThemeMode {
  const value = localStorage.getItem('mymarkdown:theme');
  return value === 'dark' ? 'dark' : 'light';
}

export default function App(): JSX.Element {
  const editorMountRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<ToastEditor | null>(null);
  const suppressChangeRef = useRef(false);
  const repoInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const commitInputRef = useRef<HTMLInputElement | null>(null);

  const [repoInput, setRepoInput] = useState('');
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [selectedChangedPath, setSelectedChangedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  const [locale, setLocale] = useState<Locale>(loadLocale);
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadTheme);
  const [notice, setNotice] = useState<Notice>({ kind: 'info', text: 'Open a repository to get started.' });
  const [busy, setBusy] = useState(false);

  const [commitMessage, setCommitMessage] = useState('');
  const [remoteInput, setRemoteInput] = useState('origin');
  const [branchInput, setBranchInput] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchFromRef, setNewBranchFromRef] = useState('HEAD');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<MarkdownSearchResult | null>(null);
  const [controlTab, setControlTab] = useState<'sync' | 'branch' | 'search'>('sync');

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
    if (!status) {
      setNotice({ kind: 'info', text: tt('Open a repository to get started.', 'Öffne ein Repository, um zu starten.') });
    }
  }, [locale, status]);

  useEffect(() => {
    localStorage.setItem('mymarkdown:locale', locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    localStorage.setItem('mymarkdown:theme', themeMode);
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

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
      if (busy && action !== 'focus-search') {
        return;
      }

      switch (action) {
        case 'open-repository':
          void pickRepositoryAndOpen();
          break;
        case 'refresh-status':
          if (isRepoOpen) {
            void refreshStatus(true);
          }
          break;
        case 'save-file':
          if (isRepoOpen) {
            void saveActiveFile();
          }
          break;
        case 'commit':
          if (isRepoOpen) {
            if (!commitMessage.trim()) {
              commitInputRef.current?.focus();
            }
            void commitChanges();
          }
          break;
        case 'fetch':
          if (isRepoOpen) {
            void fetchRemote();
          }
          break;
        case 'pull':
          if (isRepoOpen) {
            void pullRemote();
          }
          break;
        case 'push':
          if (isRepoOpen) {
            void pushRemote();
          }
          break;
        case 'incoming-delta':
          if (isRepoOpen) {
            void refreshIncomingDelta(true);
          }
          break;
        case 'focus-search':
          setControlTab('search');
          window.setTimeout(() => searchInputRef.current?.focus(), 0);
          break;
        default:
          break;
      }
    });

    return () => {
      unsubscribe();
    };
  });

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
    setEditorDirty(false);
  }

  function getEditorMarkdown(): string {
    return editorRef.current?.getMarkdown() ?? '';
  }

  async function runQuery<T>(query: () => Promise<AppResult<T>>, successText?: string): Promise<T | null> {
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
  }

  async function refreshIdentity(): Promise<void> {
    const identity = await runQuery(() => window.myMarkdown.getIdentity());
    if (!identity) {
      return;
    }

    setGitIdentity(identity.name || identity.email || 'unknown');
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

  async function openRepository(explicitRepositoryPath?: string): Promise<void> {
    const targetPath = (explicitRepositoryPath ?? repoInput).trim();
    if (!targetPath) {
      setNotice({ kind: 'error', text: tt('Please enter a repository path.', 'Bitte einen Repository-Pfad eingeben.') });
      repoInputRef.current?.focus();
      return;
    }

    if (repoInput !== targetPath) {
      setRepoInput(targetPath);
    }

    setBusy(true);
    const opened = await runQuery(
      () => window.myMarkdown.openRepository(targetPath),
      `${tt('Repository opened', 'Repository geöffnet')}: ${targetPath}`
    );

    if (!opened) {
      setBusy(false);
      return;
    }

    await refreshStatus(false);
    await Promise.all([refreshMarkdownFiles(), refreshIdentity()]);
    await refreshIncomingDelta(false);
    setBusy(false);
  }

  async function pickRepositoryAndOpen(): Promise<void> {
    const picked = await runQuery(() => window.myMarkdown.pickRepositoryDirectory());
    if (!picked) {
      return;
    }

    setRepoInput(picked);
    await openRepository(picked);
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

  return (
    <div className="app-shell">
      <header className="header">
        <h1>{tt('myMarkDown', 'myMarkDown')}</h1>
        <p>{tt('Git identity', 'Git-Identität')}: {gitIdentity}</p>
      </header>

      <section className="repo-open">
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
          onClick={() => {
            void openRepository();
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

      <section className="status-bar">
        <span>
          <strong>{tt('Branch', 'Branch')}:</strong> {branchSummary}
        </span>
        <span>
          <strong>CODEOWNERS:</strong> {hasCodeownersFile ? codeownersPath || 'CODEOWNERS' : tt('not found', 'nicht gefunden')}
        </span>
        <span>
          <strong>{tt('Incoming', 'Eingehend')}:</strong>{' '}
          {incomingDelta
            ? incomingDelta.remoteRef
              ? `${incomingDelta.incomingCommitCount} ${tt('commit(s)', 'Commit(s)')}, ${incomingDelta.incomingFiles.length} ${tt('file(s)', 'Datei(en)')}`
              : tt('no tracking branch', 'kein Tracking-Branch')
            : tt('not checked', 'nicht geprüft')}
        </span>
        <span className={conflictFiles.length > 0 ? 'status-conflicts' : ''}>
          <strong>{tt('Conflicts', 'Konflikte')}:</strong> {conflictFiles.length}
        </span>
      </section>

      <section className="settings-section">
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
            <input value={remoteInput} onChange={(event) => setRemoteInput(event.target.value)} placeholder={tt('remote', 'remote')} />
          </div>

          <div className="setting-row">
            <span className="setting-label">{tt('Default Branch', 'Standard-Branch')}</span>
            <input
              value={branchInput}
              onChange={(event) => setBranchInput(event.target.value)}
              placeholder={tt('branch (optional)', 'Branch (optional)')}
            />
          </div>
        </div>
      </section>

      <section className="control-card">
        <div className="control-tabs">
          <button
            className={controlTab === 'sync' ? 'active-tab' : ''}
            onClick={() => setControlTab('sync')}
            disabled={busy}
          >
            {tt('Sync', 'Sync')}
          </button>
          <button
            className={controlTab === 'branch' ? 'active-tab' : ''}
            onClick={() => setControlTab('branch')}
            disabled={busy}
          >
            {tt('Branch', 'Branch')}
          </button>
          <button
            className={controlTab === 'search' ? 'active-tab' : ''}
            onClick={() => setControlTab('search')}
            disabled={busy}
          >
            {tt('Search', 'Suche')}
          </button>
        </div>

        {controlTab === 'sync' ? (
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

        {controlTab === 'branch' ? (
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
              <button onClick={searchRepository} disabled={busy || !isRepoOpen}>
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

      <main className="main-grid">
        <section className="panel files-panel">
          <div className="panel-header">
            <h2>{tt('Changed Files', 'Geänderte Dateien')}</h2>
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
              <p>{tt('Run fetch or Incoming Delta to inspect remote changes.', 'Führe Fetch oder Eingehende Deltas aus, um Remote-Änderungen zu sehen.')}</p>
            )}
          </div>

          {changedFiles.length === 0 ? (
            <p>{tt('No changes.', 'Keine Änderungen.')}</p>
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
            <button onClick={commitChanges} disabled={busy || !isRepoOpen}>
              {tt('Commit', 'Commit')}
            </button>
          </div>
        </section>

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
              <button onClick={saveActiveFile} disabled={busy || !activeMarkdownPath}>
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
            <pre>{diff || tt('Select a changed file to view diff output.', 'Wähle eine geänderte Datei für die Diff-Ausgabe.')}</pre>
          </div>
        </section>

        <section className="panel comments-panel">
          <h2>{tt('Comments', 'Kommentare')} ({openCommentsInPanel} {tt('open', 'offen')})</h2>

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
            <button onClick={createCommentForActiveFile} disabled={busy || !activeMarkdownPath}>
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
                  <span>{comment.anchor.line ? `${tt('line', 'Zeile')} ${comment.anchor.line}` : `${tt('line', 'Zeile')} -`}</span>
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
              <button onClick={releaseVersionNow} disabled={busy || !isRepoOpen}>
                {tt('Release Version', 'Version freigeben')}
              </button>
            </div>

            {releaseGate ? (
              <div className="release-state">
                <p>{tt('Releasable', 'Freigabefähig')}: {releaseGate.releasable ? tt('yes', 'ja') : tt('no', 'nein')}</p>
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
        </section>
      </main>
    </div>
  );
}
