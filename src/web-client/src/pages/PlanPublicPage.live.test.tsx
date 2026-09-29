// #555: the read view /p/<token> takes a changed plan without a reload (the poll's answer is drawn in place, the section stays,
// a short "Aktualisiert" shows) and keeps the chosen section in the address (#boss=) and in this browser, so a reload lands on it.
// The poll hook is replaced so the test calls its tick by hand; the requests are mocked.
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { RaidplanPublic, RaidplanPublicBoss } from "../api";
import { rememberedSection } from "../lib/raidplan";
import { sectionFromHash } from "../lib/raidplan/sectionUrl";
import PlanPublicPage from "./PlanPublicPage";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getRaidplanPublic: vi.fn(),
    pollRaidplanPublic: vi.fn(),
}));
let tick: (() => void) | null = null;
let polling = false;
vi.mock("../hooks/useVisiblePoll", () => ({
    useVisiblePoll: (fn: () => void, _ms: number, enabled: boolean) => { tick = fn; polling = enabled; },
}));

// jsdom has no ResizeObserver; the board only reads its size through it
class NoResize { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", NoResize);

function boss(key: string, name: string, notes: string): RaidplanPublicBoss {
    return {
        key, name, instanceName: "Black Temple", iconUrl: "", mapUrl: "", trash: false, general: false,
        tokens: [], slots: [], marks: [], icons: [], zones: [], lines: [], texts: [], targets: [], assignments: [],
        notes, profileName: "", mapOpacity: 1, objectScale: 1,
    };
}
function plan(notes = "Erst stacken"): RaidplanPublic {
    return {
        event: { title: "BT", startTime: 0 },
        bosses: [boss("bt/najentus", "Najentus", "Spines"), boss("bt/supremus", "Supremus", notes)],
        roster: [], me: "", meIds: [], catalog: { mobs: [], spells: [] }, loggedIn: false,
    };
}
const chosen = () => screen.getAllByRole("button").find((b) => b.getAttribute("aria-current") === "true");

beforeEach(() => {
    tick = null;
    polling = false;
    window.history.replaceState(null, "", "/p/abc");
    window.localStorage.clear();
    vi.mocked(api.getRaidplanPublic).mockReset().mockResolvedValue({ data: plan(), etag: "\"v1\"" });
    vi.mocked(api.pollRaidplanPublic).mockReset();
});
afterEach(() => { window.history.replaceState(null, "", "/"); });

describe("the read view keeps its section (#555)", () => {
    it("opens on the section of the address and writes a picked one into the address and this browser", async () => {
        window.history.replaceState(null, "", "/p/abc#boss=bt/supremus");
        render(<PlanPublicPage token="abc" />);
        expect(await screen.findByText("Erst stacken")).toBeInTheDocument();
        expect(chosen()).toHaveAccessibleName(/Supremus/);
        await userEvent.click(screen.getByRole("button", { name: /Najentus/ }));
        expect(sectionFromHash(window.location.hash)).toBe("bt/najentus");
        expect(window.location.pathname).toBe("/p/abc");
        expect(rememberedSection("p:abc")).toBe("bt/najentus");
    });

    it("without a hash opens on the section last open in this browser", async () => {
        window.localStorage.setItem("eh.raidplan.section.p:abc", "bt/supremus");
        render(<PlanPublicPage token="abc" />);
        expect(await screen.findByText("Erst stacken")).toBeInTheDocument();
        expect(sectionFromHash(window.location.hash)).toBe("bt/supremus");
    });
});

describe("live update (#555)", () => {
    async function openOnSupremus() {
        window.history.replaceState(null, "", "/p/abc#boss=bt/supremus");
        render(<PlanPublicPage token="abc" />);
        await screen.findByText("Erst stacken");
        expect(polling).toBe(true);
    }
    const poll = async () => { await act(async () => { tick!(); await Promise.resolve(); await Promise.resolve(); }); };

    it("draws a changed plan in place, keeps the section and says so for a moment", async () => {
        await openOnSupremus();
        vi.mocked(api.pollRaidplanPublic).mockResolvedValueOnce({ data: plan("Jetzt verteilen"), etag: "\"v2\"" });
        await poll();
        // the first round already sends the ETag of the first load
        expect(api.pollRaidplanPublic).toHaveBeenLastCalledWith("abc", "\"v1\"");
        expect(await screen.findByText("Jetzt verteilen")).toBeInTheDocument();
        expect(chosen()).toHaveAccessibleName(/Supremus/);
        expect(screen.getByRole("status")).toHaveTextContent("Aktualisiert");
        // the next round sends the ETag it got; a 304 (null) changes nothing
        vi.mocked(api.pollRaidplanPublic).mockResolvedValueOnce(null);
        await poll();
        expect(api.pollRaidplanPublic).toHaveBeenLastCalledWith("abc", "\"v2\"");
        expect(screen.getByText("Jetzt verteilen")).toBeInTheDocument();
        expect(api.getRaidplanPublic).toHaveBeenCalledTimes(1);
    });

    it("an answer equal to what is shown says nothing, and an error keeps what is shown", async () => {
        await openOnSupremus();
        vi.mocked(api.pollRaidplanPublic).mockResolvedValueOnce({ data: plan(), etag: "\"v1b\"" });
        await poll();
        expect(screen.getByRole("status")).toHaveTextContent("");
        vi.mocked(api.pollRaidplanPublic).mockRejectedValueOnce({ code: "not_found", message: "weg" });
        await poll();
        expect(screen.getByText("Erst stacken")).toBeInTheDocument();
        expect(api.pollRaidplanPublic).toHaveBeenLastCalledWith("abc", "\"v1b\"");
    });

    it("a section removed meanwhile falls back to the first one", async () => {
        await openOnSupremus();
        const without = plan();
        without.bosses = without.bosses.slice(0, 1);
        vi.mocked(api.pollRaidplanPublic).mockResolvedValueOnce({ data: without, etag: "\"v3\"" });
        await poll();
        await waitFor(() => expect(sectionFromHash(window.location.hash)).toBe("bt/najentus"));
        expect(screen.getByText("Spines")).toBeInTheDocument();
    });
});
