// The real portraits of the default mobs (scripts/fetch-mob-icons.js): the NPC table, the generated mapping, the files.
const fs = require("fs");
const path = require("path");
const png = require("../../../scripts/lib/png");
const defaults = require("../../../src/services/raidplan/raidplanCatalogDefaults");
const { MOB_NPCS } = require("../../../scripts/data/raidplanMobNpcs");
const generated = require("../../../src/config/generated/mobIcons.json");
const catalog = require("../../../src/stores/raidplanCatalogStore");
const board = require("../../../src/services/raidplan/raidplanBoard");
const { icon } = require("../../factories/raidplan");

const DIR = path.join(__dirname, "..", "..", "..", "src", "web-client", "public", "mobs");
// Their Wowhead pages name no display, so there is no model render: they keep the placeholder icon.
const PLACEHOLDERS = ["doomfire-spirit", "towering-infernal", "hyjal-giant-infernal"];

describe("mob portraits", () => {
    it("the NPC table names a default mob each, and only these mobs keep a placeholder", () => {
        const slugs = defaults.MOBS.map((m) => m.id.replace(/^d:/, ""));
        for (const slug of Object.keys(MOB_NPCS)) expect(slugs).toContain(slug);
        expect(slugs.filter((s) => !MOB_NPCS[s]).sort()).toEqual([...PLACEHOLDERS].sort());
        expect(new Set(Object.values(MOB_NPCS)).size).toBe(Object.keys(MOB_NPCS).length);
    });

    it("every entry of the table has a verified portrait: page name, display id, an answered image request, a stored file", () => {
        for (const [slug, npcId] of Object.entries(MOB_NPCS)) {
            const rec = generated.portraits[`d:${slug}`];
            expect(rec).toBeDefined();
            expect(rec.npcId).toBe(npcId);
            expect(rec.icon).toBe(`mob:${npcId}`);
            expect(rec.name).toBeTruthy();
            expect(rec.displayId).toBeGreaterThan(0);
            expect(rec.source).toContain(`/webthumbs/npc/${rec.displayId % 256}/${rec.displayId}.png`);
            expect(rec.verified.status).toBe(200);
            expect(rec.verified.type).toMatch(/^image\/png/);
            const file = path.join(DIR, `${npcId}.png`);
            expect(fs.existsSync(file)).toBe(true);
            const img = png.decode(fs.readFileSync(file));
            expect([img.width, img.height]).toEqual([64, 64]);
            expect(png.alphaBox(img)).not.toBe(null);
            expect(fs.statSync(file).size).toBeLessThan(30000);
        }
        expect(Object.keys(generated.portraits).length).toBe(Object.keys(MOB_NPCS).length);
    });

    it("the catalog uses the portrait, and only the rest is marked as a placeholder", () => {
        for (const m of defaults.MOBS) {
            const slug = m.id.replace(/^d:/, "");
            if (MOB_NPCS[slug]) {
                expect(m.icon).toBe(`mob:${MOB_NPCS[slug]}`);
                expect(m.similar).toBe(false);
            } else {
                expect(m.icon).toBe(generated.icons[m.id].icon);
                expect(m.similar).toBe(true);
            }
            expect(m.icon).toMatch(catalog.ICON);
        }
    });

    it("the icon key of a portrait passes the validators of the board (map icons, the mobs of a section)", () => {
        expect("mob:22949").toMatch(catalog.ICON);
        const r = board.cleanBoard({
            icons: [icon({ iconKey: "mob:22949" }), icon({ iconKey: "mob:abc" })],
            mobs: [{ id: "d:gathios", name: "Gathios", icon: "mob:22949" }],
        }, { allowedUserIds: [] }).board;
        expect(r.icons.map((i) => i.iconKey)).toEqual(["mob:22949"]);
        expect(r.mobs[0].icon).toBe("mob:22949");
    });
});
