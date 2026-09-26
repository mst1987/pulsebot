// The roster's hint on characters two accounts put into "Mein Profil" (#255):
// one badge in the page head, the list in its tooltip, nothing without claims.
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { CharacterClaim, RosterData } from "../../api";
import { renderPage } from "../../test/render";
import RosterPage from "./RosterPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRoster: vi.fn(),
    getCharacterClaims: vi.fn(),
}));

const EMPTY_ROSTER: RosterData = {
    chars: [],
    hiddenChars: [],
    categories: [],
    categoryInfo: {},
    stats: {
        total: 0, assigned: 0, fromLootOnly: 0, categories: 0, uncategorized: 0, loot: 0, evaluated: 0,
        withIssues: 0, clean: 0, issues: 0, highIssues: 0, avgAttendance: null, attendanceCounted: 0, classes: [],
    },
    activeGuildId: "g1",
};

const CLAIMS: CharacterClaim[] = [
    { key: "borka", character: "Borka", className: "Druid", claims: [{ userId: "u1", name: "Ann", main: true }, { userId: "u2", name: "", main: false }] },
    { key: "frosti", character: "Frosti", className: "Mage", claims: [{ userId: "u3", name: "Bert", main: true }, { userId: "u4", name: "Carl", main: true }] },
];

beforeEach(() => {
    vi.mocked(api.getRoster).mockResolvedValue(EMPTY_ROSTER);
});

describe("RosterPage – double-claimed characters", () => {
    it("shows them as one badge with the list in its tooltip", async () => {
        vi.mocked(api.getCharacterClaims).mockResolvedValue({ claims: CLAIMS });
        renderPage(<RosterPage />, { route: "/roster" });

        const badge = await screen.findByText("2 doppelt vergeben");
        expect(badge).toHaveAttribute("data-tip", "2 Charaktere doppelt beansprucht");
        const sub = badge.getAttribute("data-tip-sub") || "";
        expect(sub.split("\n").slice(1)).toEqual(["Borka: Ann, u2", "Frosti: Bert, Carl"]);
    });

    it("shows nothing when no character is claimed twice, or when the claims cannot be loaded", async () => {
        vi.mocked(api.getCharacterClaims).mockResolvedValue({ claims: [] });
        const { unmount } = renderPage(<RosterPage />, { route: "/roster" });
        await screen.findByRole("heading", { name: /Roster/ });
        expect(screen.queryByText(/doppelt vergeben/)).not.toBeInTheDocument();
        unmount();

        vi.mocked(api.getCharacterClaims).mockRejectedValue({ code: "forbidden", message: "nope" });
        renderPage(<RosterPage />, { route: "/roster" });
        await screen.findByRole("heading", { name: /Roster/ });
        expect(screen.queryByText(/doppelt vergeben/)).not.toBeInTheDocument();
    });
});
