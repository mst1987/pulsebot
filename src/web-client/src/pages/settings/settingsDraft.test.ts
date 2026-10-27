// #924: the per-server defaults of the settings form only go out when changed,
// so a save on one server never overwrites another server's values.
import { describe, expect, it } from "vitest";
import type { AdminConfig } from "../../api";
import { serverDefaultsChanges, toDraft, type Draft } from "./settingsDraft";

function draft(over: Partial<AdminConfig> = {}): Draft {
    return toDraft({
        adminRoleIds: [], rolePermissions: {}, baseAccess: {}, userPermissions: {},
        guildId: "10001", officerRoleId: "r1", applicationChannelId: "c1",
        categoryIds: [], categoryRoles: {}, raidDefaults: { channelId: "c2" }, botLanguage: "de",
        ...over,
    } as AdminConfig);
}

describe("serverDefaultsChanges", () => {
    it("sends nothing when no per-server field changed", () => {
        expect(serverDefaultsChanges(draft(), draft())).toEqual({});
    });

    it("sends each changed field on its own, trimmed", () => {
        const saved = draft();
        expect(serverDefaultsChanges(saved, { ...saved, officerRoleId: " r9 " })).toEqual({ officerRoleId: "r9" });
        expect(serverDefaultsChanges(saved, { ...saved, applicationChannelId: "" })).toEqual({ applicationChannelId: "" });
        expect(serverDefaultsChanges(saved, { ...saved, raidChannelId: "c7" })).toEqual({ raidDefaults: { channelId: "c7" } });
        expect(serverDefaultsChanges(saved, { ...saved, botLanguage: "en" })).toEqual({ botLanguage: "en" });
    });

    it("treats whitespace around an unchanged id as no change", () => {
        const saved = draft();
        expect(serverDefaultsChanges(saved, { ...saved, raidChannelId: " c2 " })).toEqual({});
    });

    it("sends all four when all changed", () => {
        const saved = draft();
        const next = { ...saved, officerRoleId: "r2", applicationChannelId: "c3", raidChannelId: "", botLanguage: "en" as const };
        expect(serverDefaultsChanges(saved, next)).toEqual({
            officerRoleId: "r2", applicationChannelId: "c3", raidDefaults: { channelId: "" }, botLanguage: "en",
        });
    });
});
