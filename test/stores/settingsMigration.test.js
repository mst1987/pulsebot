jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const {
    migrateSettings, legacyEventGuilds, migrateDiscordServers, migrateCategoryRaidTemplate, raidplanDefaultsLine,
} = require("../../src/stores/settingsMigration");
const { getConfig } = require("../../src/stores/configStore");
const { listRaidTemplates } = require("../../src/stores/raidTemplateStore");

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

describe("stores/settingsMigration migrateSettings (#420)", () => {
    it("upgrades an old install once and logs every change", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(OLD_CONFIG));
        fs.__store.set(TEMPLATES_FILE, JSON.stringify(OLD_TEMPLATES));
        const log = jest.fn();
        const { changes } = migrateSettings({ log });
        // the four upgrades of the old install, plus the planning of its two raid categories (nothing used yet: raid plan)
        expect(changes).toHaveLength(5);
        expect(changes[4]).toBe("config.json: Planung je Raid-Kategorie nach der bisherigen Nutzung festgelegt (Raidplan oder Sheet) - c1 raidplan, c2 raidplan");
        expect(log).toHaveBeenCalledTimes(5);
        expect(log.mock.calls.every(([line]) => line.startsWith("[settings] Migration: "))).toBe(true);

        expect(stored(TEMPLATES_FILE).templates[0]).toMatchObject({ id: "rh-3", raidhelperTemplateId: "3" });
        const config = stored(CONFIG_FILE);
        expect(config.discordServers.eventGuilds).toEqual([
            { guildId: "1100000000000000001", label: "", overviewGuildId: "1100000000000000002", overviewChannelId: "1100000000000000003" },
        ]);
        expect(config.categoryRaidTemplate).toEqual({ c1: "rh-3", c2: "rh-3" });
        // everything else stays as it was
        expect(config.raidDefaults).toEqual(OLD_CONFIG.raidDefaults);
        expect(getConfig().categoryRaidTemplate).toEqual({ c1: "rh-3", c2: "rh-3" });
        expect(getConfig().discordServers.eventGuilds).toHaveLength(1);
        expect(listRaidTemplates()[0].id).toBe("rh-3");
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

    it("writes nothing for a fresh install", () => {
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
describe("stores/settingsMigration overflow -> none (#516)", () => {
    const EVENTS_FILE = settingsPath("events.json");
    const { getEvent } = require("../../src/stores/eventStore");
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
        ]);
        expect(log).toHaveBeenCalledTimes(2);
        const events = stored(EVENTS_FILE).events;
        expect(events[0]).toEqual({ ...OLD_EVENTS.events[0], overflow: "none", lockAtLimit: false });
        expect(events[1]).toEqual({ ...OLD_EVENTS.events[1], overflow: "none", lockAtLimit: false });
        expect(events[2]).toEqual(OLD_EVENTS.events[2]);
        // a raid the old rule already closed stays closed - that is the orga's call
        expect(getEvent("eh-a")).toMatchObject({ overflow: "none", lockAtLimit: false, signupsClosed: true });
        const templates = stored(TEMPLATES_FILE).templates;
        expect(templates[0]).toEqual({ ...OLD_TPL.templates[0], overflow: "none", lockAtLimit: false });
        expect(templates[1]).toEqual(OLD_TPL.templates[1]);
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

describe("stores/settingsMigration steps", () => {
    it("legacyEventGuilds builds one entry from an event server, none without", () => {
        expect(legacyEventGuilds({ eventGuildId: " 111111 " })).toEqual([{ guildId: "111111", label: "", overviewGuildId: "", overviewChannelId: "" }]);
        expect(legacyEventGuilds({ talkGuildId: "222222" })).toEqual([]);
        expect(legacyEventGuilds(undefined)).toEqual([]);
    });

    it("migrateDiscordServers leaves a list, a missing block and a block without event server alone", () => {
        expect(migrateDiscordServers({ eventGuilds: [], eventGuildId: "111111" })).toBeNull();
        expect(migrateDiscordServers(undefined)).toBeNull();
        expect(migrateDiscordServers(["x"])).toBeNull();
        expect(migrateDiscordServers({ talkGuildId: "222222" })).toBeNull();
        expect(migrateDiscordServers({ eventGuildId: "111111", talkPingChannelId: "5" })).toMatchObject({ talkPingChannelId: "5", eventGuilds: [{ guildId: "111111" }] });
    });

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

describe("stores/settingsMigration: the raid plans' Standard (#524)", () => {
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
describe("stores/settingsMigration standard values and recruitment versions (#553)", () => {
    const { migrateVersionDefaults } = require("../../src/stores/settingsMigration");
    const { normalizeBlock } = require("../../src/stores/versionSettingsSchema");
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
        expect(config.versionDefaultsApplied).toEqual(["tbc", "classic"]);
        expect(config.versionSettings.classic).toMatchObject({ wowheadPath: "classic-own", softresEdition: "classic", blizzardNamespace: "profile-classic1x-eu", blizzardRealmSlug: "" });
        expect(config.versionSettings.tbc).toMatchObject({ blizzardRealmSlug: "thunderstrike", wowheadPath: "tbc", softresEdition: "tbc", blizzardNamespace: "profile-classicann-eu" });
        expect(config.versionSettings.forever).toEqual(EMPTY);
        // the links work with the TBC realm, and stay out for Classic without one
        const { versionLinks } = require("../../src/services/events/versionSettings");
        expect(versionLinks("tbc").wcl("Nera")).toBe("https://fresh.warcraftlogs.com/character/eu/thunderstrike/Nera");
        expect(versionLinks("classic").wcl("Nera")).toBe("");

        fs.writeFileSync.mockClear();
        expect(migrateSettings(quiet)).toEqual({ changes: [] });
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("never fills a field again once the version is listed (cleared on purpose)", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(current({ versionDefaultsApplied: ["tbc", "classic"] })));
        expect(migrateSettings(quiet)).toEqual({ changes: [] });
        expect(stored(CONFIG_FILE).versionSettings.classic.softresEdition).toBe("");
    });

    it("fills a version that was not listed yet and keeps the others", () => {
        const out = migrateVersionDefaults(current({ versionDefaultsApplied: ["tbc"] }));
        expect(out.versionDefaultsApplied).toEqual(["tbc", "classic"]);
        expect(Object.keys(out.filled)).toEqual(["classic"]);
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
