// Golden master for the config split (#420): test/fixtures/configSchema/
// golden.json is what getConfig() and listRaidTemplates() returned for the
// states in cases.json BEFORE settingsStore.js was split and the upgrades left
// the read path. After the split a current file must read the same straight
// away, an old one after the one start-up migration.
//
// The defaults come from the env (GUILD_ID, BLIZZARD_*, ...); they are cleared
// before anything loads, exactly as when the fixture was frozen.
const ENV_KEYS = ["GUILD_ID", "RAIDHELPER_SERVER_ID", "OFFICER_ROLE_ID", "APPLICATION_CHANNEL_ID", "GOOGLE_SPREADSHEET_ID",
    "GOOGLE_SHEET_NAME", "GOOGLE_SHEET_GID", "BLIZZARD_CLIENT_ID", "BLIZZARD_CLIENT_SECRET", "BLIZZARD_REGION", "BLIZZARD_REALM",
    "BLIZZARD_NAMESPACE", "ADMIN_ROLE_IDS"];
for (const key of ENV_KEYS) delete process.env[key];

jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const schema = require("../../src/stores/configSchema");
const { getConfig } = require("../../src/stores/configStore");
const { listRaidTemplates } = require("../../src/stores/raidTemplateStore");
const { migrateSettings } = require("../../src/stores/settingsMigration");
const cases = require("../fixtures/configSchema/cases.json");
const frozen = require("../fixtures/configSchema/golden.json");
const defaults = require("../../src/config/defaults");
const { defaultAddons } = require("../../src/services/addons/addonConfig");

// #542 moved the Battle.net realm (region, realm slug, namespace) out of
// `blizzard` into the TBC block of `versionSettings`, next to the armory/WCL
// templates, Wowhead "tbc" and softres "tbc"; the other versions are empty.
// #553 adds the standard values of the other versions (Classic's; Forever has
// none) and the list of versions they were handed to.
// The frozen result stays as it was frozen; these are the documented changes
// on top of it.
const EMPTY_BLOCK = {
    blizzardRegion: "", blizzardRealmSlug: "", blizzardNamespace: "", armoryUrlTemplate: "",
    wclUrlTemplate: "", wowheadPath: "", softresEdition: "", raidsheetId: "", color: "",
};
function after542(config) {
    const { region, realmSlug, namespace, ...credentials } = config.blizzard;
    const tbc = {
        blizzardRegion: region, blizzardRealmSlug: realmSlug, blizzardNamespace: namespace || `profile-classicann-${region}`,
        armoryUrlTemplate: defaults.applyArmoryUrlTemplate, wclUrlTemplate: defaults.applyWclUrlTemplate,
        wowheadPath: "tbc", softresEdition: "tbc", raidsheetId: "", color: "",
    };
    const classic = {
        blizzardRegion: "eu", blizzardRealmSlug: "", blizzardNamespace: "profile-classic1x-eu",
        armoryUrlTemplate: "https://classic-armory.org/character/{region}/vanilla/{realm}/{char}",
        wclUrlTemplate: "https://vanilla.warcraftlogs.com/character/{region}/{realm}/{char}",
        wowheadPath: "classic", softresEdition: "classic", raidsheetId: "", color: "",
    };
    return {
        ...config, blizzard: credentials, versionSettings: { tbc, classic, forever: { ...EMPTY_BLOCK, blizzardRegion: "eu", wowheadPath: "forever" } },
        versionDefaultsApplied: ["tbc", "classic", "forever"],
    };
}
// Raidplan ODER Sheet: the start fixes every raid category's planning by what it
// used (settingsMigration.migrateCategoryPlanning); these installs used nothing,
// so a category with a fixed sheet plans with the sheet, every other with the raid plan.
// Only the categories the stored file names (a missing file has none — the defaults are not migrated).
function afterPlanning(config, stored = {}) {
    const planning = { ...(config.categoryPlanning || {}) };
    for (const cat of Array.isArray(stored.categoryIds) ? stored.categoryIds : []) {
        if (planning[cat]) continue;
        const sheet = (stored.categorySheets || {})[cat];
        planning[cat] = sheet && sheet.url ? "sheet" : "raidplan";
    }
    return { ...config, categoryPlanning: planning };
}
// #691 adds the data snapshots' schedule and retention with their defaults, #694 the restore probe's slot.
const BACKUP_DEFAULTS = {
    intervalMinutes: 60,
    retention: { hourlyHours: 48, dailyDays: 14, weeklyWeeks: 8, monthlyMonths: 12, deployKeep: 10, manualKeep: 10, preRestoreKeep: 10 },
    restoreTest: { weekday: 3, time: "04:30" },
};
const after691 = (config) => ({ ...config, backup: BACKUP_DEFAULTS });
// Oct 2026 adds the roles that count as orga (Einstellungen → Berechtigungen), none by default.
const afterOrgaRoles = (config) => ({ ...config, orgaRoleIds: [] });
// #738 adds the section history per category (empty until a category switches its version).
const afterEras = (config) => ({ ...config, categoryEras: {} });
// #745 adds the hand-made marks of the checklist "Neue Version starten" (empty until one is ticked off).
const afterLaunch = (config) => ({ ...config, versionLaunch: {} });
// Oct 2026 adds the drawn pictures in bot messages (a test), every one on by default.
const afterVisuals = (config) => ({ ...config, discordVisuals: { overviewWeekStrip: true, setupImage: true, eventCover: true } });
// Oct 2026 adds the characters per signup per category (empty: every category allows the default 8).
const afterSignupCharacters = (config) => ({ ...config, categorySignupCharacters: {} });
// Oct 2026 adds the dungeon record post (Einstellungen -> Dungeon-Bestzeiten), off by default.
const afterDungeonRecords = (config) => ({ ...config, dungeonRecords: { post: false, channelId: "" } });
// #738: the start pins every active category to the version it plays (the main version) -
// only for a stored file (a missing one is never written).
function afterCategoryVersions(config, stored) {
    if (!stored || !Object.keys(stored).length) return config;
    const map = { ...(config.categoryVersion || {}) };
    for (const id of Array.isArray(stored.categoryIds) ? stored.categoryIds : []) if (!map[id]) map[id] = config.mainVersion;
    return { ...config, categoryVersion: map };
}
// #818 adds the GitHub token (none) and the addons of the page "Addons" (the three own addons by default,
// not edited by an admin: an empty list without that mark reads as the defaults again).
const afterAddons = (config) => ({ ...config, github: { token: "" }, addonDownloads: defaultAddons(), addonDownloadsCustomized: false });
// #890 replaces the event-server list by the server federation: every event server keeps its label in
// `servers`, its overview target becomes a link (the target server joins `servers` when missing), the talk
// server is appended when it is no server yet - behind the home guild (config.guildId) when there was no
// event server, so the home guild stays the first server.
function after890(config) {
    const { eventGuilds, ...rest } = config.discordServers;
    const servers = eventGuilds.map((e) => ({ guildId: e.guildId, label: e.label }));
    if (!servers.length && rest.talkGuildId && config.guildId && config.guildId !== rest.talkGuildId) servers.push({ guildId: config.guildId, label: "" });
    const links = [];
    for (const e of eventGuilds) {
        if (!e.overviewGuildId || !e.overviewChannelId) continue;
        if (!servers.some((x) => x.guildId === e.overviewGuildId)) servers.push({ guildId: e.overviewGuildId, label: "" });
        links.push({ from: e.guildId, to: e.overviewGuildId, channelId: e.overviewChannelId, lang: "", versions: [] });
    }
    if (rest.talkGuildId && !servers.some((x) => x.guildId === rest.talkGuildId)) servers.push({ guildId: rest.talkGuildId, label: "" });
    return { ...config, discordServers: { ...rest, servers, links } };
}
// #894: pings and reminders stay on the raid's server - the talk server's ping channel and the
// `target` of reminders and announcements are gone (an old one is dropped on read).
function after894(config) {
    const servers = { ...config.discordServers };
    delete servers.talkPingChannelId;
    const dropTarget = (map) => Object.fromEntries(Object.entries(map || {}).map(([k, v]) => {
        const rest = { ...v };
        delete rest.target;
        return [k, rest];
    }));
    return {
        ...config, discordServers: servers,
        categoryReminders: dropTarget(config.categoryReminders), categoryAnnounce: dropTarget(config.categoryAnnounce),
    };
}
// #896 turns the role sync into pairs of servers: the event role belongs to the first server, the talk role to
// the talk server, "toTalk"/"toEvent" become "toTarget"/"toSource". Without a talk server, or when the talk
// server is the first server, the old pair names no two servers and is dropped.
const DIRECTION_896 = { toTalk: "toTarget", toEvent: "toSource", both: "both" };
function after896(config) {
    const from = (config.discordServers.servers[0] || {}).guildId || "";
    const to = config.discordServers.talkGuildId || "";
    const roleSync = from && to && from !== to
        ? config.roleSync.map((r) => ({ fromGuildId: from, fromRoleId: r.eventRoleId, toGuildId: to, toRoleId: r.talkRoleId, direction: DIRECTION_896[r.direction] }))
        : [];
    return { ...config, roleSync };
}
// #897 removes the talk server: its id is already one of `servers` (after890), the field itself is gone.
function after897(config) {
    const servers = { ...config.discordServers };
    delete servers.talkGuildId;
    return { ...config, discordServers: servers };
}
// #917 adds the settings per Discord server (none stored: empty).
const after917 = (config) => ({ ...config, serverSettings: {} });
// #924: the application channel, the officer role, the raid defaults, the bot language and the two signup
// channels of the server block are per server - on read the global fields are gone.
const GLOBAL_924 = ["applicationChannelId", "officerRoleId", "raidDefaults", "botLanguage"];
function after924(config) {
    const out = { ...config };
    for (const key of GLOBAL_924) delete out[key];
    const servers = { ...config.discordServers };
    delete servers.signupNoteChannelId;
    delete servers.guildBankChannelId;
    return { ...out, discordServers: servers };
}
// The start moves a stored value into serverSettings: raid defaults and language onto every known server,
// a channel or role onto its server - the stores of these cases are empty, so onto the first server.
function after924Migrated(config, stored) {
    if (!stored || !Object.keys(stored).length) return config;
    const snowflake = (v) => (/^\d{5,25}$/.test(String(v || "").trim()) ? String(v).trim() : "");
    const block = config.discordServers;
    const home = (block.servers[0] && block.servers[0].guildId) || config.guildId;
    const known = [...new Set([...block.servers.map((x) => x.guildId), ...block.links.map((l) => l.to), home])];
    const next = {};
    const set = (guildId, key, value) => { next[guildId] = { ...(next[guildId] || {}), [key]: value }; };
    if (stored.raidDefaults !== undefined) for (const id of known) set(id, "raidDefaults", { channelId: String((stored.raidDefaults || {}).channelId || "").trim() });
    if (stored.botLanguage !== undefined) for (const id of known) set(id, "botLanguage", stored.botLanguage === "en" ? "en" : "de");
    const src = stored.discordServers && typeof stored.discordServers === "object" && !Array.isArray(stored.discordServers) ? stored.discordServers : {};
    const one = { applicationChannelId: stored.applicationChannelId, officerRoleId: stored.officerRoleId };
    for (const [key, value] of Object.entries(one)) if (snowflake(value)) set(known[0], key, snowflake(value));
    // the fixtures prove no channel's server, so the two signup channels go onto every known server
    const every = { signupNoteChannelId: src.signupNoteChannelId, guildBankChannelId: src.guildBankChannelId };
    for (const [key, value] of Object.entries(every)) if (snowflake(value)) for (const id of known) set(id, key, snowflake(value));
    return { ...config, serverSettings: next };
}
const schemaOnly = frozen.map((g) => ({ ...g, config: after924(after917(after897(after896(after894(after890(afterAddons(afterDungeonRecords(afterSignupCharacters(afterVisuals(afterLaunch(afterEras(afterOrgaRoles(after691(after542(g.config))))))))))))))) }));
const golden = schemaOnly.map((g, i) => ({ ...g, config: after924Migrated(afterCategoryVersions(afterPlanning(g.config, cases[i].config || {}), cases[i].config), cases[i].config) }));
const without542 = (changes) => changes.filter((line) => !line.includes("(#542)") && !line.includes("(#553)") && !line.includes("Planung je Raid-Kategorie") && !line.includes("(#738)") && !line.includes("(#897)") && !line.includes("(#924)"));

const CONFIG_FILE = settingsPath("config.json");
const TEMPLATES_FILE = settingsPath("raid-templates.json");

function load(c) {
    fs.__store.clear();
    if (c.config) fs.__store.set(CONFIG_FILE, JSON.stringify(c.config));
    if (c.raidTemplates) fs.__store.set(TEMPLATES_FILE, JSON.stringify(c.raidTemplates));
}

beforeEach(() => {
    // migrateLegacy stamps a template without timestamps with Date.now()
    jest.spyOn(Date, "now").mockReturnValue(1700000000000);
});

afterEach(() => {
    Date.now.mockRestore();
});

describe("stores/configSchema golden master (#420)", () => {
    it("has one frozen result per case", () => {
        expect(golden.map((g) => g.name)).toEqual(cases.map((c) => c.name));
    });

    describe.each(cases.map((c, i) => [c.name, c, golden[i], schemaOnly[i]]))("%s", (_name, c, expected, readOnly) => {
        it("reads the same as before the split once the start-up migration ran", () => {
            load(c);
            migrateSettings({ log: () => {} });
            expect(listRaidTemplates()).toEqual(expected.raidTemplates);
            expect(getConfig()).toEqual(expected.config);
        });

        if (!c.legacy) {
            it("needs no migration: the schema alone gives the frozen result", () => {
                load(c);
                const { changes } = migrateSettings({ log: () => {} });
                // every stored config predates #542's versionSettings (see after542) and the planning per category (afterPlanning)
                expect(without542(changes)).toEqual([]);
                expect(schema.normalizeConfig(c.config || {})).toEqual(readOnly.config);
            });
        }

        it("a second start migrates nothing and writes nothing", () => {
            load(c);
            migrateSettings({ log: () => {} });
            fs.writeFileSync.mockClear();
            expect(migrateSettings({ log: () => {} }).changes).toEqual([]);
            expect(fs.writeFileSync).not.toHaveBeenCalled();
            expect(getConfig()).toEqual(expected.config);
        });
    });
});

describe("stores/configSchema normalisers", () => {
    it("normalizeConfig treats anything but an object as an empty file", () => {
        const empty = schema.normalizeConfig({});
        expect(schema.normalizeConfig(null)).toEqual(empty);
        expect(schema.normalizeConfig([1, 2])).toEqual(empty);
        expect(schema.normalizeConfig("x")).toEqual(empty);
    });

    it("normalizeVersionLaunch keeps known versions and the manual items only (#745)", () => {
        expect(schema.normalizeVersionLaunch({
            forever: { talk: { at: "5", byName: "Orga" }, rosters: { at: 1 }, export: null },
            nope: { talk: { at: 1 } },
            tbc: {},
        })).toEqual({ forever: { talk: { at: 5, byName: "Orga" } } });
        expect(schema.normalizeVersionLaunch([1])).toEqual({});
        expect(schema.VERSION_LAUNCH_MANUAL).toEqual(["backup", "export", "lootAddon", "talk"]);
    });

    it("normalizeEventGuilds ignores everything but a list (no legacy fallback in the read path)", () => {
        expect(schema.normalizeEventGuilds(undefined)).toEqual([]);
        expect(schema.normalizeDiscordServers({ eventGuildId: "111111" }).servers).toEqual([]);
    });

    it("caps the event-server list", () => {
        const list = Array.from({ length: 12 }, (_, i) => ({ guildId: String(111111 + i) }));
        expect(schema.normalizeEventGuilds(list)).toHaveLength(10);
    });

    it("normalizeCategoryRaidTemplate keeps trimmed, non-empty entries only", () => {
        expect(schema.normalizeCategoryRaidTemplate({ " a ": " t1 ", b: "", c: null })).toEqual({ a: "t1" });
        expect(schema.normalizeCategoryRaidTemplate(["x"])).toEqual({});
        expect(schema.normalizeCategoryRaidTemplate(undefined)).toEqual({});
    });

    it("configuredCategoryIds collects every category an install configured anything for", () => {
        expect(schema.configuredCategoryIds({ categoryIds: ["1"], categoryRoles: { 2: [] }, categorySheets: { "": {} } }).sort()).toEqual(["1", "2"]);
    });

    it("signupSourcesOf pins the known categories of an install from before #291", () => {
        expect(schema.signupSourcesOf({ categoryIds: ["1"] })).toEqual({ categorySignupSource: { 1: "raidhelper" }, signupSourceDefault: "eventhelper" });
        expect(schema.signupSourcesOf({ categoryIds: [] })).toEqual({ categorySignupSource: {}, signupSourceDefault: "raidhelper" });
        expect(schema.signupSourcesOf({})).toEqual({ categorySignupSource: {}, signupSourceDefault: "eventhelper" });
    });
});

describe("stores/configSchema server federation (#890)", () => {
    const A = "111111111111111111";
    const B = "222222222222222222";
    const T = "333333333333333333";
    const C1 = "444444444444444444";
    const C2 = "555555555555555555";

    describe("migrates every old shape on read", () => {
        it("only event servers: they become the servers, labels kept, no links", () => {
            expect(schema.normalizeDiscordServers({ eventGuilds: [{ guildId: A, label: "PvE" }, { guildId: B }] })).toEqual({
                // #924: the two signup channels are per server, not in this block
                servers: [{ guildId: A, label: "PvE" }, { guildId: B, label: "" }], links: [],
            });
        });

        // #897: the talk server is an ordinary server, the field itself is gone
        it("with a talk server: it joins the servers at the end, without a talk field", () => {
            const out = schema.normalizeDiscordServers({ eventGuilds: [{ guildId: A }], talkGuildId: T, talkPingChannelId: C1 });
            expect(out.servers.map((x) => x.guildId)).toEqual([A, T]);
            expect(out).not.toHaveProperty("talkGuildId");
            // #894: the talk server's ping channel is gone, an old one is dropped
            expect(out).not.toHaveProperty("talkPingChannelId");
        });

        it("an overview target on another server becomes a link, the target does not become a server", () => {
            const out = schema.normalizeDiscordServers({
                eventGuilds: [{ guildId: A, overviewGuildId: B, overviewChannelId: C1 }],
            });
            expect(out.servers.map((x) => x.guildId)).toEqual([A]);
            expect(out.links).toEqual([{ from: A, to: B, channelId: C1, lang: "", versions: [] }]);
        });

        it("an overview target on the talk server links to the talk server (no duplicate server)", () => {
            const out = schema.normalizeDiscordServers({
                eventGuilds: [{ guildId: A, overviewGuildId: T, overviewChannelId: C1 }], talkGuildId: T,
            });
            expect(out.servers.map((x) => x.guildId)).toEqual([A, T]);
            expect(out.links).toEqual([{ from: A, to: T, channelId: C1, lang: "", versions: [] }]);
        });

        it("an overview target on the own server becomes a link from = to", () => {
            const out = schema.normalizeDiscordServers({ eventGuilds: [{ guildId: A, overviewGuildId: A, overviewChannelId: C1 }] });
            expect(out.servers.map((x) => x.guildId)).toEqual([A]);
            expect(out.links).toEqual([{ from: A, to: A, channelId: C1, lang: "", versions: [] }]);
        });

        it("talk = event server: one server, kept once", () => {
            const out = schema.normalizeDiscordServers({ eventGuilds: [{ guildId: A, label: "Alles" }], talkGuildId: A });
            expect(out).not.toHaveProperty("talkGuildId");
            expect(out.servers).toEqual([{ guildId: A, label: "Alles" }]);
        });

        it("a talk server without event server keeps the home guild first", () => {
            expect(schema.normalizeDiscordServers({ talkGuildId: T }, { fallbackGuildId: A }).servers.map((x) => x.guildId)).toEqual([A, T]);
            expect(schema.normalizeDiscordServers({ talkGuildId: T }, { fallbackGuildId: T }).servers.map((x) => x.guildId)).toEqual([T]);
            expect(schema.normalizeDiscordServers({}, { fallbackGuildId: A }).servers).toEqual([]);
        });

        it("is idempotent: a second run over the result changes nothing", () => {
            const olds = [
                { eventGuilds: [{ guildId: A, label: "PvE" }] },
                { eventGuilds: [{ guildId: A, overviewGuildId: T, overviewChannelId: C1 }, { guildId: B, overviewGuildId: B, overviewChannelId: C2 }], talkGuildId: T, talkPingChannelId: C1 },
                { eventGuilds: [{ guildId: A }], talkGuildId: A },
                { talkGuildId: T },
                {},
            ];
            for (const old of olds) {
                const once = schema.normalizeDiscordServers(old, { fallbackGuildId: B });
                expect(schema.normalizeDiscordServers(once, { fallbackGuildId: B })).toEqual(once);
                expect(schema.normalizeConfig({ discordServers: once })).toEqual(schema.normalizeConfig(schema.normalizeConfig({ discordServers: once })));
            }
        });

        it("guildId points to the first server", () => {
            expect(schema.normalizeConfig({ guildId: T, discordServers: { servers: [{ guildId: B }, { guildId: A }] } }).guildId).toBe(B);
            expect(schema.normalizeConfig({ guildId: T, discordServers: { servers: [] } }).guildId).toBe(T);
        });
    });

    describe("servers", () => {
        it("drops non-snowflakes and duplicates (first wins) and caps at 10", () => {
            const list = [{ guildId: A, label: "erst" }, { guildId: A, label: "zweit" }, { guildId: "nope" }, null,
                ...Array.from({ length: 12 }, (_, i) => ({ guildId: String(600000 + i) }))];
            const out = schema.normalizeServers(list);
            expect(out).toHaveLength(schema.MAX_SERVERS);
            expect(out[0]).toEqual({ guildId: A, label: "erst" });
        });

        // the migration warns about this one (settingsMigration.migrateDiscordFederation)
        it("does not append the talk server once 10 servers are set", () => {
            const servers = Array.from({ length: 10 }, (_, i) => ({ guildId: String(600000 + i) }));
            expect(schema.normalizeDiscordServers({ servers, talkGuildId: T }).servers.map((x) => x.guildId)).not.toContain(T);
        });
    });

    describe("links", () => {
        const servers = [{ guildId: A }, { guildId: B }];

        it("drops a link from an unknown server, keeps one to a target outside the servers", () => {
            const out = schema.normalizeDiscordServers({ servers, links: [
                { from: A, to: T, channelId: C1 }, { from: T, to: A, channelId: C1 }, { from: A, to: "nope", channelId: C1 },
            ] });
            expect(out.links).toEqual([{ from: A, to: T, channelId: C1, lang: "", versions: [] }]);
            expect(out.servers.map((x) => x.guildId)).toEqual([A, B]);
        });

        const link = (from, to, channelId, extra = {}) => ({ from, to, channelId, lang: "", versions: [], ...extra });

        it("keeps the list language de/en, anything else falls back to the server language (\"\")", () => {
            expect(schema.normalizeLinks([
                { from: A, to: B, channelId: C1, lang: "en" }, { from: A, to: A, channelId: C1, lang: " DE " },
                { from: B, to: A, channelId: C1, lang: "fr" }, { from: B, to: B, channelId: C1 },
            ], [A, B])).toEqual([
                link(A, B, C1, { lang: "en" }), link(A, A, C1, { lang: "de" }), link(B, A, C1), link(B, B, C1),
            ]);
        });

        it("keeps known game versions only, without duplicates; missing means all ([])", () => {
            expect(schema.normalizeLinks([
                { from: A, to: B, channelId: C1, versions: ["forever", "tbc", "forever", "wotlk", 7, null] },
                { from: A, to: A, channelId: C1, versions: "tbc" },
                { from: B, to: A, channelId: C1 },
            ], [A, B])).toEqual([
                link(A, B, C1, { versions: ["forever", "tbc"] }), link(A, A, C1), link(B, A, C1),
            ]);
        });

        it("keeps language and versions through a second normalisation (idempotent)", () => {
            const once = schema.normalizeDiscordServers({ servers, links: [{ from: A, to: B, channelId: C1, lang: "en", versions: ["classic"] }] });
            expect(once.links).toEqual([link(A, B, C1, { lang: "en", versions: ["classic"] })]);
            expect(schema.normalizeDiscordServers(once)).toEqual(once);
        });

        it("drops a link without a channel", () => {
            expect(schema.normalizeLinks([{ from: A, to: B }, { from: A, to: B, channelId: "x" }], [A, B])).toEqual([]);
        });

        it("drops a second link for the same pair (first wins), allows from = to", () => {
            expect(schema.normalizeLinks([
                { from: A, to: B, channelId: C1 }, { from: A, to: B, channelId: C2 }, { from: A, to: A, channelId: C2 }, { from: B, to: A, channelId: C2 }, "x",
            ], [A, B])).toEqual([
                link(A, B, C1), link(A, A, C2), link(B, A, C2),
            ]);
        });
    });
});

describe("stores/configSchema server settings (#917)", () => {
    const A = "111111111111111111";
    const B = "222222222222222222";
    const T = "333333333333333333";
    const U = "444444444444444444";
    const servers = { servers: [{ guildId: A, label: "" }, { guildId: B, label: "" }], links: [{ from: A, to: T, channelId: "555555555555555555" }] };
    const KEYS = { lang: "de", pingRoleId: "" };

    it("keeps blocks of servers and pure link targets, drops unknown servers", () => {
        const out = schema.normalizeServerSettings({ [A]: { lang: "en" }, [T]: { lang: "de" }, [U]: { lang: "fr" } }, servers, A, KEYS);
        expect(out).toEqual({ [A]: { lang: "en" }, [T]: { lang: "de" } });
    });

    it("drops keys no part owns and keeps an empty block empty", () => {
        expect(schema.normalizeServerSettings({ [A]: { lang: "en", nope: 1 }, [B]: {} }, servers, A, KEYS)).toEqual({ [A]: { lang: "en" }, [B]: {} });
        // no part owns a key yet: every stored key is dropped, the block stays
        expect(schema.normalizeServerSettings({ [A]: { lang: "en" } }, servers, A)).toEqual({ [A]: {} });
    });

    it("turns anything but an object into an empty block / an empty map", () => {
        expect(schema.normalizeServerSettings({ [A]: "x", [B]: [1] }, servers, A, KEYS)).toEqual({ [A]: {}, [B]: {} });
        expect(schema.normalizeServerSettings(null, servers, A)).toEqual({});
        expect(schema.normalizeServerSettings([1], servers, A)).toEqual({});
        expect(schema.normalizeServerSettings("x", servers, A)).toEqual({});
    });

    it("lets the home guild hold a block when no server is configured", () => {
        expect(schema.normalizeServerSettings({ [A]: { lang: "en" }, [B]: {} }, { servers: [], links: [] }, A, KEYS)).toEqual({ [A]: { lang: "en" } });
        expect([...schema.serverSettingGuildIds(servers, "")].sort()).toEqual([A, B, T]);
        expect([...schema.serverSettingGuildIds(undefined, "nope")]).toEqual([]);
    });

    it("mergeServerSettings merges per server and per key", () => {
        const current = { [A]: { lang: "en", pingRoleId: "1" }, [B]: { lang: "de" } };
        expect(schema.mergeServerSettings(current, { [A]: { pingRoleId: "2" } })).toEqual({ [A]: { lang: "en", pingRoleId: "2" }, [B]: { lang: "de" } });
        expect(schema.mergeServerSettings(current, { [T]: { lang: "fr" } })).toEqual({ ...current, [T]: { lang: "fr" } });
        expect(schema.mergeServerSettings(current, { [A]: null })).toEqual(current);
        expect(schema.mergeServerSettings(undefined, { [A]: { lang: "en" } })).toEqual({ [A]: { lang: "en" } });
        expect(schema.mergeServerSettings(current, "x")).toEqual(current);
        expect(current[A]).toEqual({ lang: "en", pingRoleId: "1" });
    });

    it("normalizeConfig keeps every other field and reads serverSettings in its final shape", () => {
        const stored = { guildId: A, discordServers: servers, serverSettings: { [B]: {}, [U]: {} }, raidhelperServerId: "x" };
        const out = schema.normalizeConfig(stored);
        expect(out.serverSettings).toEqual({ [B]: {} });
        expect(out.discordServers.servers.map((x) => x.guildId)).toEqual([A, B]);
        expect(out.raidhelperServerId).toBe("x");
        expect(schema.normalizeConfig(out)).toEqual(out);
        expect(schema.normalizeConfig({}).serverSettings).toEqual({});
    });
});
