// The signup flow's short answers as embeds (#508): utils/signup/signupReply.js
// and the save confirmation signupButtons.savedEmbed built on it.
jest.mock("../../../src/stores/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/stores/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/stores/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/signupMocks").discord());

const { MessageFlags } = require("discord.js");
const { EMBED_ACCENT_COLOR } = require("../../../src/config/constants");
const { embedColor } = require("../../../src/services/events/embedLook");
const profiles = require("../../../src/stores/raiderProfileStore");
const appEmojis = require("../../../src/services/discord/appEmojis");
const { tempStoreFile } = require("../../helpers/tempStore");
const { ownEvent } = require("../../helpers/signupMocks");
const { asEmbed, cardButtons } = require("../../helpers/card");
const {
    plainTitle, colorOf, answerEmbed, answerPayload, answerUpdate,
} = require("../../../src/utils/signup/signupReply");
const { savedEmbed } = require("../../../src/utils/signup/signupButtons");

beforeAll(() => profiles.useFile(tempStoreFile("signup-reply-profiles")));
afterAll(() => profiles.useFile(null));
afterEach(() => appEmojis.resetAppEmojis());

const OWN_COLOR = ownEvent({ color: "#112233" });

describe("utils/signup/signupReply", () => {
    it("a single line is the description, without a title", () => {
        expect(answerEmbed("This event no longer exists.")).toEqual({ description: "This event no longer exists." });
    });

    it("several lines: the first is the title (bold marks gone), the rest the description", () => {
        expect(answerEmbed("✅ Saved for **Karazhan**:\n`1.` Zibbo · Holy\n⏳ waiting list")).toEqual({
            title: "✅ Saved for Karazhan:",
            description: "`1.` Zibbo · Holy\n⏳ waiting list",
        });
        expect(plainTitle("**A** and **B** ")).toBe("A and B");
    });

    it("an explicit title keeps the whole text as the description", () => {
        expect(answerEmbed("line one\nline two", { title: "Sign up" })).toEqual({ title: "Sign up", description: "line one\nline two" });
    });

    it("turns German service sentences into English, line by line", () => {
        expect(answerEmbed("⚠️ Für diesen Raid brauchst du eine Raider-Rolle.").description).toBe("⚠️ You need a raider role for this raid.");
        expect(answerEmbed("Event nicht gefunden.").description).toBe("This event no longer exists.");
    });

    it("takes the raid's colour: its own, else the accent colour", () => {
        expect(answerEmbed("x", { event: OWN_COLOR }).color).toBe(0x112233);
        expect(colorOf(ownEvent())).toBe(embedColor(ownEvent()));
        expect(colorOf(null)).toBeUndefined();
    });

    it("answerPayload is an ephemeral card with the given buttons inside", () => {
        const components = [{ type: 1, components: [{ type: 2, style: 5, label: "Go", url: "https://x.example" }] }];
        const p = answerPayload("No raid picked.", { components });
        expect(p.flags).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
        expect(asEmbed(p)).toMatchObject({ color: EMBED_ACCENT_COLOR, description: "No raid picked." });
        expect(cardButtons(p)).toEqual([expect.objectContaining({ label: "Go", url: "https://x.example" })]);
        expect(asEmbed(answerPayload({ title: "T", description: "D" }))).toMatchObject({ color: EMBED_ACCENT_COLOR, title: "T", description: "D" });
    });

    it("answerUpdate turns the member's message into the card, without text, embed or buttons", () => {
        const p = answerUpdate("Unknown action.", { event: OWN_COLOR });
        expect(p).toMatchObject({ content: "", embeds: [] });
        expect(p.flags).toBe(MessageFlags.IsComponentsV2);
        expect(asEmbed(p)).toMatchObject({ color: 0x112233, description: "Unknown action." });
        expect(cardButtons(p)).toEqual([]);
    });

    it("cuts a text longer than Discord allows instead of failing the reply", () => {
        const embed = asEmbed(answerPayload(`Head\n${"x".repeat(5000)}`));
        expect(embed.title).toBe("Head");
        expect(embed.text.length).toBeLessThanOrEqual(4000);
        expect(embed.description.endsWith("…")).toBe(true);
    });
});

describe("signupButtons.savedEmbed", () => {
    const event = ownEvent({ color: "#112233" });
    const signup = {
        status: "signed",
        characters: [
            { character: "Zibbo", spec: "Priest-Holy", status: "signed" },
            { character: "Zibbowar", spec: "Warrior-Protection", status: "bench" },
        ],
    };
    const profile = { characters: [] };
    const when = `🗓️ <t:${event.startTime}:d> <t:${event.startTime}:t> · <t:${event.startTime}:R>`;

    it("plain text: title, one line per character, the raid start, the waiting list", () => {
        expect(savedEmbed(event, signup, profile, { lang: "en", notice: "Der Raid ist voll (10/10) – du stehst auf der Warteliste (Bank). Ob jemand nachrückt, entscheidet die Raidleitung." })).toEqual({
            title: "Saved for Karazhan",
            description: [
                "`1.` Zibbo · Holy – **Signed up**",
                "`2.` Zibbowar · Protection – **Bench**",
                "",
                when,
                "⏳ The raid is full (10/10) – you are on the waiting list (bench). The raid lead decides who moves up.",
            ].join("\n"),
            color: 0x112233,
        });
    });

    it("with the app emojis: spec and status icons stay in the lines, the head icon in the title", () => {
        appEmojis.setAppEmojis(appEmojis.emojiCatalog().map((e, i) => ({ id: String(900 + i), name: e.name })));
        const embed = savedEmbed(event, signup, profile, { emojis: appEmojis.appEmojiMap(), lang: "en" });
        const noIds = (s) => s.replace(/:\d+>/g, ">");
        expect(noIds(embed.title)).toBe("<:eh_ui_signed> Saved for Karazhan");
        expect(noIds(embed.description).split("\n")).toEqual([
            "`1` <:eh_priest_holy> Zibbo · Holy  ·  <:eh_ui_signed> **Signed up**",
            "`2` <:eh_warrior_protection> Zibbowar · Protection  ·  <:eh_ui_bench> **Bench**",
            "",
            when,
        ]);
    });

    it("auf Deutsch: Titel, Status-Wörter und der Hinweis des Dienstes bleiben deutsch", () => {
        expect(savedEmbed(event, signup, profile, { notice: "Der Raid ist voll (10/10) – du stehst auf der Warteliste (Bank). Ob jemand nachrückt, entscheidet die Raidleitung." })).toEqual({
            title: "Gespeichert für Karazhan",
            description: [
                "`1.` Zibbo · Heilig – **Dabei**",
                "`2.` Zibbowar · Schutz – **Bank**",
                "",
                when,
                "⏳ Der Raid ist voll (10/10) – du stehst auf der Warteliste (Bank). Ob jemand nachrückt, entscheidet die Raidleitung.",
            ].join("\n"),
            color: 0x112233,
        });
        expect(savedEmbed(event, { status: "absence", comment: "Arbeit" }, profile).title).toBe("Abgemeldet von Karazhan");
    });

    it("a sign-off names the raid in the title and the reason below", () => {
        expect(savedEmbed(event, { status: "absence", comment: "Arbeit" }, profile, { lang: "en" })).toEqual({
            title: "Signed off from Karazhan",
            description: `Reason: Arbeit\n\n${when}`,
            color: 0x112233,
        });
        const noStart = ownEvent({ startTime: undefined });
        expect(savedEmbed(noStart, null, profile, { lang: "en" })).toEqual({
            title: "Signed off from Karazhan",
            color: embedColor(noStart),
        });
    });
});
