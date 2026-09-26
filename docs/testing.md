# Tests: Helfer, Fabriken und Mock-Konvention

Die Suite ist Jest (`npm test`, `npm run test:coverage`); die Tests liegen unter `test/`, wo genau, sagt der nächste Abschnitt. Der React-Client hat eine eigene Suite mit Vitest (Abschnitt „Web-Client“ unten). Diese Datei sagt, was es schon gibt, damit kein Test eine eigene Kopie davon anlegt. Die Grundregeln (jedes Feature mit Tests, kein echtes Netzwerk, Stores über `tempStoreFile`) stehen im Abschnitt „Testing“ in CLAUDE.md.

## Wo ein Test hingehört

Die Regel (#434), kurz auch in CLAUDE.md:

| Quelle | Test |
|---|---|
| `src/utils/`, `src/classes/`, `src/commands/`, `src/config/`, die Stores (`src/stores/`), die Dienste (`src/services/<bereich>/`) und die Module unter `src/web/<bereich>/` | gespiegelt: `src/utils/time/index.js` → `test/utils/time/index.test.js`, `src/stores/eventStore.js` → `test/stores/eventStore.test.js`, `src/services/events/eventCreate.js` → `test/services/events/eventCreate.test.js`, `src/web/report/widgets.js` → `test/web/report/widgets.test.js` |
| ein Route-Modul `src/web/apiRoutes/<name>.js` | `test/web/apiRoutes/<name>.test.js`; ein zweites Thema derselben Route als `<name>.<thema>.test.js` (`raidplan.templates.test.js`) |
| der Dispatcher `src/web/http/apiRouter.js` | `test/web/http/apiRouter.test.js`: nur Dispatch, 404/405, Fehlerbehandlung (AppError, 500-Umschlag), Area-Gate |
| eine Suite, die für eine Datei zu groß ist, oder ein Thema quer zu einem Modul | `<modul>.<thema>.test.js` daneben: `test/web/loot/lootCouncil.gear.test.js`; im Client `src/web-client/src/lib/raidplan.slots.test.ts` |
| der React-Client `src/web-client/src/**` | Vitest, neben dem Modul: `lib/raidplan.ts` → `lib/raidplan.test.ts` (oder `raidplan.<thema>.test.ts`), `pages/ChannelsPage.tsx` → `pages/ChannelsPage.test.tsx`; strukturelle Konventionen unter `test/web-client/conventions/` (siehe „Web-Client“) |

Eine Route-Suite fährt ihre Anfragen durch den echten Router (`routerClient` aus `http.js`, siehe unten) und bindet ihn an ihr Route-Modul: ein Pfad, den ein anderes Route-Modul registriert, lässt den Test sofort scheitern, statt still die falsche Datei zu testen. Sie mockt nur, was ihre Route erreicht. Wer einen Handler lieber direkt aufruft (Validierung, Randfälle), tut das in derselben Datei, wie in `apiRoutes/settings.test.js` und `apiRoutes/channels.test.js` („handlers called directly“).

**Schichten (#425):** `test/docs/layering.test.js` hält fest, dass `src/commands/` und `src/utils/` nie aus `src/web/` laden und `src/services/` und `src/stores/` nur `web/http/apiResult.js` (die `fail(...)`-Form). Braucht ein Befehl ein Modul, das noch unter `src/web/` liegt, zieht es nach `src/services/<bereich>/` um, samt Test nach `test/services/<bereich>/`.

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

## Web-Client (Vitest)

Der React-Client unter `src/web-client` testet sich selbst mit **Vitest** (#435): `cd src/web-client && npm test` (einmal, so läuft es auch in der CI im Job `web-client`), `npm run test:watch` beim Arbeiten. `vitest.config.ts` übernimmt die Vite-Konfiguration der App (TSX, JSON, `import.meta.glob`) und rendert in **jsdom**. Der Root-Jest sieht diese Tests nicht (`testMatch` greift nur `test/**/*.test.js`), und aus `tsc -b`/dem Build sind sie ausgenommen (`tsconfig.app.json`).

- **Wo:** neben dem Modul als `*.test.ts` bzw. `*.test.tsx` (`lib/assign.ts` → `lib/assign.test.ts`, `pages/profile/ProfilePage.tsx` → `pages/profile/ProfilePage.test.tsx`; ein Thema quer dazu als `ClaPage.actions.test.tsx`). Imports explizit aus `"vitest"`, keine Globals.
- **Logik** (`lib/`, `api/`, `i18n/core.ts`) wird einfach importiert — volles TypeScript, Generics und `as` inklusive. Den früheren Regex-Stripper (`loadTs`) gibt es nicht mehr.
- **Komponenten und Seiten** werden gerendert und so geprüft, wie ein Nutzer sie sieht: `@testing-library/react` (`screen.getByRole`, `findByText`), `@testing-library/user-event` für Klicks und Tastatur, `@testing-library/jest-dom` für `toBeInTheDocument`/`toHaveAttribute`. Gesucht wird nach Rolle, Text und Label, nicht nach CSS-Klassen — außer die Klasse ist das Verhalten (Ton eines Badges).
- **Die API ist nie echt:** `vi.mock("../api", async (orig) => ({ ...(await orig<typeof import("../api")>()), getChannels: vi.fn() }))`, dann `vi.mocked(api.getChannels).mockResolvedValue(...)`; wer `api/client.ts` selbst testet, stubbt `fetch` (`vi.stubGlobal`). `clearMocks`/`restoreMocks` sind an — Rückgabewerte gehören in `beforeEach` oder in den Test.
- **Helfer unter `src/web-client/src/test/`:**

| Datei | Wofür |
|---|---|
| `setup.ts` | läuft vor jeder Datei: jest-dom-Matcher, `<dialog>`-Nachbau (jsdom kennt `showModal` nicht; Escape feuert `cancel`), `matchMedia`-Stub, nach jedem Test `cleanup` und leerer local-/sessionStorage |
| `render.tsx` | `renderPage(<Seite />, { route, path, user })` — MemoryRouter, der Outlet-Kontext `{ user }` wie in der Shell, `JobsProvider` (Toasts) und `ConfirmProvider`; `adminUser(over)` für ein Konto |
| `i18n.ts` | der echte `t` ist Deutsch; `switchLang("en")` bzw. `inLang("en", fn)` für englische Fälle |
| `backend.ts` | `requireBackend("web/raidTemplates")` — ein CommonJS-Modul aus `src/`, für Tests, die Client und Server gegeneinander halten |

- **Bekannte Eigenheit:** Der Titel eines `Modal` ist nicht mit dem `<dialog>` verbunden (kein `aria-labelledby`), `getByRole("dialog", { name })` findet ihn also nicht — Tests suchen den offenen Dialog über seinen Titeltext.

### Konventionen: `test/web-client/conventions/` (Jest)

Was kein Render-Test sehen kann, prüft weiter der Root-Jest am Quelltext: jedes Modul mit eigenem Stylesheet und eigenem Klassen-Präfix (`cssNamespaces`), lazy geladene Routen (`codeSplitting`), die API-Aufteilung (`apiSplit`), kein durchgereichter CSRF-Token (`csrf`), keine deutschen Literale in übersetzten Dateien (`i18n-phase1`, `i18n-*`), kein nativer `title`, keine zweite Kopie eines Bausteins (`icons`, `raidLoader`, `useDismiss`, `listSection`, `resultToasts`, …). Dateien lesen sie über `test/web-client/clientSource.js` (`read`, `sourceFiles`, `clientSources`, `stripComments`, `dictionary`); jeder Durchlauf über den Client lässt dessen eigene Tests aus. Eine neue Konvention kommt dorthin — **Verhalten** einer Komponente dagegen gehört als Render-Test in den Client, nicht als `toContain` auf den Quelltext.

## Coverage-Schwellen

`npm run test:coverage` bricht ab, wenn die Abdeckung unter die Schwellen in `jest.config.js` fällt (gemessen 2026-09-26, #432): global, `src/utils/logcheck/` als Ganzes und `src/stores/**/*Store.js` je Datei. Die Werte liegen etwa einen Punkt unter dem erreichten Stand — ein Feature darf die Abdeckung der Module, die es berührt, nicht senken.
