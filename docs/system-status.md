# Systemstatus (`/system`)

Endnutzer-Sicht: siehe [guide-web-admin.md#systemstatus](guide-web-admin.md#systemstatus).

Der Produktionsserver ging immer wieder in die Knie, ohne dass jemand sagen konnte, ob der Bot selbst, ein anderer Prozess auf dem Server oder schlicht zu wenig Hardware schuld ist. Die Seite *Systemstatus* beantwortet das aus dem laufenden Prozess heraus: wo die Last herkommt und ob ein Umzug oder ein größerer Server hilft. Sie ist **nur für Voll-Admins** – sie zeigt Interna des Hosts (andere Prozesse, Dateien unter `data/`), die kein Bereich freigeben soll.

## Zugriff

- **API:** `GET /api/system/status` steht in `src/web/apiRoutes/system.js` mit `adminOnly: true` (kein Bereich, fail-closed, docs/permissions.md) und prüft im Handler zusätzlich `withUser({ full: true })`. Im Golden Master `test/web/http/fixtures/apiAccess.golden.json` steht der Pfad unter `adminOnly`; `test/web/http/apiAccess.test.js` hält fest, dass auch eine Rolle mit *allen* Bereichen 403 bekommt.
- **Menü:** `src/config/menu.json` kennt dafür `"adminOnly": true` mit leerem `areas`. `mayOpen()` in `lib/app/menu.ts` gibt die Zeile nur Voll-Admins (`menuLines`, `firstAllowedTab`); `App.tsx` schützt die Route mit `AdminGuard` (kosmetisch, wie `Guard`). „Ansicht als Rolle“ sieht den Eintrag also nicht – richtig so, die Rolle dürfte die API auch nicht.

## Was gemessen wird (`src/services/system/`)

| Modul | Aufgabe |
|---|---|
| `systemMonitor.js` | Alle **15 s** eine Stichprobe, 24 h im Speicher: die letzte Stunde roh (≤ 240 Punkte), danach **ein Punkt je Minute** (≤ 1440; Mittelwert, für die Event-Loop-Werte das Maximum). Gestartet als erster Job in `src/web/http/jobs.js` (`systemMonitor`), Timer `unref()`, `stop()` schaltet auch das Histogramm ab. Beim Laden des Moduls startet nichts – Tests bauen sich mit `createMonitor(deps)` einen eigenen. |
| `requestStats.js` | Statistik je Routen-Muster: `compression.js` meldet jede gemessene Anfrage (`/api/`, `/r/`, `/p/`) über `logRequest` hierher. Pfad ohne Querystring, IDs/Tokens/Zahlen als `:id` (`normalizePath`). Je Muster seit Start und für die letzten 60 min: Anzahl, Ø, p95, Max, langsame. Dazu die letzten 50 langsamen Anfragen. `SLOW_REQUEST_MS` (Standard 1000) liest jetzt `slowThresholdMs()` hier; `compression.js` reicht es weiter. |
| `diskUsage.js` | `fs.statfs` für das Datenverzeichnis (`EVENTHELPER_DATA_DIR` bzw. `data/`) und die größten Einträge darunter (Top 10 Ordner/Dateien der obersten Ebene, Top 10 Dateien insgesamt, asynchron, höchstens 50 000 Einträge, keine Symlinks). **Nur auf Abruf**, 5 min gecacht; je Messung ein Punkt im Verlauf des freien Platzes. Pfade relativ zu `data/`, nie absolut. |
| `hostProcesses.js` | Top 8 Prozesse des Hosts, **nur Linux, nur auf Abruf** (`?processes=1`): `/proc/<pid>/stat` zweimal im Abstand von 1 s gelesen = CPU-Anteil *jetzt*; ohne `/proc` `ps -eo pid,comm,%cpu,%mem,rss --sort=-%cpu` (Timeout 2 s; dort ist %CPU der Durchschnitt seit Prozessstart, die Seite sagt das im Tooltip). Nur Name (`comm`), PID, CPU, RAM – **nie eine Befehlszeile**, die kann Passwörter enthalten. Windows/Fehler: leere Liste, die Seite lässt den Abschnitt weg. |
| `assessment.js` | Die Einschätzung, rein: Regeln über die Stichproben der letzten 15 min. Schwellen als Konstanten oben in der Datei. |
| `systemStatus.js` | Baut die Antwort der Route aus allem zusammen; merkt sich die zuletzt gemessenen Prozesse 5 min, damit auch die 15-s-Abfragen sie (mit Zeitpunkt) für die Einschätzung haben. |

Je Stichprobe: Host-CPU in % (Deltas aus `os.cpus()`), Load 1/5/15 (Windows: keine, „n/v“), RAM verfügbar (Linux `MemAvailable` aus `/proc/meminfo`, sonst `os.freemem()`), Swap (nur Linux), Bot-CPU in % **eines Kerns** (`process.cpuUsage`-Delta / Wandzeit), RSS, Heap, external, **Event-Loop-Verzögerung** p50/p99/max des Intervalls (`monitorEventLoopDelay`, je Stichprobe zurückgesetzt; das Histogramm misst den ganzen Abstand seines 20-ms-Timers, die Auflösung wird abgezogen – unter Windows bleibt wegen der 15,6-ms-Uhr ein Sockel von ~10 ms) und **Event-Loop-Auslastung** (`eventLoopUtilization`-Delta).

Der Verlauf liegt nur im Speicher: ein Neustart (Deploy) beginnt ihn von vorn. Die erste Stichprobe kommt 15 s nach dem Start, die Einschätzung von CPU und Speicher nach vier Stichproben (1 min); bis dahin sagt die Seite „noch zu wenige Messwerte“. Kosten: eine Stichprobe ist ein paar Systemaufrufe ohne Platte, der Speicher bleibt bei wenigen hundert KB.

## Die Einschätzung (`assessment.js`)

„Dauerhaft“ heißt: in mindestens 60 % der Stichproben der letzten 15 Minuten. Eine einzelne Spitze ist keine Aussage.

| Id | Wann | Stufe | Empfehlung |
|---|---|---|---|
| `botBottleneck` | Bot-CPU dauerhaft ≥ 85 % eines Kerns, **oder** Event-Loop p99 ≥ 200 ms in ≥ 25 % der Stichproben | rot (CPU oder Loop im Mittel ≥ 1 s), sonst gelb | langsamste Routen optimieren (nennt die drei mit dem höchsten p95 der letzten Stunde); mehr Kerne helfen Node kaum |
| `otherProcess` | Host-CPU dauerhaft ≥ 85 %, Anteil des Bots < Hälfte davon | rot | den Prozess prüfen/auslagern (nennt den größten fremden Prozess, wenn gemessen) |
| `hostBusy` | Host-CPU dauerhaft ≥ 85 %, überwiegend durch den Bot, Bot aber nicht am Kern-Limit | gelb | beobachten, sonst mehr/schnellere Kerne |
| `cpuOverloaded` | Load 5 dauerhaft > Kerne oder Load 15 > Kerne, **und** Load 1 jetzt noch > Kerne (sonst hängt die Meldung einem Deploy eine Viertelstunde nach; nicht unter Windows) | gelb, rot ab Load 15 > 2× Kerne | mehr Kerne / größerer Server |
| `memoryLow` | RAM verfügbar im Mittel der letzten 5 min < 10 % (rot) oder Swap ≥ 50 % belegt (gelb) | | mehr RAM / größerer Server |
| `diskLow` | freier Platz < 10 % (gelb), < 5 % (rot) – auch schon ohne Verlauf | | `data/` aufräumen / mehr Platz |

Nichts davon: „Alles im grünen Bereich“. Der Server schickt nur Id, Stufe und Zahlen; die Sätze baut der Client (`lib/system/findings.ts`, i18n `system.findings.*`).

## Die Seite (`src/web-client/src/pages/system/`)

- `SystemPage.tsx` lädt beim Öffnen mit `?processes=1`, fragt danach alle 15 s ohne (`useVisiblePoll`, nur sichtbar), *Neu messen* holt Prozesse und Datenträger frisch (`?processes=1&disk=1`). Eine Abfrage ohne Prozesse behält die letzte Liste (`mergePoll`).
- Oben die Einschätzung (`Verdict.tsx`): Überschrift groß, je Befund ein Satz mit Zahlen und „Empfehlung“, höchstens drei.
- Fünf Kacheln (`Tiles.tsx`): Server-CPU, Bot-CPU, RAM verfügbar, Verzögerung p99, Datenträger frei – große Zahl, kleines Label, Sparkline (Inline-SVG, `sparkPath` in `lib/system/systemFormat.ts`, keine Chart-Bibliothek), Zeitraum 1 h / 24 h umschaltbar (gemerkt). Farbe nur ab den Schwellen `TILE_LIMITS`. Kerne, Load, Swap, Heap, Node, Laufzeiten im Aufklapper *Details zu Server und Bot*.
- *Langsamste Anfragen* (`RoutesSection.tsx`): `DataTable`, sortierbar, Standard p95 absteigend, Zeitraum letzte Stunde / seit Start; aufklappbar die letzten langsamen Anfragen. Auf dem Handy fallen Ø und Max weg.
- *Prozesse auf dem Server* nur, wenn eine Liste da ist; *Speicherplatz* mit Balken je Ordner und aufklappbar den größten Dateien.
- Stil `styles/system.css` (Präfix `sy-`), Bereichsfarbe `--area-system`; die Seite gehört zu den schmalen (`--page-narrow`).

## Datensicherung (#696)

Ein eigener Abschnitt der Seite (`BackupSection.tsx`), lädt für sich `GET /api/system/backup` (kein Polling, nach dem Knopf neu). Gelesen werden nur die Statusdateien unter `$BACKUP_DIR/status/` (Aufbau: Kopf von `src/services/backup/snapshot.js`), ausgewertet in `src/services/backup/backupStatus.js` (reine Funktion `evaluate`, Leser `readParts` / `readBackupStatus`).

| Teil | Quelle | grün | gelb | rot |
|---|---|---|---|---|
| Schnappschuss | `status/snapshot.json` | < 26 Std. | < 48 Std. | älter oder `ok: false` |
| Kopie außer Haus | `status/offsite.json` | < 26 Std. | < 48 Std. | älter, `ok: false`, oder noch nie gelaufen und der älteste Schnappschuss ist über 26 Std. alt |
| Wiederherstellungsprobe | `status/restore-test.json` (#694, docs/backup.md) | < 8 Tage | < 15 Tage | älter oder `ok: false` |
| Deploy-Schnappschuss (Zusatzzeile der Schnappschuss-Kachel) | `status/deploy-snapshot.json` (#695, `deploy.sh`) | hat geklappt | 7 Tage lang nach einem Fehlschlag | nie – der stündliche Schnappschuss bleibt der Rückfall |

Fehlt die Datei: grau („noch nie“); die Deploy-Zeile fehlt dann ganz, und ein Fehlschlag älter als 7 Tage zählt nicht mehr (grau). Die Gesamtlage ist die schlechteste Ampel der Teile, die etwas wissen – der Deploy-Schnappschuss eingeschlossen, ein fehlgeschlagener macht sie also gelb. DM und Übersicht-Aufgabe schauen nur auf die drei Teile. Die Deploy-Zeile zeigt „Vor dem letzten Deploy“, darunter „vor 2 Tagen“ und die Commits „abc1234 → def5678“, bei einem Fehlschlag das Abzeichen „fehlgeschlagen“, den Grund und den Namen des Schnappschusses im Tooltip; die Ampel der Kachel selbst bleibt die des stündlichen Schnappschusses. Die Probe-Kachel zeigt bei `ok: false` die Fehlerzeile der Probe („2 Probleme – settings/events.json: …“). Fehlt `status/snapshot.json` (Verzeichnis aus der Zeit davor), steht der neueste Schnappschuss dafür ein. Die Liste zeigt die 30 neuesten Schnappschüsse (Zeit, Grund, Größe aus dem Manifest; ein Manifest ändert sich nie, die Summe wird je Schnappschuss nur einmal berechnet).

- **Jetzt sichern:** `POST /api/system/backup/snapshot` (adminOnly, CSRF) ruft `runSnapshot({ reason: "manual" })` und antwortet immer mit 200 und `{ ok, skipped, name, durationMs, bytes, error }`; `skipped: "locked"` heißt, im selben Prozess läuft schon eine Sicherung.
- **Kein Download** von Schnappschüssen, mit Absicht: sie enthalten API-Schlüssel und Sitzungen.
- **Übersicht-Aufgabe** (nur Voll-Admins, nur wo Schnappschüsse an sind): `backupTask` in `src/web/dashboard/dashboardOverview.js`, gelb/rot nach Ampel, „Letzte Sicherung vor 3 Tagen“ bzw. „Sicherung fehlgeschlagen“ (bei der Kopie außer Haus / der Probe mit deren Namen), Ziel `/system`; gleich hinter der Deploy-Aufgabe.
- **Discord-DM** (`src/services/backup/backupAlerts.js`, Job `backupAlerts` alle 30 Minuten, nur mit `BACKUP_ENABLED`): an die erste ID aus `ADMIN_USER_ID`, wenn ein Teil **rot** ist (Fehlschlag oder zu alt). Je Teil höchstens eine Nachricht pro Tag; sofort wieder, wenn sich der Zustand ändert (zu alt → fehlgeschlagen) oder das Teil zwischendurch wieder in Ordnung war. Der Drossel-Zustand steht in `settings/backup-alerts.json` (`backupAlertStore.js`). Ist der Bot noch nicht verbunden, wird nichts vermerkt (nächster Versuch in 30 Minuten); eine abgelehnte DM zählt für den Tag als gesendet und steht im Log.

## Tests

Jest: `test/services/system/*.test.js` (Stichprobe mit falschem os/`/proc`/Histogramm/Uhr, Ringpuffer und Minutenpunkte, Pfad-Normalisierung, p95, Einschätzungsregeln, `/proc`- und `ps`-Parser, Datenträger gegen ein Scratch-Verzeichnis), `test/web/apiRoutes/system.test.js` (über `routerClient`: 200 für Admins, 403 für eine Rolle mit allen Bereichen, 401 ohne Login), `test/services/backup/backupStatus.test.js` (Ampel-Grenzen, „noch nie“, Deploy-Schnappschuss, Format der Probe), `backupAlerts.test.js` (DM-Drossel), `test/web/apiRoutes/system.backup.test.js`, `test/web/dashboard/backupTask.test.js`, `test/web/http/compression.test.js` (zählt in die Statistik, kein Querystring), `jobs.test.js`. Vitest: `pages/system/SystemPage.test.tsx`, `pages/system/BackupSection.test.tsx`, `lib/system/systemFormat.test.ts`, `lib/app/menu.test.ts`.
