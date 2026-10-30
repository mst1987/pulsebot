// settingsMigration (#895): a role message saved before #895 names its server
// only by its side. The start writes the server of that side down as guildId
// once, before the federation step (#897) drops talkGuildId, so reordering the
// servers later moves nothing.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../../src/config/paths");
const { migrateSettings, migrateRoleMessageGuilds } = require("../../../src/stores/settings/settingsMigration");
const roleMessageStore = require("../../../src/stores/discord/roleMessageStore");
const { roleMessageGuild } = require("../../../src/services/discord/roles/guildRoles");
const { getConfig } = require("../../../src/stores/settings/configStore");

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

describe("stores/settings/settingsMigration migrateRoleMessageGuilds (#895)", () => {
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

    it("puts an old talk entry on the first server when no talk server was set (#897: it meant the one server)", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(servers([FIRST, OTHER])));
        fs.__store.set(MESSAGES_FILE, JSON.stringify({ messages: [OLD_MESSAGES.messages[0]] }));
        expect(migrateRoleMessageGuilds()).toHaveLength(1);
        const entry = stored(MESSAGES_FILE).messages[0];
        expect(entry).toMatchObject({ id: "a", guildId: FIRST, channelId: "1300000000000000001", title: "Talk" });
        expect("guildSide" in entry).toBe(false);
    });

    it("puts an old entry on the bot's own server while no server list is stored", () => {
        const { CONFIG_DEFAULTS } = require("../../../src/stores/settings/configSchema");
        fs.__store.set(MESSAGES_FILE, JSON.stringify({ messages: [OLD_MESSAGES.messages[1]] }));
        migrateRoleMessageGuilds();
        expect(stored(MESSAGES_FILE).messages[0].guildId).toBe(CONFIG_DEFAULTS.guildId);
    });
});
