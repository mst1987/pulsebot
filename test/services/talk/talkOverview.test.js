jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({ getClient: jest.fn(), getGuild: jest.fn(() => ({ name: "Pulse Events" })) }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
// The server language: English here, German where a test says so.
jest.mock("../../../src/services/discord/botLanguage", () => {
    const mocked = { ...jest.requireActual("../../../src/services/discord/botLanguage"), serverLang: jest.fn(() => "en") };
    // no category language unless a test sets one: a raid writes in the (mocked) server language
    mocked.eventLang = jest.fn(() => mocked.serverLang());
    return mocked;
});
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn() }));
const mockListeners = [];
jest.mock("../../../src/stores/signupStore", () => ({
    onSignupsChanged: jest.fn((fn) => {
        mockListeners.push(fn);
        return () => mockListeners.splice(mockListeners.indexOf(fn), 1);
    }),
}));
// The overview store, keyed "from:to" (#892); a pre-#892 record (keyed by the
// source alone) moves to the key that names it as `legacyKey`, like the real store.
let mockStates = {};
jest.mock("../../../src/stores/talkOverviewStore", () => ({
    overviewKeys: jest.requireActual("../../../src/stores/talkOverviewStore").overviewKeys,
    getOverviewState: jest.fn((key, { legacyKey = "" } = {}) => {
        if (!mockStates[key] && legacyKey && mockStates[legacyKey]) {
            mockStates[key] = mockStates[legacyKey];
            delete mockStates[legacyKey];
        }
        return { channelId: "", messageId: "", hash: "", postedAt: 0, editedAt: 0, checkedAt: 0, error: "", ...mockStates[key] };
    }),
    setOverviewState: jest.fn((key, patch) => {
        mockStates[key] = { ...mockStates[key], ...patch };
        return mockStates[key];
    }),
    listOverviewKeys: jest.fn(() => Object.keys(mockStates).filter((key) => /^[^:]+:[^:]+$/.test(key))),
    removeOverviewState: jest.fn((key) => {
        if (!mockStates[key]) return false;
        delete mockStates[key];
        return true;
    }),
}));
// The raw config read: a clean read has a `discordServers` block (the orphan clean-up checks it).
jest.mock("../../../src/stores/configStore", () => ({ readStored: jest.fn(() => ({ discordServers: {} })) }));
// Most tests configure exactly one link, from "111" to "222" (see `config` below).
const stateOf = (key = "111:222") => mockStates[key] || {};

const discord = require("../../../src/services/discord/discord");
const { eventLang } = require("../../../src/services/discord/botLanguage");
const { getConfig } = require("../../../src/stores/settingsStore");
const { readStored } = require("../../../src/stores/configStore");
const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const {
    CHANNEL_MISSING, syncOverview, overviewStatus, scheduleOverviewSync, startTalkOverview, currentPayload,
    _internal: {
        buildOverviewMessage, formatStart, dayHeading, payloadHash, overviewLinks, roleCounts, instancePart,
    },
} = require("../../../src/services/talk/talkOverview");
const { event: baseEvent } = require("../../factories/events");
const { makeClient, makeChannel, makeGuild } = require("../../helpers/discordClient");
const { knownChannels, deletedChannels, linkCheck } = require("../../helpers/linkCheck");

// The event channels of these tests exist unless a test says otherwise (#537).
beforeEach(() => knownChannels("c1", "c2", "c3", "ov", "ov2"));

const NOW = Date.UTC(2026, 8, 16, 12, 0); // Wed 16.09.2026 14:00 Berlin
const sec = (y, m, d, h, min) => Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000);
const SEP17 = sec(2026, 9, 17, 17, 30); // 1789666200, Thu 19:30 Berlin

const ev = (over = {}) => baseEvent({
    source: "raidhelper", title: "SSC + TK", startTime: SEP17,
    channelName: "mi-17-09-ssc-tk", signUps: [], ...over,
});
const signed = (n, status = "signed") => Array.from({ length: n }, (_, i) => ({ userId: `${status}-${i}`, specName: "Arcane", status }));
const own = (userId, role, status = "signed") => ({ userId, role, status, character: userId });

const opts = { eventGuildId: "111", eventGuildName: "Pulse Events", baseUrl: "https://eh.example/", now: NOW, lang: "en" };
const lines = (field) => field.value.split("\n");
const metaLines = (field) => lines(field).filter((l) => l.startsWith("-#"));

describe("services/talk/talkOverview — buildOverviewMessage", () => {
    beforeEach(() => eventLang.mockImplementation(() => "en"));

    it("formats the start and the day heading in Berlin time", () => {
        expect(formatStart(SEP17, "en")).toBe("Thu 17 Sep 19:30");
        expect(formatStart(0)).toBe("");
        expect(formatStart(SEP17)).toMatch(/^Do\.? 17 Sept?\.? 19:30$/);
        expect(dayHeading(SEP17, "en")).toBe("Thursday 17 September");
        expect(dayHeading(SEP17, "de")).toBe("Donnerstag, 17. September");
        // 23:30 UTC is already the next day in Berlin
        expect(dayHeading(sec(2026, 9, 17, 23, 30), "en")).toBe("Friday 18 September");
    });

    it("speaks German by default: title, description, day heading, raid lines, footer, buttons and select", () => {
        const german = { ...opts };
        delete german.lang;
        const events = Array.from({ length: 30 }, (_, i) => ev({ id: `e${i}`, source: "eventhelper", startTime: sec(2026, 9, 17 + i, 17, 30), signUps: signed(2) }));
        events.push(ev({ id: "x", status: "cancelled", startTime: SEP17 + 60 }));
        const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: "", events }], german);
        const embed = payload.embeds[0];
        expect(embed.title).toBe("Kommende Raids");
        expect(embed.description).toBe("Aktualisiert sich selbst · Links führen in den Event-Kanal");
        expect(embed.fields[0].name).toBe("Donnerstag, 17. September");
        expect(embed.fields[0].value).toContain("2 Anmeldungen");
        expect(embed.fields[0].value).toContain("0 Tanks, 0 Heiler, 2 DD");
        expect(embed.fields[0].value).toContain("Ohne Kategorie");
        expect(embed.fields[0].value).toContain("~~SSC + TK~~ · abgesagt");
        expect(embed.footer.text).toMatch(/^\+\d+ weitere Raids in der Web-Übersicht$/);
        const labels = payload.components.flatMap((row) => row.components.map((c) => c.label || c.placeholder));
        expect(labels).toEqual(["Mehrere Raids wählen …", "Einzelnen Raid wählen …", "Web-Übersicht", "Meine Anmeldungen", "Mein Profil"]);
        expect(buildOverviewMessage([], german).embeds[0].description).toBe("Gerade sind keine Raids geplant. Neue Raids erscheinen hier von selbst.");
    });

    it("hashes the language with the payload, so a new language redraws the list", () => {
        const a = buildOverviewMessage([{ categoryId: "k", categoryName: "R", events: [ev()] }], opts);
        expect(payloadHash(a, "de")).not.toBe(payloadHash(a, "en"));
    });

    it("writes an own event as two lines: time, linked title, instance and size; category, lead, roles, signups, channel", () => {
        const event = ev({
            id: "eh-1", source: "eventhelper", title: "Hyjal + BT", instanceIds: ["hyjal", "bt"], size: 25,
            channelId: "c2", channelName: "do-hyjal", leaderId: "u9",
            signUps: [own("a", "tank"), own("b", "healer"), own("c", "healer"), own("d", "melee"), own("e", "ranged"), own("f", "ranged", "late"),
                own("g", "ranged", "tentative"), own("h", "tank", "absence")],
        });
        const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: "Donnerstag-Raid", events: [event] }], {
            ...opts, leaderName: (id) => (id === "u9" ? "Brokk" : ""),
        });
        const field = payload.embeds[0].fields[0];
        expect(field.name).toBe("Thursday 17 September");
        expect(field.value).toBe([
            "<t:1789666200:t> · **[Hyjal + BT](https://eh.example/e/eh-1)** · Hyjal + BT 25",
            "-# Donnerstag-Raid · Lead Brokk · 1 tank, 2 healers, 3 DPS · 6 signups · [#do-hyjal](https://discord.com/channels/111/c2)",
        ].join("\n"));
        // no emoji anywhere in the agenda
        expect(JSON.stringify(payload.embeds)).not.toMatch(/\p{Extended_Pictographic}/u);
    });

    it("writes a Raid-Helper event without a title link, roles from the specs, marked as Raid-Helper", () => {
        const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: "Mi", events: [
            ev({ signUps: [...signed(8), { userId: "p", specName: "Protection", status: "signed" }] }),
        ] }], opts);
        expect(lines(payload.embeds[0].fields[0])).toEqual([
            "<t:1789666200:t> · **SSC + TK**",
            "-# Mi · 1 tank, 0 healers, 8 DPS · 9 signups · [#mi-17-09-ssc-tk](https://discord.com/channels/111/c1) · Raid-Helper",
        ]);
    });

    it("leaves the lead out when it is unknown — no id, or the member not cached", () => {
        const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: "Mi", events: [
            ev({ id: "a", source: "eventhelper", leaderId: "u404" }),
            ev({ id: "b", source: "eventhelper", startTime: SEP17 + 60 }),
        ] }], { ...opts, leaderName: () => "" });
        expect(payload.embeds[0].fields[0].value).not.toContain("Lead");
        // without signups: no role counts, "0 signups"
        expect(metaLines(payload.embeds[0].fields[0])[0]).toBe("-# Mi · 0 signups · [#mi-17-09-ssc-tk](https://discord.com/channels/111/c1)");
    });

    it("shows instance and size only for an event that names its instances", () => {
        expect(instancePart({ instanceIds: ["ssc"] })).toBe("SSC 25");
        expect(instancePart({ instanceIds: ["ssc"], size: 10 })).toBe("SSC 10");
        expect(instancePart({ instanceIds: ["nope"] })).toBe("");
        expect(instancePart({})).toBe("");
    });

    it("counts each attending account once per role", () => {
        expect(roleCounts({ signUps: [own("a", "tank"), own("a", "healer"), own("b", "healer", "late"), own("c", "tank", "tentative")] }))
            .toEqual({ tank: 1, healer: 1, dps: 0 });
    });

    it("counts a Raid-Helper signup without a role (Late, unknown spec) in no role — only in the signups", () => {
        const signUps = [
            { userId: "a", specName: "Late", status: "late" },
            { userId: "b", specName: "Whatever", status: "signed" },
            { userId: "c", specName: "Whatever", roleName: "Tanks", status: "signed" },
            { userId: "d", specName: "Arcane", status: "signed" },
        ];
        expect(roleCounts({ signUps })).toEqual({ tank: 1, healer: 0, dps: 1 });
        const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: "Mi", events: [ev({ signUps })] }], opts);
        expect(metaLines(payload.embeds[0].fields[0])[0]).toContain("4 signups");
    });

    it("links into the event channel only while it exists — a deleted one reads \"channel missing\" (#537)", () => {
        deletedChannels("c1");
        linkCheck.channelCreated("c2");
        const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: "Mi", events: [
            ev({ id: "e1", channelId: "c1" }),
            ev({ id: "e2", channelId: "c2", channelName: "do-bt", startTime: sec(2026, 9, 18, 17, 30) }),
            ev({ id: "e3", channelId: "c9", channelName: "fr-kara", startTime: sec(2026, 9, 19, 17, 30) }),
        ] }], opts);
        const meta = payload.embeds[0].fields.map((f) => metaLines(f)[0]);
        expect(meta[0]).toContain(`· ${CHANNEL_MISSING} ·`);
        expect(meta[0]).not.toContain("discord.com");
        expect(meta[1]).toContain("[#do-bt](https://discord.com/channels/111/c2)");
        // nothing known about c9 (bot offline since the start): the name, no link
        expect(meta[2]).toContain("· #fr-kara");
        expect(meta[2]).not.toContain("discord.com");
    });

    it("names the source server in title, description and channel links when the list sits on another server (#892)", () => {
        linkCheck.channelDeleted("c3");
        const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: "PuG", events: [
            ev(), ev({ id: "e2", channelId: "c3", startTime: SEP17 + 60 }),
        ] }], { ...opts, serverName: "PuG-Server", crossServer: true });
        const embed = payload.embeds[0];
        expect(embed.title).toBe("Raids from PuG-Server");
        expect(embed.description).toBe("Updates itself · channel links lead to **PuG-Server**");
        const meta = metaLines(embed.fields[0]);
        expect(meta[0]).toContain("· [#mi-17-09-ssc-tk](https://discord.com/channels/111/c1) on PuG-Server ·");
        // a missing channel stays plain text, without the server
        expect(meta[1]).toContain(`· ${CHANNEL_MISSING} ·`);
        expect(meta[1]).not.toContain("on PuG-Server");
    });

    it("leaves the web buttons and title links out without a usable PUBLIC_BASE_URL (#537)", () => {
        const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: "Mi", events: [ev({ id: "eh-1", source: "eventhelper" })] }], { ...opts, baseUrl: "" });
        expect(JSON.stringify(payload)).not.toContain("/raids");
        expect(payload.embeds[0].fields[0].value).toContain("**SSC + TK**");
        expect(payload.embeds[0].fields[0].value).not.toContain("/e/");
        expect(payload.components.some((r) => r.components.some((c) => c.style === 5))).toBe(false);
        expect(overviewLinks("http://")).toBeNull();
    });

    it("lists the raids as an agenda: one field per day, raids in time order across categories, past raids left out", () => {
        const groups = [
            { categoryId: "k2", categoryName: "PuG", events: [ev({ id: "p1", title: "Karazhan", startTime: sec(2026, 9, 17, 18, 0), channelId: "c3", channelName: "do-kara" })] },
            {
                categoryId: "k1", categoryName: "Donnerstag-Raid", events: [
                    ev({ id: "e2", source: "eventhelper", title: "Hyjal + BT", startTime: sec(2026, 9, 24, 17, 30), channelId: "c2", channelName: "do-hyjal" }),
                    ev({ id: "e1", signUps: signed(9) }),
                    ev({ id: "old", title: "Vorbei", startTime: sec(2026, 9, 1, 17, 0) }),
                ],
            },
        ];
        const embed = buildOverviewMessage(groups, opts).embeds[0];
        expect(embed.title).toBe("Upcoming raids");
        expect(embed.fields.map((f) => f.name)).toEqual(["Thursday 17 September", "Thursday 24 September"]);
        const [first, second] = embed.fields[0].value.split("\n\n");
        expect(first).toContain("**SSC + TK**");
        expect(first).toContain("-# Donnerstag-Raid ·");
        expect(second).toContain("**Karazhan**");
        expect(second).toContain("-# PuG ·");
        expect(embed.fields[1].value).toContain("[Hyjal + BT](https://eh.example/e/e2)");
        expect(JSON.stringify(embed)).not.toContain("Vorbei");
    });

    it("names the version in the raid line only while several versions are listed (#743)", () => {
        const groups = [
            { categoryId: "k1", categoryName: "Donnerstag", events: [ev({ id: "t1", source: "eventhelper", versionId: "tbc" })] },
            { categoryId: "k2", categoryName: "Montag", events: [ev({ id: "f1", source: "eventhelper", versionId: "forever", startTime: SEP17 + 60 })] },
        ];
        const both = metaLines(buildOverviewMessage(groups, { ...opts, config: {} }).embeds[0].fields[0]);
        expect(both[0]).toMatch(/^-# TBC · Donnerstag ·/);
        expect(both[1]).toMatch(/^-# Forever · Montag ·/);
        const one = metaLines(buildOverviewMessage([groups[0]], { ...opts, config: {} }).embeds[0].fields[0]);
        expect(one[0]).toMatch(/^-# Donnerstag ·/);
    });

    it("writes each raid in its category's language, the frame in the list's (#892)", () => {
        eventLang.mockImplementation((raid) => (raid.categoryId === "k2" ? "de" : "en"));
        const groups = [
            { categoryId: "k1", categoryName: "PuG", events: [ev({ id: "a", signUps: signed(2) })] },
            { categoryId: "k2", categoryName: "Gilde", events: [ev({ id: "b", signUps: signed(3), startTime: SEP17 + 60 })] },
        ];
        const embed = buildOverviewMessage(groups, { ...opts, config: { categoryLang: {} } }).embeds[0];
        expect(embed.title).toBe("Upcoming raids");
        expect(embed.fields[0].name).toBe("Thursday 17 September");
        const meta = metaLines(embed.fields[0]);
        expect(meta[0]).toContain("2 signups");
        expect(meta[1]).toContain("3 Anmeldungen");
    });

    it("writes the single Discord accounts alone, no /size, an overbooked raid included (#516, #520)", () => {
        // 28 entries: 26 signed, 2 late — one of the late ones is a second character of a signed account
        const twice = { userId: "signed-3", specName: "Holy", status: "late" };
        const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: "Do", events: [
            ev({ id: "e9", source: "eventhelper", title: "BT", channelId: "c2", channelName: "do-bt", size: 25, signUps: [...signed(26), ...signed(1, "late"), twice, ...signed(2, "tentative"), ...signed(1, "absence")] }),
        ] }], opts);
        const meta = metaLines(payload.embeds[0].fields[0])[0];
        expect(meta).toContain(" 27 signups ");
        expect(meta).not.toMatch(/\d+ ?\/ ?\d+|\(\+/);
    });

    it("strikes a cancelled event through, marks it cancelled and does not offer it for signing up (#288)", () => {
        const payload = buildOverviewMessage([{
            categoryId: "k1", categoryName: "Mi", events: [
                ev({ id: "eh-x", source: "eventhelper", status: "cancelled", title: "Hyjal", startTime: sec(2026, 9, 18, 17, 30), leaderId: "u9", signUps: [own("a", "tank")] }),
                ev(),
            ],
        }], { ...opts, leaderName: () => "Brokk" });
        expect(lines(payload.embeds[0].fields[1])).toEqual([
            "<t:1789752600:t> · ~~Hyjal~~ · cancelled",
            "-# Mi · [#mi-17-09-ssc-tk](https://discord.com/channels/111/c1)",
        ]);
        expect(payload.components[0].components[0].options.map((o) => o.value)).toEqual(["e1"]);

        const onlyCancelled = buildOverviewMessage([{ categoryId: "k1", categoryName: "Mi", events: [ev({ status: "cancelled" })] }], opts);
        expect(onlyCancelled.components.some((r) => r.components.some((c) => c.custom_id === "talk-signup"))).toBe(false);
    });

    it("offers the next raids in the select and three link buttons", () => {
        const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: "Mi", events: [ev()] }], opts);
        const [selectRow, buttonRow] = payload.components;
        const select = selectRow.components[0];
        expect(select.custom_id).toBe("talk-signup");
        expect(select.placeholder).toBe("Pick a single raid …");
        expect(select.options).toEqual([{ label: "SSC + TK", description: "Thu 17 Sep 19:30 · Mi", value: "e1" }]);
        expect(buttonRow.components.map((b) => [b.label, b.url, b.style])).toEqual([
            ["Web overview", "https://eh.example/raids", 5],
            ["My signups", "https://eh.example/signups", 5],
            ["My profile", "https://eh.example/profile", 5],
        ]);
        expect(overviewLinks("https://x.y").profile).toBe("https://x.y/profile");
    });

    it("puts only „Mehrere Raids wählen …“ above the select once an own event is listed - no „Für alle“ (#293, #904)", () => {
        const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: "Mi", events: [ev(), ev({ id: "eh-1", source: "eventhelper", title: "Kara" })] }], opts);
        const [signupRow, selectRow, linkRow] = payload.components;
        expect(signupRow.components.map((b) => [b.custom_id, b.label, b.style])).toEqual([
            ["talk-signup-multi:111", "Pick several raids …", 2],
        ]);
        // without a source server the button stays as before
        const noSource = buildOverviewMessage([{ categoryId: "k1", categoryName: "Mi", events: [ev({ id: "eh-1", source: "eventhelper", title: "Kara" })] }], { ...opts, eventGuildId: "" });
        expect(noSource.components[0].components[0].custom_id).toBe("talk-signup-multi");
        expect(JSON.stringify(payload)).not.toContain("talk-signup-all");
        expect(selectRow.components[0].custom_id).toBe("talk-signup");
        expect(linkRow.components).toHaveLength(3);
        // only Raid-Helper events: nothing to sign up for here, so no buttons
        const rhOnly = buildOverviewMessage([{ categoryId: "k1", categoryName: "Mi", events: [ev()] }], opts);
        expect(JSON.stringify(rhOnly)).not.toContain("talk-signup-multi");
    });

    it("keeps only the configured event categories when there are any", () => {
        const groups = [
            { categoryId: "k1", categoryName: "Raid", events: [ev()] },
            { categoryId: "k9", categoryName: "Sonstiges", events: [ev({ id: "x", title: "Gildentreffen" })] },
        ];
        const payload = buildOverviewMessage(groups, { ...opts, categoryIds: ["k1"] });
        expect(payload.embeds[0].fields).toHaveLength(1);
        expect(JSON.stringify(payload)).not.toContain("Gildentreffen");
    });

    it("drops the raids of a version the link does not list (#892)", () => {
        const groups = [{ categoryId: "k1", categoryName: "Raids", events: [
            ev({ id: "t1", versionId: "tbc", title: "SSC" }), ev({ id: "f1", versionId: "forever", title: "Barrow" }),
        ] }];
        const json = JSON.stringify(buildOverviewMessage(groups, { ...opts, config: {}, versions: ["forever"] }));
        expect(json).toContain("Barrow");
        expect(json).not.toContain("SSC");
        const all = JSON.stringify(buildOverviewMessage(groups, { ...opts, config: {}, versions: [] }));
        expect(all).toContain("Barrow");
        expect(all).toContain("SSC");
    });

    it("says there is nothing planned and drops the select when no raid is upcoming", () => {
        const payload = buildOverviewMessage([], opts);
        expect(payload.embeds[0].description).toContain("No raids are planned");
        expect(payload.embeds[0].fields).toBeUndefined();
        expect(payload.components).toHaveLength(1);
        expect(payload.components[0].components).toHaveLength(3);
    });

    it("stays within Discord's limits — the latest raids fall away and the footer counts them", () => {
        const groups = Array.from({ length: 40 }, (_, g) => ({
            categoryId: `k${g}`,
            categoryName: `Kategorie ${g}`,
            events: Array.from({ length: 12 }, (_, i) => ev({
                id: `e${g}-${i}`, title: `Ein ziemlich langer Raidtitel Nummer ${g}-${i}`,
                startTime: sec(2026, 10, 1, 17, 0) + g * 3600 + i * 60, channelName: "ein-langer-kanalname-fuer-den-raid",
            })),
        }));
        const payload = buildOverviewMessage(groups, opts);
        const embed = payload.embeds[0];
        expect(embed.fields.length).toBeLessThanOrEqual(25);
        for (const f of embed.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
        const total = embed.title.length + embed.description.length + (embed.footer ? embed.footer.text.length : 0)
            + embed.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
        expect(total).toBeLessThanOrEqual(6000);
        // a day that overflows one field goes on in a field without a name
        expect(embed.fields[1].name).toBe("​");
        const shown = (JSON.stringify(embed.fields).match(/Raidtitel Nummer/g) || []).length;
        expect(embed.footer.text).toBe(`+${480 - shown} more raids in the web overview`);
        expect(JSON.stringify(embed.fields)).toContain("Nummer 0-0");
        expect(JSON.stringify(embed.fields)).not.toContain("Nummer 39-11");
        expect(JSON.stringify(embed.fields)).not.toMatch(/\+\d+ more"/);
        const options = payload.components[0].components[0].options;
        expect(options).toHaveLength(25);
        // the next 25 raids, soonest first
        expect(options[0].value).toBe("e0-0");
    });

    it("hashes the same content the same way", () => {
        const a = buildOverviewMessage([{ categoryId: "k", categoryName: "R", events: [ev()] }], opts);
        const b = buildOverviewMessage([{ categoryId: "k", categoryName: "R", events: [ev()] }], opts);
        const c = buildOverviewMessage([{ categoryId: "k", categoryName: "R", events: [ev({ signUps: signed(1) })] }], opts);
        expect(payloadHash(a)).toBe(payloadHash(b));
        expect(payloadHash(a)).not.toBe(payloadHash(c));
    });
});

function fakeDiscord({ fetchError, sendId = "m-new", extraChannels = [] } = {}) {
    const message = { id: "m1", edit: jest.fn(), delete: jest.fn() };
    // m1 is the list already there; a post answers `sendId`, which later syncs fetch again
    const channel = makeChannel({
        id: "ov",
        send: jest.fn(() => Promise.resolve({ id: sendId })),
        messages: [message, [sendId, message]],
    });
    if (fetchError) channel.messages.fetch.mockRejectedValue(fetchError);
    discord.getClient.mockReturnValue(makeClient({ channels: [channel, ...extraChannels] }));
    return { channel, message };
}

// The server federation (#890): servers and links; one raid list per link (#892).
const federation = (servers, links, talkGuildId = "") => ({ servers, links, talkGuildId });
const config = { guildId: "111", discordServers: federation([{ guildId: "111", label: "" }, { guildId: "222", label: "" }], [{ from: "111", to: "222", channelId: "ov" }], "222") };
const posted = (key, extra = {}) => {
    const [from, to] = key.split(":");
    return { key, from, to, guildId: from, label: "", ...extra };
};

describe("services/talk/talkOverview — syncOverview", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        eventLang.mockImplementation(() => "en");
        mockStates = {};
        getConfig.mockReturnValue(config);
        loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "k", categoryName: "R", events: [ev({ startTime: Math.floor(Date.now() / 1000) + 86400 })] }], error: null });
    });

    it("does nothing for a server without a link", async () => {
        getConfig.mockReturnValue({ guildId: "111", discordServers: federation([], []) });
        expect(await syncOverview({ guildId: "111" })).toEqual({ status: "unconfigured" });
        expect(await syncOverview({ key: "111:222" })).toEqual({ status: "unconfigured" });
        expect(loadEventGroups).not.toHaveBeenCalled();
    });

    it("posts the list the first time and remembers it under the link's key", async () => {
        const { channel } = fakeDiscord();
        const result = await syncOverview({ key: "111:222", now: 5 });
        expect(result).toEqual(posted("111:222", { status: "posted", messageId: "m-new" }));
        expect(loadEventGroups).toHaveBeenCalledWith("111");
        expect(channel.send).toHaveBeenCalledTimes(1);
        expect(stateOf()).toMatchObject({ channelId: "ov", messageId: "m-new", postedAt: 5, error: "" });
        expect(stateOf().hash).toHaveLength(40);
        // on another server than its raids: the title names the source
        expect(channel.send.mock.calls[0][0].embeds[0].title).toBe("Raids from Pulse Events");
    });

    it("edits when the content changed and skips when it did not", async () => {
        const { channel, message } = fakeDiscord();
        await syncOverview({ guildId: "111" });
        mockStates["111:222"].messageId = "m1";
        expect(await syncOverview({ guildId: "111" })).toEqual(posted("111:222", { status: "unchanged", messageId: "m1" }));
        expect(message.edit).not.toHaveBeenCalled();

        loadEventGroups.mockResolvedValue({ groups: [], error: null });
        expect(await syncOverview({ guildId: "111", now: 9 })).toEqual(posted("111:222", { status: "edited", messageId: "m1" }));
        expect(message.edit).toHaveBeenCalledTimes(1);
        expect(channel.send).toHaveBeenCalledTimes(1);
        expect(stateOf().editedAt).toBe(9);
    });

    it("keeps editing the message of a pre-#892 record (keyed by the source) instead of posting anew", async () => {
        mockStates["111"] = { channelId: "ov", messageId: "m1", hash: "old" };
        const { channel, message } = fakeDiscord();
        expect(await syncOverview({ now: 7 })).toEqual({ results: [posted("111:222", { status: "edited", messageId: "m1" })] });
        expect(message.edit).toHaveBeenCalledTimes(1);
        expect(channel.send).not.toHaveBeenCalled();
        expect(mockStates["111"]).toBeUndefined();
        expect(stateOf()).toMatchObject({ channelId: "ov", messageId: "m1", editedAt: 7 });
    });

    it("gives two links of one source a message each; only the first takes over the old record (#892)", async () => {
        getConfig.mockReturnValue({
            guildId: "111",
            discordServers: federation(
                [{ guildId: "111", label: "PvE" }, { guildId: "222", label: "" }],
                [{ from: "111", to: "222", channelId: "ov" }, { from: "111", to: "111", channelId: "ov2", lang: "de" }],
            ),
        });
        mockStates["111"] = { channelId: "ov", messageId: "m1", hash: "old" };
        const ownMsg = { id: "m-own", edit: jest.fn(), delete: jest.fn() };
        const second = makeChannel({ id: "ov2", send: jest.fn(() => Promise.resolve({ id: "m-own" })), messages: [ownMsg] });
        const { channel, message } = fakeDiscord({ extraChannels: [second] });

        const { results } = await syncOverview({});
        expect(results).toEqual([
            posted("111:222", { label: "PvE", status: "edited", messageId: "m1" }),
            posted("111:111", { label: "PvE", status: "posted", messageId: "m-own" }),
        ]);
        expect(message.edit).toHaveBeenCalledTimes(1);
        expect(channel.send).not.toHaveBeenCalled();
        expect(second.send).toHaveBeenCalledTimes(1);
        expect(stateOf("111:222").messageId).toBe("m1");
        expect(stateOf("111:111")).toMatchObject({ channelId: "ov2", messageId: "m-own" });

        // each in its own frame: across servers in English with the source named, at home in the link's German
        expect(message.edit.mock.calls[0][0].embeds[0].title).toBe("Raids from PvE");
        expect(second.send.mock.calls[0][0].embeds[0].title).toBe("Kommende Raids");

        // one link alone by its key
        expect(await syncOverview({ key: "111:111" })).toMatchObject({ key: "111:111", status: "unchanged" });
        expect(message.edit).toHaveBeenCalledTimes(1);
    });

    it("lists only the versions a link names", async () => {
        getConfig.mockReturnValue({ ...config, discordServers: federation(config.discordServers.servers, [{ from: "111", to: "222", channelId: "ov", versions: ["forever"] }]) });
        const t = Math.floor(Date.now() / 1000) + 86400;
        loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "k", categoryName: "R", events: [
            ev({ id: "t1", versionId: "tbc", title: "SSC", startTime: t }), ev({ id: "f1", versionId: "forever", title: "Barrow", startTime: t }),
        ] }], error: null });
        const { channel } = fakeDiscord();
        await syncOverview({ key: "111:222" });
        const json = JSON.stringify(channel.send.mock.calls[0][0]);
        expect(json).toContain("Barrow");
        expect(json).not.toContain("SSC");
    });

    it("names a lead from the member cache only — never a member fetch", async () => {
        const fetch = jest.fn();
        discord.getGuild.mockReturnValue({ name: "Pulse Events", members: { cache: new Map([["u9", { displayName: "Brokk" }]]), fetch } });
        loadEventGroups.mockResolvedValue({ groups: [{ categoryId: "k", categoryName: "R", events: [
            ev({ id: "a", source: "eventhelper", leaderId: "u9", startTime: Math.floor(Date.now() / 1000) + 86400 }),
            ev({ id: "b", source: "eventhelper", leaderId: "u404", startTime: Math.floor(Date.now() / 1000) + 90000 }),
        ] }], error: null });
        const { payload } = await currentPayload({ config, key: "111:222" });
        const json = JSON.stringify(payload.embeds);
        expect(json).toContain("Lead Brokk");
        expect(json.match(/Lead /g)).toHaveLength(1);
        expect(fetch).not.toHaveBeenCalled();
        discord.getGuild.mockReturnValue({ name: "Pulse Events" });
    });

    it("posts anew when the message was deleted in Discord", async () => {
        mockStates["111:222"] = { channelId: "ov", messageId: "gone", hash: "x" };
        const { channel } = fakeDiscord({ fetchError: Object.assign(new Error("Unknown Message"), { code: 10008 }) });
        expect(await syncOverview({ key: "111:222" })).toEqual(posted("111:222", { status: "posted", messageId: "m-new" }));
        expect(channel.send).toHaveBeenCalledTimes(1);
        expect(stateOf().messageId).toBe("m-new");
    });

    it("re-posts on request: the old message goes, a new one comes", async () => {
        mockStates["111:222"] = { channelId: "ov", messageId: "m1", hash: "x" };
        const { channel, message } = fakeDiscord({ sendId: "m2" });
        expect(await syncOverview({ key: "111:222", repost: true })).toEqual(posted("111:222", { status: "posted", messageId: "m2" }));
        expect(message.delete).toHaveBeenCalled();
        expect(channel.send).toHaveBeenCalledTimes(1);
    });

    it("leaves an existing message alone when the events cannot be loaded completely", async () => {
        mockStates["111:222"] = { channelId: "ov", messageId: "m1", hash: "x" };
        const { channel, message } = fakeDiscord();
        loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper down" });
        const result = await syncOverview({ key: "111:222" });
        expect(result.status).toBe("error");
        expect(message.edit).not.toHaveBeenCalled();
        expect(channel.send).not.toHaveBeenCalled();
        expect(stateOf().error).toContain("Raid-Helper down");
    });

    it("records other failures instead of throwing", async () => {
        discord.getClient.mockReturnValue(null);
        expect(await syncOverview({ key: "111:222" })).toEqual(posted("111:222", { status: "error", error: "Bot nicht verbunden." }));
        expect(stateOf().error).toBe("Bot nicht verbunden.");
    });

    it("returns unconfigured for a server or key that has no link", async () => {
        expect(await syncOverview({ guildId: "999" })).toEqual({ status: "unconfigured" });
        expect(await syncOverview({ key: "111:999" })).toEqual({ status: "unconfigured" });
    });

    it("loops every link without a key — one's failure never blocks another's", async () => {
        getConfig.mockReturnValue({
            discordServers: federation(
                [{ guildId: "111", label: "PvE" }, { guildId: "112", label: "PvP" }, { guildId: "222", label: "" }],
                [{ from: "111", to: "222", channelId: "ov" }, { from: "112", to: "222", channelId: "ov2" }, { from: "111", to: "111", channelId: "ov3" }],
            ),
        });
        discord.getClient.mockReturnValue(null); // every link fails ("Bot nicht verbunden.")
        loadEventGroups.mockResolvedValue({ groups: [], error: null });
        const { results } = await syncOverview({});
        expect(results.map((r) => [r.key, r.label, r.status])).toEqual([
            ["111:222", "PvE", "error"], ["112:222", "PvP", "error"], ["111:111", "PvE", "error"],
        ]);
    });

    it("shows a posted list as \"channel missing\" once its event channel is deleted (#537)", async () => {
        const { channel } = fakeDiscord();
        // online, the event server cached without c1: the channel is gone
        discord.getClient.mockReturnValue(makeClient({ channels: [channel], guilds: [makeGuild({ id: "111", channels: [] })] }));
        linkCheck._reset();
        await syncOverview({ key: "111:222" });
        const sent = channel.send.mock.calls[0][0];
        expect(sent.embeds[0].fields[0].value).toContain(CHANNEL_MISSING);
        expect(JSON.stringify(sent)).not.toContain("discord.com/channels/111/c1");
    });

    it("drops the jump link of a list message deleted in Discord (#537)", () => {
        mockStates["111:222"] = { channelId: "ov", messageId: "m1", postedAt: 1, editedAt: 2, checkedAt: 3 };
        linkCheck.messageDeleted("m1");
        expect(overviewStatus(config)[0].messageUrl).toBe("");
    });

    it("reports each link's status with a jump link for the settings page", () => {
        mockStates["111:222"] = { channelId: "ov", messageId: "m1", postedAt: 1, editedAt: 2, checkedAt: 3 };
        expect(overviewStatus(config)).toEqual([{
            key: "111:222", from: "111", to: "222", guildId: "111", label: "", lang: "", versions: [],
            configured: true, channelId: "ov", messageId: "m1",
            messageUrl: "https://discord.com/channels/222/ov/m1", postedAt: 1, editedAt: 2, checkedAt: 3, error: "",
        }]);
        mockStates["111:222"].channelId = "other";
        expect(overviewStatus(config)[0]).toMatchObject({ messageId: "", messageUrl: "", postedAt: 0 });
    });

    it("builds the dry-run payload of a link, by key or by its source server", async () => {
        const byKey = await currentPayload({ config, key: "111:222" });
        expect(byKey.error).toBeNull();
        expect(byKey.payload.embeds[0].description).toContain("Pulse Events");
        const bySource = await currentPayload({ config, guildId: "111" });
        expect(bySource.payload).toEqual(byKey.payload);
        expect(bySource.lang).toBe("en");
    });

    it("never falls back to another link of the source for an unknown key", async () => {
        const home = await currentPayload({ config, key: "111:111" });
        const known = await currentPayload({ config, key: "111:222" });
        // no link: the at-home frame of the source, not the cross-server frame of 111:222
        expect(home.payload.embeds[0].title).not.toBe(known.payload.embeds[0].title);
    });
});

describe("services/talk/talkOverview — orphaned lists (#892)", () => {
    const linkTo = (links) => ({ guildId: "111", discordServers: federation(
        [{ guildId: "111", label: "" }, { guildId: "112", label: "" }, { guildId: "222", label: "" }, { guildId: "333", label: "" }], links) });

    // the list of the current link "111:222" lives in "ov"; the orphan's in "old"
    function withOrphan(key, { fetchError, channelGone = false } = {}) {
        const orphanMsg = { id: "m-old", edit: jest.fn(), delete: jest.fn() };
        const old = makeChannel({ id: "old", messages: [orphanMsg] });
        if (fetchError) old.messages.fetch.mockRejectedValue(fetchError);
        fakeDiscord({ extraChannels: channelGone ? [] : [old] });
        mockStates[key] = { channelId: "old", messageId: "m-old", hash: "h" };
        return orphanMsg;
    }

    beforeEach(() => {
        jest.clearAllMocks();
        eventLang.mockImplementation(() => "en");
        mockStates = {};
        readStored.mockReturnValue({ discordServers: {} });
        getConfig.mockReturnValue(linkTo([{ from: "111", to: "222", channelId: "ov" }]));
        loadEventGroups.mockResolvedValue({ groups: [], error: null });
    });

    it("deletes the old list when a link's target changed (A:T1 -> A:T2)", async () => {
        const orphan = withOrphan("111:333");
        expect(await syncOverview({})).toMatchObject({ pruned: ["111:333"] });
        expect(orphan.delete).toHaveBeenCalledTimes(1);
        expect(mockStates["111:333"]).toBeUndefined();
        expect(stateOf("111:222").messageId).toBe("m-new");
    });

    it("deletes the old list when a link's source changed (A:T -> B:T)", async () => {
        const orphan = withOrphan("112:222");
        expect(await syncOverview({})).toMatchObject({ pruned: ["112:222"] });
        expect(orphan.delete).toHaveBeenCalledTimes(1);
        expect(mockStates["112:222"]).toBeUndefined();
    });

    it("deletes the list of a removed link while others remain", async () => {
        getConfig.mockReturnValue(linkTo([{ from: "111", to: "222", channelId: "ov" }]));
        const orphan = withOrphan("111:111");
        await syncOverview({});
        expect(orphan.delete).toHaveBeenCalledTimes(1);
        expect(Object.keys(mockStates)).toEqual(["111:222"]);
    });

    it("drops the record when the message or its channel is already gone", async () => {
        withOrphan("111:333", { fetchError: Object.assign(new Error("Unknown Message"), { code: 10008 }) });
        expect(await syncOverview({})).toMatchObject({ pruned: ["111:333"] });
        expect(mockStates["111:333"]).toBeUndefined();

        withOrphan("111:333", { channelGone: true });
        expect(await syncOverview({})).toMatchObject({ pruned: ["111:333"] });
        expect(mockStates["111:333"]).toBeUndefined();
    });

    it("keeps the record on any other failure, for the next sweep", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        withOrphan("111:333", { fetchError: Object.assign(new Error("Missing Access"), { code: 50001 }) });
        expect(await syncOverview({})).not.toHaveProperty("pruned");
        expect(mockStates["111:333"]).toMatchObject({ messageId: "m-old" });
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("deletes nothing after an unclean config read or without links", async () => {
        const orphan = withOrphan("111:333");
        readStored.mockReturnValue({}); // config.json missing or broken: defaults
        expect(await syncOverview({})).not.toHaveProperty("pruned");
        readStored.mockImplementation(() => { throw new Error("EACCES"); });
        await syncOverview({});
        readStored.mockReturnValue({ discordServers: {} });
        getConfig.mockReturnValue(linkTo([])); // no link at all: never read as "all removed"
        await syncOverview({});
        expect(orphan.delete).not.toHaveBeenCalled();
        expect(mockStates["111:333"]).toMatchObject({ messageId: "m-old" });
    });

    it("never touches records that may still migrate, nor runs offline", async () => {
        mockStates["999"] = { channelId: "old", messageId: "m-old" }; // keyed by a source alone
        const orphan = withOrphan("111:333");
        discord.getClient.mockReturnValue(null);
        await syncOverview({});
        expect(orphan.delete).not.toHaveBeenCalled();
        expect(mockStates["111:333"]).toBeDefined();
        expect(mockStates["999"]).toBeDefined();
    });

    it("prunes only on a full sync, never on a single link's", async () => {
        const orphan = withOrphan("111:333");
        await syncOverview({ key: "111:222" });
        expect(orphan.delete).not.toHaveBeenCalled();
    });
});

describe("services/talk/talkOverview — triggers", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        mockStates = {};
        getConfig.mockReturnValue({ guildId: "111" }); // no links: runs stay cheap
    });
    afterEach(() => jest.useRealTimers());

    it("collapses a burst of triggers into one sync", async () => {
        getConfig.mockClear();
        scheduleOverviewSync({ delayMs: 1000 });
        scheduleOverviewSync({ delayMs: 1000 });
        scheduleOverviewSync({ delayMs: 1000 });
        await jest.advanceTimersByTimeAsync(1500);
        expect(getConfig).toHaveBeenCalledTimes(1);
    });

    it("syncs after roster changes and on every sweep, and is idempotent", async () => {
        const stop = startTalkOverview({ intervalMs: 60000, debounceMs: 500, firstDelayMs: 100 });
        expect(startTalkOverview()).toBe(stop);
        await jest.advanceTimersByTimeAsync(150);
        expect(getConfig).toHaveBeenCalledTimes(1); // first run

        mockListeners.forEach((fn) => fn("eh-1"));
        mockListeners.forEach((fn) => fn("eh-1"));
        await jest.advanceTimersByTimeAsync(600);
        expect(getConfig).toHaveBeenCalledTimes(2); // one debounced run

        await jest.advanceTimersByTimeAsync(60000);
        expect(getConfig).toHaveBeenCalledTimes(3); // sweep
        stop();
        expect(mockListeners).toHaveLength(0);
    });
});
