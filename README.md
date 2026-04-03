# myMarkDown

Git-native desktop Markdown workspace.

## Foundation in this repo
- Electron shell with secure preload bridge
- React + TypeScript renderer
- Dual editor: WYSIWYG and Markdown source mode (single markdown state)
- Git workflow: status, diff, stage/unstage, commit, fetch/pull(rebase)/push
- Sidecar comments in `.comments/<escaped-target>.comments.json`
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
