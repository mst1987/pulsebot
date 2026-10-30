// The page "Dungeon-Bestzeiten" against a mocked API: the three tables, their
// sorting, the content switch's version, the empty page and the English texts.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { DungeonBoardData, DungeonRun } from "../../../api";
import { switchLang } from "../../../test/i18n";
import { adminUser, CONTENT_ARIA, renderPage, twoVersions } from "../../../test/render";
import { t } from "../../../i18n";
import DungeonsPage from "../DungeonsPage";
import { formatSeconds } from "../dungeonView";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getDungeonBoard: vi.fn(),
}));

const DEVI = { name: "Devira", classId: "Paladin", color: "#F58CBA", icon: "classicon_paladin" };
const THAL = { name: "Thalor", classId: "Warrior", color: "#C79C6E", icon: "classicon_warrior" };
const MIRA = { name: "Mira", classId: "Mage", color: "#69CCF0", icon: "classicon_mage" };

const runRow = (over: Partial<DungeonRun> = {}): DungeonRun => ({
    rank: 1, id: "dr_1", dungeon: "The Deadmines", seconds: 1902, medal: "gold", startedAt: Date.UTC(2026, 9, 10, 18), finishedAt: 0, members: [DEVI, THAL], ...over,
});

function board(over: Partial<DungeonBoardData> = {}): DungeonBoardData {
    return {
        versionId: "forever",
        dungeons: [
            { dungeon: "Ragefire Chasm", runCount: 1, goldRuns: 0, bestSeconds: 900, runs: [runRow({ id: "dr_9", dungeon: "Ragefire Chasm", seconds: 900, medal: null, members: [MIRA] })] },
            {
                dungeon: "The Deadmines", runCount: 3, goldRuns: 1, bestSeconds: 1902,
                runs: [runRow(), runRow({ rank: 2, id: "dr_2", seconds: 2100, medal: "silver", members: [MIRA] }), runRow({ rank: 3, id: "dr_3", seconds: 2400, medal: "bronze" })],
            },
        ],
        players: [
            { rank: 1, key: "g:1", ...DEVI, gold: 2, silver: 0, bronze: 1, runs: 3, goldDungeons: ["The Deadmines", "Wailing Caverns"] },
            { rank: 2, key: "g:3", ...MIRA, gold: 0, silver: 3, bronze: 0, runs: 3, goldDungeons: [] },
        ],
        characters: [
            { rank: 1, key: "forever:g:1", ...DEVI, realm: "", level: 18, points: 340, count: 34, golds: 2, readAt: Date.UTC(2026, 9, 10) },
            { rank: 2, key: "forever:g:3", ...MIRA, realm: "", level: 22, points: 120, count: 12, golds: 0, readAt: Date.UTC(2026, 9, 9) },
        ],
        totals: { runs: 4, characters: 2 },
        updatedAt: Date.UTC(2026, 9, 11),
        otherVersions: [],
        ...over,
    };
}

const rowsOf = (table: HTMLElement) => within(table).getAllByRole("row").slice(1);

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getDungeonBoard).mockResolvedValue(board());
});
afterEach(() => switchLang("de"));

describe("Dungeon-Bestzeiten", () => {
    it("heads the page with the counts and shows the picked dungeon's fastest runs", async () => {
        const user = userEvent.setup();
        renderPage(<DungeonsPage />, { route: "/roster/dungeons" });
        expect(await screen.findByRole("heading", { name: "Dungeon-Bestzeiten" })).toBeInTheDocument();
        expect(screen.getByText("4 Läufe")).toBeInTheDocument();
        expect(screen.getByText("2 Dungeons")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /Je Dungeon 2/ })).toHaveAttribute("aria-selected", "true");
        // the first dungeon by name until another is picked
        expect(screen.getByLabelText("Dungeon")).toHaveValue("Ragefire Chasm");
        await user.selectOptions(screen.getByLabelText("Dungeon"), "The Deadmines");
        expect(screen.getByText("Bestzeit 31:42")).toBeInTheDocument();
        expect(screen.getByText("1 Lauf mit Gold")).toBeInTheDocument();
        const rows = rowsOf(screen.getByRole("table"));
        expect(rows.map((r) => within(r).getAllByRole("cell")[1].textContent)).toEqual(["31:42", "35:00", "40:00"]);
        // medals as a word beside their square field, members in their class colour
        expect(within(rows[0]).getByText("Gold")).toHaveClass("dg-medal");
        expect(within(rows[1]).getByText("Silber").closest(".dg-medal")).toHaveAttribute("data-medal", "silver");
        expect(within(rows[0]).getByText("Devira")).toHaveClass("class-colored");
        expect(api.getDungeonBoard).toHaveBeenCalledWith("");
    });

    it("sorts the runs by a column", async () => {
        const user = userEvent.setup();
        renderPage(<DungeonsPage />, { route: "/roster/dungeons" });
        await user.selectOptions(await screen.findByLabelText("Dungeon"), "The Deadmines");
        await user.click(screen.getByRole("button", { name: /Medaille/ }));
        const medals = () => rowsOf(screen.getByRole("table")).map((r) => within(r).getAllByRole("cell")[2].textContent);
        expect(medals()).toEqual(["Gold", "Silber", "Bronze"]);
        await user.click(screen.getByRole("button", { name: /Medaille/ }));
        expect(medals()).toEqual(["Bronze", "Silber", "Gold"]);
    });

    it("ranks the players by medals and sorts by name", async () => {
        const user = userEvent.setup();
        renderPage(<DungeonsPage />, { route: "/roster/dungeons" });
        await user.click(await screen.findByRole("tab", { name: /Gesamtwertung/ }));
        const names = () => rowsOf(screen.getByRole("table")).map((r) => within(r).getAllByRole("cell")[1].textContent);
        expect(names()).toEqual(["Devira", "Mira"]);
        expect(within(screen.getByRole("table")).getByText("2 Dungeons")).toHaveAttribute("data-tip-sub", "The Deadmines\nWailing Caverns");
        await user.click(screen.getByRole("button", { name: /Spieler/ }));
        expect(names()).toEqual(["Devira", "Mira"]);
        await user.click(screen.getByRole("button", { name: /Silber/ }));
        expect(names()).toEqual(["Mira", "Devira"]);
    });

    it("lists the achievement points, most first", async () => {
        const user = userEvent.setup();
        renderPage(<DungeonsPage />, { route: "/roster/dungeons" });
        await user.click(await screen.findByRole("tab", { name: /Erfolgspunkte/ }));
        const rows = rowsOf(screen.getByRole("table"));
        expect(within(rows[0]).getByText("340")).toBeInTheDocument();
        expect(within(rows[0]).getByText("34 Erfolge")).toBeInTheDocument();
        expect(within(rows[1]).getByText("Stufe 22")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /^Stufe/ }));
        expect(within(rowsOf(screen.getByRole("table"))[0]).getByText("Mira")).toBeInTheDocument();
    });

    it("asks for the content switch's version and loads again on a switch", async () => {
        const user = userEvent.setup();
        localStorage.removeItem("eh-content-version");
        renderPage(<DungeonsPage />, { route: "/roster/dungeons", content: twoVersions() });
        await screen.findByRole("heading", { name: "Dungeon-Bestzeiten" });
        expect(api.getDungeonBoard).toHaveBeenLastCalledWith("tbc");
        await user.click(within(screen.getByRole("radiogroup", { name: t(CONTENT_ARIA) })).getByRole("radio", { name: /Forever/ }));
        await waitFor(() => expect(api.getDungeonBoard).toHaveBeenLastCalledWith("forever"));
    });

    it("explains where the data comes from while the version has none, naming the versions that have some", async () => {
        vi.mocked(api.getDungeonBoard).mockResolvedValue(board({
            versionId: "tbc", dungeons: [], players: [], characters: [], totals: { runs: 0, characters: 0 }, updatedAt: 0, otherVersions: ["Forever"],
        }));
        renderPage(<DungeonsPage />, { route: "/roster/dungeons", content: twoVersions() });
        expect(await screen.findByRole("heading", { name: "Noch keine Dungeon-Läufe für TBC" })).toBeInTheDocument();
        expect(screen.getByText(/Addon LevelHelper/)).toBeInTheDocument();
        expect(screen.getByText("Daten gibt es für: Forever (oben umschalten).")).toBeInTheDocument();
        expect(screen.queryByRole("table")).toBeNull();
    });

    it("says so when a version has points but no runs", async () => {
        vi.mocked(api.getDungeonBoard).mockResolvedValue(board({ dungeons: [], players: [], totals: { runs: 0, characters: 2 } }));
        renderPage(<DungeonsPage />, { route: "/roster/dungeons" });
        expect(await screen.findByText("Für diese Version ist noch kein Gruppenlauf gespeichert.")).toBeInTheDocument();
    });

    it("shows the Roster family's rail to the orga, not to a member", async () => {
        renderPage(<DungeonsPage />, { route: "/roster/dungeons" });
        expect(await screen.findByRole("link", { name: "Roster" })).toHaveAttribute("href", "/roster");
        const member = adminUser({ isAdmin: false, access: { signup: { read: true, write: true } } });
        renderPage(<DungeonsPage />, { route: "/roster/dungeons", user: member });
        await waitFor(() => expect(screen.getAllByRole("heading", { name: "Dungeon-Bestzeiten" })).toHaveLength(2));
        expect(screen.getAllByRole("link", { name: "Roster" })).toHaveLength(1);
    });

    it("speaks English", async () => {
        switchLang("en");
        renderPage(<DungeonsPage />, { route: "/roster/dungeons" });
        expect(await screen.findByRole("heading", { name: "Dungeon best times" })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /Overall ranking/ })).toBeInTheDocument();
        expect(screen.getByText("4 runs")).toBeInTheDocument();
    });
});

describe("formatSeconds", () => {
    it("writes minutes and seconds, hours when needed", () => {
        expect(formatSeconds(1902)).toBe("31:42");
        expect(formatSeconds(3725)).toBe("1:02:05");
    });
});
