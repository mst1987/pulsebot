// The Kader's raid roster on the decision page (#658): "Roster anlegen" for a
// full admin while there is none, "Ins Roster übernehmen (n)" and "Zum Roster"
// once there is one — rendered inside the real Kaderplaner against a mocked api.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { KaderRosterState } from "../../api";
import { t } from "../../i18n";
import { switchLang } from "../../test/i18n";
import { adminUser, renderPage } from "../../test/render";
import { CAT, kaderView } from "./kader.fixture";
import KaderPage from "./KaderPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getKader: vi.fn(),
    getKaderLive: vi.fn(),
    leaveKaderLive: vi.fn(),
    getKaderRoster: vi.fn(),
    syncKaderRoster: vi.fn(),
    getKaderRosterCategories: vi.fn(),
    createKaderRoster: vi.fn(),
    linkKaderRoster: vi.fn(),
    updateKader: vi.fn(),
}));

const PATH = "/kader/:kaderId?/:sub?";
const state = (over: Partial<KaderRosterState> = {}): KaderRosterState => ({
    roster: null, candidates: 3, pending: 3, canCreate: true, canSync: false, ...over,
});
const withRoster = (over: Partial<KaderRosterState> = {}) => state({ roster: { id: "forever-raid", name: "Forever-Raid", members: 2 }, pending: 1, canCreate: false, canSync: true, ...over });

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getKader).mockImplementation(async () => kaderView());
    vi.mocked(api.getKaderRosterCategories).mockResolvedValue({ categories: [
        { id: "c1", name: "Donnerstag Raid", rosterId: null },
        { id: "c2", name: "Mittwoch", rosterId: "taken" },
    ] });
});

async function show(user = adminUser()) {
    renderPage(<KaderPage />, { route: "/kader/k1/roster", path: PATH, user });
    await screen.findByRole("button", { name: /Forever-Kader/ });
}

describe("Kaderplaner · Roster aus dem Kader (#658)", () => {
    it("creates a roster from the Kader: name prefilled, a free category, then says how many came along", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValueOnce(state()).mockResolvedValue(withRoster({ pending: 0 }));
        vi.mocked(api.createKaderRoster).mockResolvedValue({ roster: { id: "forever-raid", name: "Forever-Raid" }, initial: { added: 3, skipped: 0, roleFailures: [] } });
        await show();
        await userEvent.click(await screen.findByRole("button", { name: t("kader.roster.createButton") }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByLabelText(t("kader.field.name"))).toHaveValue("Forever-Kader");
        const select = within(dialog).getByLabelText(t("kader.roster.category"));
        // a category that already has a roster is not offered
        await waitFor(() => expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([t("kader.roster.noCategory"), "Donnerstag Raid"]));
        await userEvent.selectOptions(select, "c1");
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.roster.create") }));
        expect(api.createKaderRoster).toHaveBeenCalledWith("k1", { name: "Forever-Kader", categoryId: "c1" });
        expect(await screen.findByText(t("kader.roster.created", { count: 3 }))).toBeInTheDocument();
        // afterwards the bar leads to the roster
        expect(await screen.findByRole("link", { name: t("kader.roster.open") })).toHaveAttribute("href", "/roster/r/forever-raid");
        expect(screen.queryByRole("button", { name: t("kader.roster.createButton") })).not.toBeInTheDocument();
    });

    it("says a refusal of the create dialog in words", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValue(state());
        vi.mocked(api.createKaderRoster).mockRejectedValue({ code: "category_taken", message: "Roster: category_taken" });
        await show();
        await userEvent.click(await screen.findByRole("button", { name: t("kader.roster.createButton") }));
        const dialog = await screen.findByRole("dialog");
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.roster.create") }));
        expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("kader.roster.error.category_taken"));
    });

    it("takes newly decided players over after asking, and links to the roster", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValueOnce(withRoster()).mockResolvedValue(withRoster({ pending: 0, roster: { id: "forever-raid", name: "Forever-Raid", members: 3 } }));
        vi.mocked(api.syncKaderRoster).mockResolvedValue({ rosterId: "forever-raid", added: 1, skipped: 0, kept: 2, roleFailures: [] });
        await show();
        expect(await screen.findByRole("link", { name: t("kader.roster.open") })).toHaveAttribute("href", "/roster/r/forever-raid");
        await userEvent.click(screen.getByRole("button", { name: t("kader.roster.syncButton", { count: 1 }) }));
        const confirm = await screen.findByRole("dialog");
        expect(confirm).toHaveTextContent(t("kader.roster.syncText", { count: 1 }));
        await userEvent.click(within(confirm).getByRole("button", { name: t("kader.roster.sync") }));
        expect(api.syncKaderRoster).toHaveBeenCalledWith("k1");
        expect(await screen.findByText(t("kader.roster.synced", { count: 1 }))).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole("button", { name: t("kader.roster.syncButton", { count: 1 }) })).not.toBeInTheDocument());
    });

    it("shows nothing to somebody who may neither create nor take over, and only the link once there is a roster", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValue(state({ canCreate: false }));
        const reader = adminUser({ isAdmin: false, access: { kader: { read: true, write: false } } });
        await show(reader);
        await waitFor(() => expect(api.getKaderRoster).toHaveBeenCalledWith("k1"));
        expect(screen.queryByRole("button", { name: t("kader.roster.createButton") })).not.toBeInTheDocument();
    });

    it("links a roster running as Loot-Council to the council, preselecting it (#676)", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValue(withRoster({ lootCouncil: true }));
        await show();
        const link = await screen.findByRole("link", { name: t("kader.roster.council") });
        expect(link).toHaveAttribute("href", "/lootcouncil?roster=forever-raid");
    });

    it("has no council link when the server says no (other loot system, or no council access)", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValue(withRoster({ lootCouncil: false }));
        await show();
        await screen.findByRole("link", { name: t("kader.roster.open") });
        expect(screen.queryByRole("link", { name: t("kader.roster.council") })).not.toBeInTheDocument();
    });

    it("links an existing roster - the suggestion first - and counts its category in the Kader's attendance", async () => {
        const rosters = [
            { id: "mo-raider", name: "Mo-Raider", categoryId: CAT.mo, members: 18, linkedKaderId: null, suggested: true },
            { id: "pug", name: "PUG", categoryId: CAT.pug, members: 9, linkedKaderId: null, suggested: false },
            { id: "other", name: "Belegt", categoryId: null, members: 3, linkedKaderId: "k9", suggested: false },
        ];
        vi.mocked(api.getKaderRoster).mockResolvedValue(state({ canLink: true, rosters }));
        vi.mocked(api.linkKaderRoster).mockResolvedValue(withRoster({ roster: { id: "pug", name: "PUG", members: 9 }, canLink: true, rosters }));
        vi.mocked(api.updateKader).mockImplementation(async () => ({ kader: kaderView().kader, kaders: kaderView().kaders }));
        await show();
        const linkButton = await screen.findByRole("button", { name: t("kader.roster.linkButton") });
        expect(linkButton).toHaveAttribute("data-tip-sub", t("kader.roster.linkTipSuggestion", { name: "Mo-Raider" }));
        await userEvent.click(linkButton);
        const dialog = await screen.findByRole("dialog");
        const select = within(dialog).getByLabelText(t("kader.roster.linkPick"));
        expect(select).toHaveValue("mo-raider");
        expect(within(select).getByRole("option", { name: t("kader.roster.linkTaken", { name: "Belegt" }) })).toBeDisabled();
        // Mo Raid already counts in the Kader: no switch; PUG does not: the switch is offered (on)
        expect(within(dialog).queryByRole("switch")).not.toBeInTheDocument();
        await userEvent.selectOptions(select, "pug");
        expect(within(dialog).getByRole("switch", { name: t("kader.roster.linkCountCategory") })).toBeChecked();
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.roster.link") }));
        expect(api.linkKaderRoster).toHaveBeenCalledWith("k1", "pug");
        await waitFor(() => expect(api.updateKader).toHaveBeenCalledWith("k1", { attendanceCategories: [CAT.mo, CAT.do, CAT.pug] }));
        expect(await screen.findByText(t("kader.roster.linked", { name: "PUG" }))).toBeInTheDocument();
        // linked: no "Roster anlegen" any more, the way to exactly that roster instead
        expect(await screen.findByRole("link", { name: t("kader.roster.open") })).toHaveAttribute("href", "/roster/r/pug");
        expect(screen.queryByRole("button", { name: t("kader.roster.createButton") })).not.toBeInTheDocument();
    });

    it("unlinks after asking, and says a refusal in words", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValue(withRoster({ canLink: true, rosters: [{ id: "forever-raid", name: "Forever-Raid", categoryId: null, members: 2, linkedKaderId: null, suggested: false }] }));
        vi.mocked(api.linkKaderRoster).mockResolvedValue(state({ canLink: true, rosters: [] }));
        await show();
        await userEvent.click(await screen.findByRole("button", { name: t("kader.roster.relink") }));
        const dialog = await screen.findByRole("dialog");
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.roster.unlink") }));
        const confirms = await screen.findAllByRole("dialog");
        await userEvent.click(within(confirms[confirms.length - 1]).getByRole("button", { name: t("kader.roster.unlink") }));
        expect(api.linkKaderRoster).toHaveBeenCalledWith("k1", "");
        expect(await screen.findByText(t("kader.roster.unlinked"))).toBeInTheDocument();
    });

    it("offers no link to somebody who may not link", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValue(state({ canLink: false, rosters: [] }));
        await show();
        await screen.findByRole("button", { name: t("kader.roster.createButton") });
        expect(screen.queryByRole("button", { name: t("kader.roster.linkButton") })).not.toBeInTheDocument();
    });

    it("reads in English", async () => {
        await switchLang("en");
        vi.mocked(api.getKaderRoster).mockResolvedValue(withRoster({ canSync: false }));
        await show();
        expect(await screen.findByRole("link", { name: "Open roster" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Take into roster/ })).not.toBeInTheDocument();
    });
});
