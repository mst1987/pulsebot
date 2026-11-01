// The Kader's raid roster in the status bar (#658): the green button creates a roster
// (assistant, Discord optional), "Ins Roster übernehmen (n)" and "Zum Roster" once
// there is one, the smaller ways in the menu "Mehr" — rendered inside the real
// Kaderplaner against a mocked api.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { KaderRosterState, KaderTakeoverCheck } from "../../../api";
import { t } from "../../../i18n";
import { switchLang } from "../../../test/i18n";
import { adminUser, renderPage } from "../../../test/render";
import { CAT, kaderView, U } from "../kader.fixture";
import KaderPage from "../KaderPage";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getKader: vi.fn(),
    getKaderLive: vi.fn(),
    leaveKaderLive: vi.fn(),
    getKaderRoster: vi.fn(),
    getKaderTakeover: vi.fn(),
    startKaderTakeover: vi.fn(),
    syncKaderRoster: vi.fn(),
    createKaderRoster: vi.fn(),
    linkKaderRoster: vi.fn(),
    updateKader: vi.fn(),
}));

const PATH = "/kader/:kaderId?/:sub?";
const state = (over: Partial<KaderRosterState> = {}): KaderRosterState => ({
    roster: null, candidates: 3, pending: 3, canCreate: true, canSync: false, ...over,
});
const withRoster = (over: Partial<KaderRosterState> = {}) => state({ roster: { id: "forever-raid", name: "Forever-Raid", members: 2 }, pending: 1, canCreate: false, canSync: true, ...over });

/** The precheck of a Kader without a roster: nothing keeps either way. */
const noRosterCheck = (over: Partial<KaderTakeoverCheck> = {}): KaderTakeoverCheck => ({
    kader: { id: "k1", name: "Forever-Kader", versionId: "forever", rev: 4 },
    roster: null, createsRoster: true, notes: ["creates_roster"],
    newRoster: { name: "Forever-Kader", versionId: "forever" },
    rosterCategories: [{ id: "c1", name: "Donnerstag Raid", suggested: false }],
    online: true, canManageRoles: true, canManageChannels: true, iconPossible: false, premiumTier: 1,
    blockers: [], outsideCount: 0, takeover: null, role: null, category: null, running: false, aborted: false,
    pending: [], pendingCount: 0, pullCount: 0, pendingAway: 0,
    players: [
        { userId: U.tank, state: "roster", onServer: true, hasRole: null, inRoster: false, result: null },
        { userId: U.sham, state: "bench", onServer: true, hasRole: null, inRoster: false, result: null },
        { userId: U.tent, state: "tentative", onServer: true, hasRole: null, inRoster: false, result: null },
    ],
    categories: [],
    canStart: true,
    ...over,
});

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getKader).mockImplementation(async () => kaderView());
    vi.mocked(api.getKaderTakeover).mockResolvedValue(noRosterCheck());
});

async function show(user = adminUser()) {
    renderPage(<KaderPage />, { route: "/kader/k1/roster", path: PATH, user });
    await screen.findByRole("button", { name: /Forever-Kader/ });
}

/** Opens the green button and leaves the assistant on the roster-only first step. */
async function openRosterOnly() {
    await userEvent.click(await screen.findByRole("button", { name: t("kader.roster.createButton") }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("switch", { name: t("kader.takeover.discordSwitch") }));
    return dialog;
}

/** Opens the menu next to the green button. */
async function openMenu() {
    await userEvent.click(await screen.findByRole("button", { name: t("kader.nav.more") }));
    return screen.findByRole("menu", { name: t("kader.nav.more") });
}

describe("Kaderplaner · Roster aus dem Kader (#658)", () => {
    it("creates a roster from the Kader: name prefilled, a free category, says how many came along, the bar follows at once", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValueOnce(state()).mockResolvedValue(withRoster({ pending: 0 }));
        vi.mocked(api.createKaderRoster).mockResolvedValue({ roster: { id: "forever-raid", name: "Forever-Raid" }, initial: { added: 3, skipped: 0, roleFailures: [] } });
        await show();
        const dialog = await openRosterOnly();
        expect(within(dialog).getByLabelText(t("kader.takeover.roster.name"))).toHaveValue("Forever-Kader");
        await userEvent.selectOptions(within(dialog).getByLabelText(t("kader.takeover.roster.category")), "c1");
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.takeover.next") }));
        await userEvent.click(within(dialog).getByRole("switch", { name: t("kader.takeover.rosterOnly.confirm") }));
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.takeover.rosterOnly.start") }));
        expect(api.createKaderRoster).toHaveBeenCalledWith("k1", { name: "Forever-Kader", categoryId: "c1" });
        expect(api.startKaderTakeover).not.toHaveBeenCalled();
        expect(await within(dialog).findByText(t("kader.roster.created", { count: 3 }))).toBeInTheDocument();
        // afterwards the bar leads to the roster, without a reload of the page
        expect(await screen.findByRole("link", { name: t("kader.roster.open") })).toHaveAttribute("href", "/roster/r/forever-raid");
    });

    it("says a refusal of the roster way in words", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValue(state());
        vi.mocked(api.createKaderRoster).mockRejectedValue({ code: "category_taken", message: "Roster: category_taken" });
        await show();
        const dialog = await openRosterOnly();
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.takeover.next") }));
        await userEvent.click(within(dialog).getByRole("switch", { name: t("kader.takeover.rosterOnly.confirm") }));
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.takeover.rosterOnly.start") }));
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

    it("says in words when the server refuses the sync because the Kader was taken over meanwhile", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValue(withRoster());
        vi.mocked(api.syncKaderRoster).mockRejectedValue({ code: "kader_taken_over", message: "Roster: kader_taken_over" });
        await show();
        await userEvent.click(await screen.findByRole("button", { name: t("kader.roster.syncButton", { count: 1 }) }));
        const confirm = await screen.findByRole("dialog");
        await userEvent.click(within(confirm).getByRole("button", { name: t("kader.roster.sync") }));
        expect(await screen.findByText(t("kader.roster.syncTakenOver"))).toBeInTheDocument();
        expect(screen.queryByText("Roster: kader_taken_over")).not.toBeInTheDocument();
    });

    it("shows nothing to a reader without a roster", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValue(state({ canCreate: false }));
        const reader = adminUser({ isAdmin: false, access: { kader: { read: true, write: false } } });
        await show(reader);
        await waitFor(() => expect(api.getKaderRoster).toHaveBeenCalledWith("k1"));
        expect(screen.queryByRole("button", { name: t("kader.roster.createButton") })).not.toBeInTheDocument();
        expect(document.querySelector(".kp-navgroup-main")).toBeNull();
    });

    it("links a roster running as Loot-Council to the council through the menu, preselecting it (#676)", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValue(withRoster({ lootCouncil: true }));
        await show();
        const menu = await openMenu();
        const link = within(menu).getByRole("menuitem", { name: t("kader.roster.council") });
        expect(link).toHaveAttribute("href", "/lootcouncil?roster=forever-raid");
    });

    it("has no council link when the server says no (other loot system, or no council access)", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValue(withRoster({ lootCouncil: false }));
        await show();
        await screen.findByRole("link", { name: t("kader.roster.open") });
        expect(screen.queryByRole("button", { name: t("kader.nav.more") })).not.toBeInTheDocument();
        expect(screen.queryByText(t("kader.roster.council"))).not.toBeInTheDocument();
    });

    it("walks the menu by keyboard, Escape closes it and gives the focus back", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValue(withRoster({ lootCouncil: true, canLink: true, rosters: [] }));
        await show();
        const menu = await openMenu();
        const items = within(menu).getAllByRole("menuitem");
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveFocus();
        await userEvent.keyboard("{ArrowDown}");
        expect(items[1]).toHaveFocus();
        await userEvent.keyboard("{ArrowDown}");
        expect(items[0]).toHaveFocus();
        await userEvent.keyboard("{ArrowUp}");
        expect(items[1]).toHaveFocus();
        await userEvent.keyboard("{Escape}");
        expect(screen.queryByRole("menu", { name: t("kader.nav.more") })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("kader.nav.more") })).toHaveFocus();
    });

    it("closes the menu on Tab, so the button does not stay expanded while the focus moves on", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValue(withRoster({ lootCouncil: true, canLink: true, rosters: [] }));
        await show();
        await openMenu();
        const button = screen.getByRole("button", { name: t("kader.nav.more") });
        expect(button).toHaveAttribute("aria-expanded", "true");
        await userEvent.keyboard("{Tab}");
        expect(screen.queryByRole("menu", { name: t("kader.nav.more") })).not.toBeInTheDocument();
        expect(button).toHaveAttribute("aria-expanded", "false");
    });

    it("links an existing roster through the menu - the suggestion first - and counts its category in the Kader's attendance", async () => {
        const rosters = [
            { id: "mo-raider", name: "Mo-Raider", categoryId: CAT.mo, members: 18, linkedKaderId: null, suggested: true },
            { id: "pug", name: "PUG", categoryId: CAT.pug, members: 9, linkedKaderId: null, suggested: false },
            { id: "other", name: "Belegt", categoryId: null, members: 3, linkedKaderId: "k9", suggested: false },
        ];
        vi.mocked(api.getKaderRoster).mockResolvedValue(state({ canLink: true, rosters }));
        vi.mocked(api.linkKaderRoster).mockResolvedValue(withRoster({ roster: { id: "pug", name: "PUG", members: 9 }, canLink: true, rosters }));
        vi.mocked(api.updateKader).mockImplementation(async () => ({ kader: kaderView().kader, kaders: kaderView().kaders }));
        await show();
        const menu = await openMenu();
        const linkButton = within(menu).getByRole("menuitem", { name: t("kader.roster.linkButton") });
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

    it("unlinks through the menu after asking, and says so", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValue(withRoster({ canLink: true, rosters: [{ id: "forever-raid", name: "Forever-Raid", categoryId: null, members: 2, linkedKaderId: null, suggested: false }] }));
        vi.mocked(api.linkKaderRoster).mockResolvedValue(state({ canLink: true, rosters: [] }));
        await show();
        const menu = await openMenu();
        await userEvent.click(within(menu).getByRole("menuitem", { name: t("kader.roster.relink") }));
        const dialog = await screen.findByRole("dialog");
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.roster.unlink") }));
        const confirms = await screen.findAllByRole("dialog");
        await userEvent.click(within(confirms[confirms.length - 1]).getByRole("button", { name: t("kader.roster.unlink") }));
        expect(api.linkKaderRoster).toHaveBeenCalledWith("k1", "");
        expect(await screen.findByText(t("kader.roster.unlinked"))).toBeInTheDocument();
    });

    it("offers no link to somebody who may not link: the green button without a menu", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValue(state({ canLink: false, rosters: [] }));
        await show();
        await screen.findByRole("button", { name: t("kader.roster.createButton") });
        expect(screen.queryByRole("button", { name: t("kader.nav.more") })).not.toBeInTheDocument();
    });

    it("reads in English", async () => {
        await switchLang("en");
        vi.mocked(api.getKaderRoster).mockResolvedValue(withRoster({ canSync: false }));
        await show();
        expect(await screen.findByRole("link", { name: "Open roster" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Take into roster/ })).not.toBeInTheDocument();
    });
});
