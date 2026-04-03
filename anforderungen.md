# Spec-Driven Development Spec: myMarkDown (Git-Only Backend + lokale Electron App)

## 1. Ziel
Diese Spezifikation definiert ein Git-natives System für kollaborative Markdown-Dokumentation.
Produktname der Anwendung: `myMarkDown`.
Harte Vorgabe: Das einzige Backend ist Git (Remote-Repository). Die App läuft lokal als Electron-Anwendung.

## 2. Nicht verhandelbare Architekturregeln
- AR-001: Kein separates Applikations-Backend (keine eigene DB-API, kein zentraler App-Server).
- AR-002: Git-Repository ist Single Source of Truth für Inhalte, Historie, Rechteableitung und Struktur.
- AR-003: Die App ist local-first und muss offline editieren können.
- AR-004: Alle persistierten Fachdaten liegen als Dateien im Repo.
- AR-005: Rechte werden aus Git-Mechanismen und Repository-Regeln abgeleitet.
- AR-006: Git ist führend in der Datenhaltung; lokale Indizes/Caches sind rein abgeleitet und jederzeit aus Git rekonstruierbar.
- AR-007: Kommentare werden Git-basiert als Sidecar-Metadaten gespeichert und niemals in den finalen Markdown-Inhalt geschrieben.

## 3. Systemkontext
### 3.1 Komponenten
- Electron Desktop Client (UI, Editor, lokaler Index, Git-Adapter).
- Lokales Working Directory (Clone des Repos).
- Git Remote (z. B. GitHub/GitLab/Gitea) als einziges zentrales System, public oder private.
- Git-Identität des angemeldeten Nutzers (PAT/SSH/OAuth/Credential Manager) für Zugriff auf private Repositories.

### 3.2 Kein Bestandteil
- Zentrale Benutzerverwaltung außerhalb von Git.
- Serverseitige Kommentar- oder Notizdatenbank.
- Proprietäres Sync-Protokoll neben Git.

## 4. Repository als Datenmodell
### 4.1 Standardstruktur (konfigurierbar)
- `docs/` für reguläre Inhalte.
- `books/<book-id>/` für Buchstrukturen.
- `templates/` für Vorlagen.
- `assets/` für Bilder/Anhänge.
- `.meta/` für app-spezifische Metadaten, falls nötig (nur dateibasiert).
- `.comments/` für Kommentar-Sidecar-Dateien (Git-versioniert).

### 4.2 Dateiformate
- Primärformat: `*.md`.
- Zusatzdaten: `*.json` oder `*.yaml` nur falls fachlich notwendig.
- Keine binären proprietären Datenbanken als Systemquelle.
- Kommentare: `*.json` in `.comments/` mit Referenz auf Zieldatei und Textanker.

### 4.3 Führende Datenhaltung in Git
- FR-DATA-001: Der fachlich gültige Stand ist immer der Git-Stand (Working Tree + Commit-Historie + Remote).
- FR-DATA-002: Lokale App-Daten (Index, Suche, UI-State) sind nicht autoritativ und dürfen Inhalte nicht dauerhaft von Git entkoppeln.
- FR-DATA-003: Jede persistente Inhaltsänderung wird als Git-Dateiänderung abgebildet und ist per Commit nachvollziehbar.

Akzeptanzkriterien:
- Nach Löschen aller lokalen Cache-Dateien ist der vollständige Zustand durch erneutes Laden aus dem Repo reproduzierbar.
- Es existiert keine zweite persistente Inhaltsquelle außerhalb des Repositories.

### 4.4 Kommentar-Sidecar-Modell (Git-basiert)
- FR-DATA-010: Zu jeder kommentierbaren Markdown-Datei kann eine Sidecar-Datei unter `.comments/` geführt werden.
- FR-DATA-011: Kommentarobjekte enthalten mindestens `id`, `targetPath`, `anchor`, `author`, `state`, `createdAt`, `updatedAt`, `thread`.
- FR-DATA-012: Der finale Markdown-Inhalt unter `docs/` und `books/` enthält keine persistierten Kommentarblöcke oder Kommentar-Marker.

Akzeptanzkriterien:
- Beim Erstellen/Ergänzen/Schließen von Kommentaren ändern sich nur Sidecar-Dateien, nicht der fachliche Markdown-Inhalt.
- Ein Export/Release-Artefakt enthält den reinen Markdown-Content ohne Kommentar-Metadaten.

## 5. Rechte- und Governance-Modell aus Git
### 5.1 Autoritative Rechte
- FR-ACL-000: Zugriff auf private Repositories ist nur mit authentifiziertem Git-User möglich.
- FR-ACL-001: Leserechte entsprechen Git-Clone/Pull-Berechtigung.
- FR-ACL-002: Schreibrechte entsprechen Push-Berechtigung auf Zielbranch.
- FR-ACL-003: Branch Protection des Remote ist autoritativ.

### 5.2 Pfadbezogene Steuerung
- FR-ACL-010: Ordner-/Datei-Governance erfolgt über `CODEOWNERS` + Branch-Regeln.
- FR-ACL-011: App zeigt erwartete Reviewer/Owner pro Pfad an.
- FR-ACL-012: App blockiert keine Rechte lokal hart, wenn Remote final entscheidet; sie gibt aber klare Vorab-Hinweise.

### 5.3 Akzeptanzkriterien
- Push auf geschützte Branches scheitert erwartbar und wird als Policy-Hinweis angezeigt.
- Änderungen an pfadsensitiven Dateien zeigen vor Commit die betroffenen Owner.
- Bei privaten Repositories schlagen Clone/Fetch/Pull/Push ohne gültige Authentifizierung mit klarer Login-Hilfe fehl.

## 6. Delta-Handling für Git-Änderungen (Kernanforderung)
### 6.1 Lokale Deltas
- FR-DELTA-001: Bei jeder gespeicherten Datei wird `working tree delta` ermittelt.
- FR-DELTA-002: Anzeige von unstaged/staged/untracked Änderungen in Echtzeit.
- FR-DELTA-003: Vor Commit wird ein strukturierter Delta-Report erzeugt.

### 6.2 Remote-Deltas
- FR-DELTA-010: Nach `fetch` zeigt die App eingehende Deltas (`HEAD..origin/<branch>`).
- FR-DELTA-011: Vor `pull` erfolgt Vorschau auf Konfliktkandidaten.
- FR-DELTA-012: Nach `pull`/`merge` werden resultierende Deltas neu klassifiziert.

### 6.3 Semantische Markdown-Deltas
- FR-DELTA-020: Neben Line-Diff optional Abschnitts-/Heading-Diff für Markdown.
- FR-DELTA-021: Erkennung von Datei-Umbenennungen, Verschiebungen und Löschungen.
- FR-DELTA-022: Änderungsereignisse werden lokal auditierbar protokolliert (dateibasiert).

### 6.4 Akzeptanzkriterien
- Jede Git-Zustandsänderung (save, stage, commit, fetch, pull, merge, rebase) aktualisiert den Delta-Status innerhalb von <= 1 s bei <= 2.000 Dateien.
- Konfliktdateien werden eindeutig markiert und mit Auflösungspfad versehen.

## 7. Funktionale Anforderungen (Produkt)
### 7.1 Editor und lokale Nutzung
- FR-APP-001: Markdown-Editor mit Split-Preview.
- FR-APP-002: Offline-Bearbeitung ohne Remote-Verbindung.
- FR-APP-003: Lokale Volltextsuche über Repository-Inhalte.
- FR-APP-004: Der Editor bietet eine WYSIWYG-Ansicht für visuelles Bearbeiten.
- FR-APP-005: Der Editor bietet eine Markdown-Codeansicht für direktes Bearbeiten des Quelltexts.
- FR-APP-006: Nutzer können jederzeit zwischen WYSIWYG- und Codeansicht umschalten, ohne Datenverlust.

Akzeptanzkriterien:
- Änderungen in der WYSIWYG-Ansicht sind unmittelbar in der Markdown-Codeansicht sichtbar.
- Änderungen in der Markdown-Codeansicht sind unmittelbar in der WYSIWYG-Ansicht sichtbar.
- Der Wechsel der Ansicht verändert den fachlichen Markdown-Inhalt nicht unerwartet (keine stillen Strukturverluste).

### 7.2 Git Workflow in der App
- FR-GIT-001: Clone, Open Repo, Fetch, Pull, Commit, Push in der UI.
- FR-GIT-002: Branch erstellen/wechseln, Upstream setzen, Status anzeigen.
- FR-GIT-003: Commit-Vorlagen (Conventional Commit optional).
- FR-GIT-004: Diff-Ansicht vor Commit und vor Push.
- FR-GIT-005: Aktive Git-Identität (Benutzer/Account) wird angezeigt; Account-Wechsel für private Repos ist möglich.

### 7.3 Struktur und Navigation
- FR-INFO-001: Navigation folgt realer Ordnerstruktur im Repo.
- FR-INFO-002: Dateioperationen (neu, umbenennen, verschieben, löschen) werden als Git-Änderungen geführt.
- FR-INFO-003: Templates werden aus `templates/` geladen.
- FR-INFO-004: Book-Struktur wird aus `books/` gerendert.

### 7.4 Kollaboration ohne zentrales Backend
- FR-COL-001: Zusammenarbeit erfolgt über Branches, Pull Requests und Git-Historie.
- FR-COL-002: Kommentare werden in Git als Sidecar-Dateien geführt; die App rendert sie als Overlay zur Markdown-Datei.
- FR-COL-003: Keine serverseitige Echtzeit-Presence als Pflichtfunktion im MVP.
- FR-COL-004: Für den Freigabe-Check werden Sidecar-Kommentare in einen einheitlichen `open/closed` Status abgebildet.
- FR-COL-005: PR-Review-Kommentare können optional gespiegelt werden, aber die Freigabelogik wertet den Git-Sidecar-Store aus.

### 7.5 Freigabe- und Kommentarregeln
- FR-REL-001: Eine Version darf nur freigegeben werden, wenn es im Freigabe-Scope keine offenen Kommentare gibt.
- FR-REL-002: Solange mindestens ein Kommentar offen ist, ist die Aktion `Version freigeben` blockiert.
- FR-REL-003: Offene Kommentare dürfen von anderen Nutzern ergänzt werden (Antworten/Erweiterungen).
- FR-REL-004: Kommentare dürfen von allen Nutzern geschlossen werden.
- FR-REL-005: Vor der Freigabe wird die Anzahl offener Kommentare explizit angezeigt.

Akzeptanzkriterien:
- Bei `open_comments > 0` ist Freigabe technisch gesperrt und die UI zeigt die offenen Threads.
- Bei `open_comments = 0` wird die Freigabeaktion sofort freigeschaltet.
- Ergänzungen durch andere Nutzer werden im Kommentarverlauf mit Autor und Zeit sichtbar.
- Jeder angemeldete Nutzer mit Kommentarzugriff kann einen Kommentar schließen.
- Beim Freigeben bleibt die Markdown-Zieldatei frei von Kommentar-Inhalt; nur Sidecar-Status kann sich ändern.

## 8. Nicht-funktionale Anforderungen
### 8.1 Performance
- NFR-001: App-Start (warm) <= 2,0 s.
- NFR-002: Delta-Refresh nach Speichern <= 300 ms bei mittleren Repos.
- NFR-003: Repo-Baum-Navigation <= 100 ms Reaktionszeit.

### 8.2 Zuverlässigkeit
- NFR-010: Kein Datenverlust bei App-Absturz (Autosave lokal).
- NFR-011: Wiederanlauf mit Recovery des letzten Editorzustands.

### 8.3 Sicherheit
- NFR-020: Auth gegen Git-Provider via PAT/SSH/OAuth (abhängig vom Provider).
- NFR-021: Secrets nie im Klartext im Repo speichern.
- NFR-022: Alle schreibenden Aktionen explizit bestätigbar (Commit/Push).
- NFR-023: Credentials werden nur über OS-Keychain/Credential-Manager oder SSH-Agent verwaltet, nicht in App-Logs.

### 8.4 Plattform
- NFR-030: Electron auf macOS, Windows, Linux.
- NFR-031: Keine Root-Rechte erforderlich.

### 8.5 UI-Prinzipien nach Apple Human Interface Guidelines (HIG)
- NFR-040: Das UI folgt den HIG-Grundprinzipien `Hierarchy`, `Harmony`, `Consistency`.
- NFR-041: `myMarkDown` nutzt auf Apple-Plattformen bevorzugt systemnahe Standard-Komponenten für Navigation, Toolbars, Menüs, Eingaben und Suchfelder.
- NFR-042: Toolbar-Design folgt HIG: klare Gruppierung, keine Überladung, wichtige Aktionen sichtbar priorisieren; zusätzliche Aktionen in `More`/Overflow.
- NFR-043: Auf macOS gilt: zentrale Befehle sind zusätzlich über die Menüleiste erreichbar (Toolbar ist nicht der einzige Zugang).
- NFR-044: Layout folgt HIG mit klarer Informationshierarchie, ausreichenden Abständen und progressiver Offenlegung (progressive disclosure).
- NFR-045: Suchfunktionen orientieren sich an HIG-Suche: primär über Suchfeld, optional Vorschläge/Verlauf/Scope-Filter.
- NFR-046: Accessibility folgt HIG-Prinzipien `intuitive`, `perceivable`, `adaptable`; Kernfunktionen müssen ohne Maus nutzbar sein.
- NFR-047: In macOS-Fenstern werden kritische Controls nicht ausschließlich am unteren Fensterrand platziert.
- NFR-048: HIG-Anforderungen sind für Apple-Plattform-Builds (`macOS`) verbindlich; auf `Windows/Linux` gelten die jeweiligen nativen Plattformkonventionen bei gleicher Informationsarchitektur.

Referenzquellen (normativ):
- [Apple HIG Overview](https://developer.apple.com/design/human-interface-guidelines/): `Hierarchy`, `Harmony`, `Consistency`
- [Apple HIG Layout](https://developer.apple.com/design/human-interface-guidelines/layout): visuelle Hierarchie, Gruppierung, progressive disclosure, macOS-Hinweis zu Bottom-Edge-Controls
- [Apple HIG Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars): Gruppierung, Überlauf/More, Priorisierung
- [Apple HIG Menus](https://developer.apple.com/design/human-interface-guidelines/menus): Menüstruktur und Beschriftungsprinzipien
- [Apple HIG Searching](https://developer.apple.com/design/human-interface-guidelines/searching): Search Field, Vorschläge, Scope/Filter
- [Apple HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility/): `intuitive`, `perceivable`, `adaptable`

## 9. Git-Adapter-Vertrag (statt HTTP-Backend)
### 9.1 Kernoperationen
- `openRepository(path)`
- `getAuthState(remote)`
- `switchAuthIdentity(remote, accountRef)`
- `getStatus()`
- `getDiff(target)`
- `stage(paths)`
- `unstage(paths)`
- `commit(message)`
- `fetch(remote, branch)`
- `pull(remote, branch, strategy)`
- `push(remote, branch)`
- `checkout(branch)`
- `createBranch(name, from)`

### 9.2 Fehlervertrag
- Einheitliche Fehlerobjekte: `code`, `message`, `hint`, `raw`.
- Policy-Fehler (z. B. protected branch) erhalten eigenen Codebereich.

### 9.3 Kommentar- und Freigabe-Vertrag
- `getComments(scope)`
- `createComment(targetPath, anchor, text)`
- `appendComment(commentId, text)`
- `closeComment(commentId)`
- `getOpenCommentCount(scope)`
- `canReleaseVersion(scope)`
- `releaseVersion(targetRef, releaseId)`
- `getCommentSidecarPath(targetPath)`
- `validateNoInlineComments(targetPath)`

## 10. Zustandsmodell
- Working Tree State: clean, dirty-unstaged, dirty-staged, conflicted.
- Sync State: up-to-date, ahead, behind, diverged.
- Permission State: read-only, write-allowed, push-blocked-by-policy.
- Comment State: open, closed.
- Release Gate State: blocked-by-open-comments, releasable.

## 11. QA-Strategie
### 11.1 Tests
- Unit: Parser für `git status`, `git diff`, `CODEOWNERS`.
- Integration: Git-Befehle gegen Test-Repo inkl. Branch-Protection-Simulation.
- E2E: Save -> Diff -> Stage -> Commit -> Push inkl. Fehlerpfade.

### 11.2 Abnahmetests (must pass)
- AT-001: Lokale Dateiänderung erzeugt sofort sichtbaren Delta-Eintrag.
- AT-002: Remote-Änderung nach Fetch erscheint als Incoming-Delta.
- AT-003: Konflikte nach Pull werden korrekt erkannt und angezeigt.
- AT-004: Rechtehinweise aus `CODEOWNERS` erscheinen vor Commit.
- AT-005: Push auf geschützten Branch liefert verständliche UI-Fehlermeldung.
- AT-006: App funktioniert vollständig offline bis zum Push.
- AT-007: Privates Repo kann mit gültigem Git-Login geklont/synchronisiert werden; ohne Login erscheint ein klarer Auth-Fehler mit Handlungsvorschlag.
- AT-008: Freigabe ist blockiert, solange mindestens ein Kommentar offen ist.
- AT-009: Ein anderer Nutzer kann einen offenen Kommentar ergänzen; Verlauf zeigt Autor/Zeit.
- AT-010: Jeder Nutzer mit Kommentarzugriff kann Kommentare schließen; danach wird Freigabe bei `0` offenen Kommentaren erlaubt.
- AT-011: Kommentare werden ausschließlich in `.comments/` persistiert; die betroffene `*.md` bleibt ohne Kommentartext/-marker.
- AT-012: WYSIWYG- und Markdown-Codeansicht sind bidirektional synchron und beim Umschalten tritt kein Inhaltsverlust auf.
- AT-013: HIG-Review-Checklist für macOS ist erfüllt (Hierarchy/Harmony/Consistency, Toolbar/Overflow, Menüleistenbefehle, Search Field, Accessibility-Basics).

## 12. Delivery-Plan
### Phase 0: Foundations
- Electron-Shell, Git-Adapter, Repo-Öffnen, Grundnavigation.

Exit:
- `openRepository`, `getStatus`, `getDiff` stabil.

### Phase 1: Delta Core
- Lokale/Remote-Deltas, Statuspanel, Konflikterkennung.

Exit:
- AT-001 bis AT-003 grün.

### Phase 2: Authoring + Struktur
- Markdown-Editor, Templates, Book-/Ordner-Navigation.

Exit:
- Inhaltserstellung und Umstrukturierung durchgängig; AT-012 grün.

### Phase 3: Governance + Rights UX
- CODEOWNERS-Interpretation, Policy-Hinweise, Push-Fehlerbehandlung, Kommentar-Freigabe-Gate.

Exit:
- AT-004, AT-005, AT-008, AT-009 und AT-010 grün.

### Phase 4: Hardening
- Offline-Recovery, Performance-Optimierung, Cross-Platform Feinschliff.

Exit:
- AT-006 grün, NFRs erfüllt.

## 13. Definition of Ready (DoR)
Ein Ticket ist bereit, wenn:
- Git-Auswirkung (status/diff/commit/push) beschrieben ist.
- Rechte-/Policy-Verhalten beschrieben ist.
- Fehlerpfade und UI-Hinweise definiert sind.
- Messbare Akzeptanzkriterien vorhanden sind.

## 14. Definition of Done (DoD)
Ein Ticket ist fertig, wenn:
- Zugehörige Abnahmekriterien grün sind.
- Fehlerfälle (Netzwerk, Auth, Konflikt, Policy) getestet sind.
- Telemetrie/Logs ohne sensible Inhalte funktionieren.
- Dokumentation aktualisiert ist.

## 15. Risiken und Gegenmaßnahmen
- Risiko: Git-Provider-Policies unterscheiden sich.
  Gegenmaßnahme: Provider-agnostischer Kern + Adapter je Provider.
- Risiko: Große Repos verschlechtern UI-Latenz.
  Gegenmaßnahme: Inkrementelles Scannen, Lazy Tree Loading, Caching.
- Risiko: Nutzer erwarten Echtzeit-Kollaboration wie Web-Docs.
  Gegenmaßnahme: Produktkommunikation klar: kollaborativ via Git/PR.

## 16. Initiales Backlog (12 Stories)
1. Als Nutzer kann ich ein Repository lokal öffnen und den Branch-Status sehen.
2. Als Nutzer sehe ich nach jeder Dateiänderung den Delta-Status in Echtzeit.
3. Als Nutzer kann ich Änderungen gezielt stagen und committen.
4. Als Nutzer sehe ich vor Push, ob ich ahead/behind/diverged bin.
5. Als Nutzer bekomme ich bei Konflikten einen klaren Merge-Workflow.
6. Als Maintainer sehe ich vor Commit betroffene CODEOWNERS-Pfade.
7. Als Nutzer kann ich die Struktur unter `docs/` und `books/` direkt bearbeiten.
8. Als Nutzer kann ich offline arbeiten und später synchronisieren.
9. Als Nutzer bekomme ich bei Branch-Protection-Verstößen verständliche Hinweise.
10. Als Admin kann ich Repo-Strukturkonventionen zentral vorgeben.
11. Als Reviewer kann ich offene Kommentare ergänzen, auch wenn sie von anderen erstellt wurden.
12. Als Publisher kann ich eine Version nur freigeben, wenn alle Kommentare geschlossen sind.

## 17. Offene Entscheidungen
- Exaktes Dateinaming der Sidecar-Dateien (pro Note eine Datei vs. pro Thread eine Datei).
- Welche Merge-Strategie ist Standard (merge, rebase, ff-only)?
- Welche Mindest-Git-Version ist Voraussetzung?
- Welche Provider kommen in MVP sicher rein (GitHub zuerst)?

## 18. Nächster Schritt
Technisches ADR erstellen mit:
- finaler Repo-Struktur,
- Git-Delta-Ereignismodell,
- Rechteableitung (`Push-Recht`, `Branch-Policy`, `CODEOWNERS`),
- und verbindlichem Merge-/Push-Workflow.
