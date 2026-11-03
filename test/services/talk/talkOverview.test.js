jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({ getClient: jest.fn(), getGuild: jest.fn(() => ({ name: "Pulse Events" })) }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
// The server language: English here, German where a test says so.
jest.mock("../../../src/services/discord/botLanguage", () => {
    const mocked = { ...jest.requireActual("../../../src/services/discord/botLanguage"), serverLang: jest.fn(() => "en") };
    // no category language unless a test sets one: a raid writes in the (mocked) server language
    mocked.eventLang = jest.fn(() => mocked.serverLang());
    return mocked;
});
jest.mock("../../../src/services/events/raidEventGroups", () => ({ loadEventGroups: jest.fn() }));
// No invite unless a test sets one.
jest.mock("../../../src/services/discord/pug/pugInvites", () => ({ inviteUrlForLink: jest.fn(() => ""), generalInviteUrl: jest.fn(() => "") }));
const mockListeners = [];
jest.mock("../../../src/stores/events/signupStore", () => ({
    onSignupsChanged: jest.fn((fn) => {
        mockListeners.push(fn);
        return () => mockListeners.splice(mockListeners.indexOf(fn), 1);
    }),
}));
// The overview store, keyed "from:to" (#892); a pre-#892 record (keyed by the
// source alone) moves to the key that names it as `legacyKey`, like the real store.
let mockStates = {};
jest.mock("../../../src/stores/discord/talkOverviewStore", () => ({
    overviewKeys: jest.requireActual("../../../src/stores/discord/talkOverviewStore").overviewKeys,
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
jest.mock("../../../src/stores/settings/configStore", () => ({ readStored: jest.fn(() => ({ discordServers: {} })) }));
// Most tests configure exactly one link, from "111" to "222" (see `config` below).
const stateOf = (key = "111:222") => mockStates[key] || {};

const { MessageFlags } = require("discord.js");
const discord = require("../../../src/services/discord/discord");
const { eventLang } = require("../../../src/services/discord/botLanguage");
const { getConfig } = require("../../../src/stores/settings/settingsStore");
const { readStored } = require("../../../src/stores/settings/configStore");
const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const { inviteUrlForLink, generalInviteUrl } = require("../../../src/services/discord/pug/pugInvites");
const { ruleSetLook } = require("../../../src/services/events/embedLook");
const { raidPicture } = require("../../../src/services/events/overview/raidOverviewPanel");
const {
    CHANNEL_MISSING, syncOverview, overviewStatus, scheduleOverviewSync, startTalkOverview, currentPayload,
    _internal: {
        buildOverviewMessage, formatStart, payloadHash, overviewLinks, instanceTitle,
    },
} = require("../../../src/services/talk/talkOverview");
const { instanceById } = require("../../../src/config/gameVersions");
const { event: baseEvent } = require("../../factories/events");
const { makeClient, makeChannel, makeGuild } = require("../../helpers/discordClient");
const { knownChannels, deletedChannels, linkCheck } = require("../../helpers/linkCheck");

// The event channels of these tests exist unless a test says otherwise (#537).
beforeEach(() => knownChannels("c1", "c2", "c3", "ov", "ov2"));

const NOW = Date.UTC(2026, 8, 16, 12, 0); // Wed 16.09.2026 14:00 Berlin
const sec = (y, m, d, h, min) => Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000);
const SEP17 = sec(2026, 9, 17, 17, 30); // 1789666200, Thu 19:30 Berlin
const SEP24 = sec(2026, 9, 24, 17, 30); // Thu of the next ID
const OCT1 = sec(2026, 10, 1, 17, 30); // Thu of the ID after that
const ZONES = "https://render.worldofwarcraft.com/eu/zones";

const ev = (over = {}) => baseEvent({
    source: "raidhelper", title: "SSC + TK", startTime: SEP17,
    channelName: "mi-17-09-ssc-tk", signUps: [], ...over,
});
const signed = (n, status = "signed") => Array.from({ length: n }, (_, i) => ({ userId: `${status}-${i}`, specName: "Arcane", status }));
const own = (userId, role, status = "signed") => ({ userId, role, status, character: userId });
// An own event of an instance: lands in that instance's block.
const raidOf = (instance, over = {}) => ev({ id: `${instance}-1`, source: "eventhelper", title: instance, instanceIds: [instance], ...over });
const inCategory = (...events) => [{ categoryId: "k1", categoryName: "Mi", events }];

const opts = { eventGuildId: "111", eventGuildName: "Pulse Events", baseUrl: "https://eh.example/", now: NOW, lang: "en" };

// The Components V2 message: one container of texts, sections (text + thumbnail), lines and rows.
const TEXT = 10;
const SECTION = 9;
const ROW = 1;
const container = (payload) => payload.components[0];
const textsOf = (payload) => container(payload).components.flatMap((c) => {
    if (c.type === TEXT) return [c.content];
    if (c.type === SECTION) return c.components.map((t) => t.content);
    return [];
});
const allText = (payload) => textsOf(payload).join("\n");
const sectionsOf = (payload) => container(payload).components.filter((c) => c.type === SECTION);
const rowsOf = (payload) => container(payload).components.filter((c) => c.type === ROW);
const headingsOf = (payload) => allText(payload).match(/^### .*$/gm) || [];
const smallLinesOf = (payload) => allText(payload).split("\n").filter((l) => l.startsWith("-# "));
// Discord counts every component, the nested ones too (select options are no components).
const countComponents = (list) => list.reduce((n, c) => n + 1 + countComponents(c.components || []) + (c.accessory ? 1 : 0), 0);
const textLength = (payload) => textsOf(payload).reduce((n, t) => n + t.length, 0);

describe("services/talk/talkOverview — buildOverviewMessage", () => {
    beforeEach(() => eventLang.mockImplementation(() => "en"));

    describe("frame", () => {
        it("formats the start of a select option in Berlin time", () => {
            expect(formatStart(SEP17, "en")).toBe("Thu 17 Sep 19:30");
            expect(formatStart(0)).toBe("");
            expect(formatStart(SEP17)).toMatch(/^Do\.? 17 Sept?\.? 19:30$/);
        });

        it("speaks German by default: head, marks, cancelled, the last line, buttons and select", () => {
            const german = { ...opts };
            delete german.lang;
            const events = Array.from({ length: 50 }, (_, i) => ev({ id: `e${i}`, source: "eventhelper", startTime: sec(2026, 9, 17 + i, 17, 30), signUps: signed(2) }));
            events.push(ev({ id: "x", source: "eventhelper", status: "cancelled", startTime: SEP17 + 60 }));
            const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: "", events }], german);
            const text = allText(payload);
            expect(text).toMatch(/^## Kommende Raids\n-# Diese ID Mi\.? 16\.09\. – Di\.? 22\.09\./);
            expect(text).toContain("**Diese ID** · ");
            expect(text).toContain("**Nächste ID** · ");
            expect(text).toContain("· abgesagt");
            expect(text).toMatch(/-# \+\d+ weitere in der Web-Übersicht$/);
            expect(text).not.toContain("Ohne Kategorie");
            const labels = rowsOf(payload).flatMap((row) => row.components.map((c) => c.label || c.placeholder));
            expect(labels).toEqual(["Mehrere Raids wählen …", "Einzelnen Raid wählen …", "Web-Übersicht", "Meine Anmeldungen", "Mein Profil"]);
            expect(allText(buildOverviewMessage([], german))).toBe("## Kommende Raids\nGerade sind keine Raids geplant. Neue Raids erscheinen hier von selbst.");
        });

        it("is a Components V2 message that also clears what an old embed list left behind", () => {
            const payload = buildOverviewMessage(inCategory(ev()), opts);
            expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
            expect(payload.content).toBe("");
            expect(payload.embeds).toEqual([]);
            expect(payload.allowedMentions).toEqual({ parse: [] });
            expect(payload.components).toHaveLength(1);
            expect(container(payload).type).toBe(17);
            // no emoji anywhere in the list
            expect(JSON.stringify(payload)).not.toMatch(/\p{Extended_Pictographic}/u);
        });

        it("drops the technical line: nothing says how the list updates or where its links lead", () => {
            const text = allText(buildOverviewMessage(inCategory(ev()), { ...opts, serverName: "PuG-Server", crossServer: true }));
            expect(text).not.toContain("Updates itself");
            expect(text).not.toContain("channel links lead");
        });

        it("says there is nothing planned and keeps only the link buttons when no raid is upcoming", () => {
            const payload = buildOverviewMessage([], opts);
            expect(allText(payload)).toContain("No raids are planned");
            expect(sectionsOf(payload)).toHaveLength(0);
            expect(rowsOf(payload)).toHaveLength(1);
            expect(rowsOf(payload)[0].components).toHaveLength(3);
        });
    });

    describe("hash", () => {
        it("hashes the language with the payload, so a new language redraws the list", () => {
            const a = buildOverviewMessage(inCategory(ev()), opts);
            expect(payloadHash(a, "de")).not.toBe(payloadHash(a, "en"));
        });

        it("hashes the same content the same way, a new signup differently", () => {
            const a = buildOverviewMessage(inCategory(ev()), opts);
            const b = buildOverviewMessage(inCategory(ev()), opts);
            const c = buildOverviewMessage(inCategory(ev({ signUps: signed(1) })), opts);
            expect(payloadHash(a)).toBe(payloadHash(b));
            expect(payloadHash(a)).not.toBe(payloadHash(c));
        });

        it("does not change with the clock within an ID, but when the ID turns over the marks move", () => {
            const raids = inCategory(ev({ startTime: SEP24 }));
            const before = buildOverviewMessage(raids, opts);
            const hourLater = buildOverviewMessage(raids, { ...opts, now: NOW + 3600 * 1000 });
            const nextId = buildOverviewMessage(raids, { ...opts, now: NOW + 7 * 86400 * 1000 });
            expect(payloadHash(hourLater, "en")).toBe(payloadHash(before, "en"));
            expect(payloadHash(nextId, "en")).not.toBe(payloadHash(before, "en"));
            expect(allText(before)).toContain("**Next ID** · ");
            expect(allText(nextId)).toContain("**This ID** · ");
        });
    });

    describe("the mark at a date", () => {
        const three = inCategory(
            raidOf("kara", { id: "a", startTime: SEP17 }),
            raidOf("kara", { id: "b", startTime: SEP24 }),
            raidOf("kara", { id: "c", startTime: OCT1 }),
        );

        it("writes This ID and Next ID as two lines, a later ID as one small line without a mark", () => {
            const lines = allText(buildOverviewMessage(three, opts)).split("\n");
            expect(lines).toContain("**This ID** · **[Thu 17.09.](https://eh.example/e/a)** · <t:1789666200:t>");
            expect(lines).toContain(`**Next ID** · [Thu 24.09.](https://eh.example/e/b) · <t:${SEP24}:t>`);
            expect(lines.some((l) => l.startsWith(`-# [Thu 01.10.](https://eh.example/e/c) · <t:${OCT1}:t> · `))).toBe(true);
            expect(lines.filter((l) => l.includes("Thu 01.10.") && l.includes("ID"))).toEqual([]);
        });

        it("gives the days of the IDs in the head, not in the blocks", () => {
            const [head, block] = textsOf(buildOverviewMessage(three, opts));
            expect(head).toBe("## Upcoming raids\n-# This ID Wed 16.09. – Tue 22.09. · Next ID Wed 23.09. – Tue 29.09.");
            expect(block).not.toContain("–");
        });

        it("names in the head only the IDs that have a date", () => {
            const [nextOnly] = textsOf(buildOverviewMessage(inCategory(raidOf("kara", { startTime: SEP24 })), opts));
            expect(nextOnly).toBe("## Upcoming raids\n-# Next ID Wed 23.09. – Tue 29.09.");
            const [laterOnly] = textsOf(buildOverviewMessage(inCategory(raidOf("kara", { startTime: OCT1 })), opts));
            expect(laterOnly).toBe("## Upcoming raids");
        });
    });

    describe("blocks", () => {
        it("puts the raids of one kind into one block, by instance or by title, soonest block first and across categories", () => {
            const groups = [
                { categoryId: "k2", categoryName: "PuG", events: [
                    ev({ id: "p1", title: "Karazhan", startTime: sec(2026, 9, 18, 17, 0), channelId: "c3", channelName: "fr-kara" }),
                ] },
                { categoryId: "k1", categoryName: "Donnerstag-Raid", events: [
                    ev({ id: "a", source: "eventhelper", title: "Erster Schlangenraid", instanceIds: ["ssc"], startTime: SEP17 }),
                    ev({ id: "b", title: "SSC", startTime: SEP24 }),
                    ev({ id: "c", title: "Gildentreffen", startTime: sec(2026, 9, 19, 17, 0) }),
                ] },
            ];
            const payload = buildOverviewMessage(groups, opts);
            expect(headingsOf(payload)).toEqual(["### Serpentshrine Cavern", "### Karazhan", "### Gildentreffen"]);
            const firstBlock = textsOf(payload)[1];
            expect(firstBlock).toContain("[Thu 17.09.](https://eh.example/e/a)");
            expect(firstBlock).toContain("Thu 24.09.");
            expect(firstBlock).toContain("-# Erster Schlangenraid · Donnerstag-Raid · ");
        });

        it("counts a raid of two instances as the larger one", () => {
            const payload = buildOverviewMessage(inCategory(
                ev({ id: "a", title: "SSC + TK" }),
                raidOf("kara", { id: "b", title: "Kara + Gruul", instanceIds: ["kara", "gruul"], startTime: SEP17 + 60 }),
            ), opts);
            expect(headingsOf(payload)).toEqual(["### Serpentshrine Cavern", "### Gruul's Lair"]);
        });

        it("takes the block from the game data's order, not from how the title lists the instances", () => {
            const payload = buildOverviewMessage(inCategory(
                ev({ id: "a", title: "SSC + TK" }),
                ev({ id: "b", title: "TK + SSC", startTime: SEP17 + 60 }),
            ), opts);
            expect(headingsOf(payload)).toEqual(["### Serpentshrine Cavern"]);
            expect(smallLinesOf(payload).slice(1).map((l) => l.split(" · ")[0])).toEqual(["-# + Tempest Keep", "-# + Tempest Keep"]);
        });

        describe("the block's name follows the raid's language", () => {
            it("writes the English name in an English raid and the German one in a German raid, whatever the frame speaks", () => {
                eventLang.mockImplementation((raid) => (raid.categoryId === "k2" ? "de" : "en"));
                const groups = [
                    { categoryId: "k1", categoryName: "PuG", events: [raidOf("ssc", { id: "a" })] },
                    { categoryId: "k2", categoryName: "Gilde", events: [raidOf("kara", { id: "b", startTime: SEP17 + 60 }), raidOf("hyjal", { id: "c", startTime: SEP17 + 120 })] },
                ];
                const payload = buildOverviewMessage(groups, { ...opts, config: {} });
                expect(allText(payload)).toMatch(/^## Upcoming raids/);
                expect(headingsOf(payload)).toEqual(["### Serpentshrine Cavern", "### Karazhan", "### Hyjalgipfel"]);
            });

            it("takes `short` when the catalogue has no English name, never the German one", () => {
                const fresh = { id: "neu", name: "Neues Verlies (Forever)", short: "NV" };
                expect(instanceTitle(fresh, "en")).toBe("NV");
                expect(instanceTitle(fresh, "de")).toBe("Neues Verlies");
            });

            it("leaves the suffix „(Forever)“ out, in either language", () => {
                const forever = (id) => inCategory(raidOf(id, { versionId: "forever" }));
                const withConfig = { ...opts, config: {} };
                expect(headingsOf(buildOverviewMessage(forever("forever-ony"), withConfig))).toEqual(["### Onyxia's Lair"]);
                expect(headingsOf(buildOverviewMessage(forever("forever-hyjal"), withConfig))).toEqual(["### Hyjal Summit"]);
                eventLang.mockImplementation(() => "de");
                expect(headingsOf(buildOverviewMessage(forever("forever-ony"), withConfig))).toEqual(["### Onyxias Hort"]);
                expect(headingsOf(buildOverviewMessage(forever("forever-hyjal"), withConfig))).toEqual(["### Hyjal Summit"]);
            });
        });

        describe("what tells the dates of a block apart", () => {
            const dateLineOf = (payload, raid) => {
                const lines = allText(payload).split("\n");
                return lines[lines.findIndex((l) => l.includes(`/e/${raid}`)) + 1];
            };
            // a single raid in the list: the first small line after the head's is its own
            const noteOf = (raid, category = "Mi") => {
                const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: category, events: [raid] }], opts);
                return smallLinesOf(payload)[1];
            };

            it("names the further instances of a raid at its date, in the raid's language", () => {
                const combo = { id: "c", title: "Kara + Gruul", instanceIds: ["kara", "gruul"] };
                const payload = buildOverviewMessage(inCategory(raidOf("gruul", { id: "g" }), raidOf("gruul", { ...combo, startTime: SEP17 + 60 })), opts);
                expect(headingsOf(payload)).toEqual(["### Gruul's Lair"]);
                expect(dateLineOf(payload, "c")).toMatch(/^-# \+ Karazhan · /);
                expect(dateLineOf(payload, "g")).not.toContain("+ ");

                eventLang.mockImplementation(() => "de");
                const german = buildOverviewMessage(inCategory(ev({ id: "t", source: "eventhelper", title: "SSC + TK" })), { ...opts, config: {} });
                expect(dateLineOf(german, "t")).toContain(`+ ${instanceById("tk").name} ·`);
            });

            it("tells two raids of one block apart by their own titles", () => {
                const payload = buildOverviewMessage(inCategory(
                    raidOf("kara", { id: "a", title: "Kara Anfänger" }),
                    raidOf("kara", { id: "b", title: "Kara Gear-Check", startTime: SEP17 + 60 }),
                ), opts);
                expect(headingsOf(payload)).toEqual(["### Karazhan"]);
                expect(dateLineOf(payload, "a")).toMatch(/^-# Kara Anfänger · /);
                expect(dateLineOf(payload, "b")).toMatch(/^-# Kara Gear-Check · /);
            });

            it("keeps the further instance and the own title of one raid side by side", () => {
                const line = noteOf(raidOf("gruul", { title: "Kara + Gruul Twink-Run", instanceIds: ["kara", "gruul"] }));
                expect(line).toMatch(/^-# \+ Karazhan · Kara \+ Gruul Twink-Run · /);
            });

            it.each([
                ["forever", "forever-barrow", "Barrow Deeps"],
                ["forever", "forever-barrow", "Barrow"],
                ["forever", "forever-barrow", "Barrow Deeps Forever"],
                ["forever", "forever-hyjal", "Hyjal Summit"],
                ["forever", "forever-hyjal", "Hyjal Summit (Forever)"],
                ["forever", "forever-ony", "Onyxias Hort"],
                ["tbc", "hyjal", "Hyjal"],
                ["tbc", "hyjal", "Hyjalgipfel"],
                ["tbc", "hyjal", "Hyjal Mittwoch"],
                ["tbc", "kara", "KZ"],
                ["tbc", "kara", "Kara Donnerstag 20 Uhr"],
                ["tbc", "kara", "Karazhan Thursday 8 pm"],
                ["tbc", "kara", "Karazhan Thursday 8pm"],
                ["tbc", "kara", "Karazhan 17.09."],
                ["tbc", "kara", "Donnerstagsraid Kara"],
                ["tbc", "tk", "Das Auge"],
                ["tbc", "ssc", "Höhle des Schlangenschreins"],
                ["tbc", "gruul", "Gruul's Lair"],
                ["tbc", "gruul", "Gruuls Unterschlupf"],
            ])("does not repeat an automatic title: %s %s „%s“", (versionId, instance, title) => {
                expect(noteOf(raidOf(instance, { versionId, title, signUps: signed(1) }))).toMatch(/^-# Mi · 1 signed up/);
            });

            it("shows a title that names something beyond the instance", () => {
                expect(noteOf(raidOf("tk", { title: "Das Auge Gear-Check" }))).toMatch(/^-# Das Auge Gear-Check · /);
            });

            it("reads „Hyjal Mittwoch PuG“ by the category beside it (Raid-Helper title)", () => {
                const raid = () => ev({ title: "Hyjal Mittwoch PuG", signUps: signed(1) });
                expect(noteOf(raid(), "PuG")).toMatch(/^-# PuG · 1 signed up/);
                expect(noteOf(raid(), "🔥 PuG")).toMatch(/^-# PuG · 1 signed up/);
                expect(noteOf(raid(), "Gilde")).toMatch(/^-# Hyjal Mittwoch PuG · Gilde · /);
            });

            it("shortens a long title and stays within Discord's limits", () => {
                const title = `Kara ${"Sehr lange Beschreibung ".repeat(4)}`;
                expect(noteOf(raidOf("kara", { title }))).toMatch(/^-# Kara Sehr lange Beschreibung Sehr lange…/);
                const events = Array.from({ length: 60 }, (_, i) => raidOf("gruul", {
                    id: `r${i}`, title: `Kara + Gruul ${title}`, instanceIds: ["kara", "gruul"], channelName: "ein-langer-kanalname-fuer-den-raid", size: 25, signUps: signed(3), startTime: SEP17 + i * 86400,
                }));
                const payload = buildOverviewMessage(inCategory(...events), opts);
                expect(textLength(payload)).toBeLessThanOrEqual(4000);
                expect(allText(payload)).toMatch(/-# \+\d+ more/);
            });

            it("shows them at a cancelled date too", () => {
                const cancelled = { status: "cancelled", title: "Kara + Gruul Twink-Run", instanceIds: ["kara", "gruul"] };
                const soon = allText(buildOverviewMessage(inCategory(raidOf("gruul", cancelled)), opts));
                expect(soon).toContain("~~**Thu 17.09.**~~ · cancelled\n-# + Karazhan · Kara + Gruul Twink-Run · [#");
                const later = allText(buildOverviewMessage(inCategory(raidOf("gruul", { ...cancelled, startTime: OCT1 })), opts));
                expect(later).toContain("-# ~~Thu 01.10.~~ · cancelled · + Karazhan · Kara + Gruul Twink-Run · [#");
            });
        });

        it("lists only the first raid of a raid group", () => {
            const payload = buildOverviewMessage(inCategory(
                raidOf("kara", { id: "g1", raidGroupId: "g1" }),
                raidOf("kara", { id: "g2", raidGroupId: "g1", startTime: SEP17 + 60 }),
            ), opts);
            expect(allText(payload)).toContain("/e/g1");
            expect(allText(payload)).not.toContain("/e/g2");
            expect(rowsOf(payload)[1].components[0].options.map((o) => o.value)).toEqual(["g1"]);
        });

        it("leaves past raids out", () => {
            const json = JSON.stringify(buildOverviewMessage(inCategory(ev(), ev({ id: "old", title: "Vorbei", startTime: sec(2026, 9, 1, 17, 0) })), opts));
            expect(json).not.toContain("Vorbei");
        });

        it("keeps the raid's category when it means something, not a mere size or none", () => {
            const say = (categoryName) => smallLinesOf(buildOverviewMessage([{ categoryId: "k1", categoryName, events: [raidOf("kara", { signUps: signed(2) })] }], opts))[1];
            expect(say("Donnerstag-Raid")).toMatch(/^-# Donnerstag-Raid · 2 signed up · /);
            expect(say("10er")).toMatch(/^-# 2 signed up · /);
            expect(say("")).toMatch(/^-# 2 signed up · /);
        });

        it("strips the decoration of a category and a channel name (the raw name showed \"◜ ·\")", () => {
            const payload = buildOverviewMessage([{ categoryId: "k1", categoryName: "◜ · Raid", events: [
                ev({ id: "a", title: "Mittwochs-PuG", channelName: "◜ · mi-kara" }),
            ] }], opts);
            expect(allText(payload)).toContain("-# Raid · 0 signed up · [#mi-kara](https://discord.com/channels/111/c1)");
            expect(rowsOf(payload)[0].components[0].options[0].description).toBe("Thu 17 Sep 19:30 · Raid");
            expect(JSON.stringify(payload)).not.toContain("◜");
        });
    });

    describe("pictures", () => {
        const accessoryUrl = (payload, i = 0) => sectionsOf(payload)[i].accessory.media.url;

        it("gives a block its zone picture as a thumbnail, from the instance or the title", () => {
            expect(accessoryUrl(buildOverviewMessage(inCategory(raidOf("kara")), opts))).toBe(`${ZONES}/karazhan-small.jpg`);
            expect(accessoryUrl(buildOverviewMessage(inCategory(ev()), opts))).toBe(`${ZONES}/serpentshrine-cavern-small.jpg`);
            expect(sectionsOf(buildOverviewMessage(inCategory(ev()), opts))[0].accessory.type).toBe(11);
        });

        it("draws a block without an instance as plain text", () => {
            const payload = buildOverviewMessage(inCategory(ev({ title: "Gildentreffen" })), opts);
            expect(sectionsOf(payload)).toHaveLength(0);
            expect(allText(payload)).toContain("### Gildentreffen");
        });

        it("prefers the picture the raid has itself", () => {
            const payload = buildOverviewMessage(inCategory(raidOf("kara", { image: { url: "https://example.com/own.png" } })), opts);
            expect(accessoryUrl(payload)).toBe("https://example.com/own.png");
        });

        it("has a placeholder picture for Barrow Deeps, the same for the list, the category overview and the event post", () => {
            const barrow = { versionId: "forever", instanceIds: ["forever-barrow"] };
            const url = `${ZONES}/auchenai-crypts-small.jpg`;
            expect(accessoryUrl(buildOverviewMessage(inCategory(ev({ source: "eventhelper", title: "Barrow", ...barrow })), { ...opts, config: {} }))).toBe(url);
            expect(ruleSetLook(barrow.instanceIds).art).toBe(url);
            expect(raidPicture(ev({ source: "eventhelper", title: "Barrow", ...barrow }))).toBe(url);
        });
    });

    describe("lead", () => {
        const names = { u9: "Brokk", u7: "Devi" };
        const leaderName = (id) => names[id] || "";

        it("stands once at the block when every date shares it", () => {
            const text = allText(buildOverviewMessage(inCategory(
                raidOf("kara", { id: "a", leaderId: "u9" }),
                raidOf("kara", { id: "b", leaderId: "u9", startTime: SEP24 }),
            ), { ...opts, leaderName }));
            expect(text.match(/Lead /g)).toHaveLength(1);
            expect(text).toContain("### Karazhan\n-# Lead Brokk\n**This ID**");
        });

        it("stands at each date when they differ", () => {
            const text = allText(buildOverviewMessage(inCategory(
                raidOf("kara", { id: "a", leaderId: "u9" }),
                raidOf("kara", { id: "b", leaderId: "u7", startTime: SEP24 }),
            ), { ...opts, leaderName }));
            expect(text).toContain("### Karazhan\n**This ID**");
            expect(text).toContain("· Lead Brokk ·");
            expect(text).toContain("· Lead Devi ·");
        });

        it("falls away without a placeholder when the member is not cached", () => {
            const text = allText(buildOverviewMessage(inCategory(
                raidOf("kara", { id: "a", leaderId: "u404" }),
                raidOf("kara", { id: "b", startTime: SEP24 }),
            ), { ...opts, leaderName }));
            expect(text).not.toContain("Lead");
            expect(text).not.toContain("u404");
            expect(text).not.toContain("· ·");
        });

        it("ignores a cancelled date when it compares", () => {
            const text = allText(buildOverviewMessage(inCategory(
                raidOf("kara", { id: "a", leaderId: "u9" }),
                raidOf("kara", { id: "x", leaderId: "u7", status: "cancelled", startTime: SEP17 + 60 }),
                raidOf("kara", { id: "b", leaderId: "u9", startTime: SEP24 }),
            ), { ...opts, leaderName }));
            expect(text).toContain("### Karazhan\n-# Lead Brokk\n");
            expect(text).not.toContain("Devi");
        });
    });

    describe("a date's small line", () => {
        it("writes a Raid-Helper event without a date link, only its count, marked where nothing else tells", () => {
            const text = textsOf(buildOverviewMessage(inCategory(
                ev({ title: "Mittwochs-PuG", signUps: [...signed(8), { userId: "p", specName: "Protection", status: "signed" }] }),
            ), opts))[1];
            expect(text).toBe([
                "### Mittwochs-PuG",
                "-# Raid-Helper",
                "**This ID** · **Thu 17.09.** · <t:1789666200:t>",
                "-# Mi · 9 signed up · [#mi-17-09-ssc-tk](https://discord.com/channels/111/c1)",
            ].join("\n"));
        });

        it("does not mark a Raid-Helper raid of an instance, and gives it no web page", () => {
            const text = allText(buildOverviewMessage(inCategory(ev()), opts));
            expect(text).not.toContain("Raid-Helper");
            expect(text).not.toContain("/e/");
        });

        it("relates the signups to the size: accounts once, tentative and absent not at all (#516, #520)", () => {
            const say = (over) => allText(buildOverviewMessage(inCategory(raidOf("bt", over)), opts));
            expect(say({ size: 10, signUps: signed(3) })).toContain("3 / 10 signed up");
            // 28 entries: 26 signed, 2 late — one of the late ones is a second character of a signed account
            const twice = { userId: "signed-3", specName: "Holy", status: "late" };
            expect(say({ size: 25, signUps: [...signed(26), ...signed(1, "late"), twice, ...signed(2, "tentative"), ...signed(1, "absence")] })).toContain("27 / 25 full");
            expect(say({ size: 10, overflow: "waitlist", signUps: signed(10) })).toContain("10 / 10 full · waiting list open");
            expect(say({ size: 10, signupsClosed: true, signUps: signed(3) })).toContain("signups closed");
        });

        it("links into the event channel only while it exists — a deleted one reads \"channel missing\" (#537)", () => {
            deletedChannels("c1");
            linkCheck.channelCreated("c2");
            const lines = smallLinesOf(buildOverviewMessage(inCategory(
                ev({ id: "e1", channelId: "c1" }),
                ev({ id: "e2", channelId: "c2", channelName: "do-bt", startTime: SEP17 + 60 }),
                ev({ id: "e3", channelId: "c9", channelName: "fr-kara", startTime: SEP17 + 120 }),
            ), opts)).slice(1);
            expect(lines[0]).toContain(`· ${CHANNEL_MISSING}`);
            expect(lines[0]).not.toContain("discord.com");
            expect(lines[1]).toContain("[#do-bt](https://discord.com/channels/111/c2)");
            // nothing known about c9 (bot offline since the start): the name, no link
            expect(lines[2]).toContain("· #fr-kara");
            expect(lines[2]).not.toContain("discord.com");
        });

        it("names the source server once in the head when the list sits on another server (#892)", () => {
            linkCheck.channelDeleted("c3");
            const payload = buildOverviewMessage(inCategory(
                ev(), ev({ id: "e2", channelId: "c3", startTime: SEP17 + 60 }),
            ), { ...opts, serverName: "PuG-Server", crossServer: true });
            const text = allText(payload);
            expect(text).toMatch(/^## Raids from PuG-Server\n/);
            expect(text.match(/PuG-Server/g)).toHaveLength(1);
            expect(text).toContain("[#mi-17-09-ssc-tk](https://discord.com/channels/111/c1)");
            // a missing channel stays plain text
            expect(smallLinesOf(payload)[2]).toContain(`· ${CHANNEL_MISSING}`);
        });

        it("leaves the web buttons and date links out without a usable PUBLIC_BASE_URL (#537)", () => {
            const payload = buildOverviewMessage(inCategory(ev({ id: "eh-1", source: "eventhelper" })), { ...opts, baseUrl: "" });
            expect(JSON.stringify(payload)).not.toContain("/raids");
            expect(allText(payload)).toContain("**Thu 17.09.**");
            expect(allText(payload)).not.toContain("/e/");
            expect(rowsOf(payload).some((r) => r.components.some((c) => c.style === 5))).toBe(false);
            expect(overviewLinks("http://")).toBeNull();
        });

        it("writes each raid in its category's language, the frame in the list's (#892)", () => {
            eventLang.mockImplementation((raid) => (raid.categoryId === "k2" ? "de" : "en"));
            const groups = [
                { categoryId: "k1", categoryName: "PuG", events: [ev({ id: "a", signUps: signed(2) })] },
                { categoryId: "k2", categoryName: "Gilde", events: [ev({ id: "b", signUps: signed(3), startTime: SEP17 + 60 })] },
            ];
            const payload = buildOverviewMessage(groups, { ...opts, config: { categoryLang: {} } });
            const text = allText(payload);
            expect(text).toMatch(/^## Upcoming raids\n-# This ID /);
            expect(text).toContain("**This ID** · **Thu 17.09.**");
            expect(text).toContain("**Diese ID** · **Do");
            expect(text).toContain("2 signed up");
            expect(text).toContain("3 angemeldet");
        });
    });

    describe("cancelled raids", () => {
        const cancelled = (over) => raidOf("hyjal", { id: "eh-x", status: "cancelled", title: "Hyjal", leaderId: "u9", signUps: [own("a", "tank")], ...over });

        it("strikes the date through, without time, fill, lead or link, and does not offer it (#288)", () => {
            const payload = buildOverviewMessage(inCategory(cancelled({ startTime: sec(2026, 9, 18, 17, 30) }), ev()), { ...opts, leaderName: () => "Brokk" });
            const block = textsOf(payload).find((t) => t.startsWith("### Hyjal Summit"));
            expect(block).toBe([
                "### Hyjal Summit",
                "**This ID** · ~~**Fri 18.09.**~~ · cancelled",
                "-# [#mi-17-09-ssc-tk](https://discord.com/channels/111/c1)",
            ].join("\n"));
            expect(JSON.stringify(payload)).not.toContain("/e/eh-x");
            expect(rowsOf(payload)[0].components[0].options.map((o) => o.value)).toEqual(["e1"]);
        });

        it("stays a single small line in a later ID", () => {
            const text = allText(buildOverviewMessage(inCategory(cancelled({ startTime: OCT1 })), opts));
            expect(text).toContain("-# ~~Thu 01.10.~~ · cancelled · [#mi-17-09-ssc-tk](https://discord.com/channels/111/c1)");
        });

        it("offers no signup at all when only cancelled raids are listed", () => {
            const payload = buildOverviewMessage(inCategory(cancelled({})), opts);
            expect(JSON.stringify(payload)).not.toContain("talk-signup");
            expect(allText(payload)).toContain("cancelled");
        });
    });

    describe("controls", () => {
        it("offers the next raids in the select and three link buttons", () => {
            const [selectRow, buttonRow] = rowsOf(buildOverviewMessage(inCategory(ev()), opts));
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

        it("makes „Mehrere Raids wählen …“ the green button above the select once an own event is listed — no „Für alle“ (#293, #904)", () => {
            const payload = buildOverviewMessage(inCategory(ev(), ev({ id: "eh-1", source: "eventhelper", title: "Kara" })), opts);
            const [signupRow, selectRow, linkRow] = rowsOf(payload);
            expect(signupRow.components.map((b) => [b.custom_id, b.label, b.style])).toEqual([
                ["talk-signup-multi:111", "Pick several raids …", 3],
            ]);
            // without a source server the button stays as before
            const noSource = buildOverviewMessage(inCategory(ev({ id: "eh-1", source: "eventhelper", title: "Kara" })), { ...opts, eventGuildId: "" });
            expect(rowsOf(noSource)[0].components[0].custom_id).toBe("talk-signup-multi");
            expect(JSON.stringify(payload)).not.toContain("talk-signup-all");
            expect(selectRow.components[0].custom_id).toBe("talk-signup");
            expect(linkRow.components).toHaveLength(3);
            // only Raid-Helper events: nothing to sign up for here, so no button
            expect(JSON.stringify(buildOverviewMessage(inCategory(ev()), opts))).not.toContain("talk-signup-multi");
        });

        describe("join button", () => {
            const INVITE = "https://discord.gg/abc";
            const joined = { ...opts, crossServer: true, serverName: "Pulse PuGs", inviteUrl: INVITE };
            const linkButtons = (payload) => rowsOf(payload).at(-1).components;

            it("comes as the fourth link button, named after the raids' server", () => {
                const buttons = linkButtons(buildOverviewMessage(inCategory(ev()), joined));
                expect(buttons.map((b) => b.label)).toEqual(["Web overview", "My signups", "My profile", "Join Pulse PuGs"]);
                expect(buttons[3]).toMatchObject({ url: INVITE, style: 5 });
            });

            it("speaks the frame's language", () => {
                const buttons = linkButtons(buildOverviewMessage(inCategory(ev()), { ...joined, lang: "de" }));
                expect(buttons[3].label).toBe("Pulse PuGs beitreten");
            });

            it("stands alone in its row without web buttons, and on an empty list too", () => {
                const noWeb = buildOverviewMessage(inCategory(ev()), { ...joined, baseUrl: "" });
                expect(linkButtons(noWeb).map((b) => b.label)).toEqual(["Join Pulse PuGs"]);
                const empty = buildOverviewMessage([], joined);
                expect(linkButtons(empty).map((b) => b.label)).toContain("Join Pulse PuGs");
            });

            it("keeps a long server name within Discord's 80 characters", () => {
                const payload = buildOverviewMessage(inCategory(ev()), { ...joined, lang: "de", serverName: "N".repeat(100) });
                const { label } = linkButtons(payload)[3];
                expect(label.length).toBeLessThanOrEqual(80);
                expect(label).toMatch(/… beitreten$/);
            });

            it.each([
                ["no invite", { inviteUrl: "" }],
                ["an address that is no https link", { inviteUrl: "discord.gg/abc" }],
                ["no name for the server", { serverName: "", eventGuildName: "" }],
            ])("is left out with %s", (_, over) => {
                const buttons = linkButtons(buildOverviewMessage(inCategory(ev()), { ...joined, ...over }));
                expect(buttons.map((b) => b.label)).toEqual(["Web overview", "My signups", "My profile"]);
            });
        });

        it("offers at most the next 25 raids, soonest first", () => {
            const events = Array.from({ length: 30 }, (_, i) => raidOf("kara", { id: `e${i}`, startTime: SEP17 + (29 - i) * 3600 }));
            const options = rowsOf(buildOverviewMessage(inCategory(...events), opts))[1].components[0].options;
            expect(options).toHaveLength(25);
            expect(options[0].value).toBe("e29");
        });
    });

    describe("filters", () => {
        it("keeps only the configured event categories when there are any", () => {
            const groups = [
                { categoryId: "k1", categoryName: "Raid", events: [ev()] },
                { categoryId: "k9", categoryName: "Sonstiges", events: [ev({ id: "x", title: "Gildentreffen" })] },
            ];
            const payload = buildOverviewMessage(groups, { ...opts, categoryIds: ["k1"] });
            expect(headingsOf(payload)).toHaveLength(1);
            expect(JSON.stringify(payload)).not.toContain("Gildentreffen");
        });

        it("drops the raids of a version the link does not list (#892)", () => {
            const groups = inCategory(ev({ id: "t1", versionId: "tbc", title: "SSC" }), ev({ id: "f1", versionId: "forever", title: "Barrow" }));
            const json = JSON.stringify(buildOverviewMessage(groups, { ...opts, config: {}, versions: ["forever"] }));
            expect(json).toContain("Barrow");
            expect(json).not.toContain("SSC");
            const all = JSON.stringify(buildOverviewMessage(groups, { ...opts, config: {}, versions: [] }));
            expect(all).toContain("Barrow");
            expect(all).toContain("SSC");
        });
    });

    describe("what the clock changes", () => {
        it("turns the fill into „signups closed“ past the signup deadline, and only then edits the message", () => {
            const deadline = sec(2026, 9, 17, 10, 0);
            const raid = raidOf("kara", { size: 10, signupDeadline: deadline, signUps: signed(2) });
            const at = (seconds) => buildOverviewMessage(inCategory(raid), { ...opts, now: seconds * 1000 });
            expect(allText(at(deadline - 7200))).toContain("2 / 10 signed up");
            expect(payloadHash(at(deadline - 7200), "en")).toBe(payloadHash(at(deadline - 60), "en"));
            expect(allText(at(deadline + 60))).toContain("signups closed");
            expect(allText(at(deadline + 60))).not.toContain("2 / 10");
            expect(payloadHash(at(deadline + 60), "en")).not.toBe(payloadHash(at(deadline - 60), "en"));
        });
    });

    describe("Discord's limits", () => {
        const KINDS = ["kara", "gruul", "mag", "ssc", "tk", "za", "hyjal", "bt", "swp"];
        const longChannel = "ein-langer-kanalname-fuer-den-raid";
        // `perKind` weekly dates of each kind, one hour apart between the kinds
        const kinds = (count, perKind = 1) => inCategory(...KINDS.slice(0, count).flatMap((kind, k) => Array.from({ length: perKind }, (_, i) => raidOf(kind, {
            id: `${kind}-${i}`, channelName: longChannel, size: 25, signUps: signed(3),
            startTime: SEP17 + k * 3600 + i * 7 * 86400,
        }))));

        it("does not let a cancelled first date take the place of a block's real date", () => {
            const [group] = kinds(3, 40);
            const late = SEP17 + 400 * 86400;
            const events = [
                ...group.events,
                raidOf("ssc", { id: "gone", status: "cancelled", channelName: longChannel, startTime: SEP17 - 3600 }),
                raidOf("ssc", { id: "real", channelName: longChannel, startTime: late }),
            ];
            const payload = buildOverviewMessage([{ ...group, events }], opts);
            expect(allText(payload)).toContain("/e/real");
            expect(allText(payload)).toMatch(/-# \+\d+ more/);
        });

        it("still lists a block that has nothing but cancelled dates", () => {
            const [group] = kinds(3, 40);
            const events = [...group.events, raidOf("ssc", { id: "gone", status: "cancelled", startTime: SEP17 + 400 * 86400 })];
            expect(headingsOf(buildOverviewMessage([{ ...group, events }], opts))).toContain("### Serpentshrine Cavern");
        });

        it("reads a block's picture once per message: a broken address warns once, not per round of fitting", () => {
            const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
            try {
                const [group] = kinds(2, 10);
                group.events[0].image = { url: "keine-adresse" };
                buildOverviewMessage([group], opts);
                expect(warn.mock.calls.filter(([text]) => String(text).includes("[embedLook]"))).toHaveLength(1);
            } finally {
                warn.mockRestore();
            }
        });

        it("gives up to 7 kinds a block with a picture", () => {
            const payload = buildOverviewMessage(kinds(7), opts);
            expect(sectionsOf(payload)).toHaveLength(7);
            expect(allText(payload)).not.toContain("more in the web overview");
            expect(countComponents(payload.components)).toBeLessThanOrEqual(40);
        });

        it("reaches exactly 40 components with 7 pictures and the last line", () => {
            const payload = buildOverviewMessage(kinds(7, 12), opts);
            expect(sectionsOf(payload)).toHaveLength(7);
            expect(allText(payload)).toContain("more in the web overview");
            expect(countComponents(payload.components)).toBe(40);
            expect(textLength(payload)).toBeLessThanOrEqual(4000);
        });

        describe("with the join button", () => {
            const joined = { ...opts, crossServer: true, serverName: "Pulse PuGs", inviteUrl: "https://discord.gg/abc" };

            it("keeps 6 pictures from the 7th kind on, as a seventh block would be the 41st component", () => {
                const payload = buildOverviewMessage(kinds(7, 12), joined);
                expect(sectionsOf(payload)).toHaveLength(6);
                expect(textsOf(payload).some((t) => t.startsWith("### "))).toBe(true);
                expect(allText(payload)).toContain("more in the web overview");
                expect(countComponents(payload.components)).toBeLessThanOrEqual(40);
                expect(textLength(payload)).toBeLessThanOrEqual(4000);
            });

            it("still gives 6 kinds a picture each, without a shared text", () => {
                const payload = buildOverviewMessage(kinds(6), joined);
                expect(sectionsOf(payload)).toHaveLength(6);
                expect(container(payload).components.filter((c) => c.type === TEXT)).toHaveLength(1);
            });

            it.each([8, 9])("stays within 40 components with %i kinds", (count) => {
                const payload = buildOverviewMessage(kinds(count, 12), joined);
                expect(countComponents(payload.components)).toBeLessThanOrEqual(40);
                expect(textLength(payload)).toBeLessThanOrEqual(4000);
            });
        });

        it("keeps pictures for the first 6 from the 8th kind on, the others share a text under their names", () => {
            const payload = buildOverviewMessage(kinds(8), opts);
            expect(sectionsOf(payload)).toHaveLength(6);
            const shared = textsOf(payload).at(-1);
            expect(shared.match(/^### /gm)).toHaveLength(2);
            expect(container(payload).components.filter((c) => c.type === TEXT)).toHaveLength(2);
            expect(countComponents(payload.components)).toBeLessThanOrEqual(40);
        });

        it("keeps every kind's first date, cuts the latest dates and counts them in the last line", () => {
            const payload = buildOverviewMessage(kinds(9, 12), opts);
            const text = allText(payload);
            expect(countComponents(payload.components)).toBeLessThanOrEqual(40);
            expect(textLength(payload)).toBeLessThanOrEqual(4000);
            const shownDates = (text.match(/<t:/g) || []).length;
            expect(text.endsWith(`-# +${108 - shownDates} more in the web overview`)).toBe(true);
            expect(shownDates).toBeGreaterThan(9);
            for (const kind of KINDS) expect(text).toContain(`/e/${kind}-0)`);
            expect(text).not.toContain("/e/swp-11)");
        });

        it("cuts second dates before the first date of any later kind, by start time", () => {
            const text = allText(buildOverviewMessage(kinds(9, 12), opts));
            expect(text).toContain("/e/kara-1)");
            expect(text).not.toContain("/e/kara-11)");
        });

        it("stays inside even when the kinds alone do not fit", () => {
            const events = Array.from({ length: 60 }, (_, i) => ev({
                id: `e${i}`, source: "eventhelper", title: `Ein ziemlich langer Raidtitel Nummer ${i}`, channelName: longChannel, startTime: SEP17 + i * 60,
            }));
            const payload = buildOverviewMessage(inCategory(...events), opts);
            const text = allText(payload);
            expect(countComponents(payload.components)).toBeLessThanOrEqual(40);
            expect(textLength(payload)).toBeLessThanOrEqual(4000);
            expect(text).toContain("Nummer 0\n");
            expect(text).not.toContain("Nummer 59");
            expect(text).toMatch(/\+\d+ more in the web overview$/);
        });

        it("stays inside without web links too", () => {
            const payload = buildOverviewMessage(kinds(9, 12), { ...opts, baseUrl: "" });
            expect(countComponents(payload.components)).toBeLessThanOrEqual(40);
            expect(textLength(payload)).toBeLessThanOrEqual(4000);
            expect(rowsOf(payload)).toHaveLength(2);
        });
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

    describe("the invite of the join button", () => {
        const joinUrlOf = async (cfg, key) => {
            getConfig.mockReturnValue(cfg);
            const { payload } = await currentPayload({ config: cfg, key });
            const buttons = rowsOf(payload).flatMap((r) => r.components);
            return (buttons.find((b) => /^Join /.test(b.label)) || {}).url || "";
        };
        const itself = { guildId: "111", discordServers: federation([{ guildId: "111", label: "" }], [{ from: "111", to: "111", channelId: "ov" }], "111") };

        afterEach(() => {
            inviteUrlForLink.mockReturnValue("");
            generalInviteUrl.mockReturnValue("");
        });

        it("takes the link's own invite first, as that counts where a member came from", async () => {
            inviteUrlForLink.mockReturnValue("https://discord.gg/link");
            generalInviteUrl.mockReturnValue("https://discord.gg/general");
            expect(await joinUrlOf(config, "111:222")).toBe("https://discord.gg/link");
            expect(inviteUrlForLink).toHaveBeenCalledWith("111:222");
        });

        it("falls back to the source server's general invite", async () => {
            generalInviteUrl.mockReturnValue("https://discord.gg/general");
            expect(await joinUrlOf(config, "111:222")).toBe("https://discord.gg/general");
            expect(generalInviteUrl).toHaveBeenCalledWith("111");
        });

        it("offers nothing without an invite", async () => {
            expect(await joinUrlOf(config, "111:222")).toBe("");
        });

        it("offers nothing on the raids' own server, whatever invites exist", async () => {
            inviteUrlForLink.mockReturnValue("https://discord.gg/link");
            generalInviteUrl.mockReturnValue("https://discord.gg/general");
            expect(await joinUrlOf(itself, "111:111")).toBe("");
            expect(inviteUrlForLink).not.toHaveBeenCalled();
        });

        it("edits the list on the next sync once an invite exists", async () => {
            const { message } = fakeDiscord();
            await syncOverview({ key: "111:222", now: 5 });
            await syncOverview({ key: "111:222", now: 6 });
            expect(message.edit).not.toHaveBeenCalled();
            inviteUrlForLink.mockReturnValue("https://discord.gg/link");
            await syncOverview({ key: "111:222", now: 7 });
            expect(message.edit).toHaveBeenCalledTimes(1);
        });
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
        const sent = channel.send.mock.calls[0][0];
        expect(textsOf(sent)[0]).toMatch(/^## Raids from Pulse Events/);
        expect(sent.flags).toBe(MessageFlags.IsComponentsV2);
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

    it("turns a list that is still an embed into the new message by an edit, without a new post", async () => {
        mockStates["111:222"] = { channelId: "ov", messageId: "m1", hash: "hash-of-the-old-embed" };
        const { channel, message } = fakeDiscord();
        expect(await syncOverview({ key: "111:222" })).toEqual(posted("111:222", { status: "edited", messageId: "m1" }));
        expect(channel.send).not.toHaveBeenCalled();
        expect(message.edit).toHaveBeenCalledWith(expect.objectContaining({
            flags: MessageFlags.IsComponentsV2, content: "", embeds: [],
        }));
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
        expect(textsOf(message.edit.mock.calls[0][0])[0]).toMatch(/^## Raids from PvE/);
        expect(textsOf(second.send.mock.calls[0][0])[0]).toMatch(/^## Kommende Raids/);

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
        const text = allText(payload);
        expect(text).toContain("Lead Brokk");
        expect(text.match(/Lead /g)).toHaveLength(1);
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
        expect(allText(sent)).toContain(CHANNEL_MISSING);
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
        expect(allText(byKey.payload)).toContain("Pulse Events");
        const bySource = await currentPayload({ config, guildId: "111" });
        expect(bySource.payload).toEqual(byKey.payload);
        expect(bySource.lang).toBe("en");
    });

    it("asks the language of the server the list is posted on, not the first server (#924)", async () => {
        const botLanguage = require("../../../src/services/discord/botLanguage");
        botLanguage.serverLang.mockClear();
        await currentPayload({ config, key: "111:222" });
        expect(botLanguage.serverLang).toHaveBeenCalledWith(config, "222");
        botLanguage.serverLang.mockClear();
        await currentPayload({ config, guildId: "333" });
        expect(botLanguage.serverLang).toHaveBeenCalledWith(config, "333");
    });

    it("never falls back to another link of the source for an unknown key", async () => {
        const home = await currentPayload({ config, key: "111:111" });
        const known = await currentPayload({ config, key: "111:222" });
        // no link: the at-home frame of the source, not the cross-server frame of 111:222
        expect(textsOf(home.payload)[0]).not.toBe(textsOf(known.payload)[0]);
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
