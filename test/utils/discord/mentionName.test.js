const {
    SILENT_MENTION_EDIT, nameAndMention, nameOrMention, nameFromSignups, plainName, mentionedUserIds, withoutMentions, mentionEdit, silentMentionSteps,
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

    test("the switch is off: nothing but parse []", () => {
        expect(SILENT_MENTION_EDIT).toBe(false);
        const steps = silentMentionSteps(payload());
        expect(steps.then).toBeNull();
        expect(steps.first.allowedMentions).toEqual({ parse: [] });
        expect(steps.first.components).toEqual(payload().components);
        expect(mentionEdit(payload()).allowedMentions).toEqual({ parse: [] });
    });

    test("switched on: post without the mentions, then the edit with the users", () => {
        const steps = silentMentionSteps(payload(), { enabled: true });
        expect(JSON.stringify(steps.first.components)).not.toContain(`<@${UID}>`);
        expect(steps.first.allowedMentions).toEqual({ parse: [] });
        expect(steps.then.components).toEqual(payload().components);
        expect(steps.then.allowedMentions).toEqual({ parse: [], users: [UID, UID2] });
        expect(mentionEdit(payload(), { enabled: true }).allowedMentions).toEqual({ parse: [], users: [UID, UID2] });
    });

    test("switched on but nobody mentioned: one plain post", () => {
        const steps = silentMentionSteps({ content: "hi" }, { enabled: true });
        expect(steps).toEqual({ first: { content: "hi", allowedMentions: { parse: [] } }, then: null });
        expect(mentionEdit({ content: "hi" }, { enabled: true }).allowedMentions).toEqual({ parse: [] });
    });
});
