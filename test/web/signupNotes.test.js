// Die Nachricht zu „Vielleicht“ / „Absagen“: Modus je Kategorie, wann gepostet
// wird, wie der Post aussieht und dass ein Fehlschlag nie wirft.
jest.mock("../../src/web/discord", () => ({ postNotice: jest.fn(async () => ({ messageId: "m" })), channelVisible: jest.fn(() => true) }));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: () => ({}) }));

const discord = require("../../src/web/discord");
const notes = require("../../src/web/signupNotes");

const EVENT = { id: "eh-1", title: "SSC + TK", categoryId: "cat-1", startTime: 1760000000, guildId: "10000", channelId: "20000", message: { messageId: "30000" } };
const CHANNEL = { discordServers: { signupNoteChannelId: "777777" } };
const signup = (over = {}) => ({ userId: "123456", character: "zibbo", status: "absence", comment: "Arbeit", ...over });
const notePayload = (text) => expect.objectContaining({ embeds: [expect.objectContaining({ description: expect.stringContaining(text) })] });

beforeEach(() => discord.postNotice.mockClear());

describe("web/signupNotes", () => {
    it("reads the category's mode, optional by default", () => {
        const config = { categorySignupNotes: { a: "required", b: "none", c: "odd" } };
        expect(notes.noteMode("a", config)).toBe("required");
        expect(notes.noteMode("b", config)).toBe("none");
        expect(notes.noteMode("c", config)).toBe("optional");
        expect(notes.noteMode("x", config)).toBe("optional");
        expect(notes.noteMode("", null)).toBe("optional");
    });

    it("finds a new note only for a changed status or comment of Vielleicht / Absagen", () => {
        expect(notes.hasNewNote(null, signup())).toBe(true);
        expect(notes.hasNewNote(null, signup({ comment: "  " }))).toBe(false);
        expect(notes.hasNewNote(null, signup({ status: "late" }))).toBe(false);
        expect(notes.hasNewNote(signup(), signup())).toBe(false);
        expect(notes.hasNewNote(signup({ status: "tentative" }), signup())).toBe(true);
        expect(notes.hasNewNote(signup(), signup({ comment: "Urlaub" }))).toBe(true);
        expect(notes.hasNewNote(null, null)).toBe(false);
    });

    it("builds an embed like Raid-Helper's: title bar, who/status/reason, and a closing raid line", () => {
        const post = notes.buildNotePost(EVENT, signup({ comment: "**krank** @everyone\n> x" }));
        expect(post.embeds).toHaveLength(1);
        const embed = post.embeds[0];
        expect(embed.title).toBe("Notification received!");
        expect(typeof embed.color).toBe("number");
        const lines = embed.description.split("\n");
        expect(lines[0]).toBe("**<@123456> (zibbo)** signed up as **Absent** with the following reason:");
        expect(lines[1]).toBe("");
        expect(lines[2]).toBe("\\*\\*krank\\*\\* @​everyone \\> x");
        expect(lines[3]).toBe("");
        expect(lines[4]).toBe("<@123456> | **[SSC + TK](https://discord.com/channels/10000/20000/30000)** <t:1760000000:f>");

        const noCharacter = notes.buildNotePost({ title: "Kara" }, signup({ status: "tentative", character: "" }));
        const noCharacterLines = noCharacter.embeds[0].description.split("\n");
        expect(noCharacterLines[0]).toBe("**<@123456>** signed up as **Tentative** with the following reason:");
        expect(noCharacterLines[4]).toBe("<@123456> | **Kara**");
    });

    it("posts to the configured channel", async () => {
        await expect(notes.postSignupNote(EVENT, signup(), null, { config: CHANNEL })).resolves.toEqual({ posted: true, channelId: "777777" });
        expect(discord.postNotice).toHaveBeenCalledTimes(1);
        expect(discord.postNotice).toHaveBeenCalledWith("777777", notePayload("Arbeit"));
    });

    it("skips without a note, for the orga, a category without messages or without a channel", async () => {
        expect(await notes.postSignupNote(EVENT, signup({ comment: "" }), null, { config: CHANNEL })).toMatchObject({ skipped: "no_note" });
        expect(await notes.postSignupNote(EVENT, signup(), null, { config: CHANNEL, byOrga: true })).toMatchObject({ skipped: "by_orga" });
        expect(await notes.postSignupNote(EVENT, signup(), null, { config: { ...CHANNEL, categorySignupNotes: { "cat-1": "none" } } })).toMatchObject({ skipped: "off" });
        expect(await notes.postSignupNote(EVENT, signup(), null, { config: {} })).toMatchObject({ skipped: "no_channel" });
        expect(discord.postNotice).not.toHaveBeenCalled();
    });

    it("never throws when the post fails", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        discord.postNotice.mockRejectedValueOnce(new Error("Missing Access"));
        await expect(notes.postSignupNote(EVENT, signup(), null, { config: CHANNEL })).resolves.toEqual({ posted: false, error: "Missing Access" });
        expect(discord.postNotice).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});

describe("web/signupNotes — Kanal je Kategorie (#335)", () => {
    const OWN = { ...CHANNEL, categorySignupNoteChannel: { "cat-1": "888888" } };

    beforeEach(() => discord.channelVisible.mockReset().mockReturnValue(true));

    it("picks the category's own channel, else the default, else none", () => {
        expect(notes.noteChannelFor("cat-1", OWN)).toBe("888888");
        expect(notes.noteChannelFor("cat-2", OWN)).toBe("777777");
        expect(notes.noteChannelFor("cat-1", { categorySignupNoteChannel: { "cat-1": "888888" } })).toBe("888888");
        expect(notes.noteChannelFor("cat-2", { categorySignupNoteChannel: { "cat-1": "888888" } })).toBe("");
        expect(notes.noteChannelFor("", null)).toBe("");
    });

    it("ignores an id that is no snowflake", () => {
        expect(notes.noteChannelFor("cat-1", { ...CHANNEL, categorySignupNoteChannel: { "cat-1": "#abmeldungen" } })).toBe("777777");
        expect(notes.noteChannelFor("cat-1", { ...CHANNEL, categorySignupNoteChannel: { "cat-1": "" } })).toBe("777777");
    });

    it("falls back to the default when the bot cannot reach the own channel", () => {
        expect(notes.noteChannelFor("cat-1", OWN, { reachable: (id) => id !== "888888" })).toBe("777777");
        expect(notes.noteChannelFor("cat-1", OWN, { reachable: () => true })).toBe("888888");
    });

    it("posts into the category's channel", async () => {
        await expect(notes.postSignupNote(EVENT, signup(), null, { config: OWN })).resolves.toEqual({ posted: true, channelId: "888888" });
        expect(discord.channelVisible).toHaveBeenCalledWith("888888");
        expect(discord.postNotice).toHaveBeenCalledTimes(1);
        expect(discord.postNotice).toHaveBeenCalledWith("888888", notePayload("Arbeit"));
    });

    it("posts into the default channel when the own one is out of reach", async () => {
        discord.channelVisible.mockReturnValue(false);
        await expect(notes.postSignupNote(EVENT, signup(), null, { config: OWN })).resolves.toEqual({ posted: true, channelId: "777777" });
        expect(discord.postNotice).toHaveBeenCalledTimes(1);
        expect(discord.postNotice).toHaveBeenCalledWith("777777", notePayload("Arbeit"));
    });

    it("tries the default channel when the own one refuses the post, and never throws", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        discord.postNotice.mockRejectedValueOnce(new Error("Unknown Channel"));
        await expect(notes.postSignupNote(EVENT, signup(), null, { config: OWN })).resolves.toEqual({ posted: true, channelId: "777777" });
        expect(discord.postNotice.mock.calls.map((c) => c[0])).toEqual(["888888", "777777"]);

        discord.postNotice.mockClear();
        discord.postNotice.mockRejectedValueOnce(new Error("Unknown Channel"));
        const alone = { categorySignupNoteChannel: { "cat-1": "888888" } };
        await expect(notes.postSignupNote(EVENT, signup(), null, { config: alone })).resolves.toEqual({ posted: false, error: "Unknown Channel" });
        expect(discord.postNotice).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it("posts nothing for a category with messages off, whatever its channel", async () => {
        const off = { ...OWN, categorySignupNotes: { "cat-1": "none" } };
        expect(await notes.postSignupNote(EVENT, signup(), null, { config: off })).toMatchObject({ skipped: "off" });
        expect(discord.postNotice).not.toHaveBeenCalled();
    });
});
