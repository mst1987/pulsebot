# Addons zum Herunterladen (#818)

Endnutzer-Sicht: siehe [guide-web-admin.md#addons](guide-web-admin.md#addons) und [guide-discord.md](guide-discord.md) (`/addons`).

Die Gilde lädt die eigenen Addons im Web herunter: **LevelHelper** (`mst1987/levelhelper`, privat), **ProfessionKit** (`mst1987/professionkit`, privat) und **EventHelper Sync** (`mst1987/eventhelper-addon`, öffentlich: Sync-Tool `EventHelperSync.exe` und Addon `EventHelperSync-<version>.zip`). Jedes Addon kommt als GitHub-Release; die Seite zeigt immer das neueste (`/releases/latest`).

## Bausteine

| Wo | Was |
|---|---|
| `src/services/addons/addonConfig.js` | Die Standardliste und der Normalisierer der Einstellung `config.addonDownloads` (`id`, `name`, `description`, `repo`, `private`, `assets` = Dateimuster mit `*`/`?`, `versions`, `install`, `icon`, `enabled`), dazu `normalizeGithub` für `config.github = { token }`. Rein, deshalb von `configSchema.js` geladen. |
| `src/classes/githubReleases.js` | GitHub-API: `fetchLatestRelease({ repo, token })` reduziert ein Release auf Version, Datum, gekürzte Notizen (4000 Zeichen) und die hochgeladenen Dateien (`id`, `name`, `size`, `sha256` aus GitHubs `digest`); `openAssetStream({ repo, assetId, token })` holt eine Datei als Stream (`Accept: application/octet-stream`, folgt der Weiterleitung zum Speicher; `follow-redirects` nimmt den `Authorization`-Header beim Hostwechsel ab). Fehler als `GithubError` mit Kurzcode: `no_release` (404 beim Release), `not_found` (404 bei einer Datei), `unauthorized` (401), `forbidden` (403), `rate_limited` (429 oder 403 mit `x-ratelimit-remaining: 0`), `unreachable` (5xx, Netz). |
| `src/services/addons/addonReleases.js` | Cache je Repo (10 Minuten; „kein Release“ wird genauso gemerkt), gemeinsame Anfrage paralleler Aufrufe, bei einem Fehler der letzte gute Stand als `stale`, ein Fehlschlag wird 2 Minuten nicht wiederholt. Der Cache merkt sich nur einen Fingerabdruck des Tokens, ein neuer Token fragt sofort neu. Ein privates Repo ohne Token wird gar nicht gefragt (`token_missing`), denn GitHub antwortet darauf mit 404 wie „kein Release“. Dazu `addonCards()` (die Karten einer Version), `resolveDownload()` (prüft Addon, Release und Dateimuster). |
| `src/services/addons/downloadLimit.js` | Höchstens 30 Downloads je Konto in einer gleitenden Stunde, im Speicher (ein Neustart vergisst die Zählung). |
| `src/web/apiRoutes/addons.js` | `GET /api/addons?version=` und `GET /api/addons/download?addon=<id>&asset=<datei>` (Parameter in der Query, wie jede `/api`-Route). |
| `src/commands/lookup/addons.js` | `/addons [version]`: ephemere Karte mit Name, Version, Datum und Kurzbeschreibung je Addon und dem Knopf „Zur Download-Seite“. Nie ein Datei-Link: ein weitergeleiteter Link würde den Login umgehen. |
| `src/web-client/src/pages/addon/AddonPage.tsx` | Die Seite, `lib/addons/addonInstall.ts` (Addon-Ordner je Version, Release-Notizen als reiner Text), `styles/addon.css`. |
| `src/web-client/src/pages/settings/AddonsSection.tsx` | Einstellungen → Module → Addons (Liste, ein Editor zur Zeit, speichert die ganze Liste). |

## Wer darf was

- **Seite und Download:** Bereich `signup` (die Basisberechtigung jedes Mitglieds, „Profil & Anmeldung“) oder `history` (wer die alte Seite „Sync-Tool & Addon“ öffnen durfte). Ohne Login 401, ohne einen der beiden Bereiche 403 — der Download ist ein normaler `GET` mit der Sitzung, also ein `<a href download>`.
- **Admin-Hinweise:** nur Voll-Admins bekommen `repo`, `private` und `tokenSet` in der Antwort und sehen auf der Karte, dass der Token fehlt oder abgelehnt wird; alle anderen lesen nur „Gerade nicht verfügbar“.
- **Einstellungen:** `github` steht in `CREDENTIAL_KEYS`, `addonDownloads` in `ADDON_KEYS` (`apiRoutes/settings.js`) — beide nur für Voll-Admins (`FULL_ADMIN_KEYS`). `publicConfig()` macht aus dem Token `{ hasToken }`; `PATCH { github: { token } }` folgt dem Vertrag der anderen Geheimnisse (weglassen = behalten, `""` = löschen). Die Karte „GitHub (Addons)“ unter Verbindungen ist der Ort dafür; ohne Token zählt sie als „nicht eingerichtet“.

## Download über den Server

`resolveDownload()` sucht im (gecachten) neuesten Release die Datei mit genau dem Namen **und** passendem Muster des Addons; sonst 404 (`unknown_addon`, `unknown_asset`, `no_release`) bzw. 503 (`unavailable`: Token fehlt, GitHub nicht erreichbar). Danach zählt das Limit (429 mit `Retry-After`), dann streamt die Route GitHubs Antwort mit `Content-Type` nach Endung (`application/zip`, `application/vnd.microsoft.portable-executable`, sonst `application/octet-stream`), `Content-Disposition: attachment` mit Dateinamen (ASCII und RFC 5987), `Content-Length` und `Cache-Control: private, no-store`. Bricht der Browser ab, wird der Stream zu GitHub geschlossen. Die Komprimierung (`compression.js`) lässt Streams in Ruhe.

**Protokoll:** jede Datei als Zeile `[info] [addons] download <id> <version> <datei> by <Name> (<Discord-Id>)` (pm2-Log), abgelehnte und fehlgeschlagene als `warn`. Der Token steht nie in einer Zeile: geloggt werden nur Kurzcode und Status, nie ein axios-Fehlerobjekt (das trüge die Request-Header).

## Version zuerst

Die Seite schickt die Version des Content-Umschalters (`?version=`), der Server löst sie über `resolveVersionQuery()` auf (nichts = Hauptversion, „Andere Versionen ausblenden“ = immer die Hauptversion) und zeigt nur Addons, deren `versions` sie enthalten. `/addons` nimmt die Version des Befehls (`versionOfCommand`: Option, sonst Kategorie des Kanals, sonst Hauptversion). Die Seite ist deshalb nicht mehr `neutral` in `menu.json`.

## Einrichten: GitHub-Token

Fine-grained Personal Access Token auf github.com (Settings → Developer settings → Personal access tokens → Fine-grained tokens): Resource owner `mst1987`, Repository access „Only select repositories“ mit `levelhelper`, `professionkit` (und optional `eventhelper-addon`), Permissions → Repository permissions → **Contents: Read-only** (Metadata: Read-only kommt automatisch), sonst nichts. Ablaufdatum setzen und den Token unter Einstellungen → Verbindungen → GitHub (Addons) eintragen. Ein abgelaufener Token zeigt Admins „GitHub lehnt den Token ab“.

## Tests

`test/classes/githubReleases.test.js`, `test/services/addons/*.test.js`, `test/web/apiRoutes/addons.test.js` (Router, Bereiche, Stream, Limit, kein Token in Antwort und Log), `test/web/apiRoutes/settings.test.js` (Maskierung, Vertrag, nur Voll-Admins), `test/commands/lookup/addons.test.js`; im Client `pages/addon/AddonPage.test.tsx` und `pages/settings/AddonsSection.test.tsx`.
