// The one council view the page and the sync tool share: the armory step on
// top of councilRoster(), the query a stored view stands for, which categories
// run as Loot-Council, and the instances of a category's raid template.
jest.mock("../../../src/web/loot/lootCouncil", () => ({ councilRoster: jest.fn() }));
jest.mock("../../../src/services/loot/armoryGear", () => ({ primeArmoryGear: jest.fn() }));
jest.mock("../../../src/stores/raidTemplateStore", () => ({ getRaidTemplate: jest.fn(() => null) }));
jest.mock("../../../src/services/loot/councilProfiles", () => ({
    viewFor: jest.fn(),
    resolveProfile: jest.fn(() => ({ profile: { id: "standard", name: "Standard" }, source: "default", roster: null })),
    profileHead: (p, source) => ({ id: p.id, name: p.name, isDefault: p.id === "standard", source }),
}));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/services/discord/discord", () => ({ listCategories: jest.fn(() => []) }));

const { councilRoster } = require("../../../src/web/loot/lootCouncil");
const { primeArmoryGear } = require("../../../src/services/loot/armoryGear");
const { getRaidTemplate } = require("../../../src/stores/raidTemplateStore");
const councilProfiles = require("../../../src/services/loot/councilProfiles");
const {
    buildCouncilView, viewQuery, councilCategoryIds, categoryInstances, categoryCouncil,
} = require("../../../src/web/loot/councilView");

const row = (character, dropped = []) => ({ key: character.toLowerCase(), character, gear: { dropped } });

beforeEach(() => {
    jest.clearAllMocks();
    getRaidTemplate.mockReturnValue(null);
});

describe("buildCouncilView", () => {
    it("asks nobody when no set holds a boss-specific piece", async () => {
        const built = { rows: [row("Anna"), { key: "bob", character: "Bob", gear: null }] };
        councilRoster.mockReturnValue(built);
        expect(await buildCouncilView({ versionId: "tbc" })).toBe(built);
        expect(primeArmoryGear).not.toHaveBeenCalled();
        expect(councilRoster).toHaveBeenCalledTimes(1);
    });

    it("asks the armory for those names only and builds again when it answered", async () => {
        const first = { rows: [row("Anna", [{ slot: 1 }]), row("Bob")] };
        const second = { rows: [row("Anna")] };
        councilRoster.mockReturnValueOnce(first).mockReturnValueOnce(second);
        primeArmoryGear.mockResolvedValue({ answered: 1 });
        expect(await buildCouncilView({ versionId: "tbc" })).toBe(second);
        expect(primeArmoryGear).toHaveBeenCalledWith(["Anna"], { versionId: "tbc" });
    });

    it("keeps the first roster when the armory has no answer or fails", async () => {
        const first = { rows: [row("Anna", [{ slot: 1 }])] };
        councilRoster.mockReturnValue(first);
        primeArmoryGear.mockResolvedValueOnce({ answered: 0 });
        expect(await buildCouncilView({})).toBe(first);
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});
        primeArmoryGear.mockRejectedValueOnce(new Error("down"));
        expect(await buildCouncilView({})).toBe(first);
        expect(spy).toHaveBeenCalledWith("armory gear failed:", "down");
        spy.mockRestore();
        expect(councilRoster).toHaveBeenCalledTimes(2);
    });
});

describe("viewQuery", () => {
    it("builds the query the page sends", () => {
        const q = viewQuery("c1", { role: "caster", tiers: ["t5", "t6"], contents: ["bt"], bisTier: "t6", version: "tbc" });
        expect(q.toString()).toBe("role=caster&tiers=t5%2Ct6&contents=bt&category=c1&bisTier=t6&version=tbc");
    });

    it("leaves out what the page leaves out (role \"\" = every role)", () => {
        expect(viewQuery("c1", { role: "", tiers: [], contents: [], bisTier: "", version: "" }).toString()).toBe("category=c1");
        expect(viewQuery("", {}).toString()).toBe("");
    });
});

describe("councilCategoryIds", () => {
    it("keeps the categories whose loot system is Loot-Council, in settings order", () => {
        const config = {
            categoryIds: ["a", "b", "c", "d"],
            categoryLootSystem: { a: "lootcouncil", c: "softres", d: "gdkp" },
            categoryLootTool: { b: "rclc", c: "rclc" },
        };
        expect(councilCategoryIds(config)).toEqual(["a", "b"]);
        expect(councilCategoryIds({})).toEqual([]);
        expect(councilCategoryIds(null)).toEqual([]);
    });
});

describe("categoryInstances", () => {
    it("names the raids of the category's template", () => {
        getRaidTemplate.mockReturnValue({ id: "tpl", instanceIds: ["bt", "forever-barrow", "nope"] });
        const out = categoryInstances({ categoryRaidTemplate: { c1: "tpl" } }, "c1");
        expect(getRaidTemplate).toHaveBeenCalledWith("tpl");
        expect(out.map((i) => i.id)).toEqual(["bt", "forever-barrow"]);
        expect(out[1]).toEqual({ id: "forever-barrow", name: "Barrow Deeps", short: "Barrow", zoneNames: ["barrow deeps"] });
        expect(out[0].zoneNames).toEqual([]);
    });

    it("is empty without a template", () => {
        expect(categoryInstances({}, "c1")).toEqual([]);
        expect(categoryInstances({ categoryRaidTemplate: { c1: "gone" } }, "c1")).toEqual([]);
        expect(getRaidTemplate).toHaveBeenCalledWith("gone");
    });
});

describe("categoryCouncil", () => {
    it("builds the category with its profile's view (#676) and names profile and roster", async () => {
        councilProfiles.viewFor.mockReturnValue({ role: "healer", tiers: ["t6"], contents: [], bisTier: "t6", version: "", stored: true });
        councilProfiles.resolveProfile.mockReturnValue({ profile: { id: "p-1", name: "Main T6" }, source: "roster", roster: { id: "r1", name: "Mittwoch" } });
        councilRoster.mockReturnValue({ rows: [] });
        const { view, opts, profile, roster } = await categoryCouncil("c1");
        expect(councilProfiles.viewFor).toHaveBeenCalledWith({ categoryId: "c1" });
        expect(view.role).toBe("healer");
        expect(opts).toMatchObject({ role: "healer", tierIds: ["t6"], categoryId: "c1", bisTier: "t6" });
        expect(councilRoster).toHaveBeenCalledWith(opts);
        expect(profile).toEqual({ id: "p-1", name: "Main T6", isDefault: false, source: "roster" });
        expect(roster).toEqual({ id: "r1", name: "Mittwoch" });
    });
});
