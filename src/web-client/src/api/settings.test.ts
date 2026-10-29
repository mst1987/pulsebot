// The Discord-server parts' API calls (api/settings.ts): which address each
// one asks, and that the router gates it to the settings area (#264; #435:
// formerly a source scan in test/web-client/pingsRoleSync.test.js).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireBackend } from "../test/backend";
import { closeCategory, forServer, getCategoryDeactivate, getReminders, getRoleSync, getSettings, saveVersionOverrides, serverCategoriesOf, updateSettings, type AdminConfig } from "./settings";
import { SERVER_SCOPED_KEYS } from "./channels";
import { t } from "../i18n";

const { AREA_BY_PATH } = requireBackend<{ AREA_BY_PATH: Record<string, string> }>("web/http/apiAccess");

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("api/settings.ts", () => {
    // #962: a server that is not entered - the save is refused, the message says where to add it
    it("names a server that is not entered in plain words, on every settings save", async () => {
        const refuse = () => vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "unknown_server", message: "raw" } }), { status: 400 }));
        refuse();
        await expect(updateSettings({ serverSettingsGuildId: "g9" })).rejects.toMatchObject({ code: "unknown_server", message: t("settings.unknownServer") });
        refuse();
        await expect(saveVersionOverrides("g9", {})).rejects.toMatchObject({ code: "unknown_server", message: t("settings.unknownServer") });
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "forbidden", message: "nope" } }), { status: 403 }));
        await expect(updateSettings({})).rejects.toMatchObject({ code: "forbidden", message: "nope" });
    });

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

// #926: config.categoryIds spans every Discord server; the page only ever sees the active server's part.
describe("raid categories per server", () => {
    const config = { categoryIds: ["a1", "b1"] } as unknown as AdminConfig;
    const answer = { config, serverCategoryIds: ["a1"], unprovenCategoryIds: [], otherServerCategoryIds: ["b1"] };
    const respond = (data: unknown) => vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ data }), { status: 200 }));

    it("narrows config.categoryIds to the active server", () => {
        expect(forServer(answer).config.categoryIds).toEqual(["a1"]);
        expect(config.categoryIds).toEqual(["a1", "b1"]);
    });

    it("leaves an answer without the server's part as it is", () => {
        const plain = { config };
        expect(forServer(plain)).toBe(plain);
    });

    it("copies only the per-server fields", () => {
        expect(serverCategoriesOf(answer)).toEqual({ serverCategoryIds: ["a1"], unprovenCategoryIds: [], otherServerCategoryIds: ["b1"] });
    });

    it("copies serverListed only when the server sent it", () => {
        expect(serverCategoriesOf({ ...answer, serverListed: false }).serverListed).toBe(false);
        expect("serverListed" in serverCategoriesOf(answer)).toBe(false);
    });

    it("applies it to load, save and close", async () => {
        respond(answer);
        expect((await getSettings()).config.categoryIds).toEqual(["a1"]);
        respond(answer);
        expect((await updateSettings({})).config.categoryIds).toEqual(["a1"]);
        respond({ ...answer, ok: true, name: "x", removed: {}, rosters: [], missingCategories: [] });
        expect((await closeCategory("gone")).config.categoryIds).toEqual(["a1"]);
    });

    it("asks the deactivation preview for the page's server", async () => {
        respond({ categories: [], emptyBlocked: false });
        await getCategoryDeactivate(["a 1", "b"], "g1");
        expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/settings/category-deactivate?next=a%201%2Cb&guild=g1");
    });
});
