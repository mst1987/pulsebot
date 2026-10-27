// The Discord-server parts' API calls (api/settings.ts): which address each
// one asks, and that the router gates it to the settings area (#264; #435:
// formerly a source scan in test/web-client/pingsRoleSync.test.js).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireBackend } from "../test/backend";
import { getReminders, getRoleSync, saveVersionOverrides } from "./settings";
import { SERVER_SCOPED_KEYS } from "./channels";

const { AREA_BY_PATH } = requireBackend<{ AREA_BY_PATH: Record<string, string> }>("web/http/apiAccess");

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("api/settings.ts", () => {
    it("loads the role sync from the endpoint the router serves, gated to settings", async () => {
        expect(await getRoleSync()).toEqual({ ok: true });
        expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/settings/role-sync");
        expect(AREA_BY_PATH["/api/settings/role-sync"]).toBe("settings");
    });

    it("loads the reminders from the endpoint the router serves, gated to settings", async () => {
        await getReminders();
        expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/settings/reminders");
        expect(AREA_BY_PATH["/api/settings/reminders"]).toBe("settings");
    });

    // #923 on the 409 guard of #921: the overrides go as a server-bound key with
    // the server the page loaded, never as a serverSettings map naming any server
    it("saves the overrides as a server-bound key with the loaded server", async () => {
        await saveVersionOverrides("111111111111111111", { tbc: { blizzardRealmSlug: "x" } });
        const [url, init] = vi.mocked(fetch).mock.calls[0];
        expect(url).toBe("/api/settings");
        expect(JSON.parse(String((init as RequestInit).body))).toEqual({
            versionOverrides: { tbc: { blizzardRealmSlug: "x" } }, serverSettingsGuildId: "111111111111111111",
        });
        expect(SERVER_SCOPED_KEYS).toContain("versionOverrides");
    });
});
