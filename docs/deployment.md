# Deployment

Ein Merge nach `main` löst das automatische Deployment aus: GitHub Actions
(`.github/workflows/ci.yml`) lintet, testet und startet danach `deploy.sh` per
SSH auf dem Server.

Acht PRs sind einmal hintereinander gemergt worden, ohne dass eine Zeile davon
auf dem Server ankam — der Deploy-Schritt scheiterte jedes Mal mit
`missing server host` und der Job wurde trotzdem grün. Deshalb gibt es jetzt
zwei Sicherungen: der Workflow bricht ab, wenn ein Secret fehlt, und der Bot
sagt selbst, auf welchem Stand er läuft.

## Woran man den laufenden Stand sieht

- **`GET /health`** (ohne Login erreichbar, enthält nichts Vertrauliches):

  ```json
  { "status": "ok", "commit": "a1b2c3d…", "committedAt": "2026-09-12T18:04:11.000Z",
    "subject": "Merge pull request #313 …", "startedAt": "2026-09-12T18:10:02.311Z" }
  ```

  Die Werte liest `src/web/version.js` einmal beim Start (`git log -1`, sonst
  `GIT_COMMIT` aus der Umgebung). Ist nichts davon da, bleiben die Felder leer —
  der Bot läuft trotzdem.

- **Im Menü**, als eine Zeile unten in der Seitenleiste:
  „Server läuft auf `a1b2c3d` vom 12.09. · main ist 9 Commits weiter“. Details
  (Commit-Titel, seit wann der Rückstand besteht, wann zuletzt geprüft wurde)
  stehen im Tooltip. Sichtbar für alle, die *Einstellungen* lesen dürfen.

- **Als Aufgabe auf der Übersicht**: „Server ist 9 Commits hinter main
  (seit 6 Tagen)“ — gelb ab dem ersten Commit, rot ab sieben Tagen Rückstand,
  verlinkt auf diese Seite.

Der Vergleich fragt `https://api.github.com/repos/mst1987/pulsebot/commits?sha=main`
ab — öffentliches Repo, **kein Token**, Ergebnis 10 Minuten gecacht. Klappt der
Abruf nicht, steht dort „Abstand zu main nicht prüfbar“; es gibt dann weder eine
Aufgabe noch einen Fehler.

## Die Secrets

Einzutragen unter **Settings → Secrets and variables → Actions →
Repository secrets**. Das kann nur der Repo-Besitzer.

| Secret | Pflicht | Wofür |
|---|---|---|
| `SSH_HOST` | ja | Hostname oder IP des Servers |
| `SSH_USER` | ja | Benutzer, dem der Checkout gehört |
| `SSH_PRIVATE_KEY` | ja | privater Schlüssel (ganzer Inhalt, inkl. `-----BEGIN …-----`) |
| `SSH_PORT` | nein | SSH-Port, ohne Angabe 22 |

Fehlt eines der drei Pflicht-Secrets, bricht der Schritt **„Secrets prüfen“** mit
einer Meldung wie `SSH_HOST fehlt — in Settings → Secrets and variables →
Actions → Repository secrets eintragen` ab. Der Job ist dann rot; ein stiller
Fehlschlag wie früher ist nicht mehr möglich.

## Das Zielverzeichnis

Workflow und `deploy.sh` haben sich hier einmal widersprochen
(`/opt/eventhelper` gegen `/var/www/pulsebot`). Der Pfad steht jetzt nur noch an
einer Stelle:

- **Repository-Variable `DEPLOY_DIR`** (Settings → Secrets and variables →
  Actions → **Variables**, nicht Secrets). Ohne sie gilt `/var/www/pulsebot`.
- `deploy.sh` nimmt `DEPLOY_DIR`, sonst das Verzeichnis, in dem das Skript
  selbst liegt — es deployt also immer den Checkout, zu dem es gehört.

Liegt der Checkout auf dem Server woanders, genügt es, `DEPLOY_DIR` auf diesen
Pfad zu setzen; an den Dateien im Repo ist nichts zu ändern.

## Deploy pausieren und gesammelt nachholen

Landen viele PRs kurz nacheinander auf `main`, deployt sonst jeder Merge
einzeln (je 5–6 Minuten, Bot-Neustart inklusive). Die Repository-Variable
`DEPLOY_PAUSED` schaltet den Deploy-Job ab, Lint, Tests und Client-Build
laufen weiter:

```bash
gh variable set DEPLOY_PAUSED --body 1 --repo mst1987/pulsebot   # Pause an
gh variable delete DEPLOY_PAUSED --repo mst1987/pulsebot         # Pause aus
```

Während der Pause erscheint der Job „Deploy to Production“ in jedem Lauf als
übersprungen. Am Ende einmal von Hand deployen — der manuelle Lauf ignoriert
die Pause:

```bash
gh workflow run ci.yml --ref main --repo mst1987/pulsebot
gh run watch    # oder unter Actions -> CI zusehen
```

Danach die Variable löschen, sonst bleibt der nächste Merge ohne Deploy.

## Von Hand deployen

Auf dem Server, als der Benutzer, dem der Checkout gehört:

```bash
cd /var/www/pulsebot      # oder das eigene DEPLOY_DIR
./deploy.sh main
```

Das Skript holt `origin`, setzt hart auf `origin/main`, schreibt den neuen
Commit ins Log (`[deploy] Now at a1b2c3d …`), aktiviert die Node-Version aus
`.nvmrc` über nvm, installiert Abhängigkeiten, baut den Web-Client, prüft die
Pflicht-Variablen in `.env`, registriert die Slash-Commands und startet den
Prozess über pm2 neu.

Zum Schluss fragt es selbst `GET /health` ab (`curl -fsS`, bis zu 20 Versuche
im Abstand von 3 s, Port aus `WEB_PORT` in `.env`, sonst 3005). Antwortet der
Bot nicht, gibt es die letzten pm2-Logzeilen aus und endet mit `exit 1` — der
Deploy-Job in GitHub Actions wird rot, statt über einem toten Bot grün zu
bleiben. Von Hand lässt sich dasselbe nachsehen:

```bash
curl -s http://localhost:3005/health
```

Der `commit` dort muss der sein, der gerade auf `main` steht.

pm2 startet ohne `--env` im Modus `production` (`ecosystem.config.js`);
`--env development` gibt es nur noch ausdrücklich. Neu gestartet wird der Bot
erst ab 512 MB Speicher.

## Docker

Der zweite Weg neben pm2: ein Multi-Stage-Image, das den Web-Client selbst baut
(Stage `client`) und nur dessen `dist/` ins schlanke Laufzeit-Image übernimmt
(Stage `runtime`, `npm ci --omit=dev`, dazu `src/`, `assets/`, `scripts/`).

```bash
docker build --build-arg GIT_COMMIT=$(git rev-parse HEAD) -t pulsebot .
docker run -d --name pulsebot --env-file .env -p 3005:3005 \
  -v pulsebot-data:/app/data pulsebot
```

- **Build-Arg `GIT_COMMIT`**: im Image gibt es kein `.git`; ohne das Argument
  bleibt `commit` in `/health` leer.
- **Volume `/app/data`**: alle Stores (Einstellungen, Sitzungen, Importe)
  schreiben dorthin — ohne Volume ist nach einem neuen Image alles weg.
- **Healthcheck**: das Image prüft alle 30 s `/health` auf `$WEB_PORT`
  (Standard 3005). Wer einen anderen Port setzt, gibt ihn per `-e WEB_PORT=…`
  mit und veröffentlicht denselben.
- `.dockerignore` hält alle `.env*` (außer `.env.example`), `data/`, Tests und
  Doku aus dem Build-Kontext — Secrets landen nie in einer Image-Schicht; sie
  kommen nur zur Laufzeit per `--env-file`.

## Wenn der Bot hinter `main` hängt

1. Im Menü (Zeile in der Seitenleiste) oder über `/health` nachsehen, welcher
   Commit läuft.
2. In GitHub → **Actions** den letzten Lauf auf `main` öffnen: scheitert
   „Secrets prüfen“, fehlt ein Secret; scheitert „Deploy via SSH“, steht der
   Grund im Log (Verzeichnis, Rechte, pm2).
3. Solange das nicht behoben ist, hilft ein Deploy von Hand (oben) — der
   Rückstand verschwindet danach aus Menü und Übersicht, sobald der Cache von
   10 Minuten abgelaufen ist oder die Seite neu geladen wird.

## Agenten-Übersicht (`npm run agents`)

Wenn mehrere Agenten parallel in Worktrees arbeiten, zeigt `npm run agents`
pro Worktree: die Agenten (Aufgabe, „läuft“ = Transkript in den letzten
3 Minuten geschrieben), was sich gegenüber `origin/main` geändert hat
(Commits, Dateien, Uncommittetes, Rückstand), die Testinstanz und **was man
testen kann**.

- **Agenten** kommen aus den Subagent-Transkripten unter
  `~/.claude/projects/<repo>/<session>/subagents/` (`meta.json`, die ersten
  24 KB für den Prompt und die letzten 512 KB fürs Aktuelle — nie die ganze,
  oft 50 MB große Datei). Sie werden dem Worktree zugeordnet, dessen Pfad (sonst
  Branch) im ersten Prompt steht; alles andere landet unter „(ohne Worktree)“.
- **Was gemacht wurde**: je Agent die letzten Handgriffe („bearbeitet …“,
  „führt aus: …“) und seine letzte Textnachricht (bei laufenden „Zuletzt
  geschrieben“, bei beendeten „Ergebnis“); je Worktree die Commit-Texte samt
  Beschreibung, die PR-Beschreibung und eine Dateiliste mit `+/-` Zeilen
  (committet, uncommittet und neu zusammengezählt).
- **Testinstanz**: `WEB_PORT` aus der `.env.dev` des Worktrees, dann `GET /health`
  auf diesem Port. Der dort gemeldete Commit wird mit dem Branch-Stand
  verglichen — „Instanz neu starten“ heißt: sie läuft auf einem älteren Stand.
- **Was testen**: der Abschnitt „Test…“ aus dem PR-Text (`gh`, mit `--no-pr`
  übersprungen) plus Hinweise je geänderter Bereich (Tabelle `AREAS` in
  `scripts/agent-overview.js`).
- **Aktualisieren**: `--serve [port]` startet eine Seite auf
  `http://localhost:3099/` (nur 127.0.0.1), die sich alle 10 s selbst neu lädt und
  aufgeklappte Abschnitte offen lässt; `/data.json` liefert die Rohdaten.
  `--watch [sekunden]` zeichnet den Text im Terminal neu. Beide fragen `gh`
  höchstens einmal pro Minute.
- `--html` schreibt zusätzlich `eventhelper-agent-overview.html` ins Temp-Verzeichnis
  (`os.tmpdir()`, nicht nach `data/`; Schnappschuss ohne Aktualisierung), `--json` gibt die
  Rohdaten aus, `--all` zeigt auch Worktrees ohne Änderungen und Agenten,
  `--hours N` bestimmt, wie weit zurück Agenten zählen (Standard 24).

## Reverse proxy: upload size

A reverse proxy in front of the bot (nginx) has its own body limit: `client_max_body_size` defaults to **1 MB** and answers larger uploads with an HTML "413 Request Entity Too Large" before the bot ever sees them. The bot's own limit for room maps is 3 MB, so the browser shrinks every map to at most 900 KB first (`lib/mapImage.ts`, `MAP_TARGET_BYTES`), and the client turns a 413 / 502 / 503 / 504 answer without JSON into a readable message (the HTML only goes to the browser console). If bigger files should get through, raise the limit **in the proxy config** (outside this repo), e.g. `location /api/raidplan/ { client_max_body_size 4m; }`; the client-side shrinking stays below it either way.
