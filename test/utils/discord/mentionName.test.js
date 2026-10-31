const {
    MAX_USERS, nameAndMention, nameOrMention, nameFromSignups, plainName, mentionedUserIds, withoutMentions, mentionEdit, silentMentionSteps,
} = require("../../../src/utils/discord/mentionName");
const { card } = require("../../../src/utils/discord/card");

const ZWSP = String.fromCharCode(0x200b);
const UID = "123456789012345678";
const UID2 = "223456789012345678";

describe("nameAndMention", () => {
    test("name as text first, the mention behind it", () => {
        expect(nameAndMention("Thrall", UID)).toBe(`**Thrall** · <@${UID}>`);
    });
    test("just the mention without a name, just the name without an id", () => {
        expect(nameAndMention("", UID)).toBe(`<@${UID}>`);
        expect(nameAndMention("  ", UID)).toBe(`<@${UID}>`);
        expect(nameAndMention("Thrall", "")).toBe("**Thrall**");
        expect(nameAndMention("Thrall", "nope")).toBe("**Thrall**");
        expect(nameAndMention(null, undefined)).toBe("");
    });
    test("the name cannot break the markdown or ping", () => {
        expect(nameAndMention("*x*_y_ @everyone\nz", UID)).toBe(`**\\*x\\*\\_y\\_ @${ZWSP}everyone z** · <@${UID}>`);
    });
});

describe("nameOrMention", () => {
    test("the plain name, the mention only without one", () => {
        expect(nameOrMention("Thrall", UID)).toBe("Thrall");
        expect(nameOrMention("", UID)).toBe(`<@${UID}>`);
        expect(nameOrMention("", "")).toBe("");
    });
    test("plainName escapes", () => {
        expect(plainName("a|b")).toBe("a\\|b");
    });
});

describe("nameFromSignups", () => {
    test("own events' character, Raid-Helper's name, the newest row wins", () => {
        const rows = [{ userId: UID, character: "Alt" }, { userId: UID2, name: "Jaina" }, { userId: UID, character: "Thrall" }];
        expect(nameFromSignups(rows, UID)).toBe("Thrall");
        expect(nameFromSignups(rows, UID2)).toBe("Jaina");
    });
    test("\"\" when not signed up or nothing given", () => {
        expect(nameFromSignups([{ userId: UID2, character: "X" }], UID)).toBe("");
        expect(nameFromSignups(null, UID)).toBe("");
        expect(nameFromSignups([{ userId: UID }], "")).toBe("");
    });
    test("the newest row WITH a name: a later row without one does not hide it", () => {
        expect(nameFromSignups([{ userId: UID, character: "Thrall" }, { userId: UID, status: "late" }], UID)).toBe("Thrall");
        expect(nameFromSignups([{ userId: UID, character: " " }], UID)).toBe("");
    });
});

describe("mentions in a payload", () => {
    const payload = () => card({ title: "Gildenbank", text: `**Thrall** · <@${UID}> · vor 2 Minuten\nAn: <@!${UID2}>` });

    test("mentionedUserIds finds them in text displays and content, each once", () => {
        expect(mentionedUserIds(payload())).toEqual([UID, UID2]);
        expect(mentionedUserIds({ content: `<@${UID}> und <@${UID}>` })).toEqual([UID]);
        expect(mentionedUserIds({})).toEqual([]);
    });

    test("withoutMentions takes them out with their separator, the rest stays", () => {
        const stripped = withoutMentions(payload(), [UID, UID2]);
        const texts = JSON.stringify(stripped.components);
        expect(texts).not.toContain(`<@${UID}>`);
        expect(texts).not.toContain(`<@!${UID2}>`);
        expect(texts).toContain("**Thrall** · vor 2 Minuten");
        expect(withoutMentions({ content: `<@${UID}>` }, [UID]).content).toBe("");
    });

    test("a label left alone goes away with its line, other lines stay", () => {
        const stripped = withoutMentions(payload(), [UID, UID2]);
        const text = stripped.components[0].components.find((c) => c.type === 10 && c.content.includes("Thrall")).content;
        expect(text).not.toContain("An:");
        expect(withoutMentions({ content: `Kopf\n**An:** <@${UID}>\n- <@${UID2}>\nFuß` }, [UID, UID2]).content).toBe("Kopf\nFuß");
        expect(withoutMentions({ content: `Leader: **Thrall** · <@${UID}>` }, [UID]).content).toBe("Leader: **Thrall**");
        expect(withoutMentions({ content: "Zeit: 20:00\nLeer: " }, [UID]).content).toBe("Zeit: 20:00\nLeer: ");
    });

    test("silentMentionSteps: post without the mentions, then the edit with the users", () => {
        const steps = silentMentionSteps(payload());
        expect(JSON.stringify(steps.first.components)).not.toContain(`<@${UID}>`);
        expect(steps.first.allowedMentions).toEqual({ parse: [] });
        expect(steps.then.components).toEqual(payload().components);
        expect(steps.then.allowedMentions).toEqual({ parse: [], users: [UID, UID2] });
        expect(mentionEdit(payload()).allowedMentions).toEqual({ parse: [], users: [UID, UID2] });
    });

    test("the edit leaves files and attachments out, the post keeps them", () => {
        const withFiles = { ...payload(), files: [{ name: "a.png" }], attachments: [] };
        const steps = silentMentionSteps(withFiles);
        expect(steps.first.files).toEqual([{ name: "a.png" }]);
        expect(steps.first.attachments).toEqual([]);
        expect(steps.then).not.toHaveProperty("files");
        expect(steps.then).not.toHaveProperty("attachments");
    });

    test("nobody mentioned: one plain post", () => {
        const steps = silentMentionSteps({ content: "hi" });
        expect(steps).toEqual({ first: { content: "hi", allowedMentions: { parse: [] } }, then: null });
        expect(mentionEdit({ content: "hi" }).allowedMentions).toEqual({ parse: [] });
    });

    test("at most MAX_USERS users, the rest stays in the text unpinged", () => {
        const ids = Array.from({ length: MAX_USERS + 5 }, (_, i) => String(100000000000000000 + i * 1000));
        const content = ids.map((id) => `<@${id}>`).join(" ");
        const steps = silentMentionSteps({ content });
        expect(steps.then.allowedMentions.users).toHaveLength(MAX_USERS);
        expect(steps.first.content).toContain(`<@${ids[MAX_USERS]}>`);
        expect(steps.first.content).not.toContain(`<@${ids[0]}>`);
    });
});
