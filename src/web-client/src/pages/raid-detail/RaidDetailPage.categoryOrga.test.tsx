// The raid detail for the orga of a raid category (#729, epic #723): a manager of the category's roster,
// without an orga rank and without `raids` write. The server says per raid whom the page is for (`orga`)
// and what may be done (`viewer`) - each field the gate of the route its buttons call - and the page
// draws exactly that: no button without the right, no right without the button.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import type { RaidDetailData, SessionUser } from "../../api";
import { t } from "../../i18n";
import { adminUser, renderPage } from "../../test/render";
import { ownSteps, raidDetail, raidhelperDetail } from "../../test/fixtures/raidDetail";
import RaidDetailPage from "./RaidDetailPage";

vi.mock("../../api/client", async (orig) => ({ ...(await orig<typeof import("../../api/client")>()), get: vi.fn(), send: vi.fn() }));

// a raider account with `raids` read that manages the roster of category c1
const MANAGER: SessionUser = adminUser({
    id: "m1", name: "Mgr", isAdmin: false, orgaCategories: ["c1"],
    access: { raids: { read: true, write: false }, signup: { read: true, write: true } },
});
const MINE = { orga: true, viewer: { canOrga: true, canPlan: true, canSwitchPlan: true } };

let detail: RaidDetailData;

beforeEach(() => {
    vi.mocked(client.get).mockImplementation((path: string) => {
        if (path.startsWith("/api/raids/detail?")) return Promise.resolve(detail);
        return Promise.reject({ code: "not_mocked", message: path });
    });
    vi.mocked(client.send).mockResolvedValue({ message: "erledigt" });
});

async function show(data: RaidDetailData, user: SessionUser = MANAGER) {
    detail = data;
    renderPage(<RaidDetailPage />, { route: `/raids/detail?event=${data.event.id}`, user });
    await screen.findByRole("heading", { name: data.event.title });
}

const manageButton = () => screen.queryByRole("button", { name: t("raidDetail.manage.button") });
const tabs = () => screen.getAllByRole("tab").map((tab) => tab.textContent || "");

describe("the orga of the raid's category", () => {
    it("gets the orga's view of their raid: Verwalten, the Raidplan tab and the Logs tab", async () => {
        await show(raidDetail(MINE));
        expect(manageButton()).toBeInTheDocument();
        const labels = tabs();
        expect(labels.some((l) => l.startsWith(t("raidDetail.page.tab.plan")))).toBe(true);
        expect(labels.some((l) => l.startsWith(t("raidDetail.page.tab.logs")))).toBe(true);
    });

    it("gets no button of another area: assigning logs is `cla` write, adding loot `history` write", async () => {
        const user = userEvent.setup();
        await show(raidDetail(MINE));
        await user.click(screen.getByRole("tab", { name: new RegExp(t("raidDetail.page.tab.logs")) }));
        expect(screen.queryByRole("button", { name: t("raidDetail.logs.assign") })).not.toBeInTheDocument();
        await user.click(screen.getByRole("tab", { name: new RegExp(t("raidDetail.page.tab.loot")) }));
        expect(screen.queryByRole("button", { name: t("raidDetail.loot.add") })).not.toBeInTheDocument();
    });

    it("may switch on the raid plan of a Raid-Helper raid when the server says so", async () => {
        const user = userEvent.setup();
        await show(raidhelperDetail(MINE));
        await user.click(manageButton()!);
        const items = within(screen.getByRole("menu")).getAllByRole("menuitem").map((i) => i.textContent || "");
        expect(items.some((l) => l.includes(t("raidDetail.manage.raidplanOn")))).toBe(true);
    });

    it("gets no action where the server gives none (`viewer.canOrga` false), even in the orga's view", async () => {
        await show(raidDetail({ orga: true, viewer: { canOrga: false, canPlan: false, canSwitchPlan: false } }));
        expect(manageButton()).not.toBeInTheDocument();
        expect(tabs().some((l) => l.startsWith(t("raidDetail.page.tab.plan")))).toBe(false);
    });

    it("keeps a raid of another category in the raider's view: no orga parts, no buttons", async () => {
        await show(raidDetail({ orga: false, viewer: { canOrga: false, canPlan: false, canSwitchPlan: false }, steps: null }));
        expect(manageButton()).not.toBeInTheDocument();
        expect(tabs().some((l) => l.startsWith(t("raidDetail.page.tab.logs")))).toBe(false);
    });

    it("hides the primary action of a Raid-Helper raid (a dialog) without the right to it", async () => {
        await show(raidhelperDetail({ orga: true, viewer: { canOrga: false, canPlan: false, canSwitchPlan: false } }));
        expect(screen.queryByRole("button", { name: "Anmelde-Aufruf posten" })).not.toBeInTheDocument();
    });

    it("shows that primary action to the orga of the raid", async () => {
        await show(raidhelperDetail(MINE));
        expect(screen.getByRole("button", { name: "Anmelde-Aufruf posten" })).toBeInTheDocument();
    });

    // review #729: log and loot deeds are `cla` / `history` writes - the step informs, it offers nothing that fails
    const LOG = { id: "log", label: "Log zuordnen", icon: "inv_misc_pocketwatch_01", modal: "log" as const };
    const pastSteps = () => ownSteps({
        current: "after", action: LOG,
        steps: ownSteps().steps.map((s) => (s.id === "after" ? { ...s, state: "current" as const, action: LOG } : { ...s, action: null })),
    });

    it("offers no \"Log zuordnen\" on a past own raid without `cla` write", async () => {
        await show(raidDetail({ ...MINE, steps: pastSteps() }, { isPast: true }));
        expect(screen.queryByRole("button", { name: /Log zuordnen/ })).not.toBeInTheDocument();
    });

    it("does offer it with `cla` write", async () => {
        const writer = adminUser({ ...MANAGER, access: { ...MANAGER.access, cla: { read: true, write: true } } });
        await show(raidDetail({ ...MINE, steps: pastSteps() }, { isPast: true }), writer);
        expect(screen.getAllByRole("button", { name: /Log zuordnen/ }).length).toBeGreaterThan(0);
    });

    it("hides a Raid-Helper raid's primary \"Loot hinzufügen\" without `history` write", async () => {
        await show(raidhelperDetail({ ...MINE, progress: { steps: [], next: "loot", primary: { label: "Loot hinzufügen", icon: "inv_misc_bag_10", modal: "loot" } } }));
        expect(screen.queryByRole("button", { name: "Loot hinzufügen" })).not.toBeInTheDocument();
    });

    it("names the orga of the category in its zone, not the admins", async () => {
        await show(raidDetail(MINE));
        expect(screen.getAllByText(new RegExp(t("shell.orga.visibleForCategory"))).length).toBeGreaterThan(0);
    });

    it("leads nobody without `raids` write to the call templates from an empty Anmelde-Aufruf", async () => {
        const user = userEvent.setup();
        await show(raidDetail(MINE));
        await user.click(manageButton()!);
        await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: new RegExp(t("raidDetail.manage.notify")) }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText(t("raidModals.notify.noTemplatesOrga"))).toBeInTheDocument();
        expect(within(dialog).queryByRole("link", { name: t("raidModals.notify.noTemplatesLink") })).not.toBeInTheDocument();
    });
});
