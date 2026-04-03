# myMarkDown

Git-native desktop Markdown workspace.

## Foundation in this repo
- Electron shell with secure preload bridge
- React + TypeScript renderer
- Dual editor: WYSIWYG and Markdown source mode (single markdown state)
- Git workflow: status, diff, stage/unstage, commit, fetch/pull(rebase)/push
- Branch workflow: create + checkout branch, switch branch, set upstream tracking
- Incoming remote delta preview with conflict-candidate hints
- Local markdown full-text search with clickable results
- Explicit conflict highlighting for merge/rebase conflict status codes
- App menu + keyboard shortcuts for core actions (Open, Refresh, Save, Commit, Fetch/Pull/Push, Search)
- UI toggles for language (Deutsch/English) and theme (Light/Dark) with persistence
- Apple-style 3-pane workspace: hideable left navigation + centered editor + hideable right context sidebar
- Right context sidebar tabs: comments, heading outline navigation, statistics/analysis insights
- View menu actions + shortcuts to toggle left/right sidebars (`Alt+CmdOrCtrl+1/2`)
- First-run onboarding: asks for Git repository + base settings before entering workspace
- Onboarding connect flow supports local folder + optional remote URL login (system credentials or HTTPS user/token)
- Connect flow can open existing repo, initialize local repo, or clone remote into an empty local folder
- Automatic fallback for systems without Git: start a local demo workspace from onboarding
- Non-interactive Git auth checks (`GIT_TERMINAL_PROMPT=0`) to avoid hanging credential prompts
- Credential-safe error handling with masking for URL-embedded secrets
- Empty-repo bootstrap: initializes required project structure (markdown + folders) automatically
- Git-friendly folder placeholders (`.gitkeep`) to represent otherwise-empty directories
- Conflict resolution actions in-app (`Use Ours` / `Use Theirs`) with direct diff context
- Hardened renderer error handling for unexpected IPC/runtime failures
- Stable one-time app menu subscription (reduced event re-subscription churn)
- Extended parser/unit coverage for repository-state derivation logic
- Dedicated settings section for app configuration (language, theme, remote, default branch)
- Local draft autosave + recovery prompt per repository/file
- Sidecar comments in `.comments/<escaped-target>.comments.json`
- CODEOWNERS path hints for changed/active markdown files
- Policy/auth-aware Git error hints (protected branch, auth, non-fast-forward, conflicts)
- Release gate: release blocked while open comments exist in scope

## Run
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```

## Main Process Parser Tests
```bash
npm run test:main
```

## Notes
- Git remains the authoritative backend.
- If Git is not installed, the app can run in demo mode with Git actions disabled.
- Remote authentication is verified during onboarding connect when a remote URL is configured.
- Unit tests cover remote-auth URL construction and credential masking helpers.
- Comments are persisted only as sidecar metadata under `.comments/` and not inside final markdown files.
- If onboarding detects a fully empty repository (no commits, no tracked/untracked files), a starter structure is created.
- Release action creates an annotated git tag after gate checks (`open_comments == 0` in scope).
