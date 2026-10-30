// PuG onboarding roles must not unlock anything (#930, src/services/discord/pug/pugRoleGuard.js):
// every field selfRole.roleUses reads is refused for a version or class role of the
// onboarding, an old entry is no refusal (the Bot-Check reports it), a roster of another
// server does not count, and without config.pugRoles nothing changes.
jest.mock("../../../../src/config/variables", () => ({ adminRoleIds: [] }));

const rosterStore = require("../../../../src/stores/roster/rosterStore");
const guard = require("../../../../src/services/discord/pug/pugRoleGuard");

const GID = "100000000000000001";
const OTHER_GID = "100000000000000002";
const VERSION_ROLE = "200000000000000001";
const CLASS_ROLE = "200000000000000002";
const PLAIN = "200000000000000009";

const pug = (extra = {}) => ({ pugRoles: { [GID]: { versions: { tbc: VERSION_ROLE }, classes: { Warrior: CLASS_ROLE } } }, ...extra });
const roster = (over = {}) => ({ id: "ro1", name: "Kara", guildId: GID, roleIds: [], trialRoleId: "", managers: { roleIds: [], userIds: [] }, ...over });

beforeEach(() => jest.spyOn(rosterStore, "listRosters").mockReturnValue([]));
afterEach(() => jest.restoreAllMocks());

/** What a config save adds to the onboarding roles, as keys. */
const added = (after, before = pug()) => guard.newGrants({ before, after }).flatMap((f) => f.grants.map((g) => `${f.roleId}:${g.key}`));

describe("pugRoleGuard onboardingRoles", () => {
    it("maps every version and class role to its server and a readable name", () => {
        const roles = guard.onboardingRoles(pug());
        expect(roles.get(VERSION_ROLE)).toEqual({ guildId: GID, kind: "version", id: "tbc", label: "TBC Anniversary" });
        expect(roles.get(CLASS_ROLE)).toEqual({ guildId: GID, kind: "class", id: "Warrior", label: "Krieger" });
        expect(roles.size).toBe(2);
    });

    it("is empty without pugRoles and skips empty ids", () => {
        expect(guard.onboardingRoles({}).size).toBe(0);
        expect(guard.onboardingRoles(null).size).toBe(0);
        expect(guard.onboardingRoles({ pugRoles: { [GID]: { versions: { tbc: "" }, classes: null } } }).size).toBe(0);
    });
});

describe("pugRoleGuard newGrants: every field", () => {
    it.each([
        ["adminRoleIds", { adminRoleIds: [VERSION_ROLE] }, "admin"],
        ["orgaRoleIds", { orgaRoleIds: [CLASS_ROLE] }, "orga"],
        ["officerRoleId", { serverSettings: { "900000000000000009": { officerRoleId: VERSION_ROLE } } }, "officer"],
        ["rolePermissions", { rolePermissions: { [CLASS_ROLE]: { roster: { read: true, write: false } } } }, "rolePermissions:roster:read"],
        ["botCommandAccess", { botCommandAccess: { event: { roleIds: [VERSION_ROLE] } } }, "botCommand:event"],
        ["categoryRoles", { categoryRoles: { cat1: [CLASS_ROLE] } }, "categoryRaider:cat1"],
        ["roleSync", { roleSync: [{ fromGuildId: GID, fromRoleId: VERSION_ROLE, toGuildId: OTHER_GID, toRoleId: "x", direction: "both" }] }, `roleSync:${OTHER_GID}:x`],
    ])("refuses an onboarding role in %s", (_field, extra, key) => {
        const found = added(pug(extra));
        expect(found).toHaveLength(1);
        expect(found[0].endsWith(`:${key}`)).toBe(true);
    });

    it.each([
        ["roleIds", { roleIds: [VERSION_ROLE] }, "member"],
        ["trialRoleId", { trialRoleId: CLASS_ROLE }, "trial"],
        ["managers", { managers: { roleIds: [VERSION_ROLE], userIds: [] } }, "manager"],
    ])("refuses an onboarding role in a roster's %s", (_field, over, kind) => {
        const found = guard.newGrants({ before: pug(), after: pug(), rostersBefore: [roster()], rostersAfter: [roster(over)] });
        expect(found).toHaveLength(1);
        expect(found[0].grants.map((g) => g.key)).toEqual([`roster:ro1:${kind}`]);
    });

    it("lets a plain role and the onboarding's own pugRoles through", () => {
        expect(added(pug({ orgaRoleIds: [PLAIN], categoryRoles: { cat1: [PLAIN] } }))).toEqual([]);
        // a new onboarding role on its own is no right
        expect(added(pug(), {})).toEqual([]);
    });

    it("lets an old right through when the role only now becomes an onboarding role, refuses a new one", () => {
        const before = { orgaRoleIds: [VERSION_ROLE] };
        expect(added({ ...pug(), orgaRoleIds: [VERSION_ROLE] }, before)).toEqual([]);
        // the right is old, only the onboarding is new: the Bot-Check reports it, the save passes
        expect(added({ ...pug(), orgaRoleIds: [VERSION_ROLE], serverSettings: { "900000000000000009": { officerRoleId: VERSION_ROLE } } }, before)).toEqual([`${VERSION_ROLE}:officer`]);
    });

    it("does not block a right the role already had, only a new one", () => {
        const before = pug({ botCommandAccess: { event: { roleIds: [VERSION_ROLE] } } });
        expect(added(before, before)).toEqual([]);
        expect(added(pug({ botCommandAccess: { event: { roleIds: [VERSION_ROLE] }, raidplan: { roleIds: [VERSION_ROLE] } } }), before))
            .toEqual([`${VERSION_ROLE}:botCommand:raidplan`]);
    });

    it("refuses raising an area right from read to write", () => {
        const perm = (write) => ({ rolePermissions: { [VERSION_ROLE]: { raids: { read: true, write } } } });
        expect(added(pug(perm(false)), pug(perm(false)))).toEqual([]);
        expect(added(pug(perm(true)), pug(perm(false)))).toEqual([`${VERSION_ROLE}:rolePermissions:raids:write`]);
        // lowering is no new right
        expect(added(pug(perm(false)), pug(perm(true)))).toEqual([]);
    });

    it("refuses a new role-sync pair next to an old one", () => {
        const sync = (toRoleId) => ({ fromGuildId: GID, fromRoleId: VERSION_ROLE, toGuildId: OTHER_GID, toRoleId, direction: "both" });
        const before = pug({ roleSync: [sync("300000000000000001")] });
        expect(added(before, before)).toEqual([]);
        expect(added(pug({ roleSync: [sync("300000000000000001"), sync("300000000000000002")] }), before))
            .toEqual([`${VERSION_ROLE}:roleSync:${OTHER_GID}:300000000000000002`]);
        // the onboarding role on the partner side of a pair counts as well
        const reverse = { fromGuildId: OTHER_GID, fromRoleId: "300000000000000003", toGuildId: GID, toRoleId: CLASS_ROLE, direction: "toTarget" };
        expect(added(pug({ roleSync: [reverse] }))).toEqual([`${CLASS_ROLE}:roleSync:${OTHER_GID}:300000000000000003`]);
    });

    it("does not count a closed roster, so reopening it is a new right", () => {
        const closed = roster({ roleIds: [VERSION_ROLE], closedAt: "2026-10-01T00:00:00.000Z" });
        expect(guard.newGrants({ before: pug(), after: pug(), rostersBefore: [], rostersAfter: [closed] })).toEqual([]);
        const found = guard.newGrants({ before: pug(), after: pug(), rostersBefore: [closed], rostersAfter: [{ ...closed, closedAt: null }] });
        expect(found[0].grants.map((g) => g.key)).toEqual(["roster:ro1:member"]);
    });

    it("changes nothing without pugRoles", () => {
        expect(guard.newGrants({ before: {}, after: { orgaRoleIds: [VERSION_ROLE] }, rostersAfter: [roster({ roleIds: [VERSION_ROLE] })] })).toEqual([]);
    });

    it("ignores a roster of another server", () => {
        const other = roster({ guildId: OTHER_GID, roleIds: [VERSION_ROLE] });
        expect(guard.newGrants({ before: pug(), after: pug(), rostersBefore: [], rostersAfter: [other] })).toEqual([]);
    });

    it("reads the stored rosters when none are given", () => {
        rosterStore.listRosters.mockReturnValue([roster({ roleIds: [CLASS_ROLE] })]);
        // stored on both sides: nothing new
        expect(guard.newGrants({ before: pug(), after: pug() })).toEqual([]);
        expect(guard.newGrants({ before: pug(), after: pug(), rostersBefore: [] })[0].grants[0].key).toBe("roster:ro1:member");
    });

    it("treats a broken roster store as no rosters", () => {
        rosterStore.listRosters.mockImplementation(() => { throw new Error("broken"); });
        expect(guard.newGrants({ before: pug(), after: pug({ orgaRoleIds: [VERSION_ROLE] }) })).toHaveLength(1);
    });
});

describe("pugRoleGuard grantsOf (pugOnboarding.privilegeOf)", () => {
    it("keeps the version use of another version, drops the own one", () => {
        const cfg = { pugRoles: { [GID]: { versions: { tbc: VERSION_ROLE, classic: CLASS_ROLE }, classes: {} } } };
        expect(guard.grantsOf(cfg, VERSION_ROLE, { item: { kind: "version", id: "tbc" }, rosters: [] })).toEqual([]);
        expect(guard.grantsOf(cfg, VERSION_ROLE, { item: { kind: "version", id: "classic" }, rosters: [] })).toEqual([{ code: "pugVersion", versionIds: ["tbc"] }]);
        // a class role that is a version role carries a right
        expect(guard.grantsOf(cfg, VERSION_ROLE, { item: { kind: "class", id: "Warrior" }, rosters: [] })).toHaveLength(1);
        // without an item the onboarding itself is no right
        expect(guard.grantsOf(cfg, VERSION_ROLE, { rosters: [] })).toEqual([]);
    });
});

describe("pugRoleGuard texts", () => {
    it("names the role, its kind and every new right in the refusal", () => {
        const found = guard.newGrants({
            before: pug(), after: pug({ orgaRoleIds: [VERSION_ROLE], rolePermissions: { [VERSION_ROLE]: { roster: { read: true, write: true } } } }),
            rostersBefore: [], rostersAfter: [roster({ managers: { roleIds: [VERSION_ROLE], userIds: [] } })],
        });
        const text = guard.refusalMessage(found);
        expect(text).toContain("PuG-Onboarding");
        expect(text).toContain("„TBC Anniversary“ (PuG-Versionsrolle)");
        expect(text).toContain("Orga-Rolle");
        expect(text).toContain("Bereichsrecht roster (lesen)");
        expect(text).toContain("Bereichsrecht roster (schreiben)");
        expect(text).toContain("Roster Kara (Manager)");
        expect(text).not.toContain("Ausweg");
    });

    it("names the way out when the right comes from a roster a switch back reopens", () => {
        const viaRoster = guard.newGrants({ before: pug(), after: pug(), rostersBefore: [], rostersAfter: [roster({ roleIds: [VERSION_ROLE] })] });
        const reopened = [{ id: "ro1", name: "Kara", categoryId: "c1" }];
        const text = guard.refusalMessage(viaRoster, { reopened });
        expect(text).toContain("abgeschlossenen Roster „Kara“");
        expect(text).toContain("das Roster löschen (Voll-Admin)");
        expect(text).toContain("andere Onboarding-Rolle");
        // the mirrored raider role of the reopened roster's category counts too
        const viaCategory = guard.newGrants({ before: pug(), after: pug({ categoryRoles: { c1: [VERSION_ROLE] } }), rostersBefore: [], rostersAfter: [] });
        expect(guard.refusalMessage(viaCategory, { reopened })).toContain("Ausweg");
        // another roster reopened: no way out named
        expect(guard.refusalMessage(viaRoster, { reopened: [{ id: "ro2", name: "Gruul", categoryId: "c2" }] })).not.toContain("Ausweg");
    });

    it("words every right", () => {
        expect(guard.grantText({ code: "admin" })).toBe("Voll-Admin-Rolle");
        expect(guard.grantText({ code: "officer" })).toBe("Offiziers-Rolle (Bewerbungen)");
        expect(guard.grantText({ code: "botCommand", detail: "event" })).toBe("Bot-Befehl /event");
        expect(guard.grantText({ code: "categoryRaider", detail: "c" })).toBe("Raider-Rolle einer Kategorie");
        expect(guard.grantText({ code: "roleSync", detail: "" })).toBe("Rollen-Abgleich zwischen den Servern");
        expect(guard.grantText({ code: "roleSync", detail: OTHER_GID, partnerRoleId: "3" })).toBe("Rollen-Abgleich zwischen den Servern (mit Rolle 3)");
        expect(guard.grantText({ code: "rolePermissions", detail: "raids" })).toBe("Bereichsrecht raids");
        expect(guard.grantText({ code: "something" })).toBe("something");
    });
});

describe("pugRoleGuard leftovers (Bot-Check)", () => {
    it("lists an onboarding role of the server that still carries a right", () => {
        const cfg = pug({ orgaRoleIds: [CLASS_ROLE] });
        const rosters = [roster({ roleIds: [CLASS_ROLE] }), roster({ id: "ro2", guildId: OTHER_GID, roleIds: [VERSION_ROLE] })];
        expect(guard.leftovers(cfg, GID, rosters)).toEqual([{
            id: CLASS_ROLE, guildId: GID, kind: "class", itemId: "Warrior", label: "Krieger",
            uses: [{ code: "orga" }, { code: "roster", rosterId: "ro1", name: "Kara", kinds: ["member"] }],
            grants: ["Orga-Rolle", "Roster Kara (Mitglied)"],
        }]);
    });

    it("skips a closed roster and shows an area with write once", () => {
        const cfg = pug({ rolePermissions: { [CLASS_ROLE]: { raids: { read: true, write: true } } } });
        const rosters = [roster({ roleIds: [CLASS_ROLE], closedAt: "2026-10-01T00:00:00.000Z" })];
        const [found] = guard.leftovers(cfg, GID, rosters);
        expect(found.uses.map((u) => u.code)).toEqual(["rolePermissions"]);
        expect(found.grants).toEqual(["Bereichsrecht raids (schreiben)"]);
        expect(guard.leftovers(pug(), GID, rosters)).toEqual([]);
    });

    it("skips other servers and clean roles, reads all servers without a guild", () => {
        const cfg = pug({ orgaRoleIds: [VERSION_ROLE] });
        expect(guard.leftovers(cfg, OTHER_GID, [])).toEqual([]);
        expect(guard.leftovers(cfg, "", []).map((r) => r.id)).toEqual([VERSION_ROLE]);
        expect(guard.leftovers(pug(), GID)).toEqual([]);
        expect(guard.leftovers({}, GID)).toEqual([]);
    });
});
