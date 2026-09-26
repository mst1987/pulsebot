// "Mein Profil" talks to its own endpoints only (#255, #312): every function of
// api/profile.ts and the request it sends. The HTTP layer (./client) is mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { get, send } from "./client";
import * as profile from "./profile";

vi.mock("./client", async (orig) => ({
    ...(await orig<typeof import("./client")>()),
    get: vi.fn(),
    send: vi.fn(),
}));

beforeEach(() => {
    vi.mocked(get).mockResolvedValue({});
    vi.mocked(send).mockResolvedValue({});
});

describe("api/profile.ts", () => {
    it("reads the profile, the log suggestions, the raider search and the roster's claims", async () => {
        await profile.getProfile();
        await profile.getLogCharacters("Bor ka");
        await profile.searchRaiders("an&na");
        await profile.getCharacterClaims();
        expect(vi.mocked(get).mock.calls.map((c) => c[0])).toEqual([
            "/api/profile",
            "/api/profile/log-characters?q=Bor%20ka",
            "/api/profile/raiders?q=an%26na",
            "/api/roster/character-claims",
        ]);
    });

    it("saves with PUT /api/profile and adds or removes characters through /api/profile/characters", async () => {
        await profile.saveProfile({ note: "hi" });
        await profile.addProfileCharacter({ source: "log", name: "Borka" });
        await profile.removeProfileCharacter("borka");
        expect(vi.mocked(send).mock.calls).toEqual([
            ["PUT", "/api/profile", { note: "hi" }],
            ["POST", "/api/profile/characters", { source: "log", name: "Borka" }],
            ["POST", "/api/profile/characters", { remove: "borka" }],
        ]);
    });

    it("lists, creates and revokes calendar links through the one calendar endpoint, never asking for a secret back", async () => {
        await profile.getCalendarTokens();
        await profile.createCalendarToken();
        await profile.revokeCalendarToken("t1");
        expect(vi.mocked(get).mock.calls).toEqual([["/api/profile/calendar"]]);
        expect(vi.mocked(send).mock.calls).toEqual([
            ["POST", "/api/profile/calendar", {}],
            ["POST", "/api/profile/calendar", { revoke: "t1" }],
        ]);
    });
});
