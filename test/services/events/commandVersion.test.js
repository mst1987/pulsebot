const { versionOfCommand, categoryIdOfChannel, eventsOfVersion, versionNote, addVersionOption } = require("../../../src/services/events/commandVersion");
const { eventVersionTag, versionShort } = require("../../../src/services/events/versionTag");
const { SlashCommandBuilder } = require("discord.js");

const config = { mainVersion: "tbc", categoryVersion: { catF: "forever" } };
const interaction = (channel, version = null, guild = null) => ({
    channel, guild, options: { getString: (n) => (n === "version" ? version : null) },
});

describe("versionOfCommand (#743)", () => {
    it("uses the version of the channel's category", () => {
        expect(versionOfCommand(interaction({ parentId: "catF" }), { config })).toMatchObject({ versionId: "forever", explicit: false });
    });

    it("counts a thread as the category of its parent channel", () => {
        const thread = { isThread: () => true, parentId: "text", parent: { parentId: "catF" } };
        expect(versionOfCommand(interaction(thread), { config }).versionId).toBe("forever");
        const uncached = { isThread: () => true, parentId: "text", parent: null };
        const guild = { channels: { cache: new Map([["text", { parentId: "catF" }]]) } };
        expect(categoryIdOfChannel(uncached, guild)).toBe("catF");
    });

    it("answers the main version outside a raid category", () => {
        expect(versionOfCommand(interaction({ parentId: "other" }), { config }).versionId).toBe("tbc");
        expect(versionOfCommand(interaction(null), { config: { mainVersion: "forever" } }).versionId).toBe("forever");
    });

    it("lets the version option win, and ignores an unknown one", () => {
        expect(versionOfCommand(interaction({ parentId: "catF" }, "tbc"), { config })).toMatchObject({ versionId: "tbc", explicit: true });
        expect(versionOfCommand(interaction({ parentId: "catF" }, "nope"), { config }).versionId).toBe("forever");
    });

    it("falls back to the main version for a hidden one", () => {
        const hiding = { ...config, hideOtherVersions: true };
        expect(versionOfCommand(interaction({ parentId: "catF" }), { config: hiding }).versionId).toBe("tbc");
        expect(versionOfCommand(interaction(null, "forever"), { config: hiding }).versionId).toBe("tbc");
    });
});

describe("helpers", () => {
    it("filters events by their stored version and names the version", () => {
        const events = [{ id: "a", versionId: "tbc" }, { id: "b", versionId: "forever" }];
        expect(eventsOfVersion(events, "forever", { config }).map((e) => e.id)).toEqual(["b"]);
        expect(versionNote("forever")).toBe("Version: WoW Forever");
    });

    it("adds a version choice option with every game version", () => {
        const json = addVersionOption(new SlashCommandBuilder().setName("x").setDescription("x")).toJSON();
        const opt = json.options.find((o) => o.name === "version");
        expect(opt.required).toBeFalsy();
        expect(opt.choices.map((c) => c.value)).toEqual(expect.arrayContaining(["tbc", "forever"]));
    });

    it("tags a raid with its short version name, unless only one version is visible", () => {
        expect(eventVersionTag({ versionId: "forever" }, { config })).toBe("Forever");
        expect(eventVersionTag({ versionId: "tbc" }, { config })).toBe(versionShort("tbc"));
        expect(eventVersionTag({ versionId: "forever" }, { config: { hideOtherVersions: true } })).toBe("");
        expect(eventVersionTag(null, { config })).toBe("");
    });
});
