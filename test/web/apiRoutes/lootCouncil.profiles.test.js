// The Loot-Council profiles over HTTP (#676): GET /api/lootcouncil/profiles and
// /profile, POST /profiles/create|update|delete, and the views per profile
// (GET /views, POST /view) - on the real stores pointed at scratch files. The
// permission check stays real: reading takes `lootcouncil` read, every write
// `lootcouncil` write.
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock({ body: () => mockBody }));
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: () => "g1" }));
jest.mock("../../../src/services/discord/discord", () => ({
    listCategories: () => [{ id: "cA", name: "Mittwoch" }, { id: "cB", name: "Sonntag" }],
}));

let mockUser = null;
let mockBody = {};

const councilProfilesStore = require("../../../src/stores/councilProfilesStore");
const rosterStore = require("../../../src/stores/rosterStore");
const configStore = require("../../../src/stores/configStore");
const {
    getProfiles, getProfile, postProfileCreate, postProfileUpdate, postProfileDelete, getViews, postView,
} = require("../../../src/web/apiRoutes/lootCouncil");
const { mockRes, status, body, json } = require("../../helpers/http");
const { tempStoreFile } = require("../../helpers/tempStore");

const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const READER = { id: "2", name: "Reader", isAdmin: false, access: { lootcouncil: { read: true, write: false } } };
const WRITER = { id: "3", name: "Schreiber", isAdmin: false, access: { lootcouncil: { read: true, write: true } } };
const OUTSIDER = { id: "4", name: "Outsider", isAdmin: false, access: { roster: { read: true, write: true } } };

async function call(handler, query = "") {
    const res = mockRes();
    await handler({ headers: {} }, res, new URL(`http://localhost/api/lootcouncil/x${query}`));
    return res;
}
const code = (res) => (json(res).error || {}).code;

beforeAll(() => {
    rosterStore.useFile(tempStoreFile("rosters.json"));
    configStore.useFile(tempStoreFile("config.json"));
});
afterAll(() => {
    rosterStore.useFile(null);
    configStore.useFile(null);
    councilProfilesStore.useFile(null);
});
beforeEach(() => {
    mockUser = ADMIN;
    mockBody = {};
    councilProfilesStore.useFile(tempStoreFile("council-profiles.json"));
    for (const r of rosterStore.listRosters("")) rosterStore.deleteRoster(r.id);
    configStore.saveConfig({ categoryIds: ["cA", "cB"], categoryLootSystem: { cA: "lootcouncil" } });
});

describe("GET /api/lootcouncil/profiles", () => {
    it("lists Standard on a fresh install, readable for a reader, refused to anyone else", async () => {
        mockUser = READER;
        const data = body(await call(getProfiles));
        expect(data.defaultId).toBe("standard");
        expect(data.profiles).toEqual([{ id: "standard", name: "Standard", isDefault: true, rosters: [], otherRosters: [], categories: [], inUse: true, at: 0, by: "" }]);
        mockUser = OUTSIDER;
        const res = await call(getProfiles);
        expect([status(res), code(res)]).toEqual([403, "forbidden"]);
    });

    it("says who uses which profile", async () => {
        const main = councilProfilesStore.createProfile({ name: "Main T6" });
        rosterStore.createRoster({ name: "Mi-Roster", guildId: "g1", categoryId: "cA", lootProfileId: main.id });
        councilProfilesStore.setCategoryProfile("cB", main.id);
        const data = body(await call(getProfiles));
        const row = data.profiles.find((p) => p.id === main.id);
        expect(row).toMatchObject({ name: "Main T6", isDefault: false, inUse: true, categories: [{ id: "cB", name: "Sonntag" }] });
        expect(row.rosters.map((r) => r.name)).toEqual(["Mi-Roster"]);
    });
});

describe("profile CRUD", () => {
    it("creates, copies, renames and stores weights and view (write)", async () => {
        mockUser = WRITER;
        mockBody = { name: "Main T6" };
        let res = await call(postProfileCreate);
        expect(status(res)).toBe(200);
        const id = body(res).profile.id;
        mockBody = { id, weights: { classes: { trinket: 2.55 }, items: { 32483: { weight: 3, name: "Skull" } }, tenureDays: 1000 }, view: { role: "healer", tiers: ["t6"] } };
        res = await call(postProfileUpdate);
        const data = body(res);
        expect(data.profile).toMatchObject({ id, name: "Main T6", isDefault: false, view: { role: "healer", tiers: ["t6"] } });
        expect(data.profile.weights).toMatchObject({ classes: { trinket: 2.6 }, tenureDays: 365, by: "Schreiber" });
        expect(data.itemInfo["32483"]).toMatchObject({ name: "The Skull of Gul'dan", autoClass: "trinket" });
        expect(data.defaults.weights.tenureDays).toBe(90);
        expect(data.classIds).toEqual(["trinket", "bisWeapon", "weapon", "set", "normal", "frequent"]);

        mockBody = { name: "Kopie", copyFrom: id };
        const copy = body(await call(postProfileCreate)).profile;
        expect(copy.weights.tenureDays).toBe(365);
        mockBody = { id: copy.id, name: "PuG-Nacht" };
        expect(body(await call(postProfileUpdate)).profile.name).toBe("PuG-Nacht");
        expect(body(await call(getProfile, `?id=${copy.id}`)).profile.name).toBe("PuG-Nacht");
    });

    it("answers the refusals with their codes", async () => {
        mockBody = { name: "standard" };
        let res = await call(postProfileCreate);
        expect([status(res), code(res)]).toEqual([409, "name_taken"]);
        mockBody = { name: "" };
        expect(code(await call(postProfileCreate))).toBe("invalid_name");
        mockBody = { id: "p-gone", name: "X" };
        res = await call(postProfileUpdate);
        expect([status(res), code(res)]).toEqual([404, "not_found"]);
        mockBody = { id: "standard" };
        expect([status(await call(postProfileUpdate)), code(await call(postProfileUpdate))]).toEqual([400, "bad_request"]);
        mockBody = { id: "standard", weights: [1] };
        expect(code(await call(postProfileUpdate))).toBe("bad_request");
        res = await call(getProfile, "?id=p-gone");
        expect(status(res)).toBe(404);
    });

    it("deletes only an unused profile (409 profile_in_use), never the default", async () => {
        const main = councilProfilesStore.createProfile({ name: "Main" });
        const roster = rosterStore.createRoster({ name: "R", guildId: "g1", lootProfileId: main.id });
        mockBody = { id: main.id };
        let res = await call(postProfileDelete);
        expect([status(res), code(res)]).toEqual([409, "profile_in_use"]);
        rosterStore.updateRoster(roster.id, { lootProfileId: "" });
        res = await call(postProfileDelete);
        expect(body(res)).toEqual({ id: main.id, deleted: true });
        mockBody = { id: "standard" };
        res = await call(postProfileDelete);
        expect([status(res), code(res)]).toEqual([409, "profile_default"]);
    });

    it("takes write access for every change", async () => {
        mockUser = READER;
        for (const handler of [postProfileCreate, postProfileUpdate, postProfileDelete, postView]) {
            mockBody = { name: "X", id: "standard", weights: {}, profileId: "standard" };
            const res = await call(handler);
            expect(status(res)).toBe(403);
        }
        expect(councilProfilesStore.listProfiles()).toHaveLength(1);
    });
});

describe("views per profile", () => {
    it("hands out the views and which profile every roster and category uses", async () => {
        const main = councilProfilesStore.createProfile({ name: "Main" });
        councilProfilesStore.updateProfile(main.id, { view: { role: "tank", tiers: ["t5"] } });
        const r = rosterStore.createRoster({ name: "Mi", guildId: "g1", categoryId: "cA", lootProfileId: main.id });
        const solo = rosterStore.createRoster({ name: "Ohne", guildId: "g1", lootSystem: "lootcouncil" });
        mockUser = READER;
        const data = body(await call(getViews));
        expect(data.views[main.id]).toEqual({ role: "tank", tiers: ["t5"], contents: [], bisTier: "", version: "" });
        expect(data.views.standard.role).toBe("caster");
        expect(data.targets).toEqual({ [`roster:${r.id}`]: main.id, [`roster:${solo.id}`]: "standard", "category:cA": main.id, "category:cB": "standard" });
        expect(data.councilCategories).toEqual(["cA"]);
        expect(data.councilRosters.sort()).toEqual([r.id, solo.id].sort());
        expect(data.defaultId).toBe("standard");
    });

    it("writes a view into the profile of the roster or category named", async () => {
        const main = councilProfilesStore.createProfile({ name: "Main" });
        const r = rosterStore.createRoster({ name: "Mi", guildId: "g1", lootProfileId: main.id });
        mockUser = WRITER;
        mockBody = { roster: r.id, role: "melee", tiers: ["t6", "<x>"], contents: ["bt"], bisTier: "t6", version: "tbc" };
        let res = await call(postView);
        expect(body(res)).toEqual({ profileId: main.id, view: { role: "melee", tiers: ["t6"], contents: ["bt"], bisTier: "t6", version: "tbc" } });
        mockBody = { category: "cB", role: "healer" };
        expect(body(await call(postView)).profileId).toBe("standard");
        expect(councilProfilesStore.defaultProfile()).toMatchObject({ stored: true, view: { role: "healer" } });
        mockBody = { profileId: main.id, role: "" };
        expect(body(await call(postView)).view.role).toBe("");
        mockBody = { role: "caster" };
        res = await call(postView);
        expect([status(res), code(res)]).toEqual([400, "bad_request"]);
    });
});
