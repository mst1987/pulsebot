// App-Emojis der Bot-Anwendung (#287): Namensschema, Katalog, Cache, Text-Fallback.
const appEmojis = require("../../../src/services/discord/appEmojis");
const { buildClasses, ROLES } = require("../../../src/config/gameVersions/classes");
const { SIGNUP_STATUSES } = require("../../../src/utils/attendance");

describe("services/discord/appEmojis", () => {
    beforeEach(() => appEmojis.resetAppEmojis());

    it("names specs, classes, roles and statuses by the schema", () => {
        expect(appEmojis.specEmojiName("Priest-Shadow")).toBe("eh_priest_shadow");
        expect(appEmojis.specEmojiName("Hunter-BeastMastery")).toBe("eh_hunter_beastmastery");
        expect(appEmojis.specEmojiName("Priest")).toBe("");
        expect(appEmojis.classEmojiName("Warrior")).toBe("eh_class_warrior");
        // the roles and the statuses are flat UI icons now, no longer the WoW icons eh_role_*/eh_status_*
        expect(appEmojis.roleUiEmojiName("tank")).toBe("eh_ui_tank");
        expect(appEmojis.roleUiEmojiName("nonsense")).toBe("");
        expect(appEmojis.statusEmojiName("absence")).toBe("eh_ui_absence");
        expect(appEmojis.uiEmojiName("leader")).toBe("eh_ui_leader");
    });

    it("names the letter tiles and role icons per emoji style — plain has none of its own", () => {
        expect(appEmojis.tileEmojiName("H")).toBe("eh_ta_h");
        expect(appEmojis.tileEmojiName("+", "gold")).toBe("eh_tg_plus");
        expect(appEmojis.tileEmojiName("&", "parchment")).toBe("eh_tp_amp");
        expect(appEmojis.tileEmojiName("7", "arcane")).toBe("eh_ta_7");
        expect(appEmojis.tileEmojiName("h")).toBe("");
        expect(appEmojis.tileEmojiName("Ä")).toBe("");
        expect(appEmojis.tileEmojiName("H", "plain")).toBe("");
        expect(appEmojis.roleEmojiName("tank")).toBe("eh_ra_tank");
        expect(appEmojis.roleEmojiName("healer", "gold")).toBe("eh_rg_healer");
        expect(appEmojis.roleEmojiName("tank", "plain")).toBe("eh_ui_tank");
        expect(appEmojis.roleEmojiName("nonsense")).toBe("");
        // melee is two crossed swords — under a new name, the old sword stays uploaded
        expect(appEmojis.roleEmojiName("melee")).toBe("eh_ra_swords");
        expect(appEmojis.roleEmojiName("melee", "parchment")).toBe("eh_rp_swords");
        expect(appEmojis.roleEmojiName("melee", "plain")).toBe("eh_ui_swords");
        expect(appEmojis.roleUiEmojiName("melee")).toBe("eh_ui_swords");
        const fs = require("fs");
        for (const e of appEmojis.emojiCatalog().filter((x) => /swords/.test(x.name))) expect(fs.existsSync(e.file)).toBe(true);
        // an unknown style is the default
        expect(appEmojis.emojiStyleOf("neon")).toBe("arcane");
        expect(appEmojis.emojiStyleOf(undefined)).toBe("arcane");
        expect(appEmojis.emojiStyleOf("parchment")).toBe("parchment");
        expect(appEmojis.tileEmojiName("H", "neon")).toBe("eh_ta_h");
    });

    it("has one valid, unique emoji per spec, class, role, UI icon, tile and styled role", () => {
        const catalog = appEmojis.emojiCatalog();
        const classes = buildClasses();
        const specs = classes.reduce((n, c) => n + c.specs.length, 0);
        const styled = Object.values(appEmojis.EMOJI_STYLES).filter(Boolean).length;
        const perStyle = Object.keys(appEmojis.TITLE_TILES).length + ROLES.length;
        expect(catalog).toHaveLength(specs + classes.length + appEmojis.UI_ICONS.length + styled * perStyle);
        expect(new Set(catalog.map((e) => e.name)).size).toBe(catalog.length);
        for (const e of catalog) {
            expect(appEmojis.validEmojiName(e.name)).toBe(true);
            if (e.tile) expect(e.name).toMatch(/^eh_[tr][agp]_[a-z0-9]+$/);
            else if (e.file) expect(e.name.startsWith("eh_ui_")).toBe(true);
            else expect(e.url).toBe(`https://wow.zamimg.com/images/wow/icons/medium/${e.icon}.jpg`);
        }
        // every signup status and every role has its flat icon
        for (const status of SIGNUP_STATUSES) expect(appEmojis.UI_ICONS).toContain(status);
        for (const role of ROLES) expect(appEmojis.UI_ICONS).toContain(role);
        expect(catalog.some((e) => e.name.startsWith("eh_status_"))).toBe(false);
        // the WoW role icons are gone with #320 — the setup message was their last reader
        expect(catalog.some((e) => e.name.startsWith("eh_role_"))).toBe(false);
        expect(appEmojis.validEmojiName("Eh-Bad")).toBe(false);
        expect(appEmojis.validEmojiName("x".repeat(33))).toBe(false);
    });

    it("ships every UI icon, tile and styled role icon as a checked-in 128 px PNG within Discord's size limit", () => {
        const fs = require("fs");
        const { MAX_BYTES } = require("../../../src/services/discord/appEmojiSync");
        const { ICONS } = require("../../../scripts/render-ui-emojis");
        for (const e of appEmojis.emojiCatalog().filter((x) => x.file)) {
            // the UI icons are drawn by the script; tiles and styled roles are generated images
            if (!e.tile) expect(Object.keys(ICONS)).toContain(e.icon);
            const buf = fs.readFileSync(e.file);
            expect(buf.length).toBeLessThanOrEqual(MAX_BYTES);
            // PNG signature, then the IHDR's width and height
            expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
            expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([128, 128]);
        }
    });

    it("renders an emoji from a map, or the fallback", () => {
        const map = { eh_ui_tank: { id: "9", name: "eh_ui_tank" }, eh_anim: { id: "8", name: "eh_anim", animated: true } };
        expect(appEmojis.emojiText(map, "eh_ui_tank", "T")).toBe("<:eh_ui_tank:9>");
        expect(appEmojis.emojiText(map, "eh_anim")).toBe("<a:eh_anim:8>");
        expect(appEmojis.emojiText(map, "eh_ui_healer", "💚")).toBe("💚");
        expect(appEmojis.emojiText(null, "eh_ui_tank")).toBe("");
        expect(appEmojis.emojiOption(map, "eh_ui_tank")).toEqual({ id: "9", name: "eh_ui_tank", animated: false });
        expect(appEmojis.emojiOption(map, "missing", "✅")).toEqual({ name: "✅" });
        expect(appEmojis.emojiOption(map, "missing")).toBeUndefined();
    });

    it("reads the application's emojis once and caches them by name", async () => {
        const fetch = jest.fn(async () => new Map([
            ["1", { id: "1", name: "eh_ui_tank" }],
            ["2", { id: "2", name: "someone_elses" }],
        ]));
        const client = { application: { emojis: { fetch } } };
        await appEmojis.loadAppEmojis(client);
        await appEmojis.loadAppEmojis(client);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(appEmojis.appEmojiMap()).toEqual({ eh_ui_tank: { id: "1", name: "eh_ui_tank", animated: false } });
        expect(appEmojis.emojiFor("eh_ui_tank")).toBe("<:eh_ui_tank:1>");
        expect(appEmojis.emojiFor("eh_ui_healer", "H")).toBe("H");
        await appEmojis.loadAppEmojis(client, { force: true });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("lets a read that was in flight when the cache was reset fall on the floor (#315)", async () => {
        let release;
        const pending = new Promise((resolve) => { release = resolve; });
        const fetch = jest.fn(async () => {
            await pending;
            return new Map([["1", { id: "1", name: "eh_ui_tank" }]]);
        });
        const inFlight = appEmojis.loadAppEmojis({ application: { emojis: { fetch } } });
        // What a suite's beforeEach does between two tests - or a reconnect in the bot.
        appEmojis.resetAppEmojis();
        release();
        await inFlight;
        expect(appEmojis.appEmojiMap()).toEqual({});
        expect(appEmojis.appEmojisLoaded()).toBe(false);
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
