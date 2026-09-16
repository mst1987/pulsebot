// Einstellungen → Verbindungen → Discord-Server and the switcher badge (#251).
//
// No React renderer in this project, so what is held here are the lines that
// break silently: the section talks to the endpoint the server serves, the
// rights stay in a tooltip instead of a list on the card, the dialog saves
// only its own block, and the switcher shows the role without hiding servers.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

const section = read("components", "SettingsDiscordServers.tsx");
const switcher = read("components", "GuildSwitcher.tsx");
const api = read("api.ts");

describe("Discord-Server section", () => {
    it("loads from the endpoint the router serves and the access table lists", () => {
        expect(api).toContain('get<DiscordServersData>("/api/settings/discord-servers")');
        const { AREA_BY_PATH } = require("../../src/web/apiAccess");
        expect(AREA_BY_PATH["/api/settings/discord-servers"]).toBe("settings");
        expect(section).toContain("getDiscordServers()");
    });

    it("saves only the server block, through the shared patch rule", () => {
        expect(section).toContain("updateSettings(csrfToken, discordServersPatch(fields)");
    });

    it("keeps the rights list in the tooltip, not on the card", () => {
        expect(section).toMatch(/tipSub=\{perms\.map\(\(p\) => `\$\{p\.label\}: \$\{p\.ok \? "vorhanden" : "fehlt"\}`\)\.join\("\\n"\)\}/);
        expect(section).not.toMatch(/perms\.map\(\(p\) => <li/);
        expect(section).not.toContain('className="hint"');
    });

    it("keeps role sync and reminders in their own parts below the cards", () => {
        expect(section).not.toMatch(/Zuordnung|Anmeldung pro Kategorie/);
        // The role sync needs a talk server; reminders also work on one server.
        expect(section).toContain("{data.talk && <RoleSyncPart");
        expect(section).toContain("<RemindersPart csrfToken={csrfToken} onConfig={onConfig} />");
    });

    it("clears the talk channels when another talk server is picked", () => {
        expect(section).toContain('talkGuildId: e.target.value, talkOverviewChannelId: "", talkPingChannelId: ""');
    });
});

describe("server switcher", () => {
    it("badges the event and the talk server and still lists every server", () => {
        expect(switcher).toContain("<RoleBadge role={guilds.find((g) => g.id === activeGuildId)?.role} />");
        expect(switcher).toContain("{guilds.map((g) => <option key={g.id} value={g.id}>");
        expect(switcher).not.toMatch(/guilds\.filter\(/);
    });
});
