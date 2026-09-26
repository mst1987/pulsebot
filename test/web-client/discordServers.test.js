// Einstellungen → Verbindungen → Discord-Server and the switcher badge (#251,
// #361 — several event servers, each with its own overview target).
//
// No React renderer in this project, so what is held here are the lines that
// break silently: the section talks to the endpoint the server serves, one
// card per configured event server plus the talk card, the rights stay in a
// tooltip instead of a list on the card, the dialog saves only its own block
// through the shared patch rule, and the switcher shows the role without
// hiding servers.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

const section = read("components", "SettingsDiscordServers.tsx");
const switcher = read("components", "GuildSwitcher.tsx");
const api = read("api", "discordServers.ts");

describe("Discord-Server section", () => {
    it("loads from the endpoint the router serves and the access table lists", () => {
        expect(api).toContain("get<DiscordServersData>(\"/api/settings/discord-servers\")");
        const { AREA_BY_PATH } = require("../../src/web/http/apiAccess");
        expect(AREA_BY_PATH["/api/settings/discord-servers"]).toBe("settings");
        expect(section).toContain("getDiscordServers()");
    });

    it("saves only the server block, through the shared patch rule", () => {
        expect(section).toContain("updateSettings(discordServersPatch(fields)");
    });

    it("keeps the rights list in the tooltip, not on the card", () => {
        // One status badge under the server name carries the rights in its tooltip.
        expect(section).toMatch(/sub: perms\.map\(\(p\) => `\$\{p\.label\}: \$\{p\.ok \? "vorhanden" : "fehlt"\}`\)\.join\("\\n"\)/);
        expect(section).toContain("tip={stateTip.tip} tipSub={stateTip.sub}");
        // …and says it once: no second "Bot-Rechte" row repeating the head badge.
        expect(section).not.toContain("<dt>Bot-Rechte</dt>");
        expect(section).not.toMatch(/perms\.map\(\(p\) => <li/);
        expect(section).not.toContain("className=\"hint\"");
    });

    it("keeps role sync and reminders in their own parts below the cards", () => {
        expect(section).not.toMatch(/Zuordnung|Anmeldung pro Kategorie/);
        // The role sync needs a talk server; reminders also work on one server.
        expect(section).toContain("{data.talk && <RoleSyncPart");
        expect(section).toContain("<RemindersPart onConfig={onConfig} />");
    });

    it("renders one card per configured event server, keyed by its guild id", () => {
        expect(section).toContain("{data.events.map((card, i) => {");
        expect(section).toContain("<ServerCard key={card.id} card={card} role=\"event\" label={card.label}");
    });

    it("names the Vielleicht/Absage channel once (first card), not once per event server", () => {
        expect(section).toContain("{i === 0 && (");
    });

    it("shows the empty state only when no event server is configured yet", () => {
        expect(section).toContain("{data.events.length === 0 && <ServerCard card={null} role=\"event\"");
    });

    it("offers to add another event server once at least one exists", () => {
        expect(section).toContain("{data.events.length > 0 && (");
        expect(section).toContain("Event-Server hinzufügen");
    });

    it("shows the raid-overview row per event server only once its own target is set", () => {
        expect(section).toContain("const hasOverview = !!(card.overviewGuildId && card.overviewChannelId);");
        expect(section).toContain("{hasOverview && (");
        expect(section).toContain("guildId={card.id}");
    });

    it("fetches the overview statuses once for every card instead of per card", () => {
        expect(section).toContain("getTalkOverview()");
        expect(section).toContain("statuses.find((s) => s.guildId === card.id)");
    });

    it("clears the talk server's channels (only) when another talk server is picked", () => {
        expect(section).toContain("talkGuildId: e.target.value, talkPingChannelId: \"\"");
    });

    it("generalizes the note-channel picker to every configured event server", () => {
        expect(section).toContain("noteChannels(guilds, [...fields.eventGuilds.map((e) => e.guildId), fields.talkGuildId])");
    });
});

describe("Discord-Server edit dialog: event-server rows (#361)", () => {
    it("renders one row per entry with a guild picker, a label and its own overview target", () => {
        expect(section).toContain("function EventGuildRow(");
        expect(section).toContain("placeholder=\"PvE, PvP, Allianz …\"");
        expect(section).toContain("targetChannels = guilds.find((g) => g.id === entry.overviewGuildId)?.channels || []");
        expect(section).toContain("guildSelectOptions(guilds, entry.overviewGuildId, new Set())");
    });

    it("appends a blank row and can remove one again", () => {
        expect(section).toContain("const emptyEventGuild = ()");
        expect(section).toContain("const addRow = () => setFields({ ...fields, eventGuilds: [...fields.eventGuilds, emptyEventGuild()] });");
        expect(section).toContain("const removeRow = (index: number) => {");
        expect(section).toContain("fields.eventGuilds.filter((_, i) => i !== index)");
    });

    it("excludes every other picked guild (other event servers and the talk server) from a row's own picker", () => {
        expect(section).toContain("fields.eventGuilds.filter((_, j) => j !== i).map((e) => e.guildId)");
        expect(section).toContain("fields.talkGuildId,");
    });

    it("no longer offers a single fixed event-server field or a talkOverviewChannelId", () => {
        expect(section).not.toContain("guildField(\"eventGuildId\"");
        expect(section).not.toContain("talkOverviewChannelId");
    });
});

describe("server switcher", () => {
    it("badges the event and the talk server and still lists every server", () => {
        expect(switcher).toContain("<RoleBadge role={guilds.find((g) => g.id === activeGuildId)?.role} />");
        expect(switcher).toContain("{guilds.map((g) => <option key={g.id} value={g.id}>");
        expect(switcher).not.toMatch(/guilds\.filter\(/);
    });
});

describe("raid overview row (#257, #361)", () => {
    const row = read("components", "SettingsTalkOverview.tsx");

    it("talks to the endpoint the router serves and re-posts with the CSRF token and guild id", () => {
        expect(api).toContain("get<{ statuses: TalkOverviewStatus[] }>(\"/api/settings/talk-overview?preview=0\")");
        expect(api).toContain("send(\"POST\", \"/api/settings/talk-overview\", { repost: true, guildId });");
        const { AREA_BY_PATH } = require("../../src/web/http/apiAccess");
        expect(AREA_BY_PATH["/api/settings/talk-overview"]).toBe("settings");
        expect(row).toContain("repostTalkOverview(guildId)");
    });

    it("is a controlled row fed from the parent, not a self-fetching one", () => {
        expect(row).not.toContain("getTalkOverview");
        expect(row).not.toContain("useEffect");
        expect(row).toContain("onReposted(next)");
    });

    it("sits in an event-server card once its own overview target is chosen, its details in the tooltip", () => {
        expect(row).toContain("talkOverviewBadge(status, Date.now())");
        expect(row).toContain("tipSub={badge.tipSub}");
        expect(row).toContain("Neu posten");
        expect(row).toContain("targetGuildName");
        expect(row).toContain("targetChannelName");
    });
});
