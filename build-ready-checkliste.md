# myMarkDown Build-Ready Checkliste

Ziel: Wenn diese Liste auf `done` steht, kann die Umsetzung ohne weitere Konzeptarbeit starten.

## 1. Technische Defaults (empfohlen)
- Stack: `Electron + TypeScript + React + Vite`.
- Editor: `Tiptap/ProseMirror` (WYSIWYG) + `CodeMirror` (Markdown-Codeansicht).
- Markdown-Pipeline: `remark/rehype` mit Mermaid/Math Support.
- Git-Engine: nativer `git` CLI Adapter (kein eigener Git-Server).
- Kommentar-Speicher: `.comments/*.json` Sidecar-Dateien im Repo.
- Release-Gate: Freigabe nur bei `open_comments == 0` im definierten Scope.

## 2. Entscheidungen, die final sein muessen
- [x] Sidecar-Naming festgelegt: eine Datei pro Markdown-Datei (`.comments/<escaped-target>.comments.json`).
- [x] Default-Merge-Strategie festgelegt: `rebase` fuer lokale Syncs, PR-Merge auf `main`.
- [x] Release-Scope bestaetigt: `targetRef + path set + sidecar set`.
- [x] Mindestversionen festgelegt: `Node LTS`, `Git >= 2.40`.

## 3. GitHub/Repo Voraussetzungen
- [ ] Admin-Zugriff auf `https://github.com/GodModeAI2025/myMarkDown`.
- [ ] Branch Protection fuer `main` aktiv.
  Empfehlung: PR-Pflicht, 1 Review, Status Checks Pflicht.
- [ ] `CODEOWNERS` vorhanden und abgestimmt.
- [ ] Test-Repository fuer private Zugriffe verfuegbar.
- [ ] Test-Repository mit geschuetztem Branch verfuegbar.

## 4. CI/CD Voraussetzungen
- [ ] Basis-CI fuer Build + Test + Lint aktiv.
- [ ] PR-Checks als Required Checks konfiguriert.
- [ ] Release-Tagging-Konvention festgelegt.
  Empfehlung: `vMAJOR.MINOR.PATCH`.

## 5. Testdaten und Abnahme
- [ ] Mindestens 10 Beispiel-Markdown-Dateien in `docs/`.
- [ ] Mindestens 1 Book-Struktur unter `books/`.
- [ ] Kommentar-Testdaten in `.comments/`.
- [ ] Abnahmekriterien aus `anforderungen.md` sind eingefroren.

## 6. Was ich dann direkt baue
1. Projekt-Scaffold und Build-Pipeline.
2. Git-Adapter (status/diff/stage/commit/fetch/pull/push/branch).
3. Dual-Editor (WYSIWYG + Code) mit verlustfreiem Umschalten.
4. Sidecar-Kommentar-Workflow (create/append/close).
5. Freigabe-Gate (`open_comments == 0`).
6. Rechte-/Policy-Hinweise (`CODEOWNERS`, protected branch, auth errors).
7. HIG-konforme macOS-UI und Abnahmetests.

## 7. Startsignal
Sobald die offenen Checkboxen in Abschnitt 2 bis 4 geklaert sind, starte ich mit Sprint 1 und liefere inkrementell pro Phase.
