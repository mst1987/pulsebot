# Tests: Helfer, Fabriken und Mock-Konvention

Die Suite ist Jest (`npm test`, `npm run test:coverage`); die Tests liegen unter `test/`, wo genau, sagt der nächste Abschnitt. Diese Datei sagt, was es schon gibt, damit kein Test eine eigene Kopie davon anlegt. Die Grundregeln (jedes Feature mit Tests, kein echtes Netzwerk, Stores über `tempStoreFile`) stehen im Abschnitt „Testing“ in CLAUDE.md.

## Wo ein Test hingehört

Die Regel (#434), kurz auch in CLAUDE.md:

| Quelle | Test |
|---|---|
| `src/utils/`, `src/classes/`, `src/commands/`, `src/config/`, die Stores (`src/web/*Store.js`) und die übrigen Module unter `src/web/` | gespiegelt: `src/utils/time/index.js` → `test/utils/time/index.test.js`, `src/web/report/widgets.js` → `test/web/report/widgets.test.js` |
| ein Route-Modul `src/web/apiRoutes/<name>.js` | `test/web/apiRoutes/<name>.test.js`; ein zweites Thema derselben Route als `<name>.<thema>.test.js` (`raidplan.templates.test.js`) |
| der Dispatcher `src/web/http/apiRouter.js` | `test/web/http/apiRouter.test.js`: nur Dispatch, 404/405, Fehlerbehandlung (AppError, 500-Umschlag), Area-Gate |
| eine Suite, die für eine Datei zu groß ist, oder ein Thema quer zu einem Modul | `<modul>.<thema>.test.js` daneben: `test/web/loot/lootCouncil.gear.test.js`, `test/web-client/raidplan.slots.test.js` |

Eine Route-Suite fährt ihre Anfragen durch den echten Router (`routerClient` aus `http.js`, siehe unten) und bindet ihn an ihr Route-Modul: ein Pfad, den ein anderes Route-Modul registriert, lässt den Test sofort scheitern, statt still die falsche Datei zu testen. Sie mockt nur, was ihre Route erreicht. Wer einen Handler lieber direkt aufruft (Validierung, Randfälle), tut das in derselben Datei, wie in `apiRoutes/settings.test.js` und `apiRoutes/channels.test.js` („handlers called directly“).

**Jedes Backend-Modul wird von mindestens einem Test geladen.** `test/docs/testMirror.test.js` liest alle Dateien unter `test/` und sucht für jedes `src/**/*.js` (ohne `src/web-client/` und `src/bot.js`) ein `require(...)` oder `jest.requireActual(...)` mit festem relativem Pfad; ein `jest.mock(...)`-Pfad zählt nicht. Ausnahmen stehen dort in `ALLOWED`, jede mit Grund: reine Datentabellen (`config/profanity.js`, `config/softresInstances.js`, …), die ein Test des lesenden Moduls schon abdeckt, und Dateien, die ein Test über einen berechneten Pfad lädt (`web/static/report.js`). Ein Eintrag, der nicht mehr nötig ist, lässt den Test ebenfalls scheitern. Ein neues Modul bekommt also seinen Test gleich mit, sonst ist die Suite rot.

Die Generator-Skripte unter `scripts/` exportieren ihre Parse-Funktionen und starten `main()` nur bei `require.main === module`; getestet werden sie unter `test/scripts/` mit kleinen Fixtures (`test/fixtures/scripts/`).

## Was jede Suite automatisch bekommt (`test/setup/`)

Eingebunden über `jest.config.js`, ohne dass ein Test etwas tun muss:

| Datei | Wirkung |
|---|---|
| `environment.js` | Die Testumgebung: Node plus die Lebenszyklus-Ereignisse für den Konsolen-Puffer. Außerdem bekommt **jede Suite ein eigenes Datenverzeichnis**: `EVENTHELPER_DATA_DIR` zeigt auf `%TEMP%/eh-test-data-<uuid>`, das nach der Suite gelöscht wird. Alles, was über `src/config/paths.js` schreibt (Stores, `auth.js`-Sessions), landet dort und nie im `data/` des Checkouts. `test/setup/dataDir.test.js` hält das fest. |
| `noNetwork.js` + `noNetworkCheck.js` | Netzwerk-Wächter: axios, `http(s)` und `fetch` werfen `NetworkBlockedError` („Netzwerk in Tests verboten - jest.mock verwenden“). Ein geblockter Aufruf lässt den Test auch dann scheitern, wenn der Code den Fehler schluckt. Loopback (`localhost`, `127.*`) bleibt offen. |
| `consoleBuffer.js` | Konsolenausgaben erscheinen nur bei einem fehlschlagenden Test (ersetzt `silent`). |

## Helfer (`test/helpers/`)

| Datei | Wofür |
|---|---|
| `mockInteraction.js` | `mockInteraction(opts)` — eine Discord-Interaction mit `reply`/`editReply`/`followUp`/`showModal` als `jest.fn`; `makeCollection(entries)` — Map mit `find`/`filter` wie eine discord.js-Collection. Für alles unter `src/commands/`. |
| `discordClient.js` | `makeClient({ guilds, channels, members, user, ready, missing })`, `makeGuild(...)`, `makeChannel(...)`, `makeMember(...)`, `discordError(kind)` — ein Bot-Client aus Collections. `fetch(id)` liefert den Cache-Eintrag, ein Fehlgriff wirft wie Discord (Code 10003/10004/10007/10008) oder liefert mit `missing: "null"` null. Sonderformen (Scheduled Events, fehlschlagendes `messages.fetch`) kommen über `...over`. |
| `discordMock.js` | `withClientHelpers(mock)` — für Suites, die `src/services/discord/discord.js` mocken: `isOnline()` und `fetchTextChannel()` lesen dann den Client, den der gemockte `getClient()` liefert. |
| `http.js` | `mockRes()`, `status(res)`, `json(res)` (ganzer Umschlag), `body(res)` (`data` des Umschlags, sonst der Umschlag), `jsonRequest(method, path, payload, headers)` (EventEmitter mit JSON-Body), `apiMiddlewareMock({ user, fullAdmin, csrf })` und `apiBodyMock({ body, raw })` als fertige Factory-Mocks, `routerClient(routeModule)` (liefert `get`/`post`/`patch`/`request`/`urlFor`/`handle`, fährt die Anfrage durch `apiRouter.handle` samt Area-Gate und CSRF-Header und lässt einen Pfad eines fremden Route-Moduls scheitern). Für alle Route-Handler `(req, res, url)`. |
| `tempStore.js` | `tempStoreFile(name)` — eine Datei in einem eigenen `mkdtemp`-Verzeichnis für `store.useFile(...)`; das Aufräumen registriert der Helfer selbst. |
| `memoryFs.js` | `memoryFs()` — ein `fs` im Speicher für Store-Suites (`jest.mock("fs", () => require("../helpers/memoryFs").memoryFs())`, Inhalt in `fs.__store`). |
| `lootCouncil.js` | `DAY`, `now`, `lootRow`, `gearOf`, `item` — die Loot- und Gear-Zeilen, die sich die `test/web/lootCouncil.<thema>.test.js`-Suiten teilen (die `jest.mock`-Aufrufe stehen weiter in jeder Suite). |
| `signupMocks.js` | In-Memory-`eventStore`/`signupStore`/`discord`/`settingsStore` für den Anmelde-Dialog; `signupService` läuft echt darauf. |
| `botCommandAccess.js` | `memberMayRun(command, config)` — prüft die echten Zugriffsregeln (`services/discord/botAccess.js`) für einen Befehl. |
| `tempRepo.js` | Ein Wegwerf-Git-Repo mit verknüpftem Worktree, nur für die Hook-Tests unter `test/claude-hooks/`. |

## Fabriken (`test/factories/`)

Jede Fabrik liefert ein frisches Objekt mit sinnvollen Pflichtfeldern; ein Test notiert nur seine Abweichung (`over`). Ein Feld, das fehlen soll, wird als `undefined` übergeben. Ändert sich das Datenmodell, wird es an einer Stelle nachgezogen.

| Datei | Fabriken |
|---|---|
| `events.js` | `event(over)` (Raid-Helper-Form: id, title, startTime, channelId), `ownEvent(over)` (eigenes Event, drei Tage voraus, Anmeldeschluss in zwei), `signup(over)`, `series(over)` (Serie einer Raid-Kategorie), dazu `sec(ms)` und `DAY` |
| `wcl.js` | `makeWcl(over)` (jede Methode des WCL-Clients als `jest.fn` mit leerer Antwort), `fight(over)` / `GRUUL` (der Gruul-Kill), `fights(n, { wipes })` (eine Kampfliste `{ end, fights }`) |
| `raidplan.js` | `board(over)` (leeres Roh-Board), `icon(over)`, `person(over)` (Roster-Eintrag) |

Eine Suite mit eigener Form baut einen Einzeiler darauf: `const event = (over = {}) => baseEvent({ guildId: "g1", durationMinutes: 180, ...over });`.

## Mock-Konvention

- **Factory-Mock ist der Normalfall:** `jest.mock("../../src/web/x", () => ({ ... }))` mit genau den Funktionen, die der Test steuert. Variablen aus dem Test darf die Factory nur lesen, wenn sie mit `mock` beginnen (`mockUser`, `mockEvents`) — Jest hebt `jest.mock` an den Dateianfang.
- **Nur einen Teil ersetzen:** `requireActual` spreizen und das Nötige überschreiben, damit reine Hilfsfunktionen echt bleiben:
  ```js
  jest.mock("../../src/stores/eventStore", () => ({
      ...jest.requireActual("../../src/stores/eventStore"),
      getEvent: jest.fn(() => null),
  }));
  ```
- **Gemeinsame Mocks kommen aus einem Helfer**, nicht aus einer Kopie: `apiMiddleware`/`apiBody` über `http.js`, `services/discord/discord` über `discordMock.js`, `fs` über `memoryFs.js`, die Anmelde-Stores über `signupMocks.js`. Braucht ein weiterer Mock mehrere Suites, gehört er als Factory nach `test/helpers/`.
- **Automock** (`jest.mock("axios")` ohne Factory) nur für Module, deren Rückgaben der Test ohnehin vollständig setzt.
- **Stores**, die eine Suite wirklich schreiben lässt, bekommen `useFile(tempStoreFile("x.json"))` oder `memoryFs` — nie `os.tmpdir()` plus `process.pid`, nie das `data/` des Checkouts.
- **Assertions auf konkrete Werte:** `toEqual`/`toMatchObject`/`toBe` auf das Ergebnis, nicht nur `toBeDefined()`, `not.toThrow()` oder `length > 0`.

## Coverage-Schwellen

`npm run test:coverage` bricht ab, wenn die Abdeckung unter die Schwellen in `jest.config.js` fällt (gemessen 2026-09-26, #432): global, `src/utils/logcheck/` als Ganzes und `src/web/**/*Store.js` je Datei. Die Werte liegen etwa einen Punkt unter dem erreichten Stand — ein Feature darf die Abdeckung der Module, die es berührt, nicht senken.
