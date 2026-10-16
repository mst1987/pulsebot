# Datensicherung: Kopie außer Haus und Wiederherstellen

Wie PulseBot gesichert wird, vor allem die **verschlüsselte nächtliche Kopie außer Haus** (Issue #692, Teil des Epics #690), und wie man zurückholt: Befehle und Runbook für „Datei kaputt“, „Daten weg“ und „neuer Server“ unter [Wiederherstellen](#wiederherstellen) (#693), und wie die wöchentliche [Wiederherstellungsprobe](#wiederherstellungsprobe) (#694) prüft, dass das auch wirklich geht. Die Schnappschüsse im Bot (#691) und der Verzeichnisaufbau stehen in [data-storage.md](data-storage.md#sichern-und-wiederherstellen).

## Überblick (3-2-1)

| Kopie | Wo | Womit | Schützt vor |
|---|---|---|---|
| 1. Live-Daten | `DATA_DIR` auf dem Server | der Bot | – |
| 2. Schnappschüsse | `BACKUP_DIR` (`/var/backups/pulsebot`), anderer Ordner derselben Platte | Job im Bot (#691), stündlich und vor jedem Deploy | Bedienfehler, kaputter Code, leer geschriebene Datei |
| 3. Außer Haus | Cloudflare R2, verschlüsselt | `scripts/backup/offsite.sh` mit restic, nachts per systemd-Timer | Plattenschaden, verlorener oder gekaperter Server, Umzug |

Der Ablauf einer Nacht: der Bot-Job hat unter `$BACKUP_DIR/latest` den neuesten Schnappschuss hingelegt, `offsite.sh` sammelt dazu die Server-Konfiguration und schickt alles mit restic nach R2. Das Skript läuft **außerhalb des Bots** (auch bei abgestürztem Bot) und beendet sich danach wieder: kein Dauerprozess, im Ruhezustand 0 MB RAM. Es läuft mit `nice -n 19`, `ionice -c3`, einer Sperre gegen einen zweiten Lauf und einer Zeitgrenze (2 Stunden).

**Was gesichert wird:**
- der neueste Schnappschuss aus #691 (`data/` mit `settings/`, `sessions.json`, Reports, Raumkarten und `manifest.json`)
- die `.env` des Bots (`$DEPLOY_DIR/.env`), die nur auf dem Server liegt
- Server-Konfiguration (Staging in `$BACKUP_DIR/server-config/`): `/etc/nginx`, `/etc/letsencrypt`, `/etc/cron.d`, die Zertifikate (`*.cer`) und privaten Schlüssel (`*private_key.key`) in `/root`, `/root/.pm2/dump.pm2`, die Crontab von root, eigene Units aus `/etc/systemd/system` (nur echte Dateien, keine Verweise nach `/lib`), die Paketliste (`dpkg --get-selections`) und die Node-Versionen (nvm)
- ein `pg_dumpall` von PostgreSQL, **nur** wenn `pg_dumpall` vorhanden ist und der Dienst läuft

**Was nicht gesichert wird:** andere Projekte auf dem Server (`wm2026-tipp`, `rest-api` u. a.), `node_modules`, der Code (liegt in Git), Systempakete (den Neuaufbau beschreibt [Fall 3](#fall-3-server-weg-oder-umzug-auf-einen-neuen-server)). Die Aufbewahrung im Ziel: täglich 14, wöchentlich 8, monatlich 12 Kopien (`restic forget --prune`).

## Einrichtung Schritt für Schritt (Cloudflare R2)

### 1. Bei Cloudflare

1. Konto anlegen oder anmelden (cloudflare.com), im Menü **R2 Object Storage** öffnen. R2 verlangt einmalig eine Zahlungsart, kostet bei unserer Datenmenge aber nichts (siehe Kosten).
2. **Create bucket**, Name z. B. `pulsebot-backup`, Standort „Automatic“. Der Bucket bleibt **privat** (keinen öffentlichen Zugriff und keine eigene Domain freischalten).
3. Auf der R2-Übersicht stehen rechts die **Account ID** und die S3-Adresse `https://<account-id>.r2.cloudflarestorage.com`. Die Account ID notieren.
4. **Manage API Tokens** (unter R2) → **Create API token**: Berechtigung **Object Read & Write**, bei „Specify bucket(s)“ **nur** den Bucket `pulsebot-backup` wählen (nicht „Apply to all buckets“). Nach dem Anlegen zeigt Cloudflare **einmalig** *Access Key ID* und *Secret Access Key* an: beide sofort in den Passwortmanager legen. (Mit „Admin“-Rechten würde ein gekaperter Server alle Buckets sehen; mit nur diesem Bucket ist der Schaden begrenzt.)

### 2. Auf dem Server (als root)

1. restic installieren: `apt install restic`. Die Version aus den Paketquellen ist oft alt; neuere restic-Versionen sind für R2 angenehmer. Nach der Installation `restic version` prüfen und bei einer alten Version `restic self-update` ausführen (lädt die aktuelle Release nach `/usr/bin/restic`).
2. Verzeichnis und Passwortdatei anlegen:
   ```bash
   install -d -m 700 /etc/pulsebot
   head -c 48 /dev/urandom | base64 > /etc/pulsebot/restic-password
   chmod 600 /etc/pulsebot/restic-password
   cat /etc/pulsebot/restic-password      # in den Passwortmanager kopieren
   ```
   **Dieses Passwort verschlüsselt die Kopie.** Es liegt nie in der Sicherung selbst. Geht es (und der Server) verloren, ist die Kopie außer Haus nicht mehr zu öffnen: es muss **zusätzlich im Passwortmanager** stehen, bevor der erste Lauf startet.
3. Die Zugangsdatei anlegen, Vorlage ist `scripts/backup/backup.env.example`:
   ```bash
   cp /var/www/pulsebot/scripts/backup/backup.env.example /etc/pulsebot/backup.env
   chmod 600 /etc/pulsebot/backup.env
   nano /etc/pulsebot/backup.env      # RESTIC_REPOSITORY, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY eintragen
   ```
   `RESTIC_REPOSITORY` hat die Form `s3:https://<account-id>.r2.cloudflarestorage.com/pulsebot-backup`. `BACKUP_DIR` und `DEPLOY_DIR` stimmen mit den Standardwerten, sonst anpassen. Das Skript warnt im Journal, wenn die Datei nicht Rechte 600 hat.
4. Units installieren und Timer starten (Pfad in `ExecStart` anpassen, falls `DEPLOY_DIR` nicht `/var/www/pulsebot` ist):
   ```bash
   cp /var/www/pulsebot/scripts/backup/systemd/pulsebot-backup.* /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now pulsebot-backup.timer
   ```
5. **Testlauf** (voraussetzung: der Schnappschuss-Job aus #691 hat schon einen Schnappschuss angelegt, sonst meldet das Skript „no snapshot at …/latest“):
   ```bash
   /var/www/pulsebot/scripts/backup/offsite.sh --dry-run   # nur prüfen: schreibt nichts ins Ziel, kein Status
   systemctl start pulsebot-backup.service                  # echter Lauf, legt beim ersten Mal das Repository an (restic init)
   journalctl -u pulsebot-backup -e
   ```

### 3. Prüfen, dass es läuft

- `systemctl list-timers pulsebot-backup.timer` zeigt den nächsten Lauf (ungefähr 03:30 plus bis zu 20 Minuten Zufall).
- `journalctl -u pulsebot-backup -n 50` zeigt den letzten Lauf.
- `cat /var/backups/pulsebot/status/offsite.json` ist das Ergebnis des letzten Laufs, auch bei Fehlern:
  `{"at":…,"ok":true,"durationMs":…,"addedBytes":…,"totalBytes":…,"snapshotId":"…"}` (`error` nur bei `ok:false`). Diese Datei liest der Bot für die Überwachung (#696); er braucht dafür keine Zugangsdaten.
- Die Kopien selbst: `set -a; . /etc/pulsebot/backup.env; set +a; restic -o s3.region=auto snapshots`.
- Sonntags läuft zusätzlich `restic check --read-data-subset=5%`: jede Woche werden 5 % der Daten im Ziel wirklich gelesen und geprüft.

## Wichtig zu wissen

- **Zwei Schlüsselbünde, beide extern ablegen:** das restic-Passwort und der R2-Token (Access Key + Secret) gehören in den Passwortmanager. Auf dem Server stehen sie nur in `/etc/pulsebot/` (Rechte 600).
- Die Aufbewahrung lässt sich in `backup.env` ändern (`OFFSITE_KEEP_DAILY`, `OFFSITE_KEEP_WEEKLY`, `OFFSITE_KEEP_MONTHLY`), ebenso die Zeitgrenze (`OFFSITE_TIMEOUT`) und der Wochentag der Prüfung (`OFFSITE_CHECK_DAY`, 7 = Sonntag).
- Der Unit-Speicher ist auf 300 MB begrenzt (`MemoryMax`), damit der kleine Server nie wegen der Sicherung in Not gerät. Zeigt das Journal einen OOM-Abbruch, in der Unit erhöhen (`systemctl edit pulsebot-backup.service`).
- `restic forget --prune` und `check` laufen nur in diesem Skript; ein zweiter Lauf wird durch eine Sperre abgewiesen (Exit-Code 75, der Status des ersten Laufs bleibt unberührt).
- Im Repository liegen **nie** Zugangsdaten: `backup.env.example` ist nur die Vorlage.

## Kosten

Cloudflare R2: 10 GB Speicher im Monat sind frei, der Abruf (Egress) kostet nichts, Anfragen erst oberhalb großzügiger Freimengen. Die Sicherung ist deduplizierend und liegt deutlich unter 1 GB, also dauerhaft im kostenlosen Bereich. Als Zahlungsart muss trotzdem eine hinterlegt sein.

## Wiederherstellungsprobe

Einmal pro Woche spielt der Bot den neuesten Schnappschuss **probeweise** zurück und prüft ihn (#694). So fällt eine Sicherung, die still kaputtgegangen ist (Platte voll, Rechte, ein Store schreibt plötzlich woanders hin, eine leer geschriebene Datei), auf der Systemstatus-Seite auf – nicht erst am Tag, an dem man sie braucht.

**Ein Lauf** (`src/services/backup/restoreTest.js`, `runRestoreTest`):
1. Der neueste vollständige Schnappschuss (kein `pre-restore`) wird mit `verifySnapshot` (#693) geprüft: Manifest, Größe und sha256 jeder Datei, jede `*.json` parst.
2. Platz prüfen (eine Kopie der Daten plus 10 % der Platte frei), dann `restoreSnapshot` in ein frisches Verzeichnis `$BACKUP_DIR/.restore-test-<id>/data`. Bewusst auf der Backup-Platte und nicht in `/tmp` (auf dem Server oft klein oder eine andere Platte); der Punkt am Anfang hält es aus allen Lesern der Schnappschüsse heraus, die Kopie außer Haus nimmt es nicht mit.
3. **Jeder Store liest seine Datei** aus dem zurückgespielten Stand – über seine eigene `normalize`-Funktion, mit `store.readStrict(datei)` (`src/stores/jsonStore.js`). Das ist bewusst **nicht** `useFile`: die Probe läuft im laufenden Bot, und zwischen `useFile(probe)` und `useFile(null)` wäre jede Anfrage – schlimmer: jeder Schreibvorgang – des Bots in den Probe-Dateien gelandet (und mit dem Verzeichnis gelöscht worden). `readStrict` fasst weder die Datei noch den Cache des Stores an und fällt **nicht** auf die Standardwerte zurück: wo `read()` bei einer unlesbaren Datei still `[]` liefert, gibt es hier einen Fehler. Jeder Store meldet sich dafür beim Anlegen in einer Liste (`registeredStores()`); die Probe lädt vorher alle `src/stores/*Store.js`. Fehlt eine Store-Datei im Schnappschuss, obwohl sie live schon vor dem Schnappschuss da war, ist das ebenfalls ein Problem.
4. **Kennzahlen** (`counts` aus dem Manifest: Events, Anmeldungen, Roster, Raidpläne, Reports, Raumkarten, Dateien): Der zurückgespielte Stand muss genau die Zahlen des Manifests ergeben. Gegen den Live-Stand darf keine Zahl im Schnappschuss mehr als 20 % niedriger sein, sobald live mindestens 10 da sind (Sitzungen ausgenommen, die kommen und gehen) – das Zeichen einer Sicherung, die still leer wurde.
5. Das Probe-Verzeichnis wird **immer** gelöscht (`finally`, auch nach einem Fehler; Reste eines abgestürzten Laufs räumt der nächste weg). Das Ergebnis steht in `$BACKUP_DIR/status/restore-test.json`: `{ at, ok, durationMs, bytes, files, snapshot: { name, reason, at, commit }, problems: [{ rel, problem }], problemCount, counts: { snapshot, restored, live }, stores: { checked, missing, failed }, loop: { maxMs, p99Ms, meanMs }, error? }`. Die Systemstatus-Seite zeigt es als Kachel „Wiederherstellungsprobe“ (grün < 8 Tage, gelb < 15, rot darüber oder durchgefallen; rot heißt auch DM an den Admin).

**Wann** (`src/services/backup/restoreTestJob.js`, Job `backupRestoreTest`): standardmäßig **mittwochs um 04:30** (Europe/Berlin), und nur in den 6 Stunden danach – nie an einem Raid-Abend. In diesem Morgenfenster läuft sie an jedem Tag auch dann, wenn sie noch nie gelaufen ist, der letzte Lauf 7 Tage oder älter ist (Bot war am Mittwoch aus, ein Deploy fiel ins Fenster) oder der letzte Lauf durchgefallen ist (Wiederholung am nächsten Morgen). Hält gerade ein Schnappschuss seine Sperre, wartet sie auf die nächste Prüfung (alle 10 Minuten). Wie der Schnappschuss-Job nur mit `BACKUP_ENABLED` (auf dem Live-Bot von selbst an). Tag und Uhrzeit stehen in den Einstellungen, `config.json`:

```json
"backup": { "restoreTest": { "weekday": 3, "time": "04:30" } }
```

`weekday` 1 = Montag … 7 = Sonntag, `time` als `HH:MM`; Ungültiges fällt auf den Standard zurück.

**Last:** Kopieren und Prüfen laufen asynchron Datei für Datei, nach jedem Store gibt die Probe dem Event-Loop einen Takt (`setImmediate`); die größte Verzögerung, die sie gesehen hat, steht im Status (`loop`). Gemessen auf dem Entwicklungsrechner (Windows, SSD) mit künstlichen Daten: 158 Dateien / 199 MB in etwa 3 s, Event-Loop höchstens 75–83 ms, p99 23 ms; 52 MB in etwa 1 s. Im Bot sind alle Stores schon geladen; der Befehl lädt sie einmal und braucht dafür zusätzlich etwa eine halbe Sekunde. Eine eigene niedrige Prozess-Priorität gibt es im Bot nicht (sie gälte für den ganzen Bot) – dafür das Morgenfenster.

**Von Hand** (läuft neben dem Bot, schreibt nur ins Probe-Verzeichnis und die Statusdatei):

```bash
npm run backup:restore-test            # Zusammenfassung; Exit 0 bestanden, 1 durchgefallen
npm run backup:restore-test -- --json  # das Ergebnis als eine JSON-Zeile
```

**Durchgefallen – was tun?** Die Fehlerzeile der Kachel und `problems` sagen, welche Datei: „fehlt“ / „Prüfsumme weicht ab“ → der Schnappschuss ist beschädigt (Platte, Rechte – `npm run backup:list`, neuen Schnappschuss mit `npm run backup:snapshot -- --reason manual` und Probe wiederholen). „Der Store liest die Datei nicht“ → die Datei ist gültiges JSON, aber nicht mehr im Format des Stores: live dieselbe Datei prüfen, bevor der nächste Neustart sie still durch Standardwerte ersetzt. „mehr als 20 % weniger“ → vergleichen, ob live wirklich so viel dazukam oder der Schnappschuss Daten verloren hat. „Zu wenig Platz“ → `BACKUP_DIR` aufräumen bzw. Aufbewahrung senken.

## Wiederherstellen

Wiederherstellen ist ein Befehl mit Prüfung (#693). Er nimmt einen lokalen Schnappschuss (#691) oder einen, den restic aus der Kopie außer Haus zurückgeholt hat, und spielt ihn nach `DATA_DIR` zurück. Darunter stehen die drei Fälle als Runbook.

### Die Befehle

Beide laufen im Checkout des Bots (`cd /var/www/pulsebot`) und lesen wie der Bot `.env.dev`, sonst `.env` (`EVENTHELPER_DATA_DIR`, `BACKUP_DIR`, `WEB_PORT`).

**`npm run backup:list`** zeigt die lokalen Schnappschüsse, den neuesten zuerst, mit Zeit (UTC), Größe und den Kennzahlen aus dem Manifest (Events, Anmeldungen, Roster, Reports, Dateien). `*` markiert `latest`, `kaputt` ein unlesbares Manifest. `--json` gibt alles maschinenlesbar aus.

```
Name                         Zeit (UTC)           Größe  Events Anmeld. Roster Reports Dateien
20261010-140000-hourly *     2026-10-10 14:00   48.3 MB      41     612      3     187     242
20261010-130000-hourly       2026-10-10 13:00   48.2 MB      41     609      3     187     242
```

**`npm run backup:restore -- <schnappschuss> [--dry-run] [--only <relpfad>]... [--force] [--prune] [--json]`**

`<schnappschuss>` ist entweder ein Name aus der Liste oder `latest`, also der neueste Schnappschuss, der **kein** `pre-restore` ist. Rückweg-Schnappschüsse stellt man nur mit ihrem Namen wieder her. Möglich ist auch ein Pfad zu einem beliebigen Verzeichnis mit `manifest.json` und `data/`, z. B. das, was restic zurückgeholt hat. Der Befehl macht der Reihe nach Folgendes und bricht beim ersten Fehler ab:

1. **Prüfen**: Manifest lesbar, jede Datei vorhanden, Größe und sha256 stimmen, jede `*.json` lässt sich parsen. Mit `--only` werden nur die genannten Dateien geprüft. Ist der Schnappschuss fehlerhaft, ändert sich nichts.
2. **Bot muss aus sein**: Antwortet `http://127.0.0.1:<WEB_PORT>/health` (Standard 3005), bricht der Befehl ab. Auch eine Antwort mit Fehlerstatus oder ein Port, der nicht antwortet, zählt als „läuft“. `--force` übergeht das. Danach muss der Bot neu gestartet werden, sonst schreiben Stores ihren alten Stand aus dem Speicher zurück, z. B. die Sitzungen.
3. **Rückweg**: Ein `pre-restore`-Schnappschuss des aktuellen Stands wird angelegt, mit derselben Logik wie `backup:snapshot`. Scheitert er, wird nichts zurückgespielt. Danach zeigt `$BACKUP_DIR/latest` auf diesen Rückweg-Schnappschuss, bis der wieder gestartete Bot seinen nächsten stündlichen Schnappschuss anlegt (spätestens nach einer Stunde). Läuft in dieser Zeit die Kopie außer Haus, nimmt sie den Stand **vor** dem Zurückspielen mit. Wer das vermeiden will, legt nach dem Start einen Schnappschuss an: `npm run backup:snapshot -- --reason manual`.
4. **Zurückspielen**, dabei hält der Befehl die Schnappschuss-Sperre. Jede Datei wird zuerst neben das Ziel kopiert und beim Kopieren gegen das Manifest geprüft. Erst wenn alle Kopien stimmen, werden alle Dateien in einem Zug per `rename` ausgetauscht, also jede einzeln atomar. Ersetzte Dateien behalten ihre Rechte und ihren Besitzer. Neue sensible Dateien (`sessions.json`, `config.json`, Token, Abwesenheiten) bekommen 600, andere neue Dateien 644, neue Verzeichnisse 700. Dateien, die **nur im Ziel** liegen, bleiben stehen und werden aufgelistet. Erst `--prune` löscht sie, mit `--only` nur innerhalb der genannten Pfade.
5. **Zusammenfassung**: Sie nennt, was geändert, neu, unverändert und nur im Ziel ist, die Kennzahlen vorher → nachher (`*` = geändert) und den Befehl für den Rückweg.

`--dry-run` prüft und plant nur. Es wird nichts geschrieben, kein Schnappschuss angelegt, und ein laufender Bot ist nur ein Hinweis. Die Kennzahlen zeigen dann „jetzt → Schnappschuss“. `--only` nimmt eine Datei (`settings/rosters.json`) oder ein Verzeichnis (`reports`) und darf mehrfach angegeben werden. Exit-Codes: 0 fertig, 1 Prüfung oder Zurückspielen fehlgeschlagen, 2 falsche Argumente oder Schnappschuss nicht gefunden, 3 gerade läuft ein Schnappschuss, 4 der Bot läuft.

Beispielausgabe (Testdaten):

```
Prüfung ok: 20261010-140000-hourly (hourly, 2026-10-10T14:00:00.000Z, Commit 2be1ea5), 242 Dateien, 48.3 MB, Prüfsummen und JSON in Ordnung
Rückweg-Schnappschuss: 20261010-143512-pre-restore
Zurückgespielt: 20261010-140000-hourly (…) -> /var/www/pulsebot/data
  2 geändert, 0 neu, 240 unverändert, 1 nur im Ziel (bleiben; --prune löscht sie)
  geändert  settings/events.json
  geändert  settings/rosters.json
  nur Ziel  settings/kader.json
  Kennzahlen      vorher -> nachher
    events            40 ->     41  *
    rosters            0 ->      3  *
    …
Rückweg (bei gestopptem Bot): npm run backup:restore -- 20261010-143512-pre-restore
Jetzt den Bot starten (pm2 start pulsebot) und /health prüfen.
```

Die Logik steckt in `src/services/backup/restore.js` (`verifySnapshot`, `restoreSnapshot`). Die wöchentliche [Wiederherstellungsprobe](#wiederherstellungsprobe) (#694) nutzt dieselben Funktionen gegen ein Temp-Verzeichnis.

### Fall 1: Eine Datei ist kaputt oder wurde versehentlich geändert

Typisch ist ein Roster, das jemand geleert hat, oder ein Event, das gelöscht wurde. Zielzeit: 10 Minuten.

```bash
cd /var/www/pulsebot
npm run backup:list                                       # den letzten Schnappschuss VOR dem Fehler suchen
npm run backup:restore -- 20261010-130000-hourly --only settings/rosters.json --dry-run
pm2 stop pulsebot
npm run backup:restore -- 20261010-130000-hourly --only settings/rosters.json
pm2 start pulsebot
curl -s http://localhost:3005/health                      # Port = WEB_PORT aus der .env
```

- Welche Datei was enthält, steht in der Tabelle in [data-storage.md](data-storage.md#dateien).
- Dateien, die zusammengehören, gemeinsam zurückholen, sonst passen die Bezüge nicht mehr. Events und ihre Anmeldungen zum Beispiel: `--only settings/events.json --only settings/signups.json`.
- Alles, was nach dem Schnappschuss in **dieser** Datei geändert wurde, ist danach weg. Die anderen Dateien bleiben auf dem aktuellen Stand.
- War es die falsche Datei: `npm run backup:restore -- <pre-restore-name> --only <dieselbe Datei>`.

### Fall 2: Daten weg oder kaputt

Zum Beispiel wurde `data/` gelöscht, ein Deploy hat Unsinn geschrieben oder mehrere Dateien sind leer. Zielzeit: 30 Minuten.

```bash
cd /var/www/pulsebot
pm2 stop pulsebot
npm run backup:list
npm run backup:restore -- latest --dry-run                # zeigt Änderungen und Kennzahlen jetzt -> Schnappschuss
npm run backup:restore -- latest                          # oder einen Namen, z. B. den deploy-Schnappschuss vor dem Fehler
pm2 start pulsebot
curl -s http://localhost:3005/health
pm2 logs pulsebot --lines 50 --nostream
```

- Fehlt `data/` ganz, legt der Befehl das Verzeichnis an.
- Soll das Ziel **genau** dem Schnappschuss entsprechen, `--prune` dazunehmen. Dann werden auch Dateien gelöscht, die erst nach dem Schnappschuss entstanden sind.
- Sind auch die lokalen Schnappschüsse weg, z. B. bei einem Plattenschaden: Schritt 3 aus Fall 3 (restic) ausführen, dann `npm run backup:restore -- /root/restore/var/backups/pulsebot/offsite-stage/latest`. Diese Kopie ist höchstens eine Nacht alt.
- Rückweg wie in Fall 1: Der `pre-restore`-Schnappschuss hält den Stand vor dem Zurückspielen fest.

### Fall 3: Server weg oder Umzug auf einen neuen Server

Zielzeit: **unter 2 Stunden**, das meiste davon Warten auf Installation, Deploy und DNS. ⚠️ Dieser Ablauf ist **noch nicht geübt** (Stand #693). Erst nach einer echten Probe auf einem Test-Server (Epic #690, „Abschluss“) gilt er als verlässlich. Was dabei offen ist, steht unten unter „Ungetestet“.

**Vorher bereithalten** (Passwortmanager): das restic-Passwort, Access Key und Secret des R2-Tokens, die R2-Account-ID bzw. `RESTIC_REPOSITORY`, den Zugang zum Domain-Anbieter (DNS von `pulse-ts.site`) und den Zugang zum GitHub-Repo als Besitzer (Secrets).

**0. Nur beim geplanten Umzug, solange der alte Server noch läuft** (spart den Datenverlust seit der letzten Nacht). Auf dem **alten** Server:

```bash
pm2 stop pulsebot && pm2 save                             # ab hier keine Änderungen mehr
cd /var/www/pulsebot && npm run backup:snapshot -- --reason manual
systemctl start pulsebot-backup.service                   # frische Kopie außer Haus mit genau diesem Stand
journalctl -u pulsebot-backup -n 20                       # muss mit ok enden
systemctl disable --now pulsebot-backup.timer             # der alte Server sichert ab jetzt nicht mehr
```

Der alte Bot muss aus bleiben. Zwei Bots mit demselben Discord-Token antworten doppelt und schreiben gegeneinander.

**1. Neuen Server aufsetzen** (Ubuntu 22.04 oder neuer, als root):

```bash
apt update && apt upgrade -y
apt install -y git curl nginx certbot python3-certbot-nginx restic
restic self-update                                        # die Paketversion ist oft alt
```

**2. restic-Zugang einrichten** (Werte aus dem Passwortmanager):

```bash
install -d -m 700 /etc/pulsebot
nano /etc/pulsebot/restic-password && chmod 600 /etc/pulsebot/restic-password
cat > /etc/pulsebot/backup.env <<'EOF'
RESTIC_REPOSITORY=s3:https://<account-id>.r2.cloudflarestorage.com/pulsebot-backup
RESTIC_PASSWORD_FILE=/etc/pulsebot/restic-password
AWS_ACCESS_KEY_ID=<aus dem Passwortmanager>
AWS_SECRET_ACCESS_KEY=<aus dem Passwortmanager>
BACKUP_DIR=/var/backups/pulsebot
DEPLOY_DIR=/var/www/pulsebot
EOF
chmod 600 /etc/pulsebot/backup.env
```

**3. Die Kopie zurückholen** (in ein leeres Verzeichnis, nie direkt über Live-Daten):

```bash
set -a; . /etc/pulsebot/backup.env; set +a
restic -o s3.region=auto snapshots --tag pulsebot         # die neueste Kopie sollte von heute Nacht (bzw. aus Schritt 0) sein
restic -o s3.region=auto restore latest --tag pulsebot --target /root/restore
S=/root/restore/var/backups/pulsebot                      # Abkürzung für die folgenden Schritte
ls $S/offsite-stage/latest $S/server-config /root/restore/var/www/pulsebot/.env
```

Darin liegen `$S/offsite-stage/latest/` (Schnappschuss mit `manifest.json` + `data/`), `$S/server-config/` (`files/etc/nginx`, `files/etc/letsencrypt`, `files/etc/cron.d`, `files/etc/systemd/system/*`, `files/root/*.cer`, `files/root/*private_key.key`, `files/root/.pm2/dump.pm2`, `crontab-root.txt`, `dpkg-selections.txt`, `node-versions.txt`) und die `.env`.

**4. Node über nvm und pm2:**

```bash
cat $S/server-config/node-versions.txt                    # Version(en) des alten Servers, z. B. v22.x.y
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
. ~/.nvm/nvm.sh
nvm install 22                                            # die Linie aus .nvmrc; oder genau die Version von oben
npm install -g pm2
```

**5. Repo, `.env` und Daten:**

```bash
git clone https://github.com/mst1987/pulsebot.git /var/www/pulsebot
cd /var/www/pulsebot
nvm use && npm ci --omit=dev
install -m 600 /root/restore/var/www/pulsebot/.env /var/www/pulsebot/.env
npm run backup:restore -- $S/offsite-stage/latest --dry-run
npm run backup:restore -- $S/offsite-stage/latest         # prüft sha256 + JSON, legt /var/backups/pulsebot an
```

Die Kennzahlen „nachher“ müssen zu denen im Manifest passen (`npm run backup:restore` gibt beide aus). Steht in der `.env` ein `EVENTHELPER_DATA_DIR`, landen die Daten dort. Das Discord-Token steht in der `.env` und wandert mit, am Discord-Portal ändert sich nichts. Die Weiterleitungs-URL für „Login mit Discord“ bleibt gleich, weil die Domain gleich bleibt.

**6. nginx, Zertifikate, Cron und Units:**

```bash
R=$S/server-config/files
cp -a $R/etc/letsencrypt /etc/                            # samt der Verweise live/ -> archive/
cp -a $R/etc/nginx/. /etc/nginx/
cp -a $R/root/*.cer $R/root/*private_key.key /root/ 2>/dev/null || true
nginx -t && systemctl reload nginx
less $S/server-config/crontab-root.txt                    # erst lesen: Einträge anderer Projekte weglassen
crontab $S/server-config/crontab-root.txt
ls $R/etc/cron.d $R/etc/systemd/system                    # nur übernehmen, was zu PulseBot oder certbot gehört
```

Andere Projekte des alten Servers (`wm2026-tipp`, `rest-api` u. a.) sind **nicht** gesichert. Ihre nginx-Sites, Cron-Einträge und Units zeigen auf Pfade, die es nicht gibt: weglassen oder in `sites-enabled` entfernen, sonst scheitert `nginx -t`. `dpkg-selections.txt` dient nur als Nachschlagewerk, was sonst installiert war. Nicht blind mit `dpkg --set-selections` einspielen, denn die Ubuntu-Version kann eine andere sein.

**7. Deploy auf den neuen Server umstellen und den Bot starten.** Der Client wird nur in CI gebaut (auf 921 MB RAM dauert der Bau auf dem Server sehr lange), also über GitHub deployen. Zuerst auf dem neuen Server einen eigenen Schlüssel für den Deploy anlegen, denn `authorized_keys` des alten Servers ist nicht gesichert:

```bash
ssh-keygen -t ed25519 -N "" -f /root/.ssh/pulsebot-deploy -C pulsebot-deploy
cat /root/.ssh/pulsebot-deploy.pub >> /root/.ssh/authorized_keys
cat /root/.ssh/pulsebot-deploy                            # Inhalt -> Secret SSH_PRIVATE_KEY, danach die Datei löschen
```

In GitHub (Settings → Secrets and variables → Actions) bzw. per `gh`: `SSH_HOST` auf die neue IP setzen, `SSH_PRIVATE_KEY` auf den neuen Schlüssel, `SSH_USER` bleibt `root`, `SSH_PORT` nur bei abweichendem Port. Die Variable `DEPLOY_DIR` bleibt. Dann `gh workflow run ci.yml --ref main --repo mst1987/pulsebot` (Details: [deployment.md](deployment.md)). `deploy.sh` findet keinen pm2-Prozess und startet `ecosystem.config.js` neu.

**8. Autostart nach einem Neustart:**

```bash
pm2 startup systemd -u root --hp /root                    # richtet den Dienst pm2-root ein
pm2 save                                                  # merkt sich die laufenden Prozesse
pm2 ls                                                    # pulsebot: online
curl -s http://localhost:3005/health                      # commit = aktueller main, mode = production
```

Wer sicher gehen will, startet einmal neu (`reboot`) und prüft danach `pm2 ls` und `/health`.

**9. DNS umstellen**: Beim Domain-Anbieter die A-Einträge von `pulse-ts.site` und `logcheck.pulse-ts.site` auf die neue IP setzen. Beim geplanten Umzug die TTL schon einen Tag vorher senken. Danach:

```bash
dig +short pulse-ts.site logcheck.pulse-ts.site           # neue IP?
curl -sI https://pulse-ts.site/health                     # Zertifikat gültig, 200
certbot renew --dry-run                                   # Verlängerung klappt vom neuen Server aus
```

**10. Sicherung auf dem neuen Server wieder einschalten** (Abschnitt „Einrichtung“, Schritt 2.4 und 2.5; `backup.env` gibt es schon aus Schritt 2):

```bash
cp /var/www/pulsebot/scripts/backup/systemd/pulsebot-backup.* /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now pulsebot-backup.timer
systemctl start pulsebot-backup.service && journalctl -u pulsebot-backup -n 20
npm run backup:list                                       # nach spätestens einer Stunde: ein hourly-Schnappschuss
```

Die Kopien des alten Servers liegen im selben restic-Repository (Host `pulsebot`) und werden mit den neuen weiter aufbewahrt und ausgedünnt. Danach `/root/restore` löschen (`rm -rf /root/restore`, darin liegen Schlüssel und Sitzungen). Den alten Server erst kündigen, wenn der neue ein paar Tage stabil läuft.

**Wurde der alte Server gekapert** (und ist nicht nur kaputt): alle Geheimnisse aus der `.env` und `config.json` gelten als bekannt. Neu ausstellen und eintragen: Discord-Bot-Token und Client-Secret (Developer Portal), R2-Token (Cloudflare), API-Schlüssel in den Einstellungen (Blizzard, WCL, Anthropic). Das restic-Passwort wechselt man mit `restic key add` und `restic key remove <alte-id>`. Sitzungen ungültig machen: `sessions.json` vor dem Start durch `{}` ersetzen.

**Zeitplan** (geschätzt, nicht gemessen):

| Schritt | Minuten |
|---|---|
| 0 Letzter Stand auf dem alten Server | 10 |
| 1–2 Server, Pakete, restic-Zugang | 20 |
| 3 restic restore (< 1 GB) | 5–10 |
| 4–5 nvm, Node, Repo, `npm ci`, Daten zurück | 20 |
| 6 nginx, Zertifikate, Cron | 15 |
| 7–8 Deploy-Secrets, CI-Deploy, pm2-Autostart | 20 |
| 9 DNS (Wartezeit je nach TTL) | 5–30 |
| 10 Sicherung einschalten | 10 |
| **Summe** | **etwa 1:45–2:15** |

**Ungetestet** (vor dem Abschalten von Acronis in einer echten Probe klären):
- Der ganze Fall 3 auf einem frischen Server, vor allem `cp -a` von `/etc/letsencrypt` samt Verlängerung durch certbot. Auch, ob die Zertifikate in `/root` (`*.cer`, `*private_key.key`) überhaupt noch von nginx genutzt werden.
- Ob `deploy.sh` auf einem frischen Server ohne `.deploy/`-Statusdatei in einem Lauf durchkommt (Erstinstallation, `register-commands`, `pm2 start`).
- `pm2 startup` nach einem echten Neustart.
- Die Restore-Befehle selbst sind nur mit Jest und gegen eine Kopie von Testdaten auf Windows gelaufen (Rechte 600/644/700 prüfen die Tests nur unter Linux, in CI), nicht auf dem Server.
- Die Zeiten oben sind Schätzungen.
