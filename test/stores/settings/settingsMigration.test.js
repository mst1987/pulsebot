jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../../src/config/paths");
const {
    migrateSettings, migrateCategoryRaidTemplate, raidplanDefaultsLine,
} = require("../../../src/stores/settings/settingsMigration");
const { getConfig } = require("../../../src/stores/settings/configStore");
const { allRaidTemplates, getRaidTemplate, listRaidTemplates } = require("../../../src/stores/events/raidTemplateStore");
const eventSeriesStore = require("../../../src/stores/events/eventSeriesStore");
const { isDone } = require("../../../src/stores/settings/migrationMarkStore");

const CONFIG_FILE = settingsPath("config.json");
const TEMPLATES_FILE = settingsPath("raid-templates.json");
const stored = (file) => JSON.parse(fs.__store.get(file));
const quiet = { log: () => {}, warn: () => {} };

// A pre-#266 install: bare Raid-Helper templates, a global default template,
// the single-server block from before the event-server list.
const OLD_CONFIG = {
    categoryIds: ["c1", "c2"],
    raidDefaults: { templateId: "3", channelId: "ch" },
    discordServers: { eventGuildId: "1100000000000000001", talkGuildId: "1100000000000000002", talkOverviewChannelId: "1100000000000000003" },
};
const OLD_TEMPLATES = { templates: [{ id: "3", name: "GDKP Kara", createdAt: 5, updatedAt: 6 }] };

beforeEach(() => {
    fs.__store.clear();
});

describe("stores/settings/settingsMigration migrateSettings (#420)", () => {
    it("upgrades an old install once and logs every change", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(OLD_CONFIG));
        fs.__store.set(TEMPLATES_FILE, JSON.stringify(OLD_TEMPLATES));
        const log = jest.fn();
        const { changes } = migrateSettings({ log });
        // the four upgrades of the old install, the old raid defaults dropped (#924: "ch" is no channel id),
        // plus the planning of its two raid categories (nothing used yet: raid plan)
        // and their version pinned to the one they play (#738)
        // and the template per server with the note on its two categories nothing places yet (#1076)
        // and the Vermerke switch on for the link it already had (#1078)
        expect(changes).toHaveLength(10);
        expect(changes[3]).toBe("config.json: Bewerbungen, Raid-Standardwerte und Kan\u00e4le je Server gespeichert (#924) - globale Altfelder entfernt");
        expect(changes[5]).toContain("Vermerke teilen an 1 ");
        expect(changes[6]).toContain("raid-templates.json: 1 Vorlage(n) je Server");
        expect(changes[7]).toContain("2 Kategorie(n) ohne belegten Server behalten ihre Vorlagen-ID (#1076) - c1, c2");
        expect(changes[8]).toBe("config.json: Planung je Raid-Kategorie nach der bisherigen Nutzung festgelegt (Raidplan oder Sheet) - c1 raidplan, c2 raidplan");
        expect(changes[9]).toBe("config.json: Spielversion je aktiver Kategorie festgeschrieben (#738) - c1 tbc, c2 tbc");
        expect(log).toHaveBeenCalledTimes(10);
        expect(log.mock.calls.every(([line]) => line.startsWith("[settings] Migration: "))).toBe(true);

        expect(stored(TEMPLATES_FILE).templates[0]).toMatchObject({ id: "rh-3", raidhelperTemplateId: "3" });
        const config = stored(CONFIG_FILE);
        // written as the server federation (#897): the event server, the talk server as a server of its own,
        // the overview target as a link - and no talkGuildId any more
        expect(config.discordServers).toEqual({
            servers: [{ guildId: "1100000000000000001", label: "" }, { guildId: "1100000000000000002", label: "" }],
            links: [{ from: "1100000000000000001", to: "1100000000000000002", channelId: "1100000000000000003", lang: "", versions: [], shareNotes: true }],
        });
        expect(config.categoryRaidTemplate).toEqual({ c1: "rh-3", c2: "rh-3" });
        // #924: the preset channel goes to its server like any channel - "ch" is none, so it is dropped
        expect(config).not.toHaveProperty("raidDefaults");
        expect(config.serverSettings).toEqual({});
        expect(getConfig().categoryRaidTemplate).toEqual({ c1: "rh-3", c2: "rh-3" });
        expect(getConfig().discordServers).toEqual(config.discordServers);
        expect(allRaidTemplates()[0].id).toBe("rh-3");
    });

    it("the second start finds nothing: no change, no write, no log", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(OLD_CONFIG));
        fs.__store.set(TEMPLATES_FILE, JSON.stringify(OLD_TEMPLATES));
        migrateSettings(quiet);
        const before = [fs.__store.get(CONFIG_FILE), fs.__store.get(TEMPLATES_FILE)];
        fs.writeFileSync.mockClear();
        const log = jest.fn();
        expect(migrateSettings({ log })).toEqual({ changes: [] });
        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
        expect([fs.__store.get(CONFIG_FILE), fs.__store.get(TEMPLATES_FILE)]).toEqual(before);
    });

    it("moves the old Battle.net realm and templates into versionSettings.tbc once (#542)", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: "g", blizzard: { clientId: "id", clientSecret: "s", region: "us", realmSlug: "nightslayer", namespace: "profile-classic1x-us" } }));
        const { changes } = migrateSettings(quiet);
        expect(changes).toEqual([expect.stringContaining("Einstellungen je Spielversion (#542)")]);
        const config = stored(CONFIG_FILE);
        expect(config.blizzard).toEqual({ clientId: "id", clientSecret: "s" });
        expect(config.versionSettings.tbc).toMatchObject({
            blizzardRegion: "us", blizzardRealmSlug: "nightslayer", blizzardNamespace: "profile-classic1x-us", wowheadPath: "tbc", softresEdition: "tbc",
        });
        expect(config.versionSettings.forever.blizzardRealmSlug).toBe("");
        expect(getConfig().versionSettings.tbc.blizzardRealmSlug).toBe("nightslayer");
        // idempotent: a second start finds the map and writes nothing, also after the admin emptied a field
        fs.writeFileSync.mockClear();
        expect(migrateSettings(quiet)).toEqual({ changes: [] });
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("writes nothing for a fresh install but the mark that keeps its later links out of #1078", () => {
        expect(migrateSettings(quiet)).toEqual({ changes: [] });
        const written = fs.writeFileSync.mock.calls.map(([file]) => String(file));
        expect(written).toEqual([expect.stringContaining("migrations.json")]);
        expect(fs.__store.has(CONFIG_FILE)).toBe(false);
        fs.writeFileSync.mockClear();
        expect(migrateSettings(quiet)).toEqual({ changes: [] });
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("never throws: a failure is logged and reported", () => {
        fs.__store.set(TEMPLATES_FILE, JSON.stringify(OLD_TEMPLATES));
        fs.writeFileSync.mockImplementationOnce(() => { throw new Error("disk full"); });
        const warn = jest.fn();
        const result = migrateSettings({ log: () => {}, warn });
        expect(result.error.message).toBe("disk full");
        expect(warn).toHaveBeenCalledWith("[settings] Migration fehlgeschlagen: disk full");
    });

    it("logs to the console by default", () => {
        fs.__store.set(TEMPLATES_FILE, JSON.stringify(OLD_TEMPLATES));
        const spy = jest.spyOn(console, "log").mockImplementation(() => {});
        migrateSettings();
        expect(spy).toHaveBeenCalledWith(expect.stringContaining("raid-templates.json"));
        spy.mockRestore();
    });
});

// #516: the full-raid rule from before ("bench"/"off") becomes "no limit", once.
describe("stores/settings/settingsMigration overflow -> none (#516)", () => {
    const EVENTS_FILE = settingsPath("events.json");
    const { getEvent } = require("../../../src/stores/events/eventStore");
    const OLD_EVENTS = { events: [
        { id: "eh-a", title: "A", overflow: "bench", lockAtLimit: true, signupsClosed: true, size: 25 },
        { id: "eh-b", title: "B", overflow: "off", lockAtLimit: false, size: 10 },
        { id: "eh-c", title: "C", overflow: "waitlist", lockAtLimit: true, size: 10 },
    ] };
    const OLD_TPL = { templates: [
        { id: "t1", name: "Kara", versionId: "tbc", raidhelperTemplateId: "", size: 10, overflow: "off", lockAtLimit: true, createdAt: 1, updatedAt: 2 },
        { id: "t2", name: "SSC", versionId: "tbc", raidhelperTemplateId: "", size: 25, overflow: "refuse", lockAtLimit: true, createdAt: 1, updatedAt: 2 },
    ] };

    it("switches every legacy event and template to none, lockAtLimit off, logs it and leaves new choices alone", () => {
        fs.__store.set(EVENTS_FILE, JSON.stringify(OLD_EVENTS));
        fs.__store.set(TEMPLATES_FILE, JSON.stringify(OLD_TPL));
        const log = jest.fn();
        const { changes } = migrateSettings({ log });
        expect(changes).toEqual([
            expect.stringContaining("raid-templates.json: 1 Vorlage(n)"),
            expect.stringContaining("events.json: 2 Event(s)"),
            expect.stringContaining("Vorlage(n) je Server"),
        ]);
        expect(log).toHaveBeenCalledTimes(3);
        const events = stored(EVENTS_FILE).events;
        expect(events[0]).toEqual({ ...OLD_EVENTS.events[0], overflow: "none", lockAtLimit: false });
        expect(events[1]).toEqual({ ...OLD_EVENTS.events[1], overflow: "none", lockAtLimit: false });
        expect(events[2]).toEqual(OLD_EVENTS.events[2]);
        // a raid the old rule already closed stays closed - that is the orga's call
        expect(getEvent("eh-a")).toMatchObject({ overflow: "none", lockAtLimit: false, signupsClosed: true });
        const templates = stored(TEMPLATES_FILE).templates;
        expect(templates[0]).toMatchObject({ ...OLD_TPL.templates[0], overflow: "none", lockAtLimit: false });
        expect(templates[1]).toMatchObject(OLD_TPL.templates[1]);
    });

    it("is idempotent: the second start writes and logs nothing", () => {
        fs.__store.set(EVENTS_FILE, JSON.stringify(OLD_EVENTS));
        fs.__store.set(TEMPLATES_FILE, JSON.stringify(OLD_TPL));
        migrateSettings(quiet);
        const before = [fs.__store.get(EVENTS_FILE), fs.__store.get(TEMPLATES_FILE)];
        fs.writeFileSync.mockClear();
        const log = jest.fn();
        expect(migrateSettings({ log })).toEqual({ changes: [] });
        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
        expect([fs.__store.get(EVENTS_FILE), fs.__store.get(TEMPLATES_FILE)]).toEqual(before);
    });
});

describe("stores/settings/settingsMigration steps", () => {
    it("migrateCategoryRaidTemplate only upgrades a config without a map whose default a template links", () => {
        const templates = [{ id: "rh-3", raidhelperTemplateId: "3" }];
        expect(migrateCategoryRaidTemplate({ categoryIds: ["a"], raidDefaults: { templateId: "3" } }, templates)).toEqual({ a: "rh-3" });
        expect(migrateCategoryRaidTemplate({ categoryIds: ["a"], raidDefaults: { templateId: "3" }, categoryRaidTemplate: {} }, templates)).toBeNull();
        expect(migrateCategoryRaidTemplate({ categoryIds: ["a"], raidDefaults: { templateId: "99" } }, templates)).toBeNull();
        expect(migrateCategoryRaidTemplate({ categoryIds: ["a"] }, templates)).toBeNull();
        // no category list stored: the default categories get it, like before
        expect(Object.values(migrateCategoryRaidTemplate({ raidDefaults: { templateId: "3" } }, templates)).every((id) => id === "rh-3")).toBe(true);
    });
});

describe("stores/settings/settingsMigration: the raid plans' Standard (#524)", () => {
    const PLANS_FILE = settingsPath("raidplans.json");
    const copy = (id) => ({ id, type: "heal", title: "", spell: null, assignees: ["class:Priest:1"], targets: [{ kind: "slot", ref: "tank:1" }], note: "", suggested: false, origin: "default" });
    it("turns the copies of an old plan into its Standard once, backs the file up and logs one line; the second start is silent", () => {
        const bosses = {};
        ["bt/supremus", "bt/gurtogg-bloodboil", "bt/trash"].forEach((key, i) => { bosses[key] = { assignments: [copy(`c${i}`)] }; });
        fs.__store.set(PLANS_FILE, JSON.stringify({ plans: [{ eventId: "eh_1", version: 2, bosses }] }));
        const log = jest.fn();
        const { changes } = migrateSettings({ log });
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatch(/^raidplans\.json: Standard-Abschnitt \(#524\) - 1 Plan\/Pläne geprüft, 1 umgestellt, 1 Standard-Zeile\(n\) aus 3 Kopie\(n\), 0 Abweichung\(en\), 0 Abschnitt\(e\) unverändert behalten, Sicherung raidplans\.json\.bak-\d{8}$/);
        expect(log).toHaveBeenCalledWith(expect.stringContaining("[settings] Migration: raidplans.json"));
        const plan = stored(PLANS_FILE).plans[0];
        expect(plan.defaultsMigrated).toBe(true);
        expect(plan.bosses.defaults.assignments).toHaveLength(1);
        expect([...fs.__store.keys()].some((k) => /raidplans\.json\.bak-\d{8}$/.test(k))).toBe(true);
        const again = jest.fn();
        expect(migrateSettings({ log: again }).changes).toEqual([]);
        expect(again).not.toHaveBeenCalled();
    });
    it("words the line without a backup when there was no file to back up", () => {
        expect(raidplanDefaultsLine({ plans: 1, migrated: 0, rows: 0, copies: 0, deviations: 0, kept: 0, backup: "" })).toBe("raidplans.json: Standard-Abschnitt (#524) - 1 Plan/Pläne geprüft, 0 umgestellt, 0 Standard-Zeile(n) aus 0 Kopie(n), 0 Abweichung(en), 0 Abschnitt(e) unverändert behalten");
    });
});

// #553: the standard values per version fill empty fields once; recruitment
// templates and posts from before become TBC ones.
describe("stores/settings/settingsMigration standard values and recruitment versions (#553)", () => {
    const { migrateVersionDefaults } = require("../../../src/stores/settings/settingsMigration");
    const { normalizeBlock } = require("../../../src/stores/settings/versionSettingsSchema");
    const RECRUIT_FILE = settingsPath("recruitment.json");
    const POSTS_FILE = settingsPath("recruitment-posts.json");
    const EMPTY = normalizeBlock({});
    const current = (over = {}) => ({
        guildId: "g",
        versionSettings: { tbc: { ...EMPTY, blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike", wowheadPath: "tbc" }, classic: { ...EMPTY, wowheadPath: "classic-own" }, forever: EMPTY },
        ...over,
    });

    it("fills only the empty fields of every version with defaults, once", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(current()));
        const { changes } = migrateSettings(quiet);
        expect(changes).toEqual([expect.stringContaining("Standardwerte je Spielversion (#553)")]);
        const config = stored(CONFIG_FILE);
        expect(config.versionDefaultsApplied).toEqual(["tbc", "classic", "forever"]);
        expect(config.versionSettings.classic).toMatchObject({ wowheadPath: "classic-own", softresEdition: "classic", blizzardNamespace: "profile-classic1x-eu", blizzardRealmSlug: "" });
        expect(config.versionSettings.tbc).toMatchObject({ blizzardRealmSlug: "thunderstrike", wowheadPath: "tbc", softresEdition: "tbc", blizzardNamespace: "profile-classicann-eu" });
        // Forever gets its Wowhead section (#750), realm, armory and logs stay empty
        expect(config.versionSettings.forever).toEqual({ ...EMPTY, blizzardRegion: "eu", wowheadPath: "forever" });
        // the links work with the TBC realm, and stay out for Classic without one
        const { versionLinks } = require("../../../src/services/versions/versionSettings");
        expect(versionLinks("tbc").wcl("Nera")).toBe("https://fresh.warcraftlogs.com/character/eu/thunderstrike/Nera");
        expect(versionLinks("classic").wcl("Nera")).toBe("");

        fs.writeFileSync.mockClear();
        expect(migrateSettings(quiet)).toEqual({ changes: [] });
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("never fills a field again once the version is listed (cleared on purpose)", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(current({ versionDefaultsApplied: ["tbc", "classic", "forever"] })));
        expect(migrateSettings(quiet)).toEqual({ changes: [] });
        expect(stored(CONFIG_FILE).versionSettings.classic.softresEdition).toBe("");
    });

    it("fills a version that was not listed yet and keeps the others", () => {
        const out = migrateVersionDefaults(current({ versionDefaultsApplied: ["tbc"] }));
        expect(out.versionDefaultsApplied).toEqual(["tbc", "classic", "forever"]);
        expect(Object.keys(out.filled)).toEqual(["classic", "forever"]);
        expect(out.versionSettings.tbc.softresEdition).toBe("");
    });

    it("has nothing to do for a fresh install or a config without the map", () => {
        expect(migrateVersionDefaults({})).toBeNull();
        expect(migrateVersionDefaults({ guildId: "g" })).toBeNull();
        expect(migrateVersionDefaults({ guildId: "g", versionSettings: [] })).toBeNull();
    });

    it("gives recruitment templates and posts without a version TBC, once", () => {
        fs.__store.set(RECRUIT_FILE, JSON.stringify({ templates: [{ id: "t1", name: "A" }, { id: "t2", name: "B", versionId: "classic" }] }));
        fs.__store.set(POSTS_FILE, JSON.stringify({ posts: [{ id: "p1", channelId: "c", messageId: "m" }] }));
        const { changes } = migrateSettings(quiet);
        expect(changes).toEqual([
            expect.stringContaining("recruitment.json: 1 Vorlage(n)"),
            expect.stringContaining("recruitment-posts.json: 1 Nachricht(en)"),
        ]);
        expect(stored(RECRUIT_FILE).templates.map((t) => t.versionId)).toEqual(["tbc", "classic"]);
        expect(stored(POSTS_FILE).posts[0].versionId).toBe("tbc");
        expect(migrateSettings(quiet)).toEqual({ changes: [] });
    });
});

// #1076: the raid templates go per server; a category default and a series must neither use another
// server's template nor run into nothing afterwards.
describe("stores/settings/settingsMigration raid templates per server (#1076)", () => {
    const SERIES_FILE = settingsPath("event-series.json");
    const NAMES_FILE = settingsPath("category-names.json");
    const A = "1100000000000000001";
    const B = "1100000000000000002";
    const MARK = "raidTemplateReferences";
    // real shape of a stored template, from before the servers
    const TEMPLATE = {
        id: "k1", name: "Karazhan", versionId: "tbc", raidhelperTemplateId: "", instanceIds: ["kara"], size: 10,
        composition: { tank: 2, healer: 3, melee: null, ranged: null }, overflow: "none", lockAtLimit: false,
        requiredBuffs: [], signupDeadline: null, fairness: false, wishes: false, createdAt: 5, updatedAt: 6,
    };
    const load = (servers, over = {}) => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({
            categoryRaidTemplate: { catA: "k1", catB: "k1", catLost: "k1" },
            discordServers: { servers: servers.map((guildId) => ({ guildId, label: "" })), links: [] },
            ...over,
        }));
        fs.__store.set(TEMPLATES_FILE, JSON.stringify({ templates: [TEMPLATE] }));
        fs.__store.set(NAMES_FILE, JSON.stringify({ guilds: { [A]: { catA: "A-Raids" }, [B]: { catB: "B-Raids", catOld: "Alt" } } }));
        fs.__store.set(SERIES_FILE, JSON.stringify({ series: {
            catA: { categoryId: "catA", guildId: A, raidTemplateId: "k1" },
            catB: { categoryId: "catB", guildId: B, raidTemplateId: "k1" },
            // a series from before its guildId: the category's snapshot places it
            catOld: { categoryId: "catOld", guildId: "", raidTemplateId: "k1" },
        } }));
    };
    const defaults = () => stored(CONFIG_FILE).categoryRaidTemplate;
    const seriesOf = () => stored(SERIES_FILE).series;

    it("two servers: each category and series points at the template of its own server", () => {
        load([A, B]);
        const { changes } = migrateSettings(quiet);
        const copy = getRaidTemplate(B, "k1");
        expect(copy.originId).toBe("k1");
        expect(copy.id).not.toBe("k1");
        expect(getRaidTemplate(A, "k1")).toMatchObject({ id: "k1", originId: "" });

        expect(defaults().catA).toBe("k1");
        expect(defaults().catB).toBe(copy.id);
        expect(seriesOf().catA.raidTemplateId).toBe("k1");
        expect(seriesOf().catB.raidTemplateId).toBe(copy.id);
        expect(seriesOf().catOld.raidTemplateId).toBe(copy.id);

        expect(changes).toEqual(expect.arrayContaining([
            expect.stringContaining("raid-templates.json: 1 Vorlage(n) je Server"),
            expect.stringContaining("config.json: 1 Standard-Vorlage(n)"),
            expect.stringContaining("event-series.json:"),
        ]));
    });

    it("a category nothing places keeps its id, says so once, and still finds a template on its server", () => {
        load([A, B]);
        const { changes } = migrateSettings(quiet);
        expect(defaults().catLost).toBe("k1");
        expect(changes).toContainEqual(expect.stringContaining("catLost"));
        // whichever server it turns out to be on: its own template, never a foreign one, never none
        expect(getRaidTemplate(A, defaults().catLost).guildId).toBe(A);
        expect(getRaidTemplate(B, defaults().catLost).guildId).toBe(B);
        expect(migrateSettings(quiet).changes).toEqual([]);
    });

    it("a second start changes nothing", () => {
        load([A, B]);
        migrateSettings(quiet);
        const before = [TEMPLATES_FILE, CONFIG_FILE, SERIES_FILE].map((f) => fs.__store.get(f));
        fs.writeFileSync.mockClear();
        const log = jest.fn();
        expect(migrateSettings({ log })).toEqual({ changes: [] });
        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
        expect([TEMPLATES_FILE, CONFIG_FILE, SERIES_FILE].map((f) => fs.__store.get(f))).toEqual(before);
    });

    it("a run that broke off after the copies goes on at the next start, and only then sets the mark", () => {
        load([A, B]);
        const save = jest.spyOn(eventSeriesStore, "saveSeries").mockImplementationOnce(() => {
            throw new Error("disk full");
        });
        const broken = migrateSettings(quiet);
        save.mockRestore();
        expect(broken.error.message).toBe("disk full");
        // the crash: the copies are there, the series still name the original
        const copy = getRaidTemplate(B, "k1");
        expect(copy.originId).toBe("k1");
        expect(seriesOf().catB.raidTemplateId).toBe("k1");
        expect(isDone(MARK)).toBe(false);

        const { changes } = migrateSettings(quiet);
        expect(changes).toContainEqual(expect.stringContaining("event-series.json:"));
        expect(defaults().catB).toBe(copy.id);
        expect(seriesOf().catB.raidTemplateId).toBe(copy.id);
        expect(seriesOf().catOld.raidTemplateId).toBe(copy.id);
        expect(isDone(MARK)).toBe(true);
    });

    it("the references move once: a later start leaves an id set by hand alone", () => {
        load([A, B]);
        migrateSettings(quiet);
        expect(isDone(MARK)).toBe(true);
        const config = stored(CONFIG_FILE);
        fs.__store.set(CONFIG_FILE, JSON.stringify({ ...config, categoryRaidTemplate: { ...config.categoryRaidTemplate, catB: "k1" } }));
        expect(migrateSettings(quiet).changes).toEqual([]);
        expect(defaults().catB).toBe("k1");
    });

    it("a global entry restored after the mark is copied and moves the references again", () => {
        load([A, B]);
        migrateSettings(quiet);
        const templates = stored(TEMPLATES_FILE);
        fs.__store.set(TEMPLATES_FILE, JSON.stringify({ templates: [...templates.templates, { ...TEMPLATE, id: "k2", name: "Gruul" }] }));
        const config = stored(CONFIG_FILE);
        fs.__store.set(CONFIG_FILE, JSON.stringify({ ...config, categoryRaidTemplate: { ...config.categoryRaidTemplate, catB: "k2" } }));
        migrateSettings(quiet);
        const copy = getRaidTemplate(B, "k2");
        expect(copy.guildId).toBe(B);
        expect(copy.id).not.toBe("k2");
        expect(defaults().catB).toBe(copy.id);
    });

    it("no server listed sets no mark, so the references still move once there is a list", () => {
        load([], { guildId: "g" });
        migrateSettings(quiet);
        expect(isDone(MARK)).toBe(false);
        const config = stored(CONFIG_FILE);
        fs.__store.set(CONFIG_FILE, JSON.stringify({ ...config, discordServers: { servers: [A, B].map((guildId) => ({ guildId, label: "" })), links: [] } }));
        migrateSettings(quiet);
        expect(defaults().catB).toBe(getRaidTemplate(B, "k1").id);
        expect(isDone(MARK)).toBe(true);
    });

    // wrongGuess from the review: a guildId on an event or roster may come from the active session, so
    // it alone proves no server. Real shapes: the older server first, a category made after it.
    describe("a guessed guildId is no proof of the server", () => {
        const OLD = "1354128137792917555";
        const NEW = "1564659371009376266";
        const CAT = "1452671843348516945"; // older than NEW: it cannot be on NEW
        const CAT_NEW = "1564659962913759385"; // younger than both
        const EVENTS_FILE = settingsPath("events.json");
        const RAID_EVENTS_FILE = settingsPath("raid-events.json");
        const ROSTERS_FILE = settingsPath("rosters.json");

        const place = (category, { names = {}, series = {} } = {}) => {
            fs.__store.set(CONFIG_FILE, JSON.stringify({
                categoryRaidTemplate: { [category]: "k1" },
                discordServers: { servers: [OLD, NEW].map((guildId) => ({ guildId, label: "" })), links: [] },
            }));
            fs.__store.set(TEMPLATES_FILE, JSON.stringify({ templates: [TEMPLATE] }));
            fs.__store.set(NAMES_FILE, JSON.stringify({ guilds: names }));
            fs.__store.set(SERIES_FILE, JSON.stringify({ series }));
        };
        const event = (categoryId, guildId) => ({ id: "eh-1", title: "Kara", categoryId, guildId, versionId: "tbc" });

        it.each([
            ["an event", (cat, guild) => fs.__store.set(EVENTS_FILE, JSON.stringify({ events: [event(cat, guild)] }))],
            ["a raid event", (cat, guild) => fs.__store.set(RAID_EVENTS_FILE, JSON.stringify({ events: [event(cat, guild)] }))],
            ["a roster", (cat, guild) => fs.__store.set(ROSTERS_FILE, JSON.stringify({ rosters: { r1: { id: "r1", name: "Kern", categoryId: cat, guildId: guild } } }))],
        ])("%s naming a server younger than its category moves nothing, and the default stays usable", (_what, seed) => {
            place(CAT);
            seed(CAT, NEW);
            const { changes } = migrateSettings(quiet);
            expect(defaults()[CAT]).toBe("k1");
            expect(changes).toContainEqual(expect.stringContaining(`ohne belegten Server behalten ihre Vorlagen-ID (#1076) - ${CAT}`));
            expect(getRaidTemplate(OLD, defaults()[CAT]).guildId).toBe(OLD);
            expect(getRaidTemplate(NEW, defaults()[CAT]).guildId).toBe(NEW);
        });

        it("the snapshot goes before a record that names another server", () => {
            place(CAT_NEW, { names: { [OLD]: { [CAT_NEW]: "Raids" } } });
            fs.__store.set(EVENTS_FILE, JSON.stringify({ events: [event(CAT_NEW, NEW)] }));
            migrateSettings(quiet);
            expect(defaults()[CAT_NEW]).toBe("k1");
        });

        it("a guess that does not fit leaves the category open for the next record", () => {
            place(CAT_NEW);
            fs.__store.set(EVENTS_FILE, JSON.stringify({ events: [event(CAT_NEW, "not-a-server"), { ...event(CAT_NEW, NEW), id: "eh-2" }] }));
            migrateSettings(quiet);
            expect(defaults()[CAT_NEW]).toBe(getRaidTemplate(NEW, "k1").id);
        });

        it("a record that fits still proves the server when the snapshot has no entry", () => {
            place(CAT_NEW);
            fs.__store.set(ROSTERS_FILE, JSON.stringify({ rosters: { r1: { id: "r1", name: "Kern", categoryId: CAT_NEW, guildId: NEW } } }));
            migrateSettings(quiet);
            expect(defaults()[CAT_NEW]).toBe(getRaidTemplate(NEW, "k1").id);
        });

        it("a series' own guessed guildId does not count either, a fitting one does", () => {
            place(CAT, { series: {
                [CAT]: { categoryId: CAT, guildId: NEW, raidTemplateId: "k1" },
                [CAT_NEW]: { categoryId: CAT_NEW, guildId: NEW, raidTemplateId: "k1" },
            } });
            const { changes } = migrateSettings(quiet);
            expect(seriesOf()[CAT].raidTemplateId).toBe("k1");
            expect(seriesOf()[CAT_NEW].raidTemplateId).toBe(getRaidTemplate(NEW, "k1").id);
            expect(changes).toContainEqual(expect.stringContaining("1 Kategorie(n) ohne belegten Server"));
        });
    });

    it("a single server: same ids, nothing to repoint", () => {
        load([A]);
        const { changes } = migrateSettings(quiet);
        expect(listRaidTemplates(A).map((t) => t.id)).toEqual(["k1"]);
        expect(defaults()).toEqual({ catA: "k1", catB: "k1", catLost: "k1" });
        expect(seriesOf().catB.raidTemplateId).toBe("k1");
        expect(changes.filter((line) => line.includes("#1076"))).toHaveLength(1);
    });

    it("no server listed: the templates stay stored, nothing moves, and a later start takes them over", () => {
        load([], { guildId: "g" });
        const warn = jest.fn();
        const { changes } = migrateSettings({ log: () => {}, warn });
        expect(changes).toContainEqual(expect.stringContaining(": WARNUNG "));
        expect(stored(TEMPLATES_FILE).templates).toEqual([TEMPLATE]);
        expect(defaults()).toEqual({ catA: "k1", catB: "k1", catLost: "k1" });

        const config = stored(CONFIG_FILE);
        fs.__store.set(CONFIG_FILE, JSON.stringify({ ...config, discordServers: { servers: [{ guildId: A, label: "" }], links: [] } }));
        migrateSettings(quiet);
        expect(listRaidTemplates(A).map((t) => t.id)).toEqual(["k1"]);
    });
});

// #917: every log is written down with its server - raid, else origin server, else first server.
describe("stores/settings/settingsMigration log servers (#917)", () => {
    const LOGS_FILE = settingsPath("logs.json");
    const A = "1100000000000000001";
    const B = "1100000000000000002";
    const C = "1100000000000000003";
    const CONFIG = { guildId: C, discordServers: { servers: [{ guildId: A, label: "" }, { guildId: B, label: "" }], links: [] } };
    const LOGS = { logs: [
        { id: "l1", reportId: "R1", guildId: A, channelId: "ch1", eventId: "eh-1" }, // own raid on B
        { id: "l2", reportId: "R2", guildId: A, channelId: "ch1", eventId: "rh-9" }, // Raid-Helper raid, category on B
        { id: "l3", reportId: "R3", guildId: B, channelId: "ch2" }, // post on B, no raid
        { id: "l4", reportId: "R4", guildId: "" }, // neither: first server
        { id: "l5", reportId: "R5", guildId: B, eventId: "gone" }, // manual log, its raid is not found: keeps the server it was added on
    ] };

    function load() {
        fs.__store.set(CONFIG_FILE, JSON.stringify(CONFIG));
        fs.__store.set(LOGS_FILE, JSON.stringify(LOGS));
        fs.__store.set(settingsPath("events.json"), JSON.stringify({ events: [{ id: "eh-1", title: "Kara", guildId: B }] }));
        fs.__store.set(settingsPath("raid-events.json"), JSON.stringify({ events: [{ id: "rh-9", title: "SSC", categoryId: "cat9" }] }));
        fs.__store.set(settingsPath("category-names.json"), JSON.stringify({ guilds: { [B]: { cat9: "Raids" } } }));
    }
    const byId = () => Object.fromEntries(stored(LOGS_FILE).logs.map((l) => [l.id, l]));
    const line = (n) => `logs.json: ${n} Log(s) ihrem Discord-Server fest zugeordnet (#917)`;

    it("assigns raid before origin server before first server", () => {
        load();
        const { changes } = migrateSettings(quiet);
        expect(changes).toContain(line(5));
        const logs = byId();
        expect(logs.l1).toMatchObject({ guildId: B, guildFrom: "event", postGuildId: A });
        expect(logs.l2).toMatchObject({ guildId: B, guildFrom: "event", postGuildId: A });
        expect(logs.l3).toMatchObject({ guildId: B, guildFrom: "channel", postGuildId: B });
        expect(logs.l4).toMatchObject({ guildId: A, guildFrom: "first" });
        expect(logs.l5).toMatchObject({ guildId: B, guildFrom: "channel", postGuildId: B });
        expect(logs.l4).not.toHaveProperty("postGuildId");
    });

    it("a second start changes nothing and the server list stays as it was", () => {
        load();
        migrateSettings(quiet);
        const logsBefore = fs.__store.get(LOGS_FILE);
        fs.writeFileSync.mockClear();
        expect(migrateSettings(quiet).changes).toEqual([]);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(fs.__store.get(LOGS_FILE)).toBe(logsBefore);
        expect(getConfig().discordServers.servers.map((s) => s.guildId)).toEqual([A, B]);
        expect(stored(CONFIG_FILE).discordServers.servers.map((s) => s.guildId)).toEqual([A, B]);
    });

    it("a log unlinked since falls back to the server of its post", () => {
        load();
        migrateSettings(quiet);
        const logs = stored(LOGS_FILE).logs.map((l) => {
            if (l.id !== "l1") return l;
            const rest = { ...l };
            delete rest.eventId;
            return rest;
        });
        fs.__store.set(LOGS_FILE, JSON.stringify({ logs }));
        expect(migrateSettings(quiet).changes).toEqual([line(1)]);
        expect(byId().l1).toMatchObject({ guildId: A, guildFrom: "channel", postGuildId: A });
    });

    it("without a server list the home guild is the first server", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: C }));
        fs.__store.set(LOGS_FILE, JSON.stringify({ logs: [{ id: "l4", reportId: "R4", guildId: "" }] }));
        migrateSettings(quiet);
        expect(byId().l4).toMatchObject({ guildId: C, guildFrom: "first" });
    });
});
