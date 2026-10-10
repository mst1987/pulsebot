# Deployment

Ein Merge nach `main` löst das automatische Deployment aus: GitHub Actions
(`.github/workflows/ci.yml`) lintet, testet, baut den Web-Client, kopiert
den fertigen Build auf den Server und startet dort `deploy.sh` per SSH. Wie
das im Einzelnen abläuft: „Ablauf eines Deploys“ weiter unten.

Acht PRs sind einmal hintereinander gemergt worden, ohne dass eine Zeile davon
auf dem Server ankam — der Deploy-Schritt scheiterte jedes Mal mit
`missing server host` und der Job wurde trotzdem grün. Deshalb gibt es jetzt
zwei Sicherungen: der Workflow bricht ab, wenn ein Secret fehlt, und der Bot
sagt selbst, auf welchem Stand er läuft.

## Woran man den laufenden Stand sieht

- **`GET /health`** (ohne Login erreichbar, enthält nichts Vertrauliches):

  ```json
  { "status": "ok", "commit": "a1b2c3d…", "committedAt": "2026-09-12T18:04:11.000Z",
    "subject": "Merge pull request #313 …", "startedAt": "2026-09-12T18:10:02.311Z",
    "mode": "production" }
  ```

  Die Werte liest `src/web/http/version.js` einmal beim Start (`git log -1`, sonst
  `GIT_COMMIT` aus der Umgebung). Ist nichts davon da, bleiben die Felder leer —
  der Bot läuft trotzdem.

  `mode` (#612) sagt, ob sich der Prozess für den Live-Bot hält (`src/config/runMode.js`):
  `NODE_ENV=production`, oder ohne `NODE_ENV` die `.env` statt der `.env.dev`. Steht
  auf dem Server `development`, behandelt er sich als Testinstanz — u. a. fragt der
  Raid-Helper-Abgleich dann nichts von selbst. Dieselbe Angabe steht in der ersten
  Logzeile (`PulseBot starting on Node … (production, .env, NODE_ENV=production)`).

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
einzeln (je etwa eine Minute, Bot-Neustart inklusive). Die Repository-Variable
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

## Wartung: Dependabot

Dependabot (`.github/dependabot.yml`) kommt monatlich und gebündelt: je
Ökosystem (Bot, Web-Client, GitHub Actions) ein PR für Minor/Patch und einer für
Majors, höchstens drei offene PRs je Ökosystem. Majors von `typescript` und
`vite` im Client schlägt Dependabot gar nicht vor — die brauchen eine bewusste
Migration und werden von Hand gemacht.

## Ablauf eines Deploys

Der Server hat 1 vCPU und 921 MB RAM. Bis Oktober 2026 hat `deploy.sh` bei
**jedem** Merge alles gemacht: `npm ci --omit=dev`, im Client `npm ci` und
`npm run build` (`tsc -b` allein ~500 MB), Slash-Commands registrieren,
`pm2 update`, `pm2 restart`. Ein Deploy dauerte so **9–12 Minuten**, in denen der
Server massiv swappte (vmstat: 20–30 MB/s, 0 % idle) und der Bot kaum antwortete.
Jetzt wird der Client in GitHub Actions gebaut und auf dem Server läuft nur,
was sich seit dem letzten Deploy geändert hat — im Normalfall (nur Code
geändert) bleiben `git reset`, Build austauschen, `pm2 restart` und der
Health-Check: **etwa eine Minute**, ohne nennenswerten Speicherbedarf.

### In GitHub Actions (`ci.yml`)

1. Job **„Web client“** lintet, testet und baut wie bisher; auf `main` (Push
   oder manueller Lauf, nicht bei PRs) lädt er `src/web-client/dist/` als
   Artefakt `web-client-dist` hoch (7 Tage aufbewahrt). Der Build braucht
   **nichts** aus der `.env` des Servers: der Client liest keine
   `VITE_*`-Variablen, `vite.config.ts` nutzt `WEB_PORT` nur für den
   Dev-Server-Proxy, und `import.meta.env.DEV` ist im Build immer `false`.
2. Job **„Deploy to Production“** lädt genau dieses Artefakt aus demselben Lauf
   — also vom selben Commit (`DEPLOY_SHA` = `github.sha`, auch beim manuellen
   Lauf) — und kopiert es per `tar` über SSH nach
   `$DEPLOY_DIR/.deploy/dist-<sha>` (erst unter `.part`, erst vollständig wird
   umbenannt; rsync braucht es auf keiner Seite).
3. Dann holt er per SSH `deploy.sh` **aus dem zu deployenden Commit**
   (`git show <sha>:deploy.sh`) und startet es mit `DEPLOY_SHA` und
   `PREBUILT_DIST`. Eine Änderung am Skript wirkt so schon beim Deploy, der sie
   bringt, nicht erst beim nächsten.

### Auf dem Server (`deploy.sh`)

1. Sperre `.deploy/lock` (`flock`): ein Deploy von Hand und einer aus CI
   warten aufeinander. Liegengebliebenes aus `.deploy/` (älter als eine Stunde)
   wird weggeräumt.
2. `git fetch`, dann `git reset --hard` auf **`DEPLOY_SHA`** (ohne: auf
   `origin/main`). Ist schon ein neuerer Commit live, der `DEPLOY_SHA` enthält
   (`DEPLOYED_COMMIT` in der Statusdatei), endet der Deploy sofort mit „nothing
   to do“ — ein spät drangekommener Lauf setzt nie einen älteren Stand zurück.
3. Node über nvm: eine **installierte** Version der `.nvmrc`-Linie wird nur
   aktiviert (`nvm use`). Früher lief bei jedem Deploy `nvm install`, das im
   Internet nach der neuesten 22.x fragt und jede neue Patch-Version installiert
   (daher v22.23.1/.2/.3 auf dem Server). Eine neuere Patch-Version holt man
   jetzt bewusst mit `DEPLOY_FORCE=node`.
4. `npm ci --omit=dev` nur, wenn sich `package-lock.json` oder die Node-ABI
   (`process.versions.modules`, ändert sich mit der Major-Version) geändert hat
   oder `node_modules` fehlt — mit `nice -n 19 ionice -c3`.
5. Web-Client: der Build aus CI (`PREBUILT_DIST`). Fehlt er (Deploy von Hand),
   baut `deploy.sh` wie früher selbst — mit `nice`/`ionice`, in ein eigenes
   Verzeichnis und mit einer Warnung im Log, dass das den Server lange
   belastet.
6. Pflicht-Variablen in `.env` prüfen (unverändert).
7. Slash-Commands nur registrieren, wenn sich die Registrierung geändert hat:
   `node scripts/register-commands.js --print-hash` liefert einen sha256 über
   die `data` aller Befehle (genau so gesammelt wie beim Registrieren, Schlüssel
   sortiert, `scripts/lib/commandsHash.js`), die `CLIENT_ID` und die
   Ziel-Server. Ein neuer Talk-Server in den Einstellungen zählt also auch als
   Änderung. Schlägt das Registrieren fehl, wird der Hash nicht gemerkt und der
   nächste Deploy versucht es wieder.
8. **Daten-Schnappschuss** (#695) mit Grund `deploy`, altem und neuem Commit —
   vor allem, was den Bot mit dem neuen Code startet (siehe „Schnappschuss vor
   dem Neustart“ unten). Scheitert er, läuft der Deploy mit einer Warnung weiter.
9. `pm2 update` nur, wenn sich `node --version` gegenüber dem letzten Deploy
   geändert hat. Das Verhalten bei einem Versionswechsel bleibt: der
   PM2-Daemon läuft mit der Node-Version weiter, mit der er gestartet wurde,
   und nur `pm2 update` bringt eine neue Version wirklich zum Bot. Bei
   unverändertem Node spart es einen zweiten Neustart.
10. Build einsetzen: der neue `dist/` wird neben dem alten als `dist.next`
    zusammengestellt (inklusive der behaltenen Assets, siehe unten) und dann per
    zwei `mv` umgeschaltet — ein Request sieht nie einen halb kopierten `dist/`.
    Das passiert direkt vor dem Neustart, damit der alte Prozess die neue
    `index.html` nur Sekunden lang ausliefert.
11. `pm2 restart` und Health-Check wie bisher; erst danach wird
    `DEPLOYED_COMMIT` gemerkt. Die letzte Zeile nennt die Dauer
    (`Deployment complete. (48 s)`).

Beim Einsetzen des Builds behält es die gehashten Dateien des vorherigen
Builds (#530): der Inhalt von `dist/assets/` wird mit `cp -an` in den neuen
Build gelegt (eine Datei, die der neue Build selbst geschrieben hat, wird nie
überschrieben; `index.html` bleibt immer die neue). Ein Tab, der vor dem
Deploy geöffnet wurde, lädt so seine alten Chunks weiter. Dateien älter als
`ASSET_KEEP_DAYS` (14 Tage) löscht `find -mtime` wieder. Fehlt ein Chunk
trotzdem, antwortet der Server mit 404 und die Seite lädt sich einmal neu
(docs/web-admin.md, „Nach einem Deploy“). Keiner dieser Schritte kann den
Deploy scheitern lassen (`|| true`).

### Schnappschuss vor dem Neustart (#695)

Die riskantesten Momente für die Daten sind Deploys: neuer Store-Code und
Migrationen, die beim Start laufen (`src/stores/settingsMigration.js`). Der
stündliche Schnappschuss (#691) ist dann bis zu einer Stunde alt. Deshalb
nimmt `deploy.sh` (Schritt 8) einen eigenen:

```bash
nice -n 19 ionice -c3 env BACKUP_DIR=<dir> timeout 600 \
  node scripts/backup/snapshot.js --reason deploy --from <alt> --to <neu> --json
```

- **Wann**: nach `git reset`, `npm ci` und der Command-Registrierung (die
  ändern nichts unter `data/`; Migrationen laufen nur beim Start des Bots) und
  **vor** `pm2 update`, dem Umschalten von `dist/` und `pm2 restart` — so spät
  wie möglich, aber bevor irgendetwas den Bot mit dem neuen Code startet. Beim
  „nothing to do“-Abbruch (Schritt 2) gibt es keinen.
- **Commits**: `--from` ist der Commit, der vor dem `git reset` ausgecheckt war
  (der Code, der die Daten gerade schreibt), `--to` der neue. Beide stehen im
  `manifest.json` (`fromCommit`, `toCommit`), der Name endet auf `-deploy`.
- **Aufbewahrung**: die letzten 10 Deploy-Schnappschüsse
  (`backup.retention.deployKeep`, `src/services/backup/retention.js`),
  unabhängig von den stündlichen.
- **Last**: niedrigste CPU- und I/O-Priorität, ein Node-Prozess von wenigen
  Sekunden — `settings/` und `sessions.json` werden kopiert, unveränderte
  Reports und Raumkarten nur per Hardlink übernommen. Nach
  `DEPLOY_SNAPSHOT_TIMEOUT` (600 s) wird er abgebrochen; seine Sperre gilt dann
  als verwaist und der nächste Lauf räumt sie weg.

**Ob einer entsteht**, entscheidet `deploy.sh` ohne Node, nach denselben Regeln
wie der Bot (`backupConfig.js`):

| Lage | Schnappschuss |
|---|---|
| `DEPLOY_SNAPSHOT=0` (`false`, `no`, `off`) | nie |
| `DEPLOY_SNAPSHOT=1` | immer (legt `BACKUP_DIR` notfalls an) |
| `BACKUP_ENABLED=0` in der Umgebung oder der `.env` | nein |
| das Schnappschuss-Verzeichnis existiert nicht | nein — Backups sind hier nicht eingerichtet (Test-/Staging-Checkout) |
| sonst | ja |

Das Verzeichnis ist `BACKUP_DIR` (Umgebung, sonst `.env.dev`/`.env` wie beim
Bot; relativ = ab dem Checkout), ohne Angabe `/var/backups/pulsebot` für den
Live-Bot. Auf dem Server legt es der stündliche Job des Bots wenige Minuten
nach seinem Start an; `deploy.sh` reicht genau dieses Verzeichnis an die CLI
weiter.

**Scheitert er, läuft der Deploy weiter** — ein fehlender Schnappschuss ist
kein Grund, einen Fix nicht auszurollen:

- Exit 1 (Fehler, z. B. zu wenig Platz) oder Zeitüberschreitung: Warnung im
  Log, der Deploy geht weiter.
- Exit 3 (ein anderer Schnappschuss hält die Sperre, meist der stündliche des
  Bots): `DEPLOY_SNAPSHOT_RETRY_DELAY` (30 s) warten, **ein** zweiter Versuch.
  Hält die Sperre dann immer noch, Warnung — der laufende stündliche
  Schnappschuss ist dann ohnehin nur Sekunden alt.
- Die Warnung steht am Ende des Logs noch einmal, direkt vor
  `Deployment complete.`
- `$BACKUP_DIR/status/deploy-snapshot.json` hält das Ergebnis jedes Versuchs
  fest, für die Überwachung (#696):
  `{ at, ok, exitCode, attempts, fromCommit, toCommit, error?, result }`
  (`result` = die JSON-Ausgabe der CLI mit `name`, `error`, `durationMs` …,
  oder `null`). Die `status/snapshot.json` der CLI reicht dafür nicht: der
  nächste stündliche Lauf überschreibt sie, und bei belegter Sperre schreibt
  die CLI gar keine. Die Systemstatus-Seite zeigt sie als Zusatzzeile der
  Schnappschuss-Kachel („Vor dem letzten Deploy“; fehlgeschlagen = gelb für
  7 Tage, nie rot – siehe docs/system-status.md).

Im Deploy-Log sieht das so aus (die eingerückte Zeile kommt von der CLI):

```
[deploy] Taking a data snapshot before the restart (2be1ea5 -> 4f3c2d1) in /var/backups/pulsebot...
[deploy]   [info] [backup] Schnappschuss 20261010-183012-deploy: 412 Dateien, 38.2 MB (398 verlinkt, 14 kopiert = 2.1 MB), synchron 12.4 ms, gesamt 1840 ms
[deploy] Data snapshot 20261010-183012-deploy taken (2 s).
```

Ohne Schnappschuss eine dieser Zeilen:

```
[deploy] No data snapshot before the restart: no backup directory at /var/backups/pulsebot (backups are not set up here; DEPLOY_SNAPSHOT=1 takes one anyway).
[deploy] Another snapshot holds the lock (most likely the bot's hourly one) - trying again in 30 s...
[deploy] WARNING: no data snapshot before this deploy - the snapshot CLI failed (exit 1). The deploy goes on; ...
[deploy] WARNING: this deploy ran without a fresh data snapshot (the snapshot CLI failed (exit 1)).
```

Scheitert danach der Health-Check, nennt das Log den Schnappschuss gleich mit
(`The data from before this deploy: snapshot 20261010-183012-deploy`).

**Warum die CLI und nicht der laufende Bot?** Ein Schnappschuss im Bot hätte
die volle Ein-Tick-Konsistenz (kein Store-Schreiben zwischen zwei Dateien).
Die CLI kopiert `settings/` und `sessions.json` zwar ebenfalls synchron in
einem Durchgang, aber in einem eigenen Prozess — schreibt der alte Bot genau in
diesen Millisekunden, kann der Schnappschuss eine Datei vor und eine nach
diesem einen Schreibvorgang enthalten. Jede Datei für sich bleibt dabei
vollständig (die Stores schreiben per `rename`), nur die beiden in-place
schreibenden Dateien (`sessions.json`, Kategorienamen) könnten im
ungünstigsten Fall halb kopiert sein. Das ist ein Fenster von Millisekunden
bei einem Bot, der um diese Zeit kaum schreibt. Dagegen steht: der Bot ist oft
genau das, was der Deploy repariert (hängt, startet in Schleife), eine Route in
ihn bräuchte eigene Absicherung und doch einen Rückfall auf die CLI. Die CLI
funktioniert immer, auch ohne laufenden Bot; der stündliche Schnappschuss aus
dem Bot bleibt als stimmiger Rückfall daneben.

**Zurückrollen** nach einem Deploy, der Daten beschädigt hat:

1. Den Code zurück: den PR auf `main` reverten und deployen lassen. (Ein
   älterer Commit per `DEPLOY_SHA` endet mit „nothing to do“, siehe
   Schritt 2.) Auch dieser Deploy macht einen Schnappschuss — vom kaputten
   Stand, als zweite Absicherung.
2. Dann die Daten: den Schnappschuss `<…>-deploy` des schuldigen Deploys
   zurückspielen — sein Name steht im Deploy-Log, sonst
   `ls /var/backups/pulsebot/snapshots/ | grep -- -deploy` und im
   `manifest.json` `fromCommit`/`toCommit` prüfen. Das Werkzeug dafür ist
   `npm run backup:restore` (#693) mit Trockenlauf und eigenem
   Rückweg-Schnappschuss; Ablauf und Runbook: [backup.md](backup.md).
   Erst den Code, dann die Daten: andersherum würde der neue Code die
   zurückgespielten Daten beim nächsten Start gleich wieder migrieren.

Alles, was zwischen dem Schnappschuss und dem Zurückspielen geschrieben wurde
(Anmeldungen, Einstellungen), fehlt danach — es steckt im Rückweg-Schnappschuss
des Restores.

### Die Statusdatei `.deploy/state`

Liegt im Checkout (`$DEPLOY_DIR/.deploy/`, git-ignoriert, auch aus dem
Docker-Kontext), Zeilen `KEY=value`, nach jedem gelungenen Schritt atomar
geschrieben:

| Schlüssel | Inhalt | steuert |
|---|---|---|
| `DEPS` | sha256 von `package-lock.json` + `-abi<NODE_MODULE_VERSION>` | `npm ci --omit=dev` |
| `COMMANDS` | Hash der Command-Registrierung | `register-commands.js` |
| `NODE` | `node --version`, mit dem der PM2-Daemon zuletzt neu gestartet wurde | `pm2 update` |
| `DEPLOYED_COMMIT` | Commit, der zuletzt den Health-Check bestanden hat | „schon neuer live“ |

Fehlt die Datei (oder ein Schlüssel), wird der Schritt einfach ausgeführt.
Löschen der Datei ist also immer sicher und erzwingt beim nächsten Deploy alles
einmal. Daneben liegen `lock` und kurzzeitig die Staging-Verzeichnisse
`dist-<sha>` und `build-<sha>` sowie `deploy-<sha>.sh`.

### Schritte erzwingen

`DEPLOY_FORCE` (Komma-Liste) oder `--force` (= `all`):

| Wert | erzwingt |
|---|---|
| `install` | `npm ci --omit=dev` im Root |
| `register` | Slash-Commands registrieren |
| `pm2` | `pm2 update` |
| `node` | `nvm install` (neueste Patch-Version der `.nvmrc`-Linie) |
| `build` | Client auf dem Server bauen, auch wenn ein CI-Build da ist |
| `all` | alles oben |

Auf dem Server:

```bash
DEPLOY_FORCE=register,pm2 ./deploy.sh main
./deploy.sh main --force
```

Aus GitHub (Auswahl `none`, `all`, `install`, `register`, `pm2`, `node`, `build`;
in der Oberfläche unter Actions → CI → Run workflow):

```bash
gh workflow run ci.yml --ref main -f force=register --repo mst1987/pulsebot
```

Commands lassen sich weiterhin jederzeit direkt neu registrieren
(`npm run register` auf dem Server) — der nächste Deploy registriert dann
eventuell einmal überflüssig, das schadet nicht.

### Mehrere Merges kurz hintereinander

Der Deploy-Job hat `concurrency: deploy-production` mit
`cancel-in-progress: false`: ein **laufender** Deploy wird nie abgebrochen.
GitHub hält pro Gruppe höchstens **einen** wartenden Lauf; kommt ein neuerer
dazu, wird der bisher wartende verworfen (im Actions-Tab „cancelled“). Das ist
gewollt: der neuere Commit enthält den älteren. Weil jeder Lauf seinen eigenen
Commit deployt (den, aus dem sein Client gebaut wurde), bleibt ein Lauf, der
erst nach einem neueren drankommt (z. B. weil seine Tests länger brauchten),
wirkungslos (Schritt 2). Für viele Merges am Stück bleibt `DEPLOY_PAUSED`
der bessere Weg.

### Der erste Deploy nach der Umstellung

- Es gibt noch keine `.deploy/state`: `npm ci --omit=dev`, Command-Registrierung
  und `pm2 update` laufen einmal (ca. 1–3 Minuten statt 9–12, der Client-Build
  auf dem Server entfällt schon).
- `deploy.sh` kommt schon aus dem neuen Commit (Workflow-Schritt holt es per
  `git show`), das alte Skript auf dem Server läuft nicht mehr.
- Ab dem zweiten Deploy wird nur noch neu gestartet, solange sich Lockfile,
  Commands und Node nicht ändern.

### Aufräumen auf dem Server (von Hand, optional)

- `src/web-client/node_modules` braucht der Server nicht mehr, solange der
  Client aus CI kommt. `deploy.sh` löscht es nicht (der Fallback-Build würde es
  wieder anlegen); wer Platz sparen will: `rm -rf src/web-client/node_modules`.
- Alte Node-Versionen von nvm: `nvm ls` zeigt sie, `nvm current` die aktive;
  jede andere 22.x lässt sich mit `nvm uninstall v22.23.1` entfernen. Die
  aktive Version (`NODE` in `.deploy/state`) nie entfernen — mit ihr laufen
  PM2-Daemon und Bot.

## Von Hand deployen

Auf dem Server, als der Benutzer, dem der Checkout gehört:

```bash
cd /var/www/pulsebot      # oder das eigene DEPLOY_DIR
./deploy.sh main
```

Ohne CI gibt es keinen fertigen Build: das Skript baut den Client dann selbst
(„WARNING: no prebuilt web client …“), mit niedrigster CPU- und I/O-Priorität
— das dauert auf dem Server mehrere Minuten und lässt ihn swappen. Wenn es
nicht eilt, ist ein manueller Lauf in GitHub besser
(`gh workflow run ci.yml --ref main`). Alles andere läuft wie oben
beschrieben, ohne `DEPLOY_SHA` auf `origin/main`.

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

⚠️ Das gilt nur für den allerersten `pm2 start`. Jeder Deploy startet mit
`pm2 restart pulsebot --update-env` neu, und `--update-env` übernimmt die Umgebung
der Deploy-Shell — die hat kein `NODE_ENV`. Deshalb setzt `deploy.sh` es dort
ausdrücklich (`NODE_ENV=production pm2 restart …`, danach `pm2 save`); vorher lief
der Live-Bot als `development` (#612).

## Docker

Der zweite Weg neben pm2: ein Multi-Stage-Image, das den Web-Client selbst baut
(Stage `client`) und nur dessen `dist/` ins schlanke Laufzeit-Image übernimmt
(Stage `runtime`, `npm ci --omit=dev`, dazu `src/`, `assets/`, `scripts/`).

```bash
docker build --build-arg GIT_COMMIT=$(git rev-parse HEAD) -t pulsebot .
docker run -d --name pulsebot --env-file .env -p 3005:3005 \
  -v pulsebot-data:/app/data -v pulsebot-backups:/app/backups pulsebot
```

- **Build-Arg `GIT_COMMIT`**: im Image gibt es kein `.git`; ohne das Argument
  bleibt `commit` in `/health` leer.
- **Volume `/app/data`**: alle Stores (Einstellungen, Sitzungen, Importe)
  schreiben dorthin — ohne Volume ist nach einem neuen Image alles weg.
- **Volume `/app/backups`**: die Daten-Schnappschüsse (#691); das Image setzt
  `BACKUP_DIR=/app/backups`, weil der Standard `/var/backups/pulsebot` für den
  Benutzer `node` nicht beschreibbar ist. Neben `/app/data`, nie darin.
- **Healthcheck**: das Image prüft alle 30 s `/health` auf `$WEB_PORT`
  (Standard 3005). Wer einen anderen Port setzt, gibt ihn per `-e WEB_PORT=…`
  mit und veröffentlicht denselben.
- `.dockerignore` hält alle `.env*` (außer `.env.example`), `data/`, Tests und
  Doku aus dem Build-Kontext — Secrets landen nie in einer Image-Schicht; sie
  kommen nur zur Laufzeit per `--env-file`.

### Schnappschuss vor dem Container-Tausch (#695)

`deploy.sh` läuft auf dem Docker-Weg nicht, der Schnappschuss ist dort ein
eigener Schritt: **nach** dem Bauen des neuen Images (damit die Lücke bis zum
Tausch kurz bleibt) und **vor** dem Stoppen des alten Containers, im alten
Container selbst — er hat Daten- und Backup-Volume schon eingehängt:

```bash
NEW=$(git rev-parse HEAD)
docker build --build-arg GIT_COMMIT=$NEW -t pulsebot .
OLD=$(docker exec pulsebot printenv GIT_COMMIT)
docker exec pulsebot nice -n 19 node scripts/backup/snapshot.js \
  --reason deploy --from "$OLD" --to "$NEW" \
  || echo "WARNUNG: kein Schnappschuss vor dem Tausch (Exit 3 = Sperre belegt: kurz warten, noch einmal)"
docker stop pulsebot && docker rm pulsebot
docker run -d --name pulsebot --env-file .env -p 3005:3005 \
  -v pulsebot-data:/app/data -v pulsebot-backups:/app/backups pulsebot
```

Wie bei `deploy.sh` bricht ein gescheiterter Schnappschuss den Tausch nicht ab.
Mit Compose ist es derselbe Schritt vor `docker compose up -d`:
`docker compose exec <dienst> node scripts/backup/snapshot.js --reason deploy --from … --to …`.
Den ersten Container gibt es noch nicht — dann entfällt der Schritt.

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

## Reverse proxy: compression

The bot compresses its own text answers with brotli/gzip (`src/web/http/compression.js`, docs/web-admin.md, "Kompression & Zeitmessung"). nginx does not compress a response that already carries `Content-Encoding`, so nothing is compressed twice; `gzip on;` in the proxy stays harmless (it then only covers what the bot sends uncompressed, e.g. clients without `Accept-Encoding`). Do not enable `proxy_set_header Accept-Encoding ""` — that would make the bot send everything plain.

## Reverse proxy: upload size

A reverse proxy in front of the bot (nginx) has its own body limit: `client_max_body_size` defaults to **1 MB** and answers larger uploads with an HTML "413 Request Entity Too Large" before the bot ever sees them. The bot's own limit for room maps is 3 MB, so the browser shrinks every map to at most 900 KB first (`lib/raidplan/mapImage.ts`, `MAP_TARGET_BYTES`), and the client turns a 413 / 502 / 503 / 504 answer without JSON into a readable message (the HTML only goes to the browser console). If bigger files should get through, raise the limit **in the proxy config** (outside this repo), e.g. `location /api/raidplan/ { client_max_body_size 4m; }`; the client-side shrinking stays below it either way.
