// One roster (#654): head, the members tab grouped by status, the square status
// fields, role and search filter, sorting by the column heads, the Discord role
// as a word for a reader (no action), attendance per person, and English. The
// manager's actions: RosterDetailPage.manage.test.tsx.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import RosterDetailPage from "./RosterDetailPage";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { detail, member, memberChar, sync } from "./rosters.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRosterDetail: vi.fn(),
    getRosterSync: vi.fn(),
}));

const MEMBERS = [
    member("Thorgrim", { chars: [memberChar("Thorgrim"), memberChar("Grimbrew", { className: "Druid", classColor: "#FF7D0A", specId: "Feral", specLabel: "Wildheit", specIcon: "ability_racial_bearform", role: "tank" })] }),
    member("Lunaria", { role: "healer", hasRole: false, chars: [memberChar("Lunaria", { className: "Paladin", specId: "Holy", specLabel: "Heilig", role: "healer" })], attendance: { attended: 5, total: 10, pct: 50, missed: [], present: [] } }),
    member("Brakk", { status: "trial", role: "dps", trialUntil: "2026-10-23T00:00:00.000Z", chars: [memberChar("Brakk", { className: "Hunter", specId: "Marksmanship", role: "dps" })] }),
    member("Syl", { status: "trial", role: "", chars: [], attendance: null, onServer: false, hasRole: false }),
    member("Varok", { status: "bench", role: "dps" }),
    member("Nimue", { status: "pause", role: "dps" }),
];

async function openPage(data = detail(MEMBERS)) {
    vi.mocked(api.getRosterDetail).mockResolvedValue(data);
    vi.mocked(api.getRosterSync).mockResolvedValue(sync({ canManage: false }));
    renderPage(<RosterDetailPage />, { route: "/roster/r/raid-mo-do-abc", path: "/roster/r/:rosterId/:tab?" });
    await screen.findByRole("heading", { name: "Raid Mo / Do" });
}

/** The person names of the table, top to bottom. */
const names = () => [...document.querySelectorAll(".rn-person b")].map((b) => b.textContent);
/** The group heads of the table, top to bottom. */
const groups = () => [...document.querySelectorAll(".rn-grp .rn-st")].map((s) => s.textContent);

beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(api.getRosterDetail).mockReset();
});
afterEach(() => switchLang("de"));

describe("RosterDetailPage — head", () => {
    it("asks for the roster of the url and shows its head, the back button and the members tab", async () => {
        await openPage();
        expect(api.getRosterDetail).toHaveBeenCalledWith("raid-mo-do-abc");
        expect(screen.getByRole("link", { name: "Alle Roster" })).toHaveAttribute("href", "/roster");
        expect(screen.getByText("TBC · BT · Hyjal")).toBeInTheDocument();
        expect(screen.getByText("@Raider Mo/Do")).toBeInTheDocument();
        expect(screen.getByText("21 von 25 Plätzen · 84 % Anwesenheit")).toBeInTheDocument();
        const tabs = screen.getByRole("navigation", { name: "Bereiche des Rosters" });
        expect(within(tabs).getByRole("link", { name: /Mitglieder/ })).toHaveAttribute("aria-current", "page");
        // read only: no main button, no action in a row
        expect(screen.queryByRole("button", { name: /Rolle geben|Bearbeiten|hinzufügen/ })).not.toBeInTheDocument();
    });

    it("says when the roster does not exist", async () => {
        vi.mocked(api.getRosterDetail).mockRejectedValue({ code: "not_found", message: "Roster nicht gefunden." });
        renderPage(<RosterDetailPage />, { route: "/roster/r/nope", path: "/roster/r/:rosterId/:tab?" });
        expect(await screen.findByText("Dieses Roster gibt es nicht (mehr).")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Alle Roster" })).toBeInTheDocument();
    });
});

describe("RosterDetailPage — members", () => {
    it("groups by status; pause is hidden at first and the status fields toggle it", async () => {
        await openPage();
        expect(groups()).toEqual(["Stamm", "Probe", "Ersatz"]);
        const fields = screen.getByRole("group", { name: "Status filtern" });
        const pause = within(fields).getByRole("button", { name: /Pause/ });
        expect(pause).toHaveAttribute("aria-pressed", "false");
        expect(pause).toHaveTextContent("1");
        await userEvent.click(pause);
        expect(groups()).toEqual(["Stamm", "Probe", "Ersatz", "Pause"]);
        await userEvent.click(within(fields).getByRole("button", { name: /Stamm/ }));
        expect(groups()).toEqual(["Probe", "Ersatz", "Pause"]);
        expect(JSON.parse(window.localStorage.getItem("eh-roster-members-view") || "{}").statuses).toEqual(["trial", "bench", "pause"]);
    });

    it("shows characters (first emphasised), role, Discord role as a word and attendance", async () => {
        await openPage();
        const row = screen.getByText("Thorgrim", { selector: ".rn-person b" }).closest("tr") as HTMLElement;
        const chips = row.querySelectorAll(".rn-char");
        expect(chips).toHaveLength(2);
        expect(chips[0]).toHaveClass("is-first");
        expect(chips[1]).toHaveClass("is-alt");
        expect(chips[0]).toHaveAttribute("data-tip", "Krieger · Schutz");
        expect(within(row).getByText("hat die Rolle")).toBeInTheDocument();
        expect(within(row).getByText("Tank")).toBeInTheDocument();
        expect(within(row).getByText(/82 %/)).toBeInTheDocument();

        const lunaria = screen.getByText("Lunaria", { selector: ".rn-person b" }).closest("tr") as HTMLElement;
        expect(within(lunaria).getByText("Rolle fehlt")).toBeInTheDocument();
        // a reader: the name opens the member, nothing else is a button
        expect(within(lunaria).getAllByRole("button").map((b) => b.textContent)).toEqual(["LLunaria"]);

        const syl = screen.getByText("Syl", { selector: ".rn-person b" }).closest("tr") as HTMLElement;
        expect(within(syl).getByText("Kein Charakter zugewiesen")).toBeInTheDocument();
        expect(within(syl).getByText("nicht auf dem Server")).toBeInTheDocument();

        const brakk = screen.getByText("Brakk", { selector: ".rn-person b" }).closest("tr") as HTMLElement;
        expect(within(brakk).getByText(/^Probezeit bis/)).toBeInTheDocument();
        expect(within(brakk).getByText(/^seit/)).toBeInTheDocument();
    });

    it("filters by role and by a search over names and characters", async () => {
        await openPage();
        await userEvent.click(within(screen.getByRole("radiogroup", { name: "Rolle" })).getByRole("radio", { name: /Heiler/ }));
        expect(names()).toEqual(["Lunaria"]);
        await userEvent.click(within(screen.getByRole("radiogroup", { name: "Rolle" })).getByRole("radio", { name: "Alle" }));
        await userEvent.type(screen.getByRole("searchbox", { name: "Mitglied suchen" }), "grimbrew");
        expect(names()).toEqual(["Thorgrim"]);
        await userEvent.clear(screen.getByRole("searchbox", { name: "Mitglied suchen" }));
        await userEvent.type(screen.getByRole("searchbox", { name: "Mitglied suchen" }), "zzz");
        expect(screen.getByText("Kein Mitglied passt zu den Filtern.")).toBeInTheDocument();
    });

    it("sorts by the column heads within each group", async () => {
        await openPage();
        expect(names()).toEqual(["Lunaria", "Thorgrim", "Brakk", "Syl", "Varok"]);
        await userEvent.click(screen.getByRole("button", { name: "Anwesenheit" }));
        // attendance starts high to low: Thorgrim 82 before Lunaria 50; Brakk 82 before Syl without
        expect(names()).toEqual(["Thorgrim", "Lunaria", "Brakk", "Syl", "Varok"]);
        expect(screen.getByRole("button", { name: "Anwesenheit" }).closest("th")).toHaveAttribute("aria-sort", "descending");
        await userEvent.click(screen.getByRole("button", { name: "Discord-Rolle" }));
        expect(names()).toEqual(["Lunaria", "Thorgrim", "Syl", "Brakk", "Varok"]);
    });

    it("says so when the roster has no members", async () => {
        await openPage(detail([]));
        expect(screen.getByText("Dieses Roster hat noch keine Mitglieder.")).toBeInTheDocument();
        expect(document.querySelector(".rn-tbl")).toBeNull();
    });

    it("works without checkboxes or selects", async () => {
        await openPage();
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
        expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });
});

describe("RosterDetailPage — in English", () => {
    it("translates statuses, columns and words", async () => {
        await switchLang("en");
        await openPage();
        expect(groups()).toEqual(["Core", "Trial", "Bench"]);
        expect(within(screen.getByRole("group", { name: "Filter by status" })).getByRole("button", { name: /Paused/ })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "All rosters" })).toBeInTheDocument();
        expect(screen.getByText("21 of 25 places · 84 % attendance")).toBeInTheDocument();
        for (const col of ["Person", "Characters", "Role", "Discord role", "Attendance", "Since"]) expect(screen.getByRole("button", { name: col })).toBeInTheDocument();
        expect(screen.getAllByText("has the role").length).toBeGreaterThan(0);
        expect(screen.getByText("Role missing")).toBeInTheDocument();
        expect(screen.getByText("No character assigned")).toBeInTheDocument();
    });
});
