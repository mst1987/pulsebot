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

describe("serverDefaultsChanges: bot language default and own value (#924)", () => {
    it("reads own value and default from the config", () => {
        const d = draft({ botLanguage: "en", botLanguageDefault: "de", botLanguageOwn: true });
        expect(d).toMatchObject({ botLanguage: "en", botLanguageDefault: "de", botLanguageOwn: true });
        expect(draft({ botLanguage: "en" })).toMatchObject({ botLanguageDefault: "en", botLanguageOwn: false });
    });

    it("sends the language when the server gets an own value, even the same as the default", () => {
        const saved = draft({ botLanguage: "de", botLanguageDefault: "de" });
        expect(serverDefaultsChanges(saved, { ...saved, botLanguageOwn: true })).toEqual({ botLanguage: "de" });
    });

    it("sends a changed own value", () => {
        const saved = draft({ botLanguage: "de", botLanguageDefault: "de", botLanguageOwn: true });
        expect(serverDefaultsChanges(saved, { ...saved, botLanguage: "en" })).toEqual({ botLanguage: "en" });
    });

    it("sends null when the own value is dropped", () => {
        const saved = draft({ botLanguage: "en", botLanguageDefault: "de", botLanguageOwn: true });
        expect(serverDefaultsChanges(saved, { ...saved, botLanguage: "de", botLanguageOwn: false })).toEqual({ botLanguage: null });
    });
});

describe("serverDefaultsChanges: picture switches default and own value (#961)", () => {
    const on = { overviewWeekStrip: true, setupImage: true, eventCover: true };

    it("reads own switches and default from the config; a missing default falls back to the switches", () => {
        const d = draft({ discordVisuals: { setupImage: false }, discordVisualsDefault: {}, discordVisualsOwn: true });
        expect(d).toMatchObject({ discordVisuals: { ...on, setupImage: false }, discordVisualsDefault: on, discordVisualsOwn: true });
        expect(draft({ discordVisuals: { eventCover: false } })).toMatchObject({ discordVisualsDefault: { ...on, eventCover: false }, discordVisualsOwn: false });
    });

    it("sends nothing while nothing changed", () => {
        const saved = draft({ discordVisualsOwn: true, discordVisuals: { setupImage: false } });
        expect(serverDefaultsChanges(saved, { ...saved })).toEqual({});
    });

    it("sends all switches when the server gets own ones, even equal to the default", () => {
        const saved = draft({ discordVisuals: {}, discordVisualsDefault: {} });
        expect(serverDefaultsChanges(saved, { ...saved, discordVisualsOwn: true })).toEqual({ discordVisuals: on });
    });

    it("sends changed own switches, and changed default switches without a server", () => {
        const own = draft({ discordVisualsOwn: true });
        expect(serverDefaultsChanges(own, { ...own, discordVisuals: { ...on, eventCover: false } })).toEqual({ discordVisuals: { ...on, eventCover: false } });
        const def = draft({});
        expect(serverDefaultsChanges(def, { ...def, discordVisuals: { ...on, setupImage: false } })).toEqual({ discordVisuals: { ...on, setupImage: false } });
    });

    it("sends null when the own switches are dropped", () => {
        const saved = draft({ discordVisuals: { setupImage: false }, discordVisualsDefault: {}, discordVisualsOwn: true });
        expect(serverDefaultsChanges(saved, { ...saved, discordVisuals: on, discordVisualsOwn: false })).toEqual({ discordVisuals: null });
    });
});
