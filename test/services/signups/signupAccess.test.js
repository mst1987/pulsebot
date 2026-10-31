// "Darf sich anmelden" (src/services/signups/signupAccess.js): the one rule the
// save (checkRaiderRole) and the raider's lists of raids share - roster-only
// signup, raider roles of the raid's version, open categories (PuG), unknown roles.
const rosterStore = require("../../../src/stores/roster/rosterStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const {
    accessRule, signupAccess, rosterOnlyAccess, canSignUp, openToAll, inEventCategories,
} = require("../../../src/services/signups/signupAccess");

const ANNA = "200000000000000001";
const config = { categoryIds: ["mo", "mi", "pug", "ro"], categoryRoles: { mo: ["role-mo"], mi: ["role-mi"] } };

beforeAll(() => rosterStore.useFile(tempStoreFile("eh-signup-access-rosters.json")));
afterAll(() => rosterStore.useFile(null));
beforeEach(() => {
    for (const r of rosterStore.listRosters("")) rosterStore.deleteRoster(r.id);
});

describe("signupAccess", () => {
    it("a category without raider role and roster-only signup is open to everyone", () => {
        expect(signupAccess("pug", { userId: ANNA, roleIds: [], config })).toEqual({ rule: "open", allowed: true, code: "" });
        // even when the roles cannot be read
        expect(signupAccess("pug", { userId: ANNA, roleIds: null, config }).allowed).toBe(true);
        expect(openToAll("pug", { config })).toBe(true);
        expect(openToAll("mo", { config })).toBe(false);
    });

    it("a category with raider roles takes only their holders; unreadable roles are unknown", () => {
        expect(signupAccess("mo", { userId: ANNA, roleIds: ["role-mo"], config })).toEqual({ rule: "roles", allowed: true, code: "" });
        expect(signupAccess("mi", { userId: ANNA, roleIds: ["role-mo"], config })).toEqual({ rule: "roles", allowed: false, code: "raider_role" });
        expect(signupAccess("mi", { userId: ANNA, roleIds: null, config })).toEqual({ rule: "roles", allowed: null, code: "" });
    });

    it("roster-only signup: core, trial and bench may, paused members and outsiders may not - no role is read", () => {
        const roster = rosterStore.createRoster({ name: "RO", guildId: "g1", categoryId: "ro", roleIds: ["role-ro"], trialRoleId: "role-trial", signupOnly: true });
        expect(accessRule("ro", { config }).rule).toBe("roster");
        expect(signupAccess("ro", { userId: ANNA, roleIds: ["role-ro"], config })).toEqual({ rule: "roster", allowed: false, code: "roster_only" });
        for (const status of ["core", "trial", "bench"]) {
            rosterStore.upsertMember(roster.id, ANNA, { status });
            expect(signupAccess("ro", { userId: ANNA, roleIds: null, config }).allowed).toBe(true);
            expect(rosterOnlyAccess("ro", ANNA)).toBe(true);
        }
        rosterStore.upsertMember(roster.id, ANNA, { status: "pause" });
        expect(signupAccess("ro", { userId: ANNA, roleIds: [], config }).code).toBe("roster_only");
        expect(openToAll("ro", { config })).toBe(false);
    });

    it("\"Ansicht als Rolle\" counts a holder of the roster's roles as a member (rosterByRoles)", () => {
        rosterStore.createRoster({ name: "RO", guildId: "g1", categoryId: "ro", roleIds: ["role-ro"], trialRoleId: "role-trial", signupOnly: true });
        expect(signupAccess("ro", { roleIds: ["role-ro"], config, rosterByRoles: true }).allowed).toBe(true);
        expect(signupAccess("ro", { roleIds: ["role-trial"], config, rosterByRoles: true }).allowed).toBe(true);
        expect(signupAccess("ro", { roleIds: ["role-mo"], config, rosterByRoles: true })).toMatchObject({ allowed: false, code: "roster_only" });
        expect(signupAccess("ro", { roleIds: null, config, rosterByRoles: true }).allowed).toBeNull();
    });

    it("asks the roster of the raid's version (#739): the roles of another version's roster do not count", () => {
        rosterStore.createRoster({ name: "Mi F", guildId: "g1", categoryId: "mi", versionId: "forever", roleIds: ["role-mi-forever"] });
        expect(signupAccess("mi", { roleIds: ["role-mi-forever"], config, versionId: "forever" }).allowed).toBe(true);
        expect(signupAccess("mi", { roleIds: ["role-mi-forever"], config, versionId: "tbc" }).allowed).toBe(false);
        expect(signupAccess("mi", { roleIds: ["role-mi"], config, versionId: "tbc" }).allowed).toBe(true);
    });
});

describe("canSignUp", () => {
    it("is an event category and a yes of the rule - unknown roles are a no", () => {
        expect(canSignUp("mo", { roleIds: ["role-mo"], config })).toBe(true);
        expect(canSignUp("mi", { roleIds: ["role-mo"], config })).toBe(false);
        expect(canSignUp("mi", { roleIds: null, config })).toBe(false);
        expect(canSignUp("pug", { roleIds: null, config })).toBe(true);
        // not an event category
        expect(canSignUp("elsewhere", { roleIds: [], config })).toBe(false);
        expect(inEventCategories("elsewhere", {})).toBe(true);
        expect(inEventCategories("elsewhere", config)).toBe(false);
    });
});
