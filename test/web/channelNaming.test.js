// #285: which name and design a new event channel gets — the previous event
// channel of the category, the stored schema, or the default one — and that
// the result always says so.
jest.mock("../../src/web/discord", () => ({ listAllChannels: jest.fn(() => []) }));
jest.mock("../../src/web/channelArchiveStore", () => ({ getChannelConfig: jest.fn(() => ({ schemas: {} })) }));
jest.mock("../../src/web/raidEventGroups", () => ({ loadEventGroups: jest.fn(), eventLookbackSince: jest.fn(() => 1) }));
jest.mock("../../src/web/raidListing", () => ({
    raidContentIds: ({ title }) => ({ contentIds: /hyjal/i.test(title || "") ? ["hyjal", "bt"] : /ssc/i.test(title || "") ? ["ssc", "tk"] : [] }),
}));

const discord = require("../../src/web/discord");
const archiveStore = require("../../src/web/channelArchiveStore");
const { loadEventGroups } = require("../../src/web/raidEventGroups");
const naming = require("../../src/web/channelNaming");

const CAT = "cat-mi";
// Berlin 19:30 on a day
const at = (y, m, d) => Date.UTC(y, m - 1, d, 17, 30) / 1000;

const CHANNELS = [
    { id: "c1", name: "🔥・mi-09-09-ssc-tk", parentId: CAT },
    { id: "c2", name: "🔥・mi-16-09-ssc-tk", parentId: CAT },
    { id: "c3", name: "⚔┃do-17-09-hyjal-bt", parentId: CAT },
    { id: "c9", name: "mi-16-09-kara", parentId: "cat-other" },
    { id: "tpl", name: "vorlage", parentId: CAT },
];
const EVENTS = [
    { id: "1", title: "SSC + TK", channelId: "c1", channelName: "🔥・mi-09-09-ssc-tk", startTime: at(2026, 9, 9) },
    { id: "eh-2", title: "Mittwoch", instanceIds: ["ssc", "tk"], channelId: "c2", startTime: at(2026, 9, 16) },
    { id: "3", title: "Hyjal + BT", channelId: "c3", startTime: at(2026, 9, 17) },
    { id: "9", title: "Kara", channelId: "c9", startTime: at(2026, 9, 18) },
    { id: "gone", title: "SSC", channelId: "deleted", startTime: at(2026, 9, 20) },
];
const ctxFor = (over = {}) => naming.namingContext({ events: EVENTS, channels: CHANNELS, schemas: {}, categoryId: CAT, ...over });

beforeEach(() => {
    jest.clearAllMocks();
    discord.listAllChannels.mockReturnValue(CHANNELS);
    archiveStore.getChannelConfig.mockReturnValue({ schemas: {} });
    loadEventGroups.mockResolvedValue({ groups: [{ categoryId: CAT, events: EVENTS.slice(0, 3) }, { categoryId: "cat-other", events: [EVENTS[3]] }] });
});

describe("web/channelNaming — namingContext", () => {
    it("names after the latest event channel with the same raid, and copies it", () => {
        const ctx = ctxFor({ raid: "ssc-tk" });
        expect(ctx).toMatchObject({ source: "previous", fromChannel: "🔥・mi-16-09-ssc-tk", templateChannelId: "c2" });
        const result = naming.describeResult(ctx, "2026-09-23", "ssc-tk");
        expect(result).toMatchObject({
            name: "🔥・mi-23-09-ssc-tk",
            label: "abgeleitet aus #🔥・mi-16-09-ssc-tk",
            detail: "Datum 16-09 → 23-09",
            design: "Rechte und Thema von #🔥・mi-16-09-ssc-tk",
            placement: { afterChannelId: "c3" }, // behind 17-09, the latest earlier date
        });
        expect(naming.namingLine(result)).toBe("abgeleitet aus #🔥・mi-16-09-ssc-tk (Datum 16-09 → 23-09)");
    });

    it("takes the latest channel of the category when no raid matches, and replaces the raid", () => {
        const ctx = ctxFor({ raid: "kara" });
        expect(ctx.fromChannel).toBe("⚔┃do-17-09-hyjal-bt");
        const result = naming.describeResult(ctx, "2026-09-24", "kara");
        expect(result.name).toBe("⚔┃do-24-09-kara");
        expect(result.detail).toBe("Datum 17-09 → 24-09, Raid hyjal-bt → kara");
        expect(result.placement).toEqual({ afterChannelId: "c3" });
    });

    it("ignores channels of other categories, vanished channels and the channel being renamed", () => {
        const ctx = ctxFor({ excludeChannelId: "c3" });
        expect(ctx.fromChannel).toBe("🔥・mi-16-09-ssc-tk");
        expect(ctx.eventChannels.map((r) => r.channelId)).toEqual(["c2", "c1"]);
    });

    it("lets a stored own schema win, with the stored template channel", () => {
        const schemas = { [CAT]: { schema: "raid-{dd}{mm}-{raid}", raid: "t5", templateChannelId: "tpl" } };
        const result = naming.describeResult(ctxFor({ schemas }), "2026-09-23", "");
        expect(result).toMatchObject({
            source: "schema", name: "raid-2309-t5", label: "nach Schema der Kategorie", detail: "Schema raid-{dd}{mm}-{raid}",
            templateChannelId: "tpl", design: "Rechte und Thema von #vorlage", placement: { afterChannelId: "c3" },
        });
    });

    it("treats a stored default schema as none — quick-create stores it by default", () => {
        const schemas = { [CAT]: { schema: "{tag}-{dd}-{mm}-{raid}", raid: "", templateChannelId: "" } };
        expect(ctxFor({ schemas }).source).toBe("previous");
    });

    it("falls back to the default schema with the prefix of the latest channel when no date is recognisable", () => {
        const channels = [{ id: "p1", name: "🌙│kara-pug", parentId: CAT }];
        const ctx = naming.namingContext({ events: [{ id: "x", title: "Kara", channelId: "p1", startTime: at(2026, 9, 16) }], channels, categoryId: CAT });
        const result = naming.describeResult(ctx, "2026-09-23", "kara");
        expect(result).toMatchObject({
            source: "default", name: "🌙│mi-23-09-kara", label: "Standard-Schema", templateChannelId: "p1",
        });
        expect(result.detail).toContain("„🌙│“ von #🌙│kara-pug");
    });

    it("has no design to copy in a category without any event channel", () => {
        const result = naming.describeResult(naming.namingContext({ events: [], channels: CHANNELS, categoryId: "leer" }), "2026-09-23", "bt");
        expect(result).toMatchObject({ source: "default", name: "mi-23-09-bt", templateChannelId: "", design: "Rechte der Kategorie", placement: {} });
        expect(result.detail).toContain("noch keinen Event-Kanal");
    });

    it("duplicates: the chosen event's channel is the source, never the stored template", () => {
        const schemas = { [CAT]: { schema: "", templateChannelId: "tpl" } };
        const ctx = ctxFor({ fromEventId: "1", schemas });
        expect(ctx).toMatchObject({ source: "previous", fromChannel: "🔥・mi-09-09-ssc-tk", templateChannelId: "c1" });
        expect(naming.nameFor(ctx, "2026-09-30", "ssc-tk").name).toBe("🔥・mi-30-09-ssc-tk");
    });

    it("words step 1 of /event anlegen without a date", () => {
        const ctx = ctxFor({ raid: "ssc-tk" });
        expect(naming.stepLine(ctx)).toBe("neu wie #🔥・mi-16-09-ssc-tk — Wochentag, Datum und Raid werden ersetzt");
        expect(naming.describeResult(ctx, "", "").detail).toBe("Wochentag, Datum und Raid werden ersetzt");
        expect(naming.stepLine(naming.namingContext({ categoryId: "leer" }))).toBe("neu nach Standard-Schema `{tag}-{dd}-{mm}-{raid}`");
    });
});

describe("web/channelNaming — deriveChannelName", () => {
    it("reads events, channels and schemas and names the instances' raid", async () => {
        const result = await naming.deriveChannelName({ guildId: "g1", categoryId: CAT, date: "2026-09-24", instanceIds: ["hyjal", "bt"] });
        expect(loadEventGroups).toHaveBeenCalledWith("g1", { sinceSeconds: 1 });
        expect(result).toMatchObject({ source: "previous", name: "⚔┃do-24-09-hyjal-bt", fromChannelId: "c3", templateChannelId: "c3" });
    });

    it("still answers when Raid-Helper and the store fail", async () => {
        loadEventGroups.mockRejectedValue(new Error("down"));
        archiveStore.getChannelConfig.mockImplementation(() => { throw new Error("disk"); });
        const result = await naming.deriveChannelName({ guildId: "g1", categoryId: CAT, date: "2026-09-24", instanceIds: ["ssc"] });
        expect(result).toMatchObject({ source: "default", name: "do-24-09-ssc", templateChannelId: "" });
    });
});
