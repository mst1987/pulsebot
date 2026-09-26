// The start page's API calls (api/dashboard.ts): which address each one asks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDashboard, getNextRaidDetails } from "./dashboard";

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("api/dashboard.ts", () => {
    it("loads the start page from /api/dashboard", async () => {
        expect(await getDashboard()).toEqual({ ok: true });
        expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/dashboard");
    });

    it("loads the raid details of one event, its id encoded", async () => {
        await getNextRaidDetails("eh-1 2");
        expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/dashboard/next-raid?event=eh-1%202");
    });
});
