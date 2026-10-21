import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { t } from "../../i18n";
import { adminUser, renderPage } from "../../test/render";
import { kaderView } from "./kader.fixture";
import KaderPage from "./KaderPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getKader: vi.fn(),
    getKaderLive: vi.fn(),
    leaveKaderLive: vi.fn(),
    getKaderRoster: vi.fn(async () => null),
    setKaderState: vi.fn(),
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
        // the spec column names the spec, the class stands in the group head and the tooltip
        expect(within(table).getByText("Wiederherstellung")).toHaveAttribute("data-tip", "Schamane · Wiederherstellung");
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
