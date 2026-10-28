// Einstellungen → Verbindungen → Discord-Server and the switcher badge (#891,
// Epic #893 — equal servers plus links, design SB).
//
// The behaviour is rendered in SettingsDiscordServers.test.tsx (Vitest); what is
// held here are the lines that break silently: the section talks to the
// endpoints the server serves, the links table is the main element with its
// status and "Neu posten" per row (the former SettingsTalkOverview row is gone),
// each change patches only its own fields, the old talk fields are gone for
// good (#897), the rights stay in a tooltip, and no talk section is offered any more.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

const section = read("pages", "settings", "SettingsDiscordServers.tsx");
const switcher = read("components", "shell", "ServerHeader.tsx");
const api = read("api", "discordServers.ts");
// The texts live in the dictionaries since #440; the source names their keys.
const de = require("../clientSource").dictionary("de");
const en = require("../clientSource").dictionary("en");

describe("Discord-Server section", () => {
    it("loads from the endpoint the router serves and the access table lists", () => {
        expect(api).toContain("get<DiscordServersData>(\"/api/settings/discord-servers\")");
        const { AREA_BY_PATH } = require("../../../src/web/http/apiAccess");
        expect(AREA_BY_PATH["/api/settings/discord-servers"]).toBe("settings");
        expect(section).toContain("getDiscordServers()");
    });

    it("patches only the fields a change touches, never the old talk fields", () => {
        expect(section).toContain("updateSettings({ discordServers: patch } as Partial<AdminConfig>)");
        expect(section).not.toMatch(/talkGuildId|talkPingChannelId/);
        // #894 drops the ping channel from the backend; the client no longer knows the field at all
        expect(api).not.toMatch(/talkPingChannelId|talkGuildId/);
        // #897: no ping server is locked against removal any more
        expect(section).not.toContain("removePingServerLocked");
        expect(de["settings.discordServers.removePingServerLocked"]).toBeUndefined();
        expect(section).toContain("save({ links: [...config.links, link] }");
        // a link needs its source among the servers: removing a server drops its links
        expect(section).toContain("links: config.links.filter((l) => l.from !== row.id)");
    });

    it("has no talk section and no per-server overview card any more", () => {
        expect(fs.existsSync(path.join(CLIENT, "pages", "settings", "SettingsTalkOverview.tsx"))).toBe(false);
        expect(section).not.toContain("data-server=\"talk\"");
        expect(section).not.toContain("<ServerCard");
        expect(de["settings.discordServers.addEvent"]).toBeUndefined();
    });

    it("keeps role sync and reminders in their own parts below the tables", () => {
        // #896: the role sync pairs any two servers of the list and is always
        // mounted (it says itself when there is only one); reminders too.
        // reloadKey: a saved server list reloads the pair selects (#896 review)
        expect(section).toContain("<RoleSyncPart onConfig={onConfig} reloadKey={data.discordServers} />");
        expect(section).not.toContain("{data.talk && <RoleSyncPart");
        expect(section).toContain("<RemindersPart onConfig={onConfig} />");
    });

    it("shows links and servers as sortable tables, each on its own tab, servers first", () => {
        expect(section).toContain("useTableSort<LinkSortKey>(\"settings-links-sort\"");
        expect(section).toContain("useTableSort<ServerSortKey>(\"settings-servers-sort\"");
        expect(section.indexOf("rows={config.links}")).toBeGreaterThan(-1);
        // design B: the tab "Server" comes first and is the default (clean URL)
        expect(section).toContain("const SERVER_TABS = [\"servers\", \"links\", \"roles\", \"reminders\"] as const;");
        expect(section).toContain("usePersistedSearchParam<ServerTab>(\"settings-discordserver-tab\", \"tab\", \"servers\", SERVER_TABS, true)");
        expect(section.indexOf("rows={data.servers}")).toBeLessThan(section.indexOf("rows={config.links}"));
    });

    it("keeps the full server name readable on a phone, without hover", () => {
        // a cut name with only a hover title is unreadable on touch: the name
        // wraps, and the narrow layout moves categories and members under it
        const css = read("styles", "settings.css");
        expect(css).not.toMatch(/\.srv-name[^{]*\{[^}]*text-overflow:\s*ellipsis/);
        expect(css).toMatch(/\.srv-server-text > \* \{[^}]*overflow-wrap:\s*break-word/);
        expect(css).toMatch(/\.srv-servers th:nth-child\(3\), \.srv-servers td:nth-child\(3\)[^{]*\{ display: none; \}/);
        expect(section).toContain("<span className=\"srv-sub\">");
        expect(section).toContain("t(\"settings.discordServers.raidCategoryCount\", { count: s.raidCategories })");
    });

    it("says counts with their noun and raid categories as words, none being normal", () => {
        expect(de["settings.discordServers.memberCount"]).toEqual({ one: "{count} Mitglied", other: "{count} Mitglieder" });
        expect(de["settings.discordServers.noRaidCategory"]).toBe("keine");
        expect(en["settings.discordServers.noRaidCategory"]).toBe("none");
        expect(section).toContain("raidCategoriesText(s.raidCategories)");
    });

    it("keeps the rights list in the tooltip of the status badge", () => {
        expect(section).toMatch(/sub: perms\.map\(\(p\) => `\$\{p\.label\}: \$\{p\.ok \? t\("settings\.discordServers\.permOk"\) : t\("settings\.discordServers\.permMissing"\)\}`\)\.join\("\\n"\)/);
        expect([de["settings.discordServers.permOk"], de["settings.discordServers.permMissing"]]).toEqual(["vorhanden", "fehlt"]);
        expect(section).not.toMatch(/perms\.map\(\(p\) => <li/);
    });

    it("fetches the overview statuses once for every link and re-posts per link by its key (#892)", () => {
        expect(api).toContain("get<{ statuses: TalkOverviewStatus[] }>(\"/api/settings/talk-overview?preview=0\")");
        expect(api).toContain("send(\"POST\", \"/api/settings/talk-overview\", { repost: true, key });");
        expect(api).not.toMatch(/repost: true, guildId/);
        const { AREA_BY_PATH } = require("../../../src/web/http/apiAccess");
        expect(AREA_BY_PATH["/api/settings/talk-overview"]).toBe("settings");
        expect(section.match(/getTalkOverview\(\)/g)).toHaveLength(1);
        expect(section).toContain("repostTalkOverview(key)");
        expect(section).not.toContain("repostTalkOverview(link.from)");
        expect(de["settings.talkOverview.repost"]).toBe("Neu posten");
    });

    it("picks versions with chips, not checkboxes", () => {
        expect(section).not.toContain("type=\"checkbox\"");
        expect(section).toContain("<Chip key={v.id} pressed={on}");
    });

    it("gives a server an optional label beside its Discord name", () => {
        expect(section).toContain("placeholder={t(\"settings.discordServers.labelPlaceholder\")}");
        expect(de["settings.discordServers.labelPlaceholder"]).toBe("PvE, PvP, Allianz …");
    });
});

describe("server head (switcher)", () => {
    it("shows the server's own label instead of an event/talk badge and still lists every server (#895, #918)", () => {
        // the label rides in the head's second line ("PvE · Server wechseln") and in every option
        expect(switcher).toContain("const sub = [active && active.label, t(\"shell.guild.switch\")]");
        expect(switcher).toContain("{g.label && <span className=\"srv-head-sub\">{g.label}</span>}");
        expect(switcher).not.toContain("roleEvent");
        expect(switcher).toContain("{guilds.map((g) => {");
        expect(switcher).not.toMatch(/guilds\.filter\(/);
    });
});
