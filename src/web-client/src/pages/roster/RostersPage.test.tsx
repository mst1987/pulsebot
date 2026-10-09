// The roster overview (#654, #657): one card per roster with its figures and open
// tasks, a dashed card per category without roster (with "Roster anlegen" for a
// full admin), the way to "Alle Charaktere" and the head's "Roster anlegen".
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import RostersPage from "./RostersPage";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { overview, rosterHead } from "./rosters.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRosters: vi.fn(),
}));

async function openPage(data = overview()) {
    vi.mocked(api.getRosters).mockResolvedValue(data);
    renderPage(<RostersPage />, { route: "/roster" });
    await screen.findByRole("heading", { name: "Roster" });
}

const card = (name: string) => {
    const el = screen.getByText(name, { selector: ".rn-card-title b" }).closest("li");
    if (!el) throw new Error(`no card ${name}`);
    return el;
};

beforeEach(() => vi.mocked(api.getRosters).mockReset());
afterEach(() => switchLang("de"));

describe("RostersPage", () => {
    it("shows one card per roster: version and raids, places, attendance, roles against the plan, role chip", async () => {
        await openPage();
        expect(screen.getByText("1 Roster · 1 Kategorie ohne Roster")).toBeInTheDocument();
        const c = within(card("Raid Mo / Do"));
        expect(c.getByText("TBC · BT · Hyjal")).toBeInTheDocument();
        expect(c.getByText("21")).toBeInTheDocument();
        expect(c.getByText("von 25 Plätzen")).toBeInTheDocument();
        expect(c.getByText("84")).toBeInTheDocument();
        // tanks 3 of 3, healers 6 of 7 (short), damage 12 of 15
        expect(c.getByText("Tanks").closest(".rn-fig")).toHaveTextContent("3 von 3");
        const healers = c.getByText("Heiler").closest(".rn-fig");
        expect(healers).toHaveTextContent("6 von 7");
        expect(healers).toHaveClass("rn-short");
        expect(c.getByText("DPS").closest(".rn-fig")).toHaveTextContent("12 von 15");
        expect(c.getByText("@Raider Mo/Do")).toBeInTheDocument();
        expect(c.getByRole("link")).toHaveAttribute("href", "/roster/r/raid-mo-do-abc");
    });

    it("lists the open tasks as badges, and says so when nothing is open", async () => {
        await openPage(overview({
            rosters: [
                rosterHead(),
                rosterHead({ id: "r2", name: "Sonntag", places: 25, todo: { withoutRole: 0, withoutChar: 0, trial: 0 } }),
            ],
        }));
        const first = within(card("Raid Mo / Do"));
        for (const text of ["4 Plätze frei", "2 ohne Discord-Rolle", "1 ohne Charakter", "2 in Probezeit"]) expect(first.getByText(text)).toBeInTheDocument();
        expect(within(card("Sonntag")).getByText("Nichts offen")).toBeInTheDocument();
    });

    it("names the trials that end soon or ran out instead of the plain trial count (#658)", async () => {
        await openPage(overview({
            rosters: [
                rosterHead({ trialEnding: [{ userId: "u1", displayName: "Brakk", trialUntil: "2026-10-12T00:00:00.000Z", overdue: false }] }),
                rosterHead({ id: "r2", name: "Sonntag", trialEnding: [
                    { userId: "u2", displayName: "Syl", trialUntil: "2026-10-01T00:00:00.000Z", overdue: true },
                    { userId: "u3", displayName: "Varok", trialUntil: "2026-10-12T00:00:00.000Z", overdue: false },
                ] }),
            ],
        }));
        const first = within(card("Raid Mo / Do"));
        const soon = first.getByText("Probezeit endet bald: 1");
        expect(soon).toHaveAttribute("data-tip-sub", "Brakk · Probezeit bis 12.10.2026");
        expect(first.queryByText("2 in Probezeit")).not.toBeInTheDocument();
        const late = within(card("Sonntag")).getByText("1 Probezeit abgelaufen");
        expect(late).toHaveClass("mid");
        expect(late.getAttribute("data-tip-sub")).toContain("Syl · Probezeit seit 1.10.2026 abgelaufen");
    });

    it("shows a roster without raids and without plan in words, not as 0", async () => {
        await openPage(overview({
            rosters: [rosterHead({ attendance: null, slots: { total: 0, tank: 0, healer: 0, bench: 0 }, places: 9, mainRole: null })],
            categoriesWithoutRoster: [],
        }));
        const c = within(card("Raid Mo / Do"));
        expect(c.getByText("noch keine Raids")).toBeInTheDocument();
        expect(c.getByText("Personen")).toBeInTheDocument();
        expect(c.getByText("Keine Rolle")).toBeInTheDocument();
        expect(screen.getByText("1 Roster")).toBeInTheDocument();
    });

    it("draws a category without roster as a dashed card with \"Roster anlegen\" for a full admin", async () => {
        await openPage();
        const empty = card("PuG Karazhan");
        expect(empty).toHaveClass("rn-card-empty");
        expect(within(empty).getByText("Diese Kategorie hat noch kein Roster.")).toBeInTheDocument();
        expect(within(empty).getByRole("button", { name: "Roster anlegen" })).toHaveClass("btn-ghost");
        expect(within(empty).queryByRole("link")).not.toBeInTheDocument();
    });

    it("leads to all characters and has one primary button, \"Roster anlegen\"", async () => {
        await openPage();
        expect(screen.getByRole("link", { name: "Alle Charaktere" })).toHaveAttribute("href", "/roster/chars");
        const primary = document.querySelectorAll(".btn:not(.btn-ghost)");
        expect(primary).toHaveLength(1);
        expect(primary[0]).toHaveTextContent("Roster anlegen");
    });

    it("offers no creating to someone who may not create rosters", async () => {
        await openPage(overview({ canCreate: false }));
        expect(screen.queryByRole("button", { name: "Roster anlegen" })).not.toBeInTheDocument();
        expect(document.querySelectorAll(".btn:not(.btn-ghost)")).toHaveLength(0);
    });

    it("says so when there is nothing at all", async () => {
        await openPage(overview({ rosters: [], categoriesWithoutRoster: [] }));
        expect(screen.getByText(/Noch kein Roster angelegt/)).toBeInTheDocument();
    });

    it("speaks English", async () => {
        await switchLang("en");
        await openPage();
        expect(screen.getByText("1 roster · 1 category without roster")).toBeInTheDocument();
        const c = within(card("Raid Mo / Do"));
        expect(c.getByText("of 25 places")).toBeInTheDocument();
        expect(c.getByText("2 on trial")).toBeInTheDocument();
        expect(c.getByText("Open roster")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "All characters" })).toBeInTheDocument();
    });
});
