// settingsMigration (#897): the talk server is an ordinary server. A store that
// still names `talkGuildId` (or older fields) or holds role-sync entries of
// before #896 is written down once in the federation shape - otherwise the next
// saveConfig() (which writes the normalised config) would decide what survives.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const { migrateSettings, migrateDiscordFederation, migrateRoleMessageGuilds } = require("../../src/stores/settingsMigration");
const configStore = require("../../src/stores/configStore");
const roleMessageStore = require("../../src/stores/roleMessageStore");
const { roleMessageGuild } = require("../../src/services/discord/guildRoles");

const CONFIG_FILE = settingsPath("config.json");
const MESSAGES_FILE = settingsPath("role-messages.json");
const EVENT = "1400000000000000001";
const TALK = "1400000000000000002";
const THIRD = "1400000000000000003";
const CH_TALK = "1400000000000000011";
const CH_THIRD = "1400000000000000012";
const R = (n) => `15000000000000000${String(n).padStart(2, "0")}`;
const stored = (file) => JSON.parse(fs.__store.get(file));
const quiet = { log: () => {}, warn: () => {} };

// An install that has not saved its settings since #890: the talk server only
// as `talkGuildId`, the old talk-overview target as a link, role-sync entries
// of the event/talk days and of #896, role messages that name only their side.
const OLD_CONFIG = {
    guildId: EVENT,
    discordServers: {
        servers: [{ guildId: EVENT, label: "Raids" }, { guildId: THIRD, label: "" }],
        links: [
            { from: EVENT, to: TALK, channelId: CH_TALK, lang: "", versions: [] },
            { from: THIRD, to: THIRD, channelId: CH_THIRD, lang: "en", versions: ["tbc"] },
        ],
        talkGuildId: TALK,
        talkPingChannelId: "1400000000000000099",
        signupNoteChannelId: "1400000000000000021",
    },
    roleSync: [
        { eventRoleId: R(1), talkRoleId: R(2), direction: "toTalk" },
        { eventRoleId: R(3), talkRoleId: R(4), direction: "toEvent" },
        { fromGuildId: THIRD, fromRoleId: R(5), toGuildId: TALK, toRoleId: R(6), direction: "both" },
    ],
};
const OLD_MESSAGES = {
    messages: [
        { id: "t", guildSide: "talk", channelId: "1600000000000000001", title: "Talk", roles: [] },
        { id: "e", guildSide: "event", channelId: "1600000000000000002", title: "Event", roles: [] },
    ],
};
const EXPECTED_PAIRS = [
    { fromGuildId: EVENT, fromRoleId: R(1), toGuildId: TALK, toRoleId: R(2), direction: "toTarget" },
    { fromGuildId: EVENT, fromRoleId: R(3), toGuildId: TALK, toRoleId: R(4), direction: "toSource" },
    { fromGuildId: THIRD, fromRoleId: R(5), toGuildId: TALK, toRoleId: R(6), direction: "both" },
];

beforeEach(() => {
    fs.__store.clear();
    roleMessageStore.useFile(null);
    configStore.useFile(null);
});

describe("stores/settingsMigration migrateDiscordFederation (#897)", () => {
    it("keeps every server, link, pair and role-message server through the start and a later save of something else", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(OLD_CONFIG));
        fs.__store.set(MESSAGES_FILE, JSON.stringify(OLD_MESSAGES));
        const { changes } = migrateSettings(quiet);
        expect(changes).toContain("role-messages.json: 2 Rollen-Nachricht(en) ihrem Server fest zugeordnet (#895)");
        expect(changes).toContain("config.json: Discord-Server ohne Talk-Server-Feld gespeichert (#897) - 3 Server, 2 Verknüpfung(en), 3 Rollen-Paar(e)");
        // the role messages ran first: the talk entry found the old talk server
        expect(changes.indexOf("role-messages.json: 2 Rollen-Nachricht(en) ihrem Server fest zugeordnet (#895)"))
            .toBeLessThan(changes.findIndex((line) => line.includes("(#897)")));

        const raw = stored(CONFIG_FILE);
        expect(raw.discordServers).toEqual({
            servers: [{ guildId: EVENT, label: "Raids" }, { guildId: THIRD, label: "" }, { guildId: TALK, label: "" }],
            links: OLD_CONFIG.discordServers.links,
        });
        // #924: the note channel is unknown to the stores, so it went to the first server
        expect(raw.serverSettings[EVENT]).toEqual({ signupNoteChannelId: "1400000000000000021" });
        expect(raw.roleSync).toEqual(EXPECTED_PAIRS);

        // a later save of something unrelated writes the normalised config: nothing is lost
        configStore.saveConfig({ adminRoleIds: [R(9)] });
        const after = stored(CONFIG_FILE);
        expect(after.adminRoleIds).toEqual([R(9)]);
        expect(after.discordServers.servers.map((s) => s.guildId)).toEqual([EVENT, THIRD, TALK]);
        expect(after.discordServers.links).toEqual(OLD_CONFIG.discordServers.links);
        expect(after.roleSync).toEqual(EXPECTED_PAIRS);
        expect("talkGuildId" in after.discordServers).toBe(false);
        expect("talkPingChannelId" in after.discordServers).toBe(false);
        const config = configStore.getConfig();
        const byId = Object.fromEntries(roleMessageStore.listMessages().map((m) => [m.id, roleMessageGuild(m, config)]));
        expect(byId).toEqual({ t: TALK, e: EVENT });
    });

    it("the second start writes nothing", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(OLD_CONFIG));
        fs.__store.set(MESSAGES_FILE, JSON.stringify(OLD_MESSAGES));
        migrateSettings(quiet);
        const before = [fs.__store.get(CONFIG_FILE), fs.__store.get(MESSAGES_FILE)];
        fs.writeFileSync.mockClear();
        expect(migrateSettings(quiet)).toEqual({ changes: [] });
        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect([fs.__store.get(CONFIG_FILE), fs.__store.get(MESSAGES_FILE)]).toEqual(before);
    });

    it("the role messages need the talk server: run the other way round, the talk entry lands on the first server", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(OLD_CONFIG));
        fs.__store.set(MESSAGES_FILE, JSON.stringify(OLD_MESSAGES));
        migrateDiscordFederation();
        migrateRoleMessageGuilds();
        expect(stored(MESSAGES_FILE).messages[0].guildId).toBe(EVENT);
    });

    it("upgrades the single-server block of before the event-server list", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({
            discordServers: { eventGuildId: EVENT, talkGuildId: TALK, talkOverviewChannelId: CH_TALK },
            roleSync: [{ eventRoleId: R(1), talkRoleId: R(2), direction: "toTalk" }],
        }));
        expect(migrateDiscordFederation()).toHaveLength(1);
        const raw = stored(CONFIG_FILE);
        expect(raw.discordServers.servers.map((s) => s.guildId)).toEqual([EVENT, TALK]);
        expect(raw.discordServers.links).toEqual([{ from: EVENT, to: TALK, channelId: CH_TALK, lang: "", versions: [] }]);
        expect(raw.roleSync).toEqual([EXPECTED_PAIRS[0]]);
        expect(Object.keys(raw.discordServers).sort()).toEqual(["links", "servers"]);
    });

    it("upgrades an old eventGuilds list of #251 with the talk server", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({
            discordServers: { eventGuilds: [{ guildId: EVENT, label: "A", overviewGuildId: TALK, overviewChannelId: CH_TALK }], talkGuildId: TALK },
        }));
        migrateDiscordFederation();
        const raw = stored(CONFIG_FILE);
        expect(raw.discordServers.servers).toEqual([{ guildId: EVENT, label: "A" }, { guildId: TALK, label: "" }]);
        expect(raw.discordServers.links).toEqual([{ from: EVENT, to: TALK, channelId: CH_TALK, lang: "", versions: [] }]);
        expect(raw.roleSync).toEqual([]);
    });

    it("rewrites old role-sync entries in a block that is already clean", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({
            discordServers: { servers: [{ guildId: EVENT, label: "" }, { guildId: TALK, label: "" }], links: [] },
            roleSync: [{ fromGuildId: EVENT, fromRoleId: R(1), toGuildId: TALK, toRoleId: R(2), direction: "toEvent" }],
        }));
        expect(migrateDiscordFederation()).toHaveLength(1);
        expect(stored(CONFIG_FILE).roleSync).toEqual([{ ...EXPECTED_PAIRS[0], direction: "toSource" }]);
    });

    it("writes nothing for a fresh install or a store in the current shape", () => {
        expect(migrateDiscordFederation()).toEqual([]);
        expect(fs.__store.has(CONFIG_FILE)).toBe(false);
        fs.__store.set(CONFIG_FILE, JSON.stringify({
            discordServers: { servers: [{ guildId: EVENT, label: "" }], links: [] },
            roleSync: [EXPECTED_PAIRS[2]],
        }));
        fs.writeFileSync.mockClear();
        expect(migrateDiscordFederation()).toEqual([]);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("warns when the talk server no longer fits beside ten servers: its pairs go, links onto it stay", () => {
        const ten = Array.from({ length: 10 }, (_, i) => `17000000000000000${String(i).padStart(2, "0")}`);
        fs.__store.set(CONFIG_FILE, JSON.stringify({
            discordServers: {
                servers: ten.map((guildId) => ({ guildId, label: "" })),
                links: [{ from: TALK, to: TALK, channelId: CH_TALK }, { from: ten[0], to: TALK, channelId: CH_TALK }],
                talkGuildId: TALK,
            },
            roleSync: [{ eventRoleId: R(1), talkRoleId: R(2), direction: "toTalk" }],
        }));
        const out = migrateDiscordFederation();
        expect(out).toHaveLength(2);
        expect(out[0]).toContain("10 Server, 1 Verknüpfung(en), 0 Rollen-Paar(e)");
        expect(out[1]).toContain(`WARNUNG - der bisherige Talk-Server ${TALK} passt nicht mehr in die Serverliste (höchstens 10); 1 Rollen-Paar(e) zu ihm entfallen; Verknüpfungen auf ihn bleiben`);
        expect(out[1]).not.toContain("und seine Verknüpfungen entfallen");
        const raw = stored(CONFIG_FILE);
        expect(raw.discordServers.servers).toHaveLength(10);
        // a link onto the talk server stays (a raid list may go to any server), one from it cannot
        expect(raw.discordServers.links).toEqual([{ from: ten[0], to: TALK, channelId: CH_TALK, lang: "", versions: [] }]);
        expect(raw.roleSync).toEqual([]);
    });

    it("also sends the warning line to warn on start, the plain lines only to log", () => {
        const ten = Array.from({ length: 10 }, (_, i) => `17000000000000000${String(i).padStart(2, "0")}`);
        fs.__store.set(CONFIG_FILE, JSON.stringify({
            discordServers: { servers: ten.map((guildId) => ({ guildId, label: "" })), links: [], talkGuildId: TALK },
            roleSync: [{ eventRoleId: R(1), talkRoleId: R(2), direction: "toTalk" }],
        }));
        const log = jest.fn();
        const warn = jest.fn();
        migrateSettings({ log, warn });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/^\[settings\] Migration: config\.json: WARNUNG - der bisherige Talk-Server /);
        expect(log).toHaveBeenCalledWith(warn.mock.calls[0][0]);
        expect(log.mock.calls.length).toBeGreaterThan(1);
    });
});
