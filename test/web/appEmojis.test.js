// App-Emojis der Bot-Anwendung (#287): Namensschema, Katalog, Cache, Text-Fallback.
const appEmojis = require("../../src/web/appEmojis");
const { buildClasses, ROLES } = require("../../src/config/gameVersions/classes");
const { SIGNUP_STATUSES } = require("../../src/utils/attendance");

describe("web/appEmojis", () => {
    beforeEach(() => appEmojis.resetAppEmojis());

    it("names specs, classes, roles and statuses by the schema", () => {
        expect(appEmojis.specEmojiName("Priest-Shadow")).toBe("eh_priest_shadow");
        expect(appEmojis.specEmojiName("Hunter-BeastMastery")).toBe("eh_hunter_beastmastery");
        expect(appEmojis.specEmojiName("Priest")).toBe("");
        expect(appEmojis.classEmojiName("Warrior")).toBe("eh_class_warrior");
        expect(appEmojis.roleEmojiName("tank")).toBe("eh_role_tank");
        expect(appEmojis.statusEmojiName("absence")).toBe("eh_status_absence");
    });

    it("has one valid, unique emoji per spec, class, role and status", () => {
        const catalog = appEmojis.emojiCatalog();
        const classes = buildClasses();
        const specs = classes.reduce((n, c) => n + c.specs.length, 0);
        expect(catalog).toHaveLength(specs + classes.length + ROLES.length + SIGNUP_STATUSES.length);
        expect(new Set(catalog.map((e) => e.name)).size).toBe(catalog.length);
        for (const e of catalog) {
            expect(appEmojis.validEmojiName(e.name)).toBe(true);
            expect(e.url).toBe(`https://wow.zamimg.com/images/wow/icons/medium/${e.icon}.jpg`);
        }
        expect(appEmojis.validEmojiName("Eh-Bad")).toBe(false);
        expect(appEmojis.validEmojiName("x".repeat(33))).toBe(false);
    });

    it("renders an emoji from a map, or the fallback", () => {
        const map = { eh_role_tank: { id: "9", name: "eh_role_tank" }, eh_anim: { id: "8", name: "eh_anim", animated: true } };
        expect(appEmojis.emojiText(map, "eh_role_tank", "T")).toBe("<:eh_role_tank:9>");
        expect(appEmojis.emojiText(map, "eh_anim")).toBe("<a:eh_anim:8>");
        expect(appEmojis.emojiText(map, "eh_role_healer", "💚")).toBe("💚");
        expect(appEmojis.emojiText(null, "eh_role_tank")).toBe("");
        expect(appEmojis.emojiOption(map, "eh_role_tank")).toEqual({ id: "9", name: "eh_role_tank", animated: false });
        expect(appEmojis.emojiOption(map, "missing", "✅")).toEqual({ name: "✅" });
        expect(appEmojis.emojiOption(map, "missing")).toBeUndefined();
    });

    it("reads the application's emojis once and caches them by name", async () => {
        const fetch = jest.fn(async () => new Map([
            ["1", { id: "1", name: "eh_role_tank" }],
            ["2", { id: "2", name: "someone_elses" }],
        ]));
        const client = { application: { emojis: { fetch } } };
        await appEmojis.loadAppEmojis(client);
        await appEmojis.loadAppEmojis(client);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(appEmojis.appEmojiMap()).toEqual({ eh_role_tank: { id: "1", name: "eh_role_tank", animated: false } });
        expect(appEmojis.emojiFor("eh_role_tank")).toBe("<:eh_role_tank:1>");
        expect(appEmojis.emojiFor("eh_role_healer", "H")).toBe("H");
        await appEmojis.loadAppEmojis(client, { force: true });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("keeps working without a client and retries a failed read only after a while", async () => {
        await expect(appEmojis.loadAppEmojis(null)).resolves.toEqual({});
        await expect(appEmojis.loadAppEmojis({ application: null })).resolves.toEqual({});
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const fetch = jest.fn(async () => { throw new Error("offline"); });
            const client = { application: { emojis: { fetch } } };
            await expect(appEmojis.loadAppEmojis(client, { now: 1000 })).resolves.toEqual({});
            await appEmojis.loadAppEmojis(client, { now: 2000 });
            expect(fetch).toHaveBeenCalledTimes(1);
            await appEmojis.loadAppEmojis(client, { now: 1000 + 11 * 60 * 1000 });
            expect(fetch).toHaveBeenCalledTimes(2);
        } finally {
            warn.mockRestore();
        }
    });
});
