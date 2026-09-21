// Die Nachricht zu „Vielleicht“ / „Absagen“: Modus je Kategorie, wann gepostet
// wird, wie der Post aussieht und dass ein Fehlschlag nie wirft.
jest.mock("../../src/web/discord", () => ({ postNotice: jest.fn(async () => ({ messageId: "m" })) }));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: () => ({}) }));

const discord = require("../../src/web/discord");
const notes = require("../../src/web/signupNotes");

const EVENT = { id: "eh-1", title: "SSC + TK", categoryId: "cat-1", startTime: 1760000000, guildId: "10000", channelId: "20000", message: { messageId: "30000" } };
const CHANNEL = { discordServers: { signupNoteChannelId: "777777" } };
const signup = (over = {}) => ({ userId: "123456", character: "zibbo", status: "absence", comment: "Arbeit", ...over });

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

    it("builds one line with raider, status and raid link, the note quoted and defused", () => {
        const text = notes.buildNotePost(EVENT, signup({ comment: "**krank** @everyone\n> x" }));
        const [head, quote] = text.split("\n");
        expect(head).toBe("<@123456> (zibbo) · **Absent** · [SSC + TK](https://discord.com/channels/10000/20000/30000) · <t:1760000000:f>");
        expect(quote).toBe("> \\*\\*krank\\*\\* @​everyone \\> x");
        expect(notes.buildNotePost({ title: "Kara" }, signup({ status: "tentative", character: "" })).split("\n")[0]).toBe("<@123456> · **Tentative** · **Kara**");
    });

    it("posts to the configured channel", async () => {
        await expect(notes.postSignupNote(EVENT, signup(), null, { config: CHANNEL })).resolves.toEqual({ posted: true });
        expect(discord.postNotice).toHaveBeenCalledWith("777777", expect.stringContaining("> Arbeit"));
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
        warn.mockRestore();
    });
});
