// The Kaderplaner rendered against a mocked api: the board, the player search
// with its filters and grouping, the setup view, the account dialog, and what a
// read-only grant sees.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { t } from "../../i18n";
import { switchLang } from "../../test/i18n";
import { adminUser, renderPage } from "../../test/render";
import { kaderView, U } from "./kader.fixture";
import KaderPage, { type KaderSubView } from "./KaderPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getKader: vi.fn(),
    placeKaderPlayer: vi.fn(),
    autoKaderVariant: vi.fn(),
    createKaderRoster: vi.fn(),
    addKaderAccount: vi.fn(),
    saveKaderAssignment: vi.fn(),
    saveKaderVariant: vi.fn(),
}));

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getKader).mockResolvedValue(kaderView());
});

async function show(sub: KaderSubView, { route = "/kader", path = "*", user = adminUser() } = {}) {
    const view = renderPage(<KaderPage sub={sub} />, { route, path, user });
    await screen.findAllByText("Aldric Sturmwind");
    return view;
}

const reader = adminUser({ isAdmin: false, access: { kader: { read: true, write: false } } });

describe("KaderPage · board", () => {
    it("shows the roster by role, the pool beside it and what the roster brings", async () => {
        await show("board");
        expect(screen.getByRole("combobox", { name: t("kader.board.pickRoster") })).toHaveValue("r1");
        expect(screen.getByLabelText(t("kader.board.filled", { n: 2, size: 20 }))).toBeInTheDocument();
        const pool = screen.getByRole("region", { name: t("kader.pool.title") });
        expect(within(pool).getByText("Liss Funkenhand")).toBeInTheDocument();
        expect(within(pool).queryByText("Aldric Sturmwind")).toBeNull();
        // the benched shaman stays in the pool, marked
        expect(within(pool).getByText(/Tomas · Verstärkung · Ersatzbank/)).toBeInTheDocument();
        expect(screen.getByText("75 %")).toBeInTheDocument();
        expect(screen.getByText("Arkane Brillanz")).toBeInTheDocument();
        // the healer the planner changed is marked as differing from the profile
        expect(screen.getAllByLabelText(t("kader.diff.tip"))).toHaveLength(1);
    });

    it("puts a player into the roster by the + button and swaps in the answer", async () => {
        const next = kaderView();
        next.rosters[0].members.push({ userId: U.mage, role: "ranged" });
        vi.mocked(api.placeKaderPlayer).mockResolvedValue(next);
        await show("board");
        await userEvent.click(screen.getByRole("button", { name: t("kader.pool.addToNamed", { name: "Liss Funkenhand" }) }));
        expect(api.placeKaderPlayer).toHaveBeenCalledWith("r1", U.mage, "role", undefined);
        await screen.findByLabelText(t("kader.board.filled", { n: 3, size: 20 }));
    });

    it("opens a picker from an empty slot, the keyboard way to fill it", async () => {
        vi.mocked(api.placeKaderPlayer).mockResolvedValue(kaderView());
        await show("board");
        const [firstFree] = screen.getAllByRole("button", { name: t("kader.slot.pickFor", { role: "Tanks" }) });
        await userEvent.click(firstFree);
        const dialog = await screen.findByRole("dialog");
        await userEvent.click(within(dialog).getByText("Liss Funkenhand"));
        expect(api.placeKaderPlayer).toHaveBeenCalledWith("r1", U.mage, "role", "tank");
    });

    it("lets a read-only grant look, but not move anybody", async () => {
        await show("board", { user: reader });
        expect(screen.queryByRole("button", { name: t("kader.pool.addToNamed", { name: "Liss Funkenhand" }) })).toBeNull();
        expect(screen.queryByText(t("kader.pool.addAccount"))).toBeNull();
        expect(screen.getAllByText(t("kader.slot.freeRead")).length).toBeGreaterThan(0);
    });

    it("creates the first roster from a name and a size", async () => {
        vi.mocked(api.getKader).mockResolvedValue(kaderView({ rosters: [], setups: {} }));
        vi.mocked(api.createKaderRoster).mockResolvedValue({ ...kaderView(), rosterId: "r1" });
        renderPage(<KaderPage sub="board" />);
        await userEvent.click(await screen.findByRole("button", { name: t("kader.roster.create") }));
        const dialog = await screen.findByRole("dialog");
        const create = within(dialog).getByRole("button", { name: t("kader.roster.create") });
        expect(create).toBeDisabled();
        await userEvent.type(within(dialog).getByRole("textbox"), "Mittwochs-Kader");
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.roster.sizeN", { n: 25 }) }));
        expect(within(dialog).getByText(t("kader.roster.sizeHint", { groups: 5 }))).toBeInTheDocument();
        await userEvent.click(create);
        expect(api.createKaderRoster).toHaveBeenCalledWith({ name: "Mittwochs-Kader", size: 25 });
        expect(await screen.findByRole("option", { name: "Hyjal Mittwoch · 20er" })).toBeInTheDocument();
    });

    it("refuses a size outside 5 to 40", async () => {
        await show("board");
        await userEvent.click(screen.getByRole("button", { name: t("kader.roster.edit") }));
        const dialog = await screen.findByRole("dialog");
        const size = within(dialog).getByRole("spinbutton", { name: t("kader.roster.size") });
        await userEvent.clear(size);
        await userEvent.type(size, "41");
        expect(within(dialog).getByText(t("kader.roster.sizeRule", { min: 5, max: 40 }))).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: t("common.save") })).toBeDisabled();
    });

    it("marks roles and classes with their WoW icons", async () => {
        await show("board");
        expect(screen.getAllByRole("img", { name: "Tank" }).length).toBeGreaterThan(0);
        expect(screen.getAllByRole("img", { name: "Heiler" }).length).toBeGreaterThan(0);
    });

    it("speaks English", async () => {
        await switchLang("en");
        try {
            await show("board");
            expect(screen.getByRole("heading", { name: "Discord accounts" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Build setup" })).toBeInTheDocument();
        } finally {
            await switchLang("de");
        }
    });
});

describe("KaderPage · players", () => {
    it("filters by class with counts, shows the chip and groups by class", async () => {
        await show("players", { route: "/kader/spieler" });
        expect(screen.getByText(/5 von 5 Spielern|von 5/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: t("kader.filter.class") }));
        const menu = screen.getByRole("menu", { name: t("kader.filter.class") });
        const mage = within(menu).getByRole("menuitemcheckbox", { name: /Magier/ });
        expect(within(mage).getByText("1")).toBeInTheDocument();
        await userEvent.click(mage);
        expect(screen.queryByText("Aldric Sturmwind")).toBeNull();
        expect(screen.getByText("Liss Funkenhand")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("kader.filter.remove", { label: "Magier" }) })).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: t("kader.filter.clear") }));
        await userEvent.click(screen.getByRole("radio", { name: t("kader.groupBy.cls") }));
        const shamans = screen.getByRole("button", { name: /Schamane/ });
        expect(shamans).toHaveAttribute("aria-expanded", "true");
        expect(within(shamans).getByText(t("kader.players.inKader", { n: 1 }))).toBeInTheDocument();
        await userEvent.click(shamans);
        expect(screen.queryByText("Mira Sonnlicht")).toBeNull();
    });

    it("remembers the grouping", async () => {
        const first = await show("players", { route: "/kader/spieler" });
        await userEvent.click(screen.getByRole("radio", { name: t("kader.groupBy.status") }));
        first.unmount();
        await show("players", { route: "/kader/spieler" });
        expect(screen.getByRole("radio", { name: t("kader.groupBy.status") })).toHaveAttribute("aria-checked", "true");
    });
});

describe("KaderPage · setup", () => {
    it("distributes automatically and places by pick-then-click", async () => {
        const next = kaderView();
        next.setups.r1.variants[0].groups[0] = [U.tank, U.heal, null, null, null];
        vi.mocked(api.autoKaderVariant).mockResolvedValue(next);
        vi.mocked(api.saveKaderVariant).mockResolvedValue(kaderView());
        await show("setup", { route: "/kader/setup/r1", path: "kader/setup/:rosterId" });
        expect(screen.getByText(t("kader.setup.withoutGroup"))).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: /Aldric Sturmwind/ }));
        await userEvent.click(screen.getAllByRole("button", { name: t("kader.setup.freeSlot", { n: 1 }) })[1]);
        expect(api.saveKaderVariant).toHaveBeenCalledWith("r1", "v1", { groups: [[null, null, null, null, null], [U.tank, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null]] });

        await userEvent.click(screen.getByRole("button", { name: t("kader.setup.auto") }));
        expect(api.autoKaderVariant).toHaveBeenCalledWith("r1", "v1");
        await waitFor(() => expect(screen.getByText(t("kader.setup.allPlaced"))).toBeInTheDocument());
    });

    it("sends an unknown roster back to the board", async () => {
        renderPage(<KaderPage sub="setup" />, { route: "/kader/setup/gone", path: "kader/setup/:rosterId" });
        await waitFor(() => expect(screen.queryByText(t("kader.setup.withoutGroup"))).toBeNull());
    });
});

describe("KaderPage · account dialog", () => {
    it("shows what differs from the profile and saves the planner's characters", async () => {
        vi.mocked(api.saveKaderAssignment).mockResolvedValue(kaderView());
        await show("board");
        await userEvent.click(screen.getByText("Mira Sonnlicht"));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(/Haupt-Spec/, { selector: ".kp-diffnote" })).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.account.makeMain", { spec: "Verstärkung" }) }));
        await userEvent.click(within(dialog).getByRole("button", { name: t("common.apply") }));
        expect(api.saveKaderAssignment).toHaveBeenCalledWith(U.heal, [expect.objectContaining({ id: "h", specs: [{ spec: "Shaman-Enhancement", main: true, gear: "usable" }, { spec: "Shaman-Restoration", main: false, gear: "usable" }] })], "h");
    });

    it("switches a character to a nickname and saves it as one", async () => {
        vi.mocked(api.saveKaderAssignment).mockResolvedValue(kaderView());
        await show("board");
        await userEvent.click(screen.getByText("Mira Sonnlicht"));
        const dialog = await screen.findByRole("dialog");
        await userEvent.click(within(dialog).getByRole("radio", { name: t("kader.field.nameNick") }));
        const nick = within(dialog).getByRole("textbox", { name: t("kader.field.nickname") });
        expect(nick).toHaveValue("Mira Sonnlicht");
        await userEvent.clear(nick);
        await userEvent.type(nick, "K");
        expect(within(dialog).getByText(t("kader.account.nickRule"))).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: t("common.apply") })).toBeDisabled();
        await userEvent.type(nick, "nuffel");
        await userEvent.click(within(dialog).getByRole("button", { name: t("common.apply") }));
        expect(api.saveKaderAssignment).toHaveBeenCalledWith(U.heal, [expect.objectContaining({ id: "h", name: "Knuffel", nameStyle: "nick" })], "h");
    });

    it("adds an account with a nickname as its first character", async () => {
        vi.mocked(api.addKaderAccount).mockResolvedValue(kaderView());
        await show("board");
        await userEvent.click(screen.getByRole("button", { name: t("kader.pool.addAccount") }));
        const dialog = await screen.findByRole("dialog");
        await userEvent.click(within(dialog).getByRole("radio", { name: t("kader.add.byId") }));
        await userEvent.type(within(dialog).getByRole("textbox", { name: new RegExp(`^${t("kader.add.discordId")}`) }), "280140000001999999");
        await userEvent.type(within(dialog).getByRole("textbox", { name: t("kader.add.displayName") }), "Neu");
        await userEvent.click(within(dialog).getByRole("radio", { name: t("kader.field.nameNick") }));
        await userEvent.type(within(dialog).getByRole("textbox", { name: t("kader.field.nickname") }), "Knuffel");
        await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: t("kader.field.class") }), "Mage");
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.add.submit") }));
        expect(api.addKaderAccount).toHaveBeenCalledWith({ userId: "280140000001999999", displayName: "Neu", character: { nameStyle: "nick", nickname: "Knuffel", className: "Mage" } });
    });
});
