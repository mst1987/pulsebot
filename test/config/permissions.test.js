const {
    AREAS, AREA_IDS, emptyAccess, fullAccess, can, canAny, hasAnyAccess, readableAreas,
    normalizeRolePermissions, normalizeUserPermissions, normalizeAreaAccess, mergeAccess, baseAccessMap,
    accessForRoles, accessForUser, userCan, userCanAny, userHasMenuAccess,
} = require("../../src/config/permissions");

describe("config/permissions", () => {
    describe("emptyAccess / fullAccess", () => {
        it("covers every area", () => {
            expect(Object.keys(emptyAccess())).toEqual(AREA_IDS);
            expect(Object.keys(fullAccess())).toEqual(AREA_IDS);
        });

        it("grants nothing / everything", () => {
            expect(hasAnyAccess(emptyAccess())).toBe(false);
            expect(readableAreas(fullAccess())).toEqual(AREA_IDS);
        });
    });

    describe("can", () => {
        it("treats write as implying read", () => {
            const access = { raids: { read: false, write: true } };
            expect(can(access, "raids", "read")).toBe(true);
            expect(can(access, "raids", "write")).toBe(true);
        });

        it("does not let read imply write", () => {
            const access = { raids: { read: true, write: false } };
            expect(can(access, "raids", "read")).toBe(true);
            expect(can(access, "raids", "write")).toBe(false);
        });

        it("is false for unknown areas and a missing map", () => {
            expect(can({ raids: { read: true } }, "cla")).toBe(false);
            expect(can(null, "raids")).toBe(false);
            expect(can(undefined, "raids")).toBe(false);
        });
    });

    describe("canAny", () => {
        it("is true as soon as one of the areas is granted", () => {
            const access = { loot: { read: true, write: false } };
            expect(canAny(access, ["history", "loot"])).toBe(true);
            expect(canAny(access, ["history", "loot"], "write")).toBe(false);
            expect(canAny(access, ["history"])).toBe(false);
            expect(canAny(access, [])).toBe(false);
        });
    });

    describe("the loot area", () => {
        // The read-only slice of the history tab that the base access hands to
        // members — it shares the tab, so it must not become its own sidebar tab.
        it("is a second area on the history tab", () => {
            const loot = AREAS.find((a) => a.id === "loot");
            const history = AREAS.find((a) => a.id === "history");
            expect(loot).toBeDefined();
            expect(loot.tab).toBe(history.tab);
        });
    });

    describe("normalizeAreaAccess", () => {
        it("keeps known areas, lets write imply read and drops the rest", () => {
            expect(normalizeAreaAccess({
                loot: { read: true, write: false },
                history: { read: false, write: true },
                dashboard: { read: false, write: false },
                nonsense: { read: true, write: true },
            })).toEqual({
                loot: { read: true, write: false },
                history: { read: true, write: true },
            });
        });

        it("returns an empty object for anything that is not a map", () => {
            expect(normalizeAreaAccess(null)).toEqual({});
            expect(normalizeAreaAccess([{ loot: { read: true } }])).toEqual({});
            expect(normalizeAreaAccess("loot")).toEqual({});
        });
    });

    describe("mergeAccess / baseAccessMap", () => {
        it("unions both maps without touching either", () => {
            const a = { ...emptyAccess(), loot: { read: true, write: false } };
            const b = { ...emptyAccess(), raids: { read: true, write: true } };
            const merged = mergeAccess(a, b);
            expect(merged.loot).toEqual({ read: true, write: false });
            expect(merged.raids).toEqual({ read: true, write: true });
            expect(a.raids).toEqual({ read: false, write: false });
            expect(b.loot).toEqual({ read: false, write: false });
        });

        it("keeps the more permissive side of a conflict", () => {
            const merged = mergeAccess(
                { history: { read: true, write: false } },
                { history: { read: true, write: true } },
            );
            expect(merged.history).toEqual({ read: true, write: true });
        });

        it("turns a stored base access into a full map, empty when unset", () => {
            expect(baseAccessMap({ loot: { read: true } }).loot).toEqual({ read: true, write: false });
            expect(Object.keys(baseAccessMap({}))).toEqual(AREA_IDS);
            expect(hasAnyAccess(baseAccessMap(undefined))).toBe(false);
        });
    });

    describe("normalizeRolePermissions", () => {
        it("drops unknown areas, empty role ids and roles that grant nothing", () => {
            const out = normalizeRolePermissions({
                role1: { raids: { read: true, write: false }, nonsense: { read: true } },
                "  ": { raids: { read: true } },
                role2: { raids: { read: false, write: false } },
                role3: "not-an-object",
            });
            expect(out).toEqual({ role1: { raids: { read: true, write: false } } });
        });

        it("lets write imply read and coerces the flags to booleans", () => {
            const out = normalizeRolePermissions({ role1: { cla: { write: 1 } } });
            expect(out).toEqual({ role1: { cla: { read: true, write: true } } });
        });

        it("returns {} for anything that isn't a plain object", () => {
            expect(normalizeRolePermissions(null)).toEqual({});
            expect(normalizeRolePermissions([])).toEqual({});
            expect(normalizeRolePermissions("x")).toEqual({});
        });
    });

    describe("accessForRoles", () => {
        const perms = {
            role1: { raids: { read: true, write: false }, cla: { read: true, write: false } },
            role2: { raids: { read: true, write: true } },
        };

        it("unions the rights of every role the member holds — the most permissive wins", () => {
            const access = accessForRoles(perms, ["role1", "role2"]);
            expect(access.raids).toEqual({ read: true, write: true });
            expect(access.cla).toEqual({ read: true, write: false });
            expect(access.settings).toEqual({ read: false, write: false });
        });

        it("ignores roles that have no permissions configured", () => {
            expect(accessForRoles(perms, ["unknown"])).toEqual(emptyAccess());
            expect(accessForRoles(perms, [])).toEqual(emptyAccess());
            expect(accessForRoles({}, ["role1"])).toEqual(emptyAccess());
        });
    });

    describe("userCan / userHasMenuAccess", () => {
        it("gives full admins everything regardless of their access map", () => {
            const admin = { isAdmin: true, access: emptyAccess() };
            expect(userCan(admin, "settings", "write")).toBe(true);
            expect(userHasMenuAccess(admin)).toBe(true);
        });

        it("follows the access map for everyone else", () => {
            const user = { isAdmin: false, access: { ...emptyAccess(), raids: { read: true, write: false } } };
            expect(userCan(user, "raids")).toBe(true);
            expect(userCan(user, "raids", "write")).toBe(false);
            expect(userCan(user, "cla")).toBe(false);
            expect(userHasMenuAccess(user)).toBe(true);
        });

        it("locks out a user with no areas and an anonymous caller", () => {
            expect(userHasMenuAccess({ isAdmin: false, access: emptyAccess() })).toBe(false);
            expect(userHasMenuAccess({ isAdmin: false })).toBe(false);
            expect(userHasMenuAccess(null)).toBe(false);
            expect(userCan(null, "raids")).toBe(false);
        });

        it("userCanAny takes any one of the areas, admins included", () => {
            const looter = { isAdmin: false, access: { ...emptyAccess(), loot: { read: true, write: false } } };
            expect(userCanAny(looter, ["history", "loot"])).toBe(true);
            expect(userCanAny(looter, ["history", "loot"], "write")).toBe(false);
            expect(userCanAny(looter, ["raids", "cla"])).toBe(false);
            expect(userCanAny({ isAdmin: true }, ["history", "loot"], "write")).toBe(true);
            expect(userCanAny(null, ["loot"])).toBe(false);
        });
    });
});

describe("config/permissions — per-account grants", () => {
    describe("normalizeUserPermissions", () => {
        it("normalises like the role map, keyed by user id", () => {
            const out = normalizeUserPermissions({
                "233598324022837249": { lootcouncil: { read: false, write: true }, nonsense: { read: true } },
            });
            // write implies read; an unknown area is dropped.
            expect(out["233598324022837249"]).toEqual({ lootcouncil: { read: true, write: true } });
        });

        it("drops an account that ends up granting nothing", () => {
            expect(normalizeUserPermissions({ "1": { lootcouncil: { read: false, write: false } } })).toEqual({});
            expect(normalizeUserPermissions({ "1": {} })).toEqual({});
        });

        it("tolerates junk", () => {
            expect(normalizeUserPermissions(null)).toEqual({});
            expect(normalizeUserPermissions([])).toEqual({});
            expect(normalizeUserPermissions("x")).toEqual({});
        });
    });

    describe("accessForUser", () => {
        const perms = { "42": { lootcouncil: { read: true, write: false }, raids: { read: true, write: true } } };

        it("returns exactly what is configured for that account", () => {
            const access = accessForUser(perms, "42");
            expect(access.lootcouncil).toEqual({ read: true, write: false });
            expect(access.raids).toEqual({ read: true, write: true });
            expect(access.settings).toEqual({ read: false, write: false });
        });

        it("gives an account with no entry nothing at all", () => {
            expect(hasAnyAccess(accessForUser(perms, "999"))).toBe(false);
            expect(hasAnyAccess(accessForUser(perms, ""))).toBe(false);
            expect(hasAnyAccess(accessForUser(undefined, "42"))).toBe(false);
        });

        it("matches a numeric id given as a number", () => {
            expect(can(accessForUser(perms, 42), "lootcouncil")).toBe(true);
        });

        it("only ever widens when merged with the base access", () => {
            const base = baseAccessMap({ loot: { read: true } });
            const merged = mergeAccess(base, accessForUser(perms, "42"));
            expect(can(merged, "loot")).toBe(true);
            expect(can(merged, "lootcouncil")).toBe(true);
            expect(can(merged, "raids", "write")).toBe(true);
        });
    });

    describe("the lootcouncil area", () => {
        it("is its own area on its own tab", () => {
            const area = AREAS.find((a) => a.id === "lootcouncil");
            expect(area).toBeTruthy();
            expect(area.tab).toBe("lootcouncil");
        });

        it("is not implied by the loot or history areas", () => {
            // The council is handed to a few people; the loot views are shared
            // with the guild. One must never open the other.
            const lootReader = { ...emptyAccess(), loot: { read: true, write: false } };
            expect(can(lootReader, "lootcouncil")).toBe(false);
            const historyWriter = { ...emptyAccess(), history: { read: true, write: true } };
            expect(can(historyWriter, "lootcouncil")).toBe(false);
        });
    });
});
