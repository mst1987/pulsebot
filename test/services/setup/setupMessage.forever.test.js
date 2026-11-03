// The setup message in a version with last names (WoW Forever): the fields name a raider by the Discord name, the
// character as hover text; the picture draws the character on two lines; invite call and DM keep the full character.
const mockEvents = new Map();
jest.mock("../../../src/stores/events/eventStore", () => ({
    getEvent: jest.fn((id) => (mockEvents.has(id) ? JSON.parse(JSON.stringify(mockEvents.get(id))) : null)),
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
    setEventSetupPost: jest.fn((id, patch) => {
        const e = mockEvents.get(id);
        if (!e) return null;
        e.setupPost = patch ? { ...(e.setupPost || {}), ...JSON.parse(JSON.stringify(patch)) } : null;
        return JSON.parse(JSON.stringify(e));
    }),
    appendEventLog: jest.fn(),
    listEvents: jest.fn(() => []),
    setEventSetupPingText: jest.fn(),
}));
// the real resvg, wrapped so a test can make a render fail
jest.mock("@resvg/resvg-js", () => {
    const actual = jest.requireActual("@resvg/resvg-js");
    return { Resvg: jest.fn((svg, opts) => new actual.Resvg(svg, opts)) };
});
let mockConfig = {};
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({ getClient: jest.fn(), sendDirectMessage: jest.fn(), resolveUserNames: jest.fn(async () => ({})) }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 7 }));
jest.mock("../../../src/services/discord/botLanguage", () => {
    const mocked = {
        ...jest.requireActual("../../../src/services/discord/botLanguage"), serverLang: jest.fn(() => "en"), langOf: jest.fn(() => "en"),
    };
    mocked.eventLang = jest.fn(() => "en");
    return mocked;
});

const { Resvg } = require("@resvg/resvg-js");
const discord = require("../../../src/services/discord/discord");
const variables = require("../../../src/config/variables");
const appEmojis = require("../../../src/services/discord/appEmojis");
const { clearImageCache } = require("../../../src/services/discord/discordImage");
const { _resetForTests: resetNames } = require("../../../src/services/discord/hoverNames");
const { LIMITS } = require("../../../src/services/events/eventMessage")._internal;
const raw = require("../../../src/services/setup/setupMessage");
const { inviteCharacterOf, inviteText } = require("../../../src/services/setup/inviteCall");
const { makeClient, makeChannel } = require("../../helpers/discordClient");
const { cardText } = require("../../helpers/cardText");
const { event: baseEvent } = require("../../factories/events");
const { foreverRaid, longEmojis } = require("../../factories/foreverRaid");

const build = (event, approved, opts = {}) => raw.buildSetupMessage(event, approved, { lang: "en", ...opts });
const COMP = "https://eh.example/e/eh-1/comp";
const ALDRIC = "Aldric Sturmwind";
const DEVI = "Devi Res";
const p = (userId, character, spec, role) => ({ userId, character, classId: spec.split("-")[0], spec, role });
const names = { 1: "Marc", 2: "xX_Lena_Xx", 3: "@everyone", 4: "https://evil.example", 5: "Tommy" };

function approved() {
    return {
        version: 2,
        approvedAt: 1700000000000,
        groups: [
            { index: 1, slots: [p("1", ALDRIC, "Warrior-Protection", "tank"), p("2", DEVI, "Priest-Holy", "healer")] },
            { index: 2, slots: [p("3", "Mira Tal", "Mage-Arcane", "ranged"), p("4", "Kira Stein", "Rogue-Combat", "melee")] },
        ],
        bench: [p("5", "Tom Berg", "Priest-Shadow", "ranged")],
    };
}

function seed(over = {}) {
    const a = over.approvedSetup || approved();
    const event = baseEvent({
        id: "eh-1", guildId: "g1", categoryId: "cat1", channelName: "kara-do", title: "Kara", versionId: "forever",
        size: 25, status: "active",
        setup: { status: "approved", version: 2, options: {}, groups: a.groups, bench: a.bench, approved: a },
        setupPost: null,
        ...over,
    });
    mockEvents.set(event.id, event);
    return event;
}

function fakeChannel() {
    const message = { id: "m1", edit: jest.fn(() => Promise.resolve()) };
    const channel = makeChannel({ id: "c1", messages: [message, ["m-new", message]] });
    discord.getClient.mockReturnValue(makeClient({ channels: [channel] }));
    return { channel, message };
}

const fieldsOf = (message) => message.embeds[0].fields;
const fieldOf = (message, name) => fieldsOf(message).find((f) => f.name === name);
const benchOf = (message) => fieldsOf(message).find((f) => /Bench/.test(f.name));
const linkCount = (message) => (JSON.stringify(fieldsOf(message)).match(/\]\(</g) || []).length;

beforeEach(() => {
    mockEvents.clear();
    mockConfig = { discordVisuals: { setupImage: false } };
    jest.clearAllMocks();
    discord.resolveUserNames.mockImplementation(async () => ({}));
    appEmojis.resetAppEmojis();
    raw._resetForTests();
    resetNames();
    clearImageCache();
    variables.publicBaseUrl = "https://eh.example";
});

describe("the fields of a Forever setup", () => {
    it("name a raider by the Discord name, the character as hover text", () => {
        const value = fieldOf(build(seed(), approved(), { discordNames: names }), "Group 1").value;
        expect(value).toContain(`**[Marc](<${COMP}> "${ALDRIC}")** · Protection`);
    });

    it("do the same on the bench, not bold there", () => {
        const value = benchOf(build(seed(), approved(), { discordNames: names, bench: true })).value;
        expect(value).toBe(`[Tommy](<${COMP}> "Tom Berg") · Shadow`);
    });

    it("escape a Discord name and never ping", () => {
        const message = build(seed(), approved(), { discordNames: names });
        expect(fieldOf(message, "Group 1").value).toContain(`[xX\\_Lena\\_Xx](<${COMP}> "${DEVI}")`);
        const second = fieldOf(message, "Group 2").value;
        expect(second).toContain(`@${String.fromCharCode(0x200b)}everyone`);
        expect(second).not.toContain("@everyone");
        expect(message.allowedMentions && message.allowedMentions.parse).toBeFalsy();
    });

    it("show the character as text for a Discord name that looks like an address", () => {
        const value = fieldOf(build(seed(), approved(), { discordNames: names }), "Group 2").value;
        expect(value).toContain("**Kira Stein**");
        expect(value).not.toContain("evil.example");
    });

    it("show the character without a Discord name", () => {
        const value = fieldOf(build(seed(), approved(), { discordNames: {} }), "Group 1").value;
        expect(value).toContain(`**${ALDRIC}** · Protection`);
        expect(value).not.toContain("](<");
    });

    it("show the character without a public address", () => {
        variables.publicBaseUrl = "";
        const value = fieldOf(build(seed(), approved(), { discordNames: names }), "Group 1").value;
        expect(value).toContain(`**${ALDRIC}** · Protection`);
        expect(value).not.toContain("](<");
    });
});

describe("the same setup in another version", () => {
    it("stays exactly as it was, whatever names are known", () => {
        const a = approved();
        const tbc = seed({ versionId: "tbc" });
        const plain = build(tbc, a, { bench: true });
        expect(build(tbc, a, { bench: true, discordNames: names })).toEqual(plain);
        expect(fieldOf(plain, "Group 1").value).toContain(`**${ALDRIC}** · Protection`);
        expect(benchOf(plain).value).toBe("Tom Berg · Shadow");
    });

    it("a Forever setup without names reads like it", () => {
        const a = approved();
        expect(fieldsOf(build(seed(), a, { bench: true }))).toEqual(fieldsOf(build(seed({ versionId: "tbc" }), a, { bench: true })));
    });
});

describe("the length budget of a full raid", () => {
    const emojis = longEmojis(appEmojis.emojiCatalog());

    /** The raid in groups of five, the last `benched` raiders on the bench. */
    function fullRaid(size, benched = 0) {
        const { signups, discordNames } = foreverRaid(size);
        const people = signups.map((s) => ({ ...s, classId: s.spec.split("-")[0] }));
        const placed = people.slice(0, size - benched);
        const groups = [];
        for (let i = 0; i < placed.length; i += 5) groups.push({ index: groups.length + 1, slots: placed.slice(i, i + 5) });
        return { people, discordNames, approvedSetup: { version: 3, approvedAt: 1700000000000, groups, bench: people.slice(size - benched) } };
    }

    function check(size, benched, namesOf = (n) => n) {
        const { people, discordNames, approvedSetup } = fullRaid(size, benched);
        const event = seed({ approvedSetup, startTime: 1800000000 });
        const longNames = Object.fromEntries(Object.entries(discordNames).map(([id, n]) => [id, namesOf(n)]));
        const message = build(event, approvedSetup, { emojis, discordNames: longNames, bench: true });
        const [embed] = message.embeds;
        expect(raw.embedLength(embed)).toBeLessThanOrEqual(LIMITS.total);
        for (const f of embed.fields) expect(f.value.length).toBeLessThanOrEqual(LIMITS.fieldValue);
        const text = JSON.stringify(embed.fields);
        expect(text).not.toMatch(/\+\d+ more/);
        // nobody disappears: each raider stands there, by Discord name or character
        for (const person of people) {
            const shown = longNames[person.userId].match(/[A-Za-z]+/)[0];
            expect(text.includes(person.character) || text.includes(shown)).toBe(true);
        }
        return { length: raw.embedLength(embed), links: linkCount(message) };
    }

    // Measured with 19-digit emoji ids: 25 raiders in five groups have room for every link, 40 in eight groups for
    // the first ones of each group; the others show the plain Discord name.
    it("25 raiders keep every link", () => {
        expect(check(25, 0).links).toBe(25);
    });

    it("40 raiders all stay visible, with fewer links", () => {
        const { length, links } = check(40, 0);
        expect(links).toBeGreaterThan(0);
        expect(links).toBeLessThan(40);
        expect(length).toBeLessThanOrEqual(LIMITS.total);
    });

    it("a raid with a bench stays visible too", () => {
        expect(check(40, 5).length).toBeLessThanOrEqual(LIMITS.total);
    });

    it("long Discord names give up links, not raiders", () => {
        const { links } = check(40, 0, (n) => `${n} ${"x".repeat(32)}`.slice(0, 32));
        expect(links).toBeLessThan(40);
    });

    it("the same raid in TBC shows every character without a link", () => {
        const { people, discordNames, approvedSetup } = fullRaid(40);
        const event = seed({ approvedSetup, versionId: "tbc" });
        const message = build(event, approvedSetup, { emojis, discordNames });
        expect(linkCount(message)).toBe(0);
        for (const person of people) expect(JSON.stringify(fieldsOf(message))).toContain(person.character);
    });
});

describe("the message in Discord", () => {
    it("asks Discord for the names of everyone in the setup, with the fields", async () => {
        fakeChannel();
        seed();
        discord.resolveUserNames.mockResolvedValue({ 1: "Marc" });
        await raw.postOrEditSetupMessage("eh-1", { userId: "orga", now: 1 });
        const [guild, ids, { waitMs }] = discord.resolveUserNames.mock.calls[0];
        expect(guild).toBe("g1");
        expect(ids).toEqual(["1", "2", "3", "4", "5"]);
        expect(waitMs).toBeLessThan(3000);
    });

    it("posts the hover link", async () => {
        const { channel } = fakeChannel();
        seed();
        discord.resolveUserNames.mockResolvedValue({ 1: "Marc" });
        await raw.postOrEditSetupMessage("eh-1", { userId: "orga", now: 1 });
        const sent = channel.send.mock.calls[0][0];
        expect(JSON.stringify(sent.embeds[0].fields ?? sent.embeds[0].data.fields)).toContain("[Marc](<");
    });

    it("asks for nothing while the picture is on", async () => {
        mockConfig = { discordVisuals: { setupImage: true } };
        fakeChannel();
        seed();
        await raw.postOrEditSetupMessage("eh-1", { userId: "orga", now: 1 });
        expect(discord.resolveUserNames).not.toHaveBeenCalled();
    });

    it("falls back to the fields with names when the picture cannot be rendered", async () => {
        mockConfig = { discordVisuals: { setupImage: true } };
        Resvg.mockImplementationOnce(() => { throw new Error("no renderer"); });
        const { channel } = fakeChannel();
        seed();
        discord.resolveUserNames.mockResolvedValue({ 1: "Marc" });
        await raw.postOrEditSetupMessage("eh-1", { userId: "orga", now: 1 });
        expect(discord.resolveUserNames).toHaveBeenCalledTimes(1);
        const sent = channel.send.mock.calls[0][0];
        expect(JSON.stringify(sent.embeds[0].fields ?? sent.embeds[0].data.fields)).toContain("[Marc](<");
    });

    it("asks for nothing in another version", async () => {
        fakeChannel();
        seed({ versionId: "tbc" });
        await raw.postOrEditSetupMessage("eh-1", { userId: "orga", now: 1 });
        expect(discord.resolveUserNames).not.toHaveBeenCalled();
    });

    it("a name that does not arrive in time does not change the next message", async () => {
        const { channel, message } = fakeChannel();
        seed();
        discord.resolveUserNames.mockResolvedValueOnce({ 1: "Marc" });
        await raw.postOrEditSetupMessage("eh-1", { userId: "orga", now: 1 });
        const first = channel.send.mock.calls[0][0];
        discord.resolveUserNames.mockResolvedValueOnce({});
        await raw.postOrEditSetupMessage("eh-1", { userId: "orga", now: 2 });
        const second = message.edit.mock.calls[0][0];
        expect(JSON.stringify(second.embeds)).toBe(JSON.stringify(first.embeds));
    });
});

describe("what the game needs keeps the full character", () => {
    it("the invite call whispers the whole name", () => {
        const event = seed();
        const character = inviteCharacterOf(event, event.setup.approved, "1");
        expect(character).toBe(ALDRIC);
        expect(inviteText(character)).toBe(`/w ${ALDRIC} inv`);
    });

    it("the DM names the character", () => {
        const dm = raw.buildSetupDm(seed(), { ...p("1", ALDRIC, "Warrior-Protection", "tank"), group: 1 }, { lang: "en" });
        expect(cardText(dm)).toContain(ALDRIC);
        expect(cardText(dm)).not.toContain("](<");
    });

    it("the DM of the bench too", () => {
        const dm = raw.buildSetupDm(seed(), { ...p("5", "Tom Berg", "Priest-Shadow", "ranged"), bench: true }, { lang: "en" });
        expect(cardText(dm)).toContain("Tom Berg");
    });

    it("the picture draws the character, on two lines, and no Discord name", () => {
        const event = seed();
        const message = build(event, approved(), { image: true, discordNames: names });
        const { svg } = message.images[0];
        expect(svg).toContain(">Aldric<");
        expect(svg).toContain(">Sturmwind<");
        expect(svg).not.toContain("Marc");
    });

    it("the picture of another version stays on one line", () => {
        const event = seed({ versionId: "tbc" });
        const { svg } = build(event, approved(), { image: true }).images[0];
        expect(svg).toContain(`>${DEVI}<`);
        expect(svg).not.toContain(">Sturmwind<");
    });
});
