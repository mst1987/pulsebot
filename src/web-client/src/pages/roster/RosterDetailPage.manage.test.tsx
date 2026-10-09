// One roster for whoever may manage it (#655-#657): "Einstellungen" and the
// one primary "Mitglied hinzufügen" in the head, "Bearbeiten" per row opening
// the member drawer, "Rolle geben" where the Discord role is missing, the tabs
// with their own addresses and the Abgleich's "n offen".
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import RosterDetailPage from "./RosterDetailPage";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { composition, detail, historyEntry, member, settings, sync } from "./rosters.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRosterDetail: vi.fn(),
    getRosterSync: vi.fn(),
    getRosterHistory: vi.fn(),
    getRosterComposition: vi.fn(),
    getRosterOptions: vi.fn(),
    setRosterRole: vi.fn(),
    searchRosterMembers: vi.fn(),
}));

const MEMBERS = [
    member("Thorgrim", { userId: "u-thorgrim" }),
    member("Lunaria", { userId: "u-luna", hasRole: false, heldRoles: [] }),
];
const SYNC = sync({
    inRosterWithoutRole: [{ userId: "u-luna", displayName: "Lunaria", status: "core" }],
    withoutChar: [{ userId: "u-x", displayName: "X", suggestion: null }],
    roleWithoutRoster: [{ userId: "u-y", displayName: "Y", takeFailed: false }],
});

async function openPage(route = "/roster/r/raid-mo-do-abc", data = detail(MEMBERS, { canManage: true, settings: settings() })) {
    vi.mocked(api.getRosterDetail).mockResolvedValue(data);
    renderPage(<RosterDetailPage />, { route, path: "/roster/r/:rosterId/:tab?" });
    await screen.findByRole("heading", { name: "Raid Mo / Do", level: 1 });
}

beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(api.getRosterSync).mockResolvedValue(SYNC);
    vi.mocked(api.getRosterHistory).mockResolvedValue({ entries: [historyEntry()], total: 1, offset: 0, limit: 50 });
    vi.mocked(api.getRosterComposition).mockResolvedValue(composition());
    vi.mocked(api.setRosterRole).mockResolvedValue({ result: { roleId: "role-main", roleName: "Raider Mo/Do", give: true, ok: true, code: "done", changed: true } });
    vi.mocked(api.searchRosterMembers).mockResolvedValue({ results: [] });
});
afterEach(() => switchLang("de"));

describe("RosterDetailPage — a manager", () => {
    it("has Einstellungen and the one primary 'Mitglied hinzufügen' in the head", async () => {
        await openPage();
        expect(screen.getByRole("button", { name: "Einstellungen" })).toHaveClass("btn-ghost");
        const primary = [...document.querySelectorAll(".btn")].filter((b) => !/btn-(ghost|run|danger)/.test(b.className));
        expect(primary.map((b) => b.textContent)).toEqual(["Mitglied hinzufügen"]);
        await userEvent.click(screen.getByRole("button", { name: "Mitglied hinzufügen" }));
        expect(await screen.findByText("Wer kommt ins Roster?")).toBeInTheDocument();
    });

    it("gives a missing role right in the table and loads the roster again", async () => {
        await openPage();
        const row = screen.getByText("Lunaria", { selector: ".rn-person b" }).closest("tr") as HTMLElement;
        await userEvent.click(within(row).getByRole("button", { name: "Rolle geben" }));
        expect(api.setRosterRole).toHaveBeenCalledWith("raid-mo-do-abc", "u-luna", true);
        await waitFor(() => expect(api.getRosterDetail).toHaveBeenCalledTimes(2));
        expect(await screen.findByText("@Raider Mo/Do an Lunaria gegeben")).toBeInTheDocument();
    });

    it("opens the member drawer from 'Bearbeiten'", async () => {
        await openPage();
        const row = screen.getByText("Thorgrim", { selector: ".rn-person b" }).closest("tr") as HTMLElement;
        await userEvent.click(within(row).getByRole("button", { name: "Bearbeiten" }));
        expect(screen.getByRole("complementary", { name: "Mitglied Thorgrim" })).toBeInTheDocument();
    });

    it("links every tab to its own address and counts what the Abgleich asks for", async () => {
        await openPage();
        const tabs = within(screen.getByRole("navigation", { name: "Bereiche des Rosters" }));
        expect(tabs.getByRole("link", { name: /Komposition/ })).toHaveAttribute("href", "/roster/r/raid-mo-do-abc/composition");
        expect(tabs.getByRole("link", { name: /Verlauf/ })).toHaveAttribute("href", "/roster/r/raid-mo-do-abc/history");
        const syncTab = tabs.getByRole("link", { name: /Abgleich mit Discord/ });
        expect(syncTab).toHaveAttribute("href", "/roster/r/raid-mo-do-abc/sync");
        expect(await within(syncTab).findByText("3 offen")).toBeInTheDocument();
    });

    it("opens the Abgleich tab from its address; the primary button stays on the members tab", async () => {
        await openPage("/roster/r/raid-mo-do-abc/sync");
        expect(await screen.findByRole("heading", { name: "Im Roster, aber ohne Discord-Rolle" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Mitglied hinzufügen" })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Ins Roster aufnehmen" }));
        expect(await screen.findByText("Y", { selector: ".rn-picked b" })).toBeInTheDocument();
    });

    it("opens Verlauf from its address", async () => {
        await openPage("/roster/r/raid-mo-do-abc/history");
        expect(await screen.findByText("Thorgrim aufgenommen als Stamm mit Thorgrim")).toBeInTheDocument();
    });

    it("opens the settings", async () => {
        vi.mocked(api.getRosterOptions).mockResolvedValue((await import("./rosters.fixture")).options());
        await openPage();
        await userEvent.click(screen.getByRole("button", { name: "Einstellungen" }));
        expect(await screen.findByText("Raid Mo / Do einstellen")).toBeInTheDocument();
    });
});

describe("RosterDetailPage — a reader", () => {
    it("has no settings, no add button and no row action", async () => {
        await openPage("/roster/r/raid-mo-do-abc", detail(MEMBERS));
        expect(screen.queryByRole("button", { name: /Einstellungen|Mitglied hinzufügen|Bearbeiten|Rolle geben/ })).not.toBeInTheDocument();
        await userEvent.click(screen.getByText("Thorgrim", { selector: ".rn-person b" }));
        expect(within(screen.getByRole("complementary", { name: "Mitglied Thorgrim" })).getByText("nur lesen")).toBeInTheDocument();
    });
});

describe("RosterDetailPage — a manager, in English", () => {
    it("translates the head's buttons and the tabs", async () => {
        await switchLang("en");
        vi.mocked(api.getRosterDetail).mockResolvedValue(detail(MEMBERS, { canManage: true, settings: settings() }));
        renderPage(<RosterDetailPage />, { route: "/roster/r/raid-mo-do-abc/composition", path: "/roster/r/:rosterId/:tab?" });
        expect(await screen.findByRole("button", { name: "Settings" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Composition/ })).toHaveAttribute("aria-current", "page");
        expect(await screen.findByText("Classes in the roster")).toBeInTheDocument();
        expect(await screen.findByText("3 open")).toBeInTheDocument();
    });
});
