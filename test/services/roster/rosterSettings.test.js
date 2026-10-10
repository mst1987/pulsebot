// rosterSettings (#657): the checks of a roster's settings and the split
// between full admins and the managers of a roster.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const rosterStore = require("../../../src/stores/rosterStore");
const configStore = require("../../../src/stores/configStore");
const { cleanSettings, adminOnlyChanges, updateRosterSettings, MANAGER_FIELDS } = require("../../../src/services/roster/rosterSettings");

const R1 = "900000000000000001";
const R2 = "900000000000000002";
const R3 = "900000000000000003";

let roster;
beforeEach(() => {
    fs.__store.clear();
    roster = rosterStore.createRoster({ name: "Donnerstag", guildId: "g1", categoryId: "700000000000000001", roleIds: [R1], slots: { total: 25, tank: 3, healer: 6, bench: 2 } });
});

describe("services/roster/rosterSettings cleanSettings", () => {
    it("keeps only the fields sent, merges slots and managers onto the roster", () => {
        const { fields } = cleanSettings({ name: "  Neuer   Name ", slots: { bench: 4 }, managers: { userIds: ["100001"] }, extra: 1 }, { current: roster });
        expect(fields).toEqual({
            name: "Neuer Name",
            slots: { total: 25, tank: 3, healer: 6, bench: 4 },
            managers: { roleIds: [], userIds: ["100001"] },
        });
    });

    it("refuses every bad field with its code", () => {
        const cases = [
            [{ name: 5 }, "invalid_name"],
            [{ name: "x".repeat(41) }, "name_too_long"],
            [{ name: "" }, "invalid_name"],
            [{ categoryId: "abc" }, "bad_request"],
            [{ versionId: "wotlk" }, "invalid_version"],
            [{ roleIds: "x" }, "invalid_roles"],
            [{ roleIds: ["nope"] }, "invalid_roles"],
            [{ roleIds: Array.from({ length: 21 }, (_, i) => `90000000000000${100 + i}`) }, "invalid_roles"],
            [{ trialRoleId: R1 }, "invalid_roles"],
            [{ trialRoleId: "x1" }, "invalid_roles"],
            [{ managers: [] }, "invalid_managers"],
            [{ managers: { userIds: ["abc"] } }, "invalid_managers"],
            [{ slots: { total: -1 } }, "invalid_slots"],
            [{ slots: { total: 1.5 } }, "invalid_slots"],
            [{ slots: { total: 201 } }, "invalid_slots"],
            [{ slots: { total: 5, tank: 3, healer: 3 } }, "invalid_slots"],
            [{ slots: "25" }, "invalid_slots"],
            [{ allowMultipleChars: "ja" }, "bad_request"],
            [{ signupOnly: 1 }, "bad_request"],
        ];
        for (const [raw, code] of cases) expect({ raw, code: cleanSettings(raw, { current: roster }).code }).toEqual({ raw, code });
    });

    it("refuses roles the server does not have, once its roles are known", () => {
        expect(cleanSettings({ roleIds: [R2] }, { knownRoleIds: new Set([R1]) }).code).toBe("unknown_role");
        expect(cleanSettings({ trialRoleId: R3 }, { knownRoleIds: new Set([R1]) }).code).toBe("unknown_role");
        expect(cleanSettings({ roleIds: [R2] }, { knownRoleIds: null }).fields.roleIds).toEqual([R2]);
        expect(cleanSettings({ categoryId: "", trialRoleId: "" }).fields).toEqual({ categoryId: null, trialRoleId: null });
    });

    it("lets an empty name through for a new roster (the route fills it in)", () => {
        expect(cleanSettings({ name: "" }).fields).toEqual({ name: "" });
    });
});

describe("services/roster/rosterSettings permission split", () => {
    it("lets managers change name, slots, allowMultipleChars, signupOnly and the council profile only", () => {
        expect(MANAGER_FIELDS).toEqual(["name", "slots", "allowMultipleChars", "signupOnly", "publicRaids", "lootProfileId"]);
        const { fields } = cleanSettings({ name: "X", roleIds: [R1], managers: { userIds: ["100001"] } }, { current: roster });
        // roleIds unchanged passes, the new manager does not
        expect(adminOnlyChanges(fields, roster)).toEqual(["managers"]);
    });

    it("answers admin_only for a manager changing roles, managers or category", () => {
        for (const raw of [{ roleIds: [R2] }, { managers: { roleIds: [R3] } }, { categoryId: null }, { trialRoleId: R2 }, { versionId: "forever" }]) {
            expect({ raw, code: updateRosterSettings(roster.id, raw, { isAdmin: false }).code }).toEqual({ raw, code: "admin_only" });
        }
        expect(rosterStore.getRoster(roster.id).roleIds).toEqual([R1]);
    });

    it("lets a manager rename and resize, with the caller in the history", () => {
        const res = updateRosterSettings(roster.id, { name: "Freitag", slots: { total: 20, tank: 2, healer: 5 }, signupOnly: true, roleIds: [R1] }, { actor: "100001" });
        expect(res.ok).toBe(true);
        expect(res.roster).toEqual(expect.objectContaining({ name: "Freitag", signupOnly: true, slots: { total: 20, tank: 2, healer: 5, bench: 2 } }));
        expect(res.roster.history.slice(-1)[0]).toEqual(expect.objectContaining({ what: "settings", by: "100001" }));
    });
});

describe("services/roster/rosterSettings updateRosterSettings (admin)", () => {
    it("changes roles and mirrors them into the category's raider roles of the settings", () => {
        const res = updateRosterSettings(roster.id, { roleIds: [R2, R1], trialRoleId: R3 }, { isAdmin: true, actor: "1" });
        expect(res.roster).toEqual(expect.objectContaining({ roleIds: [R2, R1], trialRoleId: R3 }));
        expect(configStore.getConfig().categoryRoles).toEqual({ "700000000000000001": [R2, R1] });
    });

    it("answers category_taken and not_found", () => {
        const other = rosterStore.createRoster({ name: "B", categoryId: "700000000000000002" });
        expect(updateRosterSettings(other.id, { categoryId: "700000000000000001" }, { isAdmin: true }).code).toBe("category_taken");
        expect(updateRosterSettings("nope", { name: "x" }, { isAdmin: true }).code).toBe("not_found");
        expect(updateRosterSettings(roster.id, { name: "" }, { isAdmin: true }).code).toBe("invalid_name");
    });

    it("counts the members cut to one character when allowMultipleChars goes off", () => {
        updateRosterSettings(roster.id, { allowMultipleChars: true }, { isAdmin: true });
        rosterStore.upsertMember(roster.id, "100001", { chars: ["Devi", "Keslight"] });
        rosterStore.upsertMember(roster.id, "100002", { chars: ["Solo"] });
        const res = updateRosterSettings(roster.id, { allowMultipleChars: false }, { isAdmin: true });
        expect(res.trimmedChars).toBe(1);
        expect(res.roster.members["100001"].chars).toEqual(["devi"]);
    });

    it("links and unlinks a Kader (admins only, known Kader, one roster per Kader)", () => {
        const known = (id) => id === "k1" || id === "k2";
        expect(updateRosterSettings(roster.id, { kaderId: "k1" }, { isAdmin: false, kaderKnown: known }).code).toBe("admin_only");
        expect(updateRosterSettings(roster.id, { kaderId: "gone" }, { isAdmin: true, kaderKnown: known }).code).toBe("kader_not_found");
        expect(updateRosterSettings(roster.id, { kaderId: 5 }, { isAdmin: true }).code).toBe("bad_request");
        expect(updateRosterSettings(roster.id, { kaderId: "k1" }, { isAdmin: true, kaderKnown: known }).roster.kaderId).toBe("k1");
        const other = rosterStore.createRoster({ name: "B" });
        expect(updateRosterSettings(other.id, { kaderId: "k1" }, { isAdmin: true, kaderKnown: known }).code).toBe("kader_taken");
        // the unchanged link of a whole form passes for a manager; "" unlinks
        expect(updateRosterSettings(roster.id, { kaderId: "k1", name: "X" }, { isAdmin: false, kaderKnown: known }).ok).toBe(true);
        expect(updateRosterSettings(roster.id, { kaderId: "" }, { isAdmin: true }).roster.kaderId).toBeNull();
    });

    it("passes an unexpected store error on", () => {
        const spy = jest.spyOn(rosterStore, "updateRoster").mockImplementationOnce(() => { throw new Error("disk"); });
        expect(() => updateRosterSettings(roster.id, { name: "x" }, { isAdmin: true })).toThrow("disk");
        spy.mockRestore();
    });
});

describe("services/roster/rosterSettings loot system and Loot-Council profile (#676)", () => {
    const councilProfilesStore = require("../../../src/stores/councilProfilesStore");
    const { rosterLootSystem } = require("../../../src/services/loot/lootSystem");
    const CAT = "700000000000000001";

    it("writes the loot system of a roster WITH category into config.categoryLootSystem (one truth)", () => {
        const res = updateRosterSettings(roster.id, { lootSystem: "lootcouncil" }, { isAdmin: true, actor: "1" });
        expect(res.ok).toBe(true);
        expect(configStore.getConfig().categoryLootSystem[CAT]).toBe("lootcouncil");
        expect(res.roster.lootSystem).toBe("");
        expect(rosterLootSystem(configStore.getConfig(), res.roster)).toEqual({ system: "lootcouncil", source: "category" });
        expect(res.roster.history.at(-1)).toMatchObject({ by: "1", what: "settings", detail: "lootSystem" });
    });

    it("keeps the loot system of a roster WITHOUT category on the roster", () => {
        const solo = rosterStore.createRoster({ name: "PuG", guildId: "g1" });
        const res = updateRosterSettings(solo.id, { lootSystem: "gdkp" }, { isAdmin: true });
        expect(res.roster.lootSystem).toBe("gdkp");
        expect(configStore.getConfig().categoryLootSystem || {}).toEqual({});
        expect(rosterLootSystem(configStore.getConfig(), res.roster)).toEqual({ system: "gdkp", source: "roster" });
    });

    it("lets only admins change the loot system; the unchanged value of a whole form passes for a manager", () => {
        expect(updateRosterSettings(roster.id, { lootSystem: "lootcouncil" }, { isAdmin: false }).code).toBe("admin_only");
        // the category follows Softres by default: sending that back changes nothing
        expect(updateRosterSettings(roster.id, { lootSystem: "softres", name: "Do" }, { isAdmin: false }).ok).toBe(true);
        expect(updateRosterSettings(roster.id, { lootSystem: "dkp" }, { isAdmin: true }).code).toBe("invalid_loot_system");
        expect(updateRosterSettings(roster.id, { lootSystem: 3 }, { isAdmin: true }).code).toBe("invalid_loot_system");
    });

    it("lets admins and managers pick a profile that exists, '' goes back to the default", () => {
        const p = councilProfilesStore.createProfile({ name: "Main T6" });
        const byManager = updateRosterSettings(roster.id, { lootProfileId: p.id }, { isAdmin: false, actor: "100001" });
        expect(byManager.ok).toBe(true);
        expect(byManager.roster.lootProfileId).toBe(p.id);
        expect(byManager.roster.history.at(-1)).toMatchObject({ what: "settings", detail: "lootProfileId" });
        expect(updateRosterSettings(roster.id, { lootProfileId: "p-nope" }, { isAdmin: true }).code).toBe("unknown_profile");
        expect(updateRosterSettings(roster.id, { lootProfileId: 7 }, { isAdmin: true }).code).toBe("unknown_profile");
        expect(updateRosterSettings(roster.id, { lootProfileId: "" }, { isAdmin: true }).roster.lootProfileId).toBe("");
        // the default profile exists even while only virtual
        expect(updateRosterSettings(roster.id, { lootProfileId: "standard" }, { isAdmin: false }).roster.lootProfileId).toBe("standard");
    });

    it("never takes the loot fields on create (settings only)", () => {
        const { fields } = cleanSettings({ name: "Neu", lootSystem: "gdkp", lootProfileId: "x" });
        expect(fields).toEqual({ name: "Neu" });
    });
});
