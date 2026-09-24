// A mob's portrait key (mob:<NPC id>) on the client: its picture, its map icon and how it is told from a boss icon.
const { loadTs, makeT } = require("./i18nHelper");

const raidplan = loadTs("lib/raidplan.ts", { t: makeT("de") });
const assign = loadTs("lib/assign.ts", { t: makeT("de") });

describe("mob portrait keys", () => {
    it("portraitUrl maps boss:N to the boss image and mob:N to the portrait, anything else to nothing", () => {
        expect(raidplan.portraitUrl("boss:601")).toBe("/bosses/601.jpg");
        expect(raidplan.portraitUrl("mob:22949")).toBe("/mobs/22949.png");
        for (const bad of ["", "wow:spell_fire_fireball", "mob:", "mob:abc", "mob:1234567", "enemy", "spell_fire_fireball"]) expect(raidplan.portraitUrl(bad)).toBe("");
    });
    it("a mob's icon becomes a map icon of the same picture, a spell icon a wow: icon, none the enemy symbol", () => {
        expect(assign.mobIconKey("mob:22949")).toBe("mob:22949");
        expect(assign.mobIconKey("boss:601")).toBe("boss:601");
        expect(assign.mobIconKey("spell_fire_fireball")).toBe("wow:spell_fire_fireball");
        expect(assign.mobIconKey("")).toBe("enemy");
    });
    it("a portrait is an image icon like a boss icon: it can face, and it is not a wow icon", () => {
        expect(raidplan.iconKeyType("mob:22949")).toBe("boss");
        expect(raidplan.canFace("mob:22949")).toBe(true);
        expect(raidplan.iconKeyType("wow:spell_fire_fireball")).toBe("wow");
    });
});
