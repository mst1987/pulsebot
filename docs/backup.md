# Datensicherung: Kopie außer Haus

Wie PulseBot gesichert wird, vor allem die **verschlüsselte nächtliche Kopie außer Haus** (Issue #692, Teil des Epics #690). Die Schnappschüsse im Bot (#691) und das Wiederherstellen (#693) haben ihre eigenen Abschnitte in [data-storage.md](data-storage.md).

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

**Was nicht gesichert wird:** andere Projekte auf dem Server (`wm2026-tipp`, `rest-api` u. a.), `node_modules`, der Code (liegt in Git), Systempakete (das Runbook #693 beschreibt den Neuaufbau). Die Aufbewahrung im Ziel: täglich 14, wöchentlich 8, monatlich 12 Kopien (`restic forget --prune`).

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

## Wiederherstellen (Kurzfassung)

Der geübte Befehl und das Runbook (Datei kaputt, gelöscht, neuer Server) stehen in #693. Von Hand geht es so:

```bash
set -a; . /etc/pulsebot/backup.env; set +a
restic -o s3.region=auto snapshots                          # Kopien auflisten
restic -o s3.region=auto restore latest --tag pulsebot --target /root/restore
```

`restore` schreibt in ein **leeres Zielverzeichnis**, nie direkt über die Live-Daten; darin liegen `offsite-stage/latest/data/…` (die Bot-Daten), `server-config/` (nginx, Zertifikate, Units, Paketliste) und die `.env`. Auf einem neuen Server fehlt `/etc/pulsebot/backup.env`: Repository-Adresse, Token und Passwort kommen dann aus dem Passwortmanager.
