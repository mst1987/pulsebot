// "Suche": what the raid still needs (roles, required and raid buffs, open places), the message that looks
// for it, and posting it into the event channel.
const mockEvents = new Map();
const mockLog = [];
jest.mock("../../src/web/eventStore", () => ({
    getEvent: (id) => mockEvents.get(id) || null,
    isOwnEventId: (id) => String(id).startsWith("eh-"),
    appendEventLog: (id, entry) => mockLog.push({ id, ...entry }),
}));
const mockPost = jest.fn();
jest.mock("../../src/web/discord", () => ({ postNotice: (...a) => mockPost(...a) }));

const { suggestSearch, textForNeeds, postSearch } = require("../../src/web/raidSearch");

const slots = (n) => Array.from({ length: n }, (_, i) => ({ userId: `u${i}` }));
function event(over = {}) {
    return {
        id: "eh-1", guildId: "g1", channelId: "c1", title: "Gruul's Lair", startTime: 2000000000, size: 25, versionId: "tbc", status: "open",
        message: { messageId: "m1" },
        setup: {
            groups: [{ index: 1, slots: slots(5) }, { index: 2, slots: slots(5) }, { index: 3, slots: slots(5) }, { index: 4, slots: slots(3) }],
            checks: {
                size: { count: 18, size: 25, ok: false },
                roles: { tank: { count: 1, min: 2, max: 2 }, healer: { count: 3, min: 5, max: 5 }, melee: { count: 6, min: 0, max: null }, ranged: { count: 8, min: 0, max: null } },
                buffs: {
                    required: [{ key: "windfury", label: "Totem des Windzorns", icon: "spell_nature_windfury", present: false }],
                    raid: [{ key: "kings", label: "Segen der Könige", icon: "spell_magic_magearmor", present: true }],
                },
            },
        },
        ...over,
    };
}

describe("suggestSearch", () => {
    it("names the roles that are short, with the specs that fill them, and the open places", () => {
        const s = suggestSearch(event());
        expect(s).toMatchObject({ size: 25, placed: 18, open: 7 });
        expect(s.roles).toEqual([
            { role: "tank", missing: 1, specs: expect.arrayContaining(["Warrior-Protection", "Paladin-Protection", "Druid-Guardian"]) },
            { role: "healer", missing: 2, specs: expect.arrayContaining(["Priest-Holy", "Paladin-Holy", "Shaman-Restoration", "Druid-Restoration"]) },
        ]);
        // a role whose minimum is met is not listed
        expect(s.roles.map((r) => r.role)).not.toContain("melee");
    });

    it("names the specs that bring a required buff nobody brings yet", () => {
        const s = suggestSearch(event());
        expect(s.buffs).toEqual([{ key: "windfury", label: "Totem des Windzorns", icon: "spell_nature_windfury", required: true, specs: expect.arrayContaining(["Shaman-Enhancement"]) }]);
    });

    it("writes the message for raiders in English, with the roles, the buff providers and the link to the signup", () => {
        const { text } = suggestSearch(event());
        expect(text).toContain("**Looking for more raiders – Gruul's Lair**");
        expect(text).toContain("<t:2000000000:F> · 18 of 25 places filled");
        expect(text).toContain("• 1× Tank: Warrior (Protection)");
        const healers = text.split("\n").find((l) => l.startsWith("• 2× Healers:"));
        expect(healers).toContain("Priest (Holy)");
        expect(healers).toContain("Paladin (Holy)");
        expect(text).toContain("Needed for a required buff: Shaman (any spec)");
        expect(text).toContain("Sign up: https://discord.com/channels/g1/c1/m1");
        expect(text.length).toBeLessThanOrEqual(1900);
    });

    it("lists a raid buff that is missing as something that would also help, and never a buff that is there", () => {
        const e = event();
        e.setup.checks.buffs = { required: [], raid: [{ key: "kings", label: "Segen der Könige", icon: "x", present: false }, { key: "windfury", label: "W", icon: "x", present: true }] };
        e.setup.checks.roles.tank.count = 2;
        e.setup.checks.roles.healer.count = 5;
        const s = suggestSearch(e);
        expect(s.buffs.map((b) => [b.key, b.required])).toEqual([["kings", false]]);
        expect(s.text).toContain("Would also help: Paladin (any spec)");
    });

    it("says every class is welcome when only places are open, and has no text when nothing is missing", () => {
        const e = event();
        e.setup.checks.roles.tank.count = 2;
        e.setup.checks.roles.healer.count = 5;
        e.setup.checks.buffs = { required: [], raid: [] };
        expect(suggestSearch(e).text).toContain("7 places open – every class and spec is welcome.");
        e.setup.groups = [{ index: 1, slots: slots(25) }];
        expect(suggestSearch(e)).toMatchObject({ open: 0, roles: [], buffs: [], text: "" });
    });

    it("is null without a setup", () => {
        expect(suggestSearch(event({ setup: null }))).toBeNull();
        expect(suggestSearch(null)).toBeNull();
    });
});

describe("what the page needs to let the orga edit the search", () => {
    it("knows every spec of the rule set and which specs belong to which role", () => {
        const s = suggestSearch(event());
        expect(s.roleSpecs.tank).toEqual(expect.arrayContaining(["Warrior-Protection", "Paladin-Protection", "Druid-Guardian"]));
        expect(s.roleSpecs.healer).toContain("Priest-Holy");
        expect(s.roleSpecs.ranged).toContain("Mage-Fire");
        // also a spec of a role that is not short (the orga may add it)
        expect(s.specInfo["Rogue-Combat"]).toMatchObject({ classId: "Rogue", icon: expect.any(String) });
        expect(Object.keys(s.specInfo).length).toBeGreaterThan(20);
    });
});

describe("textForNeeds", () => {
    it("writes the message for needs the orga edited: a changed count, fewer specs, a dropped buff, an added role", () => {
        const { text } = textForNeeds(event(), {
            roles: [
                { role: "tank", missing: 3, specs: ["Paladin-Protection"] },
                { role: "ranged", missing: 2 },
            ],
            buffs: [],
        });
        expect(text).toContain("18 of 25 places filled");
        expect(text).toContain("• 3× Tanks: Paladin (Protection)");
        // no specs named = every spec of the role
        const ranged = text.split("\n").find((l) => l.startsWith("• 2× Ranged DPS:"));
        expect(ranged).toContain("Mage (Fire)");
        expect(ranged).toContain("Warlock (Destruction)");
        expect(text).not.toContain("Healer");
        expect(text).not.toContain("required buff");
    });

    it("keeps a required buff as required and names its providers, and a raid buff as \"would also help\"", () => {
        const { text } = textForNeeds(event(), { roles: [], buffs: [{ key: "windfury", required: true }, { key: "kings", required: false }] });
        expect(text).toContain("Needed for a required buff: Shaman (any spec)");
        expect(text).toContain("Would also help: Paladin (any spec)");
    });

    it("cleans what the page sends: unknown roles, specs of another role, bad counts, unknown buffs, duplicates", () => {
        const { text } = textForNeeds(event(), {
            roles: [
                { role: "wizard", missing: 2 },
                { role: "tank", missing: 0 },
                { role: "healer", missing: 2, specs: ["Mage-Fire", "Priest-Holy"] },
                { role: "healer", missing: 5 },
                { role: "melee", missing: "abc" },
            ],
            buffs: [{ key: "nonsense", required: true }, { key: "kings" }, { key: "kings" }],
        });
        const healers = text.split("\n").filter((l) => l.includes("Healers"));
        expect(healers).toEqual(["• 2× Healers: Priest (Holy)"]);
        expect(text).not.toContain("Wizard");
        expect(text.match(/Would also help/g)).toHaveLength(1);
    });

    it("says every class is welcome when nothing specific is left, and refuses an event without a setup", () => {
        expect(textForNeeds(event(), { roles: [], buffs: [] }).text).toContain("7 places open – every class and spec is welcome.");
        expect(textForNeeds(event({ setup: null }), { roles: [] }).error).toMatchObject({ status: 400, code: "no_setup" });
    });
});

describe("postSearch", () => {
    beforeEach(() => {
        mockEvents.clear();
        mockLog.length = 0;
        mockPost.mockReset();
        mockPost.mockResolvedValue({ channelId: "c1", messageId: "p1", url: "https://discord.com/channels/g1/c1/p1" });
        mockEvents.set("eh-1", event());
    });

    it("posts the suggestion as it is into the event channel and logs it on the event", async () => {
        const out = await postSearch({ guildId: "g1", eventId: "eh-1", userId: "orga", byName: "Orga" });
        expect(out).toEqual({ message: "Suche im Kanal gepostet.", url: "https://discord.com/channels/g1/c1/p1" });
        expect(mockPost).toHaveBeenCalledWith("c1", expect.stringContaining("Looking for more raiders"));
        expect(mockLog).toEqual([{ id: "eh-1", action: "search", by: "orga", byName: "Orga", detail: "**Looking for more raiders – Gruul's Lair**" }]);
    });

    it("posts the text the orga edited instead", async () => {
        await postSearch({ eventId: "eh-1", text: "  Need a tank! /w Zibbo  " });
        expect(mockPost).toHaveBeenCalledWith("c1", "Need a tank! /w Zibbo");
    });

    it.each([
        ["a Raid-Helper event", { eventId: "abc123" }, 409, "raidhelper"],
        ["an unknown event", { eventId: "eh-nope" }, 404, "not_found"],
        ["another server's event", { eventId: "eh-1", guildId: "other" }, 404, "not_found"],
        ["a text over Discord's limit", { eventId: "eh-1", text: "x".repeat(2001) }, 400, "too_long"],
    ])("refuses %s", async (_label, args, status, code) => {
        const out = await postSearch(args);
        expect(out.error).toMatchObject({ status, code });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("refuses a cancelled event, one without a channel, and one that needs nothing", async () => {
        mockEvents.set("eh-1", event({ status: "cancelled" }));
        expect((await postSearch({ eventId: "eh-1" })).error.code).toBe("cancelled");
        mockEvents.set("eh-1", event({ channelId: "" }));
        expect((await postSearch({ eventId: "eh-1" })).error.code).toBe("no_channel");
        const done = event();
        done.setup.groups = [{ index: 1, slots: slots(25) }];
        done.setup.checks.roles.tank.count = 2;
        done.setup.checks.roles.healer.count = 5;
        done.setup.checks.buffs = { required: [], raid: [] };
        mockEvents.set("eh-1", done);
        expect((await postSearch({ eventId: "eh-1" })).error.code).toBe("nothing_needed");
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("tells when Discord refuses, and logs nothing then", async () => {
        mockPost.mockRejectedValue(new Error("Missing Permissions"));
        const out = await postSearch({ eventId: "eh-1" });
        expect(out.error).toMatchObject({ status: 502, code: "post_failed" });
        expect(out.error.message).toContain("Missing Permissions");
        expect(mockLog).toEqual([]);
    });
});

describe("the message with the spec icons", () => {
    const appEmojis = require("../../src/web/appEmojis");
    afterEach(() => appEmojis.resetAppEmojis());

    it("puts the app emoji of a spec, of a whole class and of the role in front, and nothing while they are not uploaded", () => {
        expect(suggestSearch(event()).text).not.toContain("<:");
        appEmojis.setAppEmojis([
            { id: "1", name: "eh_paladin_protection" },
            { id: "2", name: "eh_class_shaman" },
            { id: "3", name: "eh_ui_tank" },
        ]);
        const { text } = suggestSearch(event());
        expect(text).toContain("• <:eh_ui_tank:3> 1× Tank: ");
        expect(text).toContain("<:eh_paladin_protection:1> Paladin (Protection)");
        expect(text).toContain("Needed for a required buff: <:eh_class_shaman:2> Shaman (any spec)");
        expect(text.length).toBeLessThanOrEqual(1900);
    });
});
