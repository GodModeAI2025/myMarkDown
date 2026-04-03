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
  const [notice, setNotice] = useState<Notice>({ kind: 'info', text: 'Open a repository to get started.' });
  const [busy, setBusy] = useState(false);

  const [commitMessage, setCommitMessage] = useState('');
  const [remoteInput, setRemoteInput] = useState('origin');
  const [branchInput, setBranchInput] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchFromRef, setNewBranchFromRef] = useState('HEAD');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<MarkdownSearchResult | null>(null);

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
  const activeCodeownerHint = activeMarkdownPath
    ? codeownerHintsByPath[normalizePath(activeMarkdownPath)] ?? null
    : null;

  const branchSummary = useMemo(() => {
    if (!status) {
      return 'No repository selected';
    }

    const branch = status.branch ?? 'detached HEAD';
    const tracking = status.trackingBranch ? ` -> ${status.trackingBranch}` : '';
    return `${branch}${tracking} | ahead ${status.ahead} / behind ${status.behind}`;
  }, [status]);

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
        placeholder: 'Select a markdown file and start editing...'
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
          searchInputRef.current?.focus();
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
      showNotice ? 'Incoming delta refreshed.' : undefined
    );

    if (!incoming) {
      return;
    }

    setIncomingDelta(incoming);
  }

  async function searchRepository(): Promise<void> {
    if (!searchQuery.trim()) {
      setNotice({ kind: 'error', text: 'Please enter a search term.' });
      return;
    }

    setBusy(true);
    const result = await runQuery(
      () =>
        window.myMarkdown.searchMarkdown({
          query: searchQuery.trim(),
          maxResults: 120
        }),
      `Search finished for "${searchQuery.trim()}".`
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
      setNotice({ kind: 'error', text: 'Please enter a repository path.' });
      repoInputRef.current?.focus();
      return;
    }

    if (repoInput !== targetPath) {
      setRepoInput(targetPath);
    }

    setBusy(true);
    const opened = await runQuery(
      () => window.myMarkdown.openRepository(targetPath),
      `Repository opened: ${targetPath}`
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

    setDiff(diffData || '(No diff output for selected file)');
  }

  async function stageSelected(): Promise<void> {
    if (!selectedChangedPath) {
      return;
    }

    setBusy(true);
    const result = await runQuery(
      () => window.myMarkdown.stage([selectedChangedPath]),
      `Staged ${selectedChangedPath}`
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
      `Unstaged ${selectedChangedPath}`
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
      'Staged all changed files.'
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
      setNotice({ kind: 'info', text: 'No staged files to unstage.' });
      return;
    }

    setBusy(true);
    const result = await runQuery(() => window.myMarkdown.unstage(staged), 'Unstaged all staged files.');

    if (result !== null) {
      await refreshStatus(false);
    }

    setBusy(false);
  }

  async function commitChanges(): Promise<void> {
    if (!commitMessage.trim()) {
      setNotice({ kind: 'error', text: 'Please enter a commit message.' });
      return;
    }

    setBusy(true);
    const committed = await runQuery(() => window.myMarkdown.commit(commitMessage.trim()), 'Commit created successfully.');

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

    const fetched = await runQuery(() => window.myMarkdown.fetch(target), `Fetched from ${target.remote}.`);
    if (fetched !== null) {
      await refreshStatus(false);
      await refreshIncomingDelta(false);
    }

    setBusy(false);
  }

  async function pullRemote(): Promise<void> {
    setBusy(true);
    const target = currentRemoteTarget();

    const pulled = await runQuery(() => window.myMarkdown.pull(target), `Pulled from ${target.remote}.`);
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

    const pushed = await runQuery(() => window.myMarkdown.push(target), `Pushed to ${target.remote}.`);
    if (pushed !== null) {
      await refreshStatus(false);
      await refreshIncomingDelta(false);
    }

    setBusy(false);
  }

  async function createAndCheckoutBranch(): Promise<void> {
    if (!newBranchName.trim()) {
      setNotice({ kind: 'error', text: 'Please enter a new branch name.' });
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
      `Created and checked out ${newBranchName.trim()}.`
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
      setNotice({ kind: 'error', text: 'Please enter a branch to checkout.' });
      return;
    }

    setBusy(true);
    const checkedOutBranch = await runQuery(
      () => window.myMarkdown.checkoutBranch(branchName),
      `Checked out ${branchName}.`
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
      setNotice({ kind: 'error', text: 'No current branch available to set upstream.' });
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
      `Upstream set to ${remote}/${branchName}.`
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
      const proceed = window.confirm('You have unsaved changes. Switch file and discard local editor changes?');
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
              `Recovered local draft for ${file.path}. Restore draft content?`
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
      setNotice({ kind: 'info', text: `Loaded ${file.path}` });
    }

    setBusy(false);
  }

  async function saveActiveFile(): Promise<void> {
    if (!activeMarkdownPath) {
      setNotice({ kind: 'error', text: 'Select a markdown file first.' });
      return;
    }

    setBusy(true);
    const saveResult = await runQuery(
      () =>
        window.myMarkdown.writeMarkdownFile({
          path: activeMarkdownPath,
          content: getEditorMarkdown()
        }),
      `Saved ${activeMarkdownPath}`
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
      setNotice({ kind: 'error', text: 'Select an active markdown file first.' });
      return;
    }

    if (!newCommentText.trim()) {
      setNotice({ kind: 'error', text: 'Comment text cannot be empty.' });
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
      'Comment created.'
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
      setNotice({ kind: 'error', text: 'Select a comment thread first.' });
      return;
    }

    if (!replyText.trim()) {
      setNotice({ kind: 'error', text: 'Reply text cannot be empty.' });
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
      'Reply added.'
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
      setNotice({ kind: 'error', text: 'Select a comment thread first.' });
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
      'Comment closed.'
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
      setNotice({ kind: 'error', text: 'Release ID is required.' });
      return;
    }

    if (releaseScopePaths.length === 0) {
      setNotice({ kind: 'error', text: 'Release scope is empty.' });
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
      'Release gate checked.'
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
      setNotice({ kind: 'error', text: 'Release ID is required.' });
      return;
    }

    if (releaseScopePaths.length === 0) {
      setNotice({ kind: 'error', text: 'Release scope is empty.' });
      return;
    }

    if (!releaseGate || !releaseGate.releasable) {
      setNotice({ kind: 'error', text: 'Release is blocked. Run gate check and close open comments first.' });
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
      `Released ${normalizedReleaseId}`
    );

    if (result) {
      setNotice({
        kind: 'info',
        text: result.pushed
          ? `Release tag ${result.tag} created and pushed.`
          : `Release tag ${result.tag} created locally.`
      });

      await refreshStatus(false);
      setReleaseGate(null);
    }

    setBusy(false);
  }

  return (
    <div className="app-shell">
      <header className="header">
        <h1>myMarkDown</h1>
        <p>Git identity: {gitIdentity}</p>
      </header>

      <section className="repo-open">
        <input
          ref={repoInputRef}
          value={repoInput}
          onChange={(event) => setRepoInput(event.target.value)}
          placeholder="/absolute/path/to/repository"
        />
        <button onClick={pickRepositoryAndOpen} disabled={busy}>
          Browse
        </button>
        <button
          onClick={() => {
            void openRepository();
          }}
          disabled={busy}
        >
          Open Repository
        </button>
        <button onClick={() => refreshStatus(true)} disabled={busy || !isRepoOpen}>
          Refresh Status
        </button>
      </section>

      <section className="sync-controls">
        <input value={remoteInput} onChange={(event) => setRemoteInput(event.target.value)} placeholder="remote" />
        <input
          value={branchInput}
          onChange={(event) => setBranchInput(event.target.value)}
          placeholder="branch (optional)"
        />
        <button onClick={fetchRemote} disabled={busy || !isRepoOpen}>
          Fetch
        </button>
        <button onClick={pullRemote} disabled={busy || !isRepoOpen}>
          Pull (rebase)
        </button>
        <button onClick={pushRemote} disabled={busy || !isRepoOpen}>
          Push
        </button>
        <button onClick={() => refreshIncomingDelta(true)} disabled={busy || !isRepoOpen}>
          Incoming Delta
        </button>
      </section>

      <section className="branch-controls">
        <input
          value={newBranchName}
          onChange={(event) => setNewBranchName(event.target.value)}
          placeholder="new branch name"
        />
        <input
          value={newBranchFromRef}
          onChange={(event) => setNewBranchFromRef(event.target.value)}
          placeholder="from ref (default HEAD)"
        />
        <button onClick={createAndCheckoutBranch} disabled={busy || !isRepoOpen}>
          Create + Checkout
        </button>
        <button onClick={checkoutBranchNow} disabled={busy || !isRepoOpen}>
          Checkout Branch
        </button>
        <button onClick={setUpstreamNow} disabled={busy || !isRepoOpen}>
          Set Upstream
        </button>
      </section>

      <section className={`notice ${notice.kind}`}>{notice.text}</section>

      <section className="status-bar">
        <span>
          <strong>Branch:</strong> {branchSummary}
        </span>
        <span>
          <strong>CODEOWNERS:</strong> {hasCodeownersFile ? codeownersPath || 'CODEOWNERS' : 'not found'}
        </span>
        <span>
          <strong>Incoming:</strong>{' '}
          {incomingDelta
            ? incomingDelta.remoteRef
              ? `${incomingDelta.incomingCommitCount} commit(s), ${incomingDelta.incomingFiles.length} file(s)`
              : 'no tracking branch'
            : 'not checked'}
        </span>
        <span className={conflictFiles.length > 0 ? 'status-conflicts' : ''}>
          <strong>Conflicts:</strong> {conflictFiles.length}
        </span>
      </section>

      <section className="search-panel">
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
            placeholder="Search markdown content..."
            disabled={busy || !isRepoOpen}
          />
          <button onClick={searchRepository} disabled={busy || !isRepoOpen}>
            Search
          </button>
        </div>
        {searchResult ? (
          <div className="search-results">
            <p>
              Results for <strong>{searchResult.query}</strong>: {searchResult.totalMatches}
              {searchResult.truncated ? ' (truncated)' : ''}
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
                    <span className="search-hit-excerpt">{item.excerpt || '(empty line)'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <main className="main-grid">
        <section className="panel files-panel">
          <div className="panel-header">
            <h2>Changed Files</h2>
            <div className="file-actions">
              <button onClick={stageSelected} disabled={busy || !selectedChangedPath}>
                Stage Selected
              </button>
              <button onClick={unstageSelected} disabled={busy || !selectedChangedPath}>
                Unstage Selected
              </button>
              <button onClick={stageAll} disabled={busy || changedFiles.length === 0}>
                Stage All
              </button>
              <button onClick={unstageAll} disabled={busy || changedFiles.length === 0}>
                Unstage All
              </button>
            </div>
          </div>

          <div className="incoming-box">
            <strong>Remote Delta</strong>
            {incomingDelta ? (
              incomingDelta.remoteRef ? (
                <>
                  <p>
                    Source: {incomingDelta.remoteRef} | commits: {incomingDelta.incomingCommitCount} | files:{' '}
                    {incomingDelta.incomingFiles.length}
                  </p>
                  <p className={incomingDelta.conflictCandidates.length > 0 ? 'incoming-warning' : ''}>
                    Conflict candidates:{' '}
                    {incomingDelta.conflictCandidates.length > 0
                      ? incomingDelta.conflictCandidates.join(', ')
                      : 'none'}
                  </p>
                </>
              ) : (
                <p>No tracking branch configured.</p>
              )
            ) : (
              <p>Run fetch or Incoming Delta to inspect remote changes.</p>
            )}
          </div>

          {changedFiles.length === 0 ? (
            <p>No changes.</p>
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
                      {isConflictEntry(file) ? <span className="conflict-pill">CONFLICT</span> : null}
                      {hasOwners ? (
                        <span
                          className="owner-pill"
                          title={hint?.matchedPattern ? `CODEOWNERS pattern: ${hint.matchedPattern}` : 'CODEOWNERS'}
                        >
                          {hint?.owners.join(', ')}
                        </span>
                      ) : hasCodeownersFile ? (
                        <span className="owner-pill owner-pill-none">unowned</span>
                      ) : null}
                      {file.originalPath ? <span className="rename">(from {file.originalPath})</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="commit-box">
            <h3>Create Commit</h3>
            <input
              ref={commitInputRef}
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="Commit message"
            />
            <button onClick={commitChanges} disabled={busy || !isRepoOpen}>
              Commit
            </button>
          </div>
        </section>

        <section className="panel editor-panel">
          <div className="panel-header">
            <h2>Markdown Editor</h2>
            <div className="editor-toolbar">
              <select
                value={activeMarkdownPath}
                onChange={(event) => {
                  void loadMarkdownFile(event.target.value);
                }}
                disabled={busy || markdownFiles.length === 0}
              >
                {markdownFiles.length === 0 ? <option value="">No markdown files</option> : null}
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
                Markdown Code
              </button>
              <button onClick={saveActiveFile} disabled={busy || !activeMarkdownPath}>
                Save File
              </button>
            </div>
          </div>

          <div className="editor-meta">
            <span>Active File: {activeMarkdownPath || 'none'}</span>
            <span>Dirty: {editorDirty ? 'yes' : 'no'}</span>
            <span>Sidecar: {commentSidecarPath || '-'}</span>
            <span>
              Owners:{' '}
              {activeCodeownerHint && activeCodeownerHint.owners.length > 0
                ? activeCodeownerHint.owners.join(', ')
                : hasCodeownersFile
                  ? 'unowned'
                  : '-'}
            </span>
          </div>

          <div ref={editorMountRef} className="editor-mount" />

          <div className="diff-preview">
            <h3>Selected Diff</h3>
            <pre>{diff || 'Select a changed file to view diff output.'}</pre>
          </div>
        </section>

        <section className="panel comments-panel">
          <h2>Comments ({openCommentsInPanel} open)</h2>

          <div className="comment-create">
            <input
              value={newCommentLine}
              onChange={(event) => setNewCommentLine(event.target.value)}
              placeholder="line (optional)"
            />
            <textarea
              value={newCommentText}
              onChange={(event) => setNewCommentText(event.target.value)}
              placeholder="Create comment"
            />
            <button onClick={createCommentForActiveFile} disabled={busy || !activeMarkdownPath}>
              Add Comment
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
                  <span>{comment.anchor.line ? `line ${comment.anchor.line}` : 'line -'}</span>
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
              placeholder="Reply to selected thread"
            />
            <div className="reply-actions">
              <button onClick={appendReply} disabled={busy || !activeCommentId}>
                Reply
              </button>
              <button onClick={closeActiveComment} disabled={busy || !activeCommentId}>
                Close Thread
              </button>
            </div>
          </div>

          <div className="release-box">
            <h3>Release Gate</h3>
            <input
              value={releaseId}
              onChange={(event) => setReleaseId(event.target.value)}
              placeholder="release tag (e.g. release/v0.1.0)"
            />
            <input
              value={releaseTargetRef}
              onChange={(event) => setReleaseTargetRef(event.target.value)}
              placeholder="target ref (default HEAD)"
            />
            <select
              value={releaseScopeType}
              onChange={(event) => setReleaseScopeType(event.target.value as ReleaseScopeType)}
            >
              <option value="active">Scope: active markdown file</option>
              <option value="all">Scope: all markdown files</option>
            </select>

            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={pushReleaseTag}
                onChange={(event) => setPushReleaseTag(event.target.checked)}
              />
              Push tag to remote after release
            </label>

            <div className="reply-actions">
              <button onClick={checkReleaseGate} disabled={busy || !isRepoOpen}>
                Check Gate
              </button>
              <button onClick={releaseVersionNow} disabled={busy || !isRepoOpen}>
                Release Version
              </button>
            </div>

            {releaseGate ? (
              <div className="release-state">
                <p>Releasable: {releaseGate.releasable ? 'yes' : 'no'}</p>
                <p>Open comments: {releaseGate.openComments}</p>
                <p>
                  Blocking IDs:{' '}
                  {releaseGate.blockingCommentIds.length > 0
                    ? releaseGate.blockingCommentIds.join(', ')
                    : 'none'}
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
