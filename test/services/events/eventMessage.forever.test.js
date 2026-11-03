// WoW Forever: the signup post names a raider by the Discord name, the character as hover text. TBC stays as it was.
jest.mock("../../../src/stores/events/eventStore", () => ({ getEvent: jest.fn(), setEventMessage: jest.fn(), listEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/events/signupStore", () => ({ listSignups: jest.fn(() => []), onSignupsChanged: jest.fn(() => () => {}) }));
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({ getClient: jest.fn(), resolveUserNames: jest.fn(async () => ({})) }));
jest.mock("../../../src/services/discord/botLanguage", () => ({
    ...jest.requireActual("../../../src/services/discord/botLanguage"), serverLang: jest.fn(() => "en"), eventLang: jest.fn(() => "en"),
}));
// an address as long as a real one
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eventhelper.pulse-gilde.example", embedAccentColor: 7 }));

const { getEvent, setEventMessage } = require("../../../src/stores/events/eventStore");
const { listSignups } = require("../../../src/stores/events/signupStore");
const discord = require("../../../src/services/discord/discord");
const variables = require("../../../src/config/variables");
const appEmojis = require("../../../src/services/discord/appEmojis");
const { _resetForTests: resetNames } = require("../../../src/services/discord/hoverNames");
const { makeClient, makeChannel } = require("../../helpers/discordClient");
const { event: baseEvent } = require("../../factories/events");
const { foreverRaid, longEmojis } = require("../../factories/foreverRaid");
const { refreshEventMessage, _internal: { buildEventMessage: buildRaw, embedLength, LIMITS } } = require("../../../src/services/events/eventMessage");

const BASE = "https://eventhelper.pulse-gilde.example";
const ID = "eh-m1x2y3z4a5b6";
const PAGE = `${BASE}/e/${ID}`;
const NOW = 1999000000 * 1000;
const buildEventMessage = (e, list, opts = {}) => buildRaw(e, list, { lang: "en", now: NOW, ...opts });
const event = (over = {}) => baseEvent({
    id: ID, guildId: "g1", title: "Karazhan Donnerstag", description: "Treffpunkt Eingang", leaderId: "7", versionId: "forever",
    size: 25, composition: { tank: 2, healer: 5, melee: 0, ranged: 0 }, signupDeadline: 0, message: null, ...over,
});
const su = (userId, character, spec, role, status = "signed", at = Number(userId)) => ({ userId, character, spec, role, status, at });
const emojis = longEmojis(appEmojis.emojiCatalog());

const signups = [
    su("1", "Aldric Sturmwind", "Warrior-Protection", "tank"),
    su("2", "Mira Tal", "Priest-Holy", "healer", "late"),
    su("3", "Devi Res", "Mage-Arcane", "ranged", "tentative"),
    su("4", "Kira Stein", "Rogue-Combat", "melee", "bench"),
    su("5", "", "", "", "absence"),
    su("7", "Lena Wolf", "Priest-Shadow", "ranged"),
];
const names = { 1: "Marc", 2: "Mira", 3: "Devi", 4: "Kira", 5: "Weg", 7: "Lena" };

const allText = (embed) => embed.fields.map((f) => f.value).join("\n");
const moreCount = (embed) => [...allText(embed).matchAll(/\+(\d+) more/g)].reduce((n, m) => n + Number(m[1]), 0);
const linkCount = (embed) => (allText(embed).match(/\]\(</g) || []).length;
const shownBy = (embed, list, discordNames) => list.filter((s) => {
    const text = allText(embed);
    const name = discordNames && discordNames[s.userId];
    return text.includes(s.character) || (name && text.includes(name.replace(/[|_[\]()]/g, (c) => (c === "[" ? "\\(" : c === "]" ? "\\)" : `\\${c}`))));
});
const withinLimits = (embed) => {
    expect(embedLength(embed)).toBeLessThanOrEqual(LIMITS.total);
    for (const f of embed.fields) expect(f.value.length).toBeLessThanOrEqual(LIMITS.fieldValue);
};
// a link is complete or not there: every opening has its closing
const noBrokenLink = (embed) => {
    const opened = (allText(embed).match(/\]\(</g) || []).length;
    const closed = (allText(embed).match(/"\)/g) || []).length;
    expect(closed).toBe(opened);
};

beforeEach(() => {
    jest.clearAllMocks();
    appEmojis.resetAppEmojis();
    resetNames();
    variables.publicBaseUrl = BASE;
});

describe("the lines of a Forever post", () => {
    const embed = () => buildEventMessage(event(), signups, { emojis, discordNames: names }).embeds[0];

    it("links the Discord name in the roster, bold, the character as hover text", () => {
        expect(allText(embed())).toContain(`**[Marc](<${PAGE}> "Aldric Sturmwind")**`);
    });

    it("puts a raider's further character not in bold", () => {
        const list = [{ ...su("1", "Aldric Sturmwind", "Warrior-Protection", "tank"), characters: [
            { character: "Aldric Sturmwind", spec: "Warrior-Protection", role: "tank" },
            { character: "Mira Tal", spec: "Priest-Holy", role: "healer" },
        ] }];
        const text = allText(buildEventMessage(event(), list, { emojis, discordNames: names }).embeds[0]);
        expect(text).toContain(`**[Marc](<${PAGE}> "Aldric Sturmwind")**`);
        expect(text).toMatch(/ \[Marc\]\(<[^>]+> "Mira Tal"\)/);
        expect(text).not.toContain(`**[Marc](<${PAGE}> "Mira Tal")**`);
    });

    it("links the late, tentative and bench lines", () => {
        const text = allText(embed());
        for (const [name, character] of [["Mira", "Mira Tal"], ["Devi", "Devi Res"], ["Kira", "Kira Stein"]]) {
            expect(text).toContain(`[${name}](<${PAGE}> "${character}")`);
        }
    });

    it("links the leader in the head", () => {
        const head = embed().fields[0].value;
        expect(head).toContain(`[Lena](<${PAGE}> "Lena Wolf")`);
    });

    it("keeps the mention for a leader without a character and for an absence", () => {
        const noLeader = buildEventMessage(event({ leaderId: "99" }), signups, { emojis, discordNames: { ...names, 99: "Chef" } }).embeds[0];
        expect(noLeader.fields[0].value).toContain("<@99>");
        expect(allText(noLeader)).toContain("<@5>");
        expect(allText(noLeader)).not.toContain("Weg");
    });

    it("shows the character in plain text for a raider without a Discord name", () => {
        const text = allText(buildEventMessage(event(), signups, { emojis, discordNames: { 1: "Marc" } }).embeds[0]);
        expect(text).toContain("**Lena Wolf**");
        expect(text).not.toContain("\"Lena Wolf\"");
    });

    it("shows the character for a Discord name that looks like an address", () => {
        const text = allText(buildEventMessage(event(), signups, { emojis, discordNames: { ...names, 1: "evil.example" } }).embeds[0]);
        expect(text).toContain("**Aldric Sturmwind**");
        expect(text).not.toContain("evil.example");
    });

    it("escapes a Discord name so that it cannot break the link or ping", () => {
        const list = [su("1", "Aldric Sturmwind", "Warrior-Protection", "tank")];
        const text = allText(buildEventMessage(event(), list, { emojis, discordNames: { 1: "@everyone [x](y) *_~`|\"\\" } }).embeds[0]);
        const zwsp = String.fromCharCode(0x200b);
        expect(text).toContain(`**[@${zwsp}everyone \\(x\\)\\(y\\) \\*\\_\\~\\\`\\|"\\\\](<${PAGE}> "Aldric Sturmwind")**`);
        expect(text).not.toContain("@everyone");
    });

    it("stays with the characters without names or without an address", () => {
        const text = allText(buildEventMessage(event(), signups, { emojis }).embeds[0]);
        expect(text).toContain("**Aldric Sturmwind**");
        expect(text).not.toContain("](<");
        variables.publicBaseUrl = "";
        const noBase = allText(buildEventMessage(event(), signups, { emojis, discordNames: names }).embeds[0]);
        expect(noBase).toContain("**Aldric Sturmwind**");
        expect(noBase).not.toContain("Marc");
    });
});

describe("TBC stays byte for byte", () => {
    it("ignores the Discord names", () => {
        const tbc = event({ versionId: "tbc" });
        expect(buildEventMessage(tbc, signups, { emojis, discordNames: names })).toEqual(buildEventMessage(tbc, signups, { emojis }));
        expect(allText(buildEventMessage(tbc, signups, { emojis, discordNames: names }).embeds[0])).toContain("**Aldric Sturmwind**");
    });

    it("a Forever post without names reads like a TBC post, apart from its footer", () => {
        const forever = buildEventMessage(event(), signups, { emojis }).embeds[0];
        const tbc = buildEventMessage(event({ versionId: "tbc" }), signups, { emojis }).embeds[0];
        expect(forever.fields).toEqual(tbc.fields);
    });
});

describe("the length budget of a full raid", () => {
    const measure = (size, list, discordNames) => {
        const before = buildEventMessage(event({ size }), list, { emojis }).embeds[0];
        const after = buildEventMessage(event({ size }), list, { emojis, discordNames }).embeds[0];
        return { before, after };
    };

    it.each([[25], [40]])("%i raiders: everybody stays listed, within Discord's limits", (size) => {
        const { signups: list, discordNames } = foreverRaid(size);
        const { before, after } = measure(size, list, discordNames);
        withinLimits(after);
        noBrokenLink(after);
        expect(moreCount(after)).toBeLessThanOrEqual(moreCount(before));
        expect(moreCount(after)).toBe(0);
        expect(shownBy(after, list, discordNames)).toHaveLength(size);
    });

    // The measured budget: 25 raiders all keep their link (5343 of 6000 characters), 40 share 20 links (5823 of 6000),
    // the others show the plain Discord name.
    it("25 raiders keep every hover link, 40 raiders half of them", () => {
        const raid25 = foreverRaid(25);
        const raid40 = foreverRaid(40);
        expect(linkCount(measure(25, raid25.signups, raid25.discordNames).after)).toBe(25);
        expect(linkCount(measure(40, raid40.signups, raid40.discordNames).after)).toBe(20);
    });

    it("gives up the links before a raider, even with the longest names Discord allows", () => {
        const { signups: list } = foreverRaid(40);
        const longNames = Object.fromEntries(list.map((s, i) => [s.userId, `Raider Mit Sehr Langem Namen ${String(i).padStart(3, "0")}`.slice(0, 32)]));
        const { after } = measure(40, list, longNames);
        withinLimits(after);
        noBrokenLink(after);
        expect(moreCount(after)).toBe(0);
        for (const name of Object.values(longNames)) expect(allText(after)).toContain(name);
    });

    it("keeps the other lines whole: late, tentative and bench in a big raid", () => {
        const { signups: list, discordNames } = foreverRaid(40);
        const mixed = list.map((s, i) => (i >= 28 ? { ...s, status: ["late", "tentative", "bench"][i % 3] } : s));
        const after = buildEventMessage(event({ size: 40 }), mixed, { emojis, discordNames }).embeds[0];
        withinLimits(after);
        noBrokenLink(after);
        expect(moreCount(after)).toBe(0);
        expect(shownBy(after, mixed, discordNames)).toHaveLength(40);
    });

    it("a late/tentative list too long for its field says +N more instead of cutting a name off", () => {
        const { signups: list } = foreverRaid(40);
        const longNames = Object.fromEntries(list.map((s, i) => [s.userId, `Raider Mit Sehr Langem Namen ${String(i).padStart(3, "0")}`.slice(0, 32)]));
        const after = buildEventMessage(event({ size: 40 }), list.map((s) => ({ ...s, status: "tentative" })), { emojis, discordNames: longNames }).embeds[0];
        withinLimits(after);
        noBrokenLink(after);
        const named = Object.values(longNames).filter((name) => allText(after).includes(name)).length;
        expect(moreCount(after)).toBeGreaterThan(0);
        expect(named + moreCount(after)).toBe(40);
    });

    it("one raider too long for the field on their own is clipped as plain text, without a link", () => {
        const many = Array.from({ length: 40 }, (_, i) => ({ character: `Aldric Sturmwind${i}`, spec: "Warrior-Protection", role: "tank" }));
        const after = buildEventMessage(event(), [{ ...su("1", many[0].character, "Warrior-Protection", "tank", "tentative"), characters: many }], { emojis, discordNames: { 1: "Marc" } }).embeds[0];
        withinLimits(after);
        expect(linkCount(after)).toBe(0);
        expect(allText(after)).toContain("Marc");
    });
});

describe("refreshing a Forever post", () => {
    function posted(list = signups) {
        const message = { id: "m1", edit: jest.fn(() => Promise.resolve()) };
        const channel = makeChannel({ id: "c1", messages: [message] });
        channel.send = jest.fn(async () => message);
        discord.getClient.mockReturnValue(makeClient({ channels: [channel] }));
        const stored = event({ channelId: "c1", message: { channelId: "c1", messageId: "m1", hash: "old" } });
        getEvent.mockImplementation(() => stored);
        setEventMessage.mockImplementation((id, patch) => { stored.message = patch; });
        listSignups.mockReturnValue(list);
        return message;
    }

    it("edits once and then leaves an unchanged post alone", async () => {
        const message = posted();
        discord.resolveUserNames.mockResolvedValue(names);
        await refreshEventMessage(ID);
        expect(message.edit).toHaveBeenCalledTimes(1);
        await expect(refreshEventMessage(ID)).resolves.toMatchObject({ unchanged: true });
        expect(message.edit).toHaveBeenCalledTimes(1);
    });

    it("does not edit when names arrive too late: the last known ones stay", async () => {
        const message = posted();
        discord.resolveUserNames.mockResolvedValue(names);
        await refreshEventMessage(ID);
        discord.resolveUserNames.mockResolvedValue({});
        await expect(refreshEventMessage(ID)).resolves.toMatchObject({ unchanged: true });
        discord.resolveUserNames.mockRejectedValue(new Error("gateway"));
        await expect(refreshEventMessage(ID)).resolves.toMatchObject({ unchanged: true });
        expect(message.edit).toHaveBeenCalledTimes(1);
    });

    it("edits exactly once for a new Discord name", async () => {
        const message = posted();
        discord.resolveUserNames.mockResolvedValue(names);
        await refreshEventMessage(ID);
        discord.resolveUserNames.mockResolvedValue({ ...names, 1: "Marcus" });
        await refreshEventMessage(ID);
        expect(message.edit).toHaveBeenCalledTimes(2);
        await expect(refreshEventMessage(ID)).resolves.toMatchObject({ unchanged: true });
        expect(message.edit).toHaveBeenCalledTimes(2);
    });

    it("after a restart at worst one plain post and one edit with the link, no ping-pong", async () => {
        const message = posted();
        discord.resolveUserNames.mockResolvedValue({});
        await refreshEventMessage(ID);
        expect(message.edit.mock.calls[0][0].embeds[0].fields.map((f) => f.value).join("\n")).toContain("**Aldric Sturmwind**");
        discord.resolveUserNames.mockResolvedValue(names);
        await refreshEventMessage(ID);
        discord.resolveUserNames.mockResolvedValue({});
        await refreshEventMessage(ID);
        expect(message.edit).toHaveBeenCalledTimes(2);
    });

    it("looks up every raider and the leader, a TBC post asks Discord for nothing", async () => {
        posted();
        await refreshEventMessage(ID);
        expect(discord.resolveUserNames).toHaveBeenCalledWith("g1", ["1", "2", "3", "4", "5", "7"], expect.any(Object));
        discord.resolveUserNames.mockClear();
        getEvent.mockImplementation(() => event({ versionId: "tbc", channelId: "c1" }));
        await refreshEventMessage(ID);
        expect(discord.resolveUserNames).not.toHaveBeenCalled();
    });
});
