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

## Notes
- Git remains the authoritative backend.
- Comments are persisted only as sidecar metadata under `.comments/` and not inside final markdown files.
- Release action creates an annotated git tag after gate checks (`open_comments == 0` in scope).
