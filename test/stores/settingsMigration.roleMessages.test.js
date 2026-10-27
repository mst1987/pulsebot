// settingsMigration (#895): a role message saved before #895 names its server
// only by its side. The start writes the server of that side down as guildId
// once, so removing talkGuildId (#897) or reordering the servers moves nothing.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const { migrateSettings, migrateRoleMessageGuilds } = require("../../src/stores/settingsMigration");
const roleMessageStore = require("../../src/stores/roleMessageStore");
const { roleMessageGuild } = require("../../src/services/discord/guildRoles");
const { getConfig } = require("../../src/stores/configStore");

const CONFIG_FILE = settingsPath("config.json");
const MESSAGES_FILE = settingsPath("role-messages.json");
const FIRST = "1200000000000000001";
const TALK = "1200000000000000002";
const OTHER = "1200000000000000003";
const stored = (file) => JSON.parse(fs.__store.get(file));
const quiet = { log: () => {}, warn: () => {} };

const servers = (list, talk) => ({ discordServers: { servers: list.map((guildId) => ({ guildId, label: "" })), links: [], ...(talk ? { talkGuildId: talk } : {}) } });

const OLD_MESSAGES = {
    messages: [
        { id: "a", guildSide: "talk", channelId: "1300000000000000001", title: "Talk", roles: [] },
        { id: "b", guildSide: "event", channelId: "1300000000000000002", title: "Event", roles: [] },
        { id: "c", guildId: OTHER, channelId: "1300000000000000003", title: "Neu", roles: [] },
    ],
};

beforeEach(() => {
    fs.__store.clear();
    roleMessageStore.useFile(null);
});

describe("stores/settingsMigration migrateRoleMessageGuilds (#895)", () => {
    it("writes the server of each old side down as guildId and drops guildSide", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(servers([FIRST, TALK, OTHER], TALK)));
        fs.__store.set(MESSAGES_FILE, JSON.stringify(OLD_MESSAGES));
        expect(migrateRoleMessageGuilds()).toEqual(["role-messages.json: 2 Rollen-Nachricht(en) ihrem Server fest zugeordnet (#895)"]);
        const file = stored(MESSAGES_FILE).messages;
        expect(file.map((m) => [m.id, m.guildId])).toEqual([["a", TALK], ["b", FIRST], ["c", OTHER]]);
        expect(file.some((m) => "guildSide" in m)).toBe(false);
        // the rest of an entry stays
        expect(file[0]).toMatchObject({ channelId: "1300000000000000001", title: "Talk" });
    });

    it("keeps every entry on its server after talkGuildId is gone and the servers are reordered", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(servers([FIRST, TALK], TALK)));
        fs.__store.set(MESSAGES_FILE, JSON.stringify(OLD_MESSAGES));
        migrateSettings(quiet);
        // #897: no talk server any more, another order of the list
        fs.__store.set(CONFIG_FILE, JSON.stringify(servers([OTHER, TALK, FIRST])));
        const config = getConfig();
        const byId = Object.fromEntries(roleMessageStore.listMessages().map((m) => [m.id, roleMessageGuild(m, config)]));
        expect(byId).toEqual({ a: TALK, b: FIRST, c: OTHER });
    });

    it("runs once: the second start changes and writes nothing", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(servers([FIRST, TALK], TALK)));
        fs.__store.set(MESSAGES_FILE, JSON.stringify(OLD_MESSAGES));
        expect(migrateSettings(quiet).changes).toContain("role-messages.json: 2 Rollen-Nachricht(en) ihrem Server fest zugeordnet (#895)");
        const before = fs.__store.get(MESSAGES_FILE);
        expect(migrateRoleMessageGuilds()).toEqual([]);
        expect(fs.__store.get(MESSAGES_FILE)).toBe(before);
    });

    it("leaves an old talk entry alone while no talk server is known", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(servers([FIRST])));
        fs.__store.set(MESSAGES_FILE, JSON.stringify({ messages: [OLD_MESSAGES.messages[0]] }));
        expect(migrateRoleMessageGuilds()).toEqual([]);
        expect(stored(MESSAGES_FILE).messages[0]).toMatchObject({ id: "a", guildSide: "talk" });
    });
});
