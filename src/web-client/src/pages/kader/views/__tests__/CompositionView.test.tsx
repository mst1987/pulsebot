import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../../api";
import type { KaderData, KaderPlan } from "../../../../api";
import { t } from "../../../../i18n";
import { adminUser, renderPage } from "../../../../test/render";
import { kader as kaderData, kaderView, ME, U } from "../../kader.fixture";
import KaderPage from "../../KaderPage";

vi.mock("../../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../../api")>()),
    getKader: vi.fn(),
    getKaderLive: vi.fn(),
    leaveKaderLive: vi.fn(),
    getKaderRoster: vi.fn(async () => null),
    setKaderState: vi.fn(),
    saveKaderPlan: vi.fn(),
    discardKaderPlan: vi.fn(),
    applyKaderPlan: vi.fn(),
    getKaderOnly: vi.fn(),
}));

const PATH = "/kader/:kaderId?/:sub?";
const reader = adminUser({ isAdmin: false, access: { kader: { read: true, write: false } } });
const MOTW = { key: "motw", label: "Mal der Wildnis", labelEn: "Mark of the Wild", icon: "", providers: ["Shaman-Restoration", "Mage-Fire"] };
const INT = { key: "int", label: "Arkane Intelligenz", labelEn: "Arcane Intellect", icon: "", providers: ["Mage-Frost", "Mage-Fire"] };

beforeEach(() => {
    localStorage.clear();
    const base = kaderView();
    vi.mocked(api.getKader).mockImplementation(async (id = "") => kaderView(id === "k1"
        ? { buffs: { raid: [MOTW, INT], party: base.buffs.party }, setupComposition: { 10: { tanks: 2, healers: 3 }, 20: { tanks: 2, healers: 5 } } }
        : { kader: null }));
});

async function show(route: string, user = adminUser()) {
    const view = renderPage(<KaderPage />, { route, path: PATH, user });
    await screen.findByRole("button", { name: /Forever-Kader/ });
    return view;
}

const summary = () => screen.getByText(t("kader.composition.players", { count: 2 }), { exact: false }).closest("p");

describe("KaderPage · Zusammensetzung", () => {
    it("counts Vorläufig and Roster by role, with the guide of the nearest setup size", async () => {
        await show("/kader/k1/zusammensetzung");
        const table = screen.getByRole("table", { name: t("kader.composition.tableLabel", { name: "Forever-Kader" }) });
        expect(summary()).toHaveTextContent("1 Tank · 1 Heiler · 0 Nahkämpfer · 0 Fernkämpfer · 2 Spieler");
        expect(screen.getByText("Richtwert 10er: 2 Tanks · 3 Heiler")).toBeInTheDocument();
        // bench and tentative stand in the list, marked as not counted
        expect(within(table).getAllByText(t("kader.composition.notCounted"))).toHaveLength(2);
        expect(within(table).getAllByText("Schamane").length).toBeGreaterThan(0);
        // the spec column names the spec, the class stands in the group head and the tooltip;
        // a player with more than one wish gets the draft's spec picker instead
        expect(within(table).getByText("Verstärkung")).toHaveAttribute("data-tip", "Schamane · Verstärkung");
        expect(within(table).getByRole("button", { name: /Spec von Mira im Planspiel/ })).toBeInTheDocument();
        expect(within(table).getAllByText(t("kader.composition.classExtra", { count: 1 }))).toHaveLength(2);
    });

    it("names the donors of a buff and says when nobody counted brings it", async () => {
        await show("/kader/k1/zusammensetzung");
        const side = screen.getByRole("complementary", { name: t("kader.composition.buffs") });
        const motw = within(side).getByText("Mal der Wildnis").closest("li") as HTMLElement;
        expect(within(motw).getByText(t("kader.composition.donors", { count: 1 }))).toHaveAttribute("data-tip", "Mira");
        const int = within(side).getByText("Arkane Intelligenz").closest("li") as HTMLElement;
        expect(within(int).getByText(t("kader.composition.missing"))).toBeInTheDocument();
        expect(within(int).getByText("Magier")).toBeInTheDocument();
    });

    it("adds bench and tentative with the switch and keeps it per Kader", async () => {
        const view = await show("/kader/k1/zusammensetzung");
        await userEvent.click(screen.getByRole("switch", { name: t("kader.composition.extra", { count: 2 }) }));
        expect(screen.getByText(t("kader.composition.players", { count: 4 }), { exact: false }).closest("p"))
            .toHaveTextContent("1 Tank · 1 Heiler · 1 Nahkampf · 1 Fernkampf · 4 Spieler");
        expect(screen.queryByText(t("kader.composition.notCounted"))).not.toBeInTheDocument();
        // the tentative fire mage now brings Arcane Intellect
        const int = screen.getByText("Arkane Intelligenz").closest("li") as HTMLElement;
        expect(within(int).getByText(t("kader.composition.donors", { count: 1 }))).toHaveAttribute("data-tip", "Kael");
        expect(screen.queryByText(t("kader.composition.missing"))).not.toBeInTheDocument();
        view.unmount();
        await show("/kader/k1/zusammensetzung");
        expect(screen.getByRole("switch", { name: t("kader.composition.extra", { count: 2 }) })).toBeChecked();
    });

    it("is reached from the decision page and readable without write rights", async () => {
        await show("/kader/k1/roster", reader);
        await userEvent.click(screen.getByRole("link", { name: t("kader.nav.composition") }));
        expect(await screen.findByRole("table", { name: t("kader.composition.tableLabel", { name: "Forever-Kader" }) })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: t("kader.nav.setups") })).toBeInTheDocument();
    });
});

describe("KaderPage · Zusammensetzung · Planspiel", () => {
    const ENH = { className: "Shaman", spec: "Shaman-Enhancement" };
    const REGION = () => t("kader.composition.plan.title");
    const draft = (over: Partial<KaderPlan> = {}): KaderPlan => ({ specs: {}, excluded: [], by: U.lead2, at: new Date(Date.now() - 5 * 60000).toISOString(), rev: 7, ...over });
    const withPlan = (plan: KaderPlan | null) => {
        const base = kaderView();
        vi.mocked(api.getKader).mockImplementation(async (id = "") => (id === "k1"
            ? kaderView({ kader: { ...(base.kader as KaderData), plan }, buffs: { raid: [MOTW, INT], party: base.buffs.party } })
            : kaderView({ kader: null })));
    };
    const change = (plan: KaderPlan | null, extra: Record<string, unknown> = {}) => ({ kader: { ...kaderData(), plan }, kaders: kaderView().kaders, ...extra });
    const row = (name: string) => screen.getAllByText(name)[0].closest("[role=row]") as HTMLElement;
    const bar = () => screen.getByRole("region", { name: REGION() });
    const sumOf = (count: number) => screen.getByText(t("kader.composition.players", { count }), { exact: false }).closest("p");

    it("plans another spec for a player: sums, buffs and the bar follow the draft", async () => {
        withPlan(null);
        vi.mocked(api.saveKaderPlan).mockResolvedValue(change(draft({ specs: { [U.heal]: ENH }, by: ME })));
        await show("/kader/k1/zusammensetzung");
        expect(screen.queryByRole("region", { name: REGION() })).not.toBeInTheDocument();
        await userEvent.click(within(row("Mira")).getByRole("button", { name: /Spec von Mira im Planspiel/ }));
        await userEvent.click(screen.getByRole("menuitemradio", { name: /Verstärkung/ }));
        expect(api.saveKaderPlan).toHaveBeenCalledWith("k1", U.heal, { spec: ENH });
        await screen.findByRole("region", { name: REGION() });
        expect(bar()).toHaveTextContent("1 Änderung");
        expect(bar()).toHaveTextContent("−1 Heiler · +1 Nahkampf");
        expect(bar()).toHaveTextContent("Mal der Wildnis fehlt jetzt");
        expect(screen.getAllByText(t("kader.composition.players", { count: 2 }), { exact: false })[0].closest("p")).toHaveTextContent("1 Tank · 0 Heiler · 1 Nahkampf");
        expect(screen.getByText(/^vorher 1 Tank · 1 Heiler/)).toBeInTheDocument();
        expect(within(row("Mira")).getByText("Wiederherstellung").tagName).toBe("S");
        // the trigger names the spec ("Verstärkung"), the class only in its tooltip
        const trigger = within(row("Mira")).getByRole("button", { name: /Spec von Mira im Planspiel/ });
        expect(trigger).toHaveTextContent("Verstärkung");
        expect(trigger).not.toHaveTextContent("Schamane");
        const motw = screen.getByText("Mal der Wildnis").closest("li") as HTMLElement;
        expect(within(motw).getByText(t("kader.composition.plan.markGone"))).toBeInTheDocument();
    });

    it("leaves a player out and takes him back in", async () => {
        withPlan(null);
        vi.mocked(api.saveKaderPlan).mockResolvedValueOnce(change(draft({ excluded: [U.tank] })));
        await show("/kader/k1/zusammensetzung");
        await userEvent.click(within(row("Aldric")).getByRole("button", { name: t("kader.composition.plan.excludeAria", { name: "Aldric" }) }));
        expect(api.saveKaderPlan).toHaveBeenCalledWith("k1", U.tank, { excluded: true });
        expect(await within(row("Aldric")).findByText(t("kader.composition.plan.excludedRow"))).toBeInTheDocument();
        const eye = within(row("Aldric")).getByRole("button", { name: t("kader.composition.plan.includeAria", { name: "Aldric" }) });
        expect(eye).toHaveAttribute("aria-pressed", "true");
        expect(eye).toHaveAttribute("data-tip", t("kader.composition.plan.include"));
        expect(sumOf(1)).toHaveTextContent("0 Tanks · 1 Heiler");
        expect(bar()).toHaveTextContent(t("kader.composition.plan.excluded", { count: 1 }));
        vi.mocked(api.saveKaderPlan).mockResolvedValueOnce(change(null));
        await userEvent.click(within(row("Aldric")).getByRole("button", { name: t("kader.composition.plan.includeAria", { name: "Aldric" }) }));
        expect(api.saveKaderPlan).toHaveBeenLastCalledWith("k1", U.tank, { excluded: false });
        expect(await screen.findByText(t("kader.composition.players", { count: 2 }), { exact: false })).toBeInTheDocument();
        expect(screen.queryByRole("region", { name: REGION() })).not.toBeInTheDocument();
    });

    it("takes the edit back when saving fails", async () => {
        withPlan(null);
        vi.mocked(api.saveKaderPlan).mockRejectedValue(new Error("kaputt"));
        await show("/kader/k1/zusammensetzung");
        await userEvent.click(within(row("Aldric")).getByRole("button", { name: t("kader.composition.plan.excludeAria", { name: "Aldric" }) }));
        expect(await screen.findByText("kaputt")).toBeInTheDocument();
        expect(within(row("Aldric")).getByRole("button", { name: t("kader.composition.plan.excludeAria", { name: "Aldric" }) })).toBeInTheDocument();
        expect(screen.queryByRole("region", { name: REGION() })).not.toBeInTheDocument();
    });

    it("says by whom and how old the draft is, and discards it after asking", async () => {
        withPlan(draft({ specs: { [U.heal]: ENH } }));
        vi.mocked(api.discardKaderPlan).mockResolvedValue(change(null));
        await show("/kader/k1/zusammensetzung");
        expect(bar()).toHaveTextContent("Entwurf von Ohne · vor 5 Min.");
        await userEvent.click(within(bar()).getByRole("button", { name: t("kader.composition.plan.discard") }));
        const dialog = await screen.findByRole("dialog");
        expect(dialog).toHaveTextContent(t("kader.composition.plan.discardText"));
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.composition.plan.discard") }));
        expect(api.discardKaderPlan).toHaveBeenCalledWith("k1", 7);
        expect(await screen.findByText(t("kader.composition.plan.discarded"))).toBeInTheDocument();
        expect(screen.queryByRole("region", { name: REGION() })).not.toBeInTheDocument();
    });

    it("reloads instead of discarding a draft somebody changed since the dialog opened", async () => {
        withPlan(draft({ specs: { [U.heal]: ENH } }));
        vi.mocked(api.discardKaderPlan).mockRejectedValue(Object.assign(new Error("stale"), { code: "stale" }));
        await show("/kader/k1/zusammensetzung");
        vi.mocked(api.getKaderOnly).mockResolvedValue({ kader: kaderData(), kaders: kaderView().kaders, sharedRev: 0 });
        await userEvent.click(within(bar()).getByRole("button", { name: t("kader.composition.plan.discard") }));
        await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("kader.composition.plan.discard") }));
        expect(api.discardKaderPlan).toHaveBeenCalledWith("k1", 7);
        expect(await screen.findByText(t("kader.composition.plan.stale"))).toBeInTheDocument();
        expect(api.getKaderOnly).toHaveBeenCalledWith("k1");
        expect(screen.queryByText(t("kader.composition.plan.discarded"))).not.toBeInTheDocument();
    });

    it("takes the draft over as decisions after naming the consequences", async () => {
        withPlan(draft({ specs: { [U.heal]: ENH, [U.tank]: { className: "Warrior", spec: "Warrior-Fury" } }, excluded: [U.tank] }));
        vi.mocked(api.applyKaderPlan).mockResolvedValue(change(null, { applied: 1 }));
        await show("/kader/k1/zusammensetzung");
        await userEvent.click(within(bar()).getByRole("button", { name: t("kader.composition.plan.apply") }));
        const dialog = await screen.findByRole("dialog");
        expect(dialog).toHaveTextContent(t("kader.composition.plan.applyText", { count: 1 }));
        expect(dialog).toHaveTextContent(t("kader.composition.plan.applyExcluded", { count: 1 }));
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.composition.plan.apply") }));
        expect(api.applyKaderPlan).toHaveBeenCalledWith("k1", 7);
        expect(await screen.findByText(t("kader.composition.plan.applied", { count: 1 }))).toBeInTheDocument();
    });

    it("reloads instead of applying a draft somebody changed meanwhile", async () => {
        withPlan(draft({ specs: { [U.heal]: ENH } }));
        vi.mocked(api.applyKaderPlan).mockRejectedValue(Object.assign(new Error("stale"), { code: "stale" }));
        await show("/kader/k1/zusammensetzung");
        vi.mocked(api.getKaderOnly).mockResolvedValue({ kader: kaderData(), kaders: kaderView().kaders, sharedRev: 0 });
        await userEvent.click(within(bar()).getByRole("button", { name: t("kader.composition.plan.apply") }));
        await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("kader.composition.plan.apply") }));
        expect(await screen.findByText(t("kader.composition.plan.stale"))).toBeInTheDocument();
        expect(api.getKaderOnly).toHaveBeenCalledWith("k1");
    });

    it("cannot apply a draft that sets no decision", async () => {
        withPlan(draft({ excluded: [U.tank] }));
        await show("/kader/k1/zusammensetzung");
        expect(within(bar()).getByRole("button", { name: t("kader.composition.plan.apply") })).toBeDisabled();
    });

    it("shows the draft to readers without any control", async () => {
        withPlan(draft({ specs: { [U.heal]: ENH } }));
        await show("/kader/k1/zusammensetzung", reader);
        expect(within(bar()).queryByRole("button")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("kader.composition.plan.excludeAria", { name: "Aldric" }) })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Spec von Mira/ })).not.toBeInTheDocument();
        expect(within(row("Mira")).getByText("Verstärkung")).toBeInTheDocument();
    });
});
