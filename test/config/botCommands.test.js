const {
    BOT_COMMAND_GROUPS, GROUP_IDS, normalizeRule, normalizeBotCommandAccess,
} = require("../../src/config/botCommands");

const ROLE_A = "123456789012345678";
const ROLE_B = "223456789012345678";

describe("config/botCommands", () => {
    it("names every group once, with a label and a WoW icon", () => {
        expect(new Set(GROUP_IDS).size).toBe(BOT_COMMAND_GROUPS.length);
        for (const g of BOT_COMMAND_GROUPS) {
            expect(g).toEqual({ id: expect.any(String), label: expect.any(String), icon: expect.stringMatching(/^[a-z0-9_]+$/) });
        }
    });

    describe("normalizeRule", () => {
        it("reads the defaultAccess shorthands", () => {
            expect(normalizeRule("everyone")).toEqual({ mode: "everyone", roleIds: [] });
            expect(normalizeRule("admins")).toEqual({ mode: "admins", roleIds: [] });
            expect(normalizeRule({ roles: [ROLE_A] })).toEqual({ mode: "roles", roleIds: [ROLE_A] });
        });

        it("reads the stored shape and drops invalid or duplicate role ids", () => {
            expect(normalizeRule({ mode: "roles", roleIds: [ROLE_A, "x", ROLE_A, ` ${ROLE_B} `] }))
                .toEqual({ mode: "roles", roleIds: [ROLE_A, ROLE_B] });
            expect(normalizeRule({ mode: "everyone", roleIds: [ROLE_A] })).toEqual({ mode: "everyone", roleIds: [] });
        });

        it("turns a role rule without any valid role into admins-only", () => {
            expect(normalizeRule({ mode: "roles", roleIds: ["nope"] })).toEqual({ mode: "admins", roleIds: [] });
        });

        it("rejects what is no rule at all", () => {
            expect(normalizeRule(undefined)).toBeNull();
            expect(normalizeRule("anyone")).toBeNull();
            expect(normalizeRule({ mode: "bogus" })).toBeNull();
            expect(normalizeRule([ROLE_A])).toBeNull();
        });
    });

    describe("normalizeBotCommandAccess", () => {
        it("keeps valid entries and drops broken names and rules", () => {
            expect(normalizeBotCommandAccess({
                fillsetup: { mode: "roles", roleIds: [ROLE_A] },
                "Bad Name": { mode: "everyone" },
                logcheck: { mode: "nope" },
                signup: { mode: "everyone" },
            })).toEqual({
                fillsetup: { mode: "roles", roleIds: [ROLE_A] },
                signup: { mode: "everyone", roleIds: [] },
            });
        });

        it("always returns a plain object", () => {
            expect(normalizeBotCommandAccess(null)).toEqual({});
            expect(normalizeBotCommandAccess([])).toEqual({});
        });
    });
});
