// The Kaderplaner rendered against a mocked api: opening the last Kader, the
// first Kader, the pool and the import from Discord roles, the interview with
// its autosave, the overview's filters, the Vorläufig drawer (votes, comments,
// decision), the questions, the example setups, a read-only grant and English.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { KaderData } from "../../../api";
import { t } from "../../../i18n";
import { switchLang } from "../../../test/i18n";
import { CONTENT_ARIA, adminUser, renderPage, twoVersions } from "../../../test/render";
import { CAT, kader as kaderData, kaderView, ME, U } from "../kader.fixture";
import { DRAG_TYPE } from "../dnd";
import KaderPage from "../KaderPage";
import { losesRole } from "../useMovePlayer";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getKader: vi.fn(),
    // the live poll answers nothing here (KaderLive.test.tsx tests it)
    getKaderLive: vi.fn(),
    leaveKaderLive: vi.fn(),
    // the roster button of the decision page (#658, RosterLink.test.tsx tests it)
    getKaderRoster: vi.fn(async () => null),
    getKaderTakeover: vi.fn(async () => null),
    createKader: vi.fn(),
    setKaderState: vi.fn(),
    addKaderPlayers: vi.fn(),
    saveKaderInterview: vi.fn(),
    completeKaderInterview: vi.fn(),
    setKaderVote: vi.fn(),
    addKaderComment: vi.fn(),
    addKaderQuestion: vi.fn(),
    deleteKaderQuestion: vi.fn(),
    saveKaderVariant: vi.fn(),
    updateKader: vi.fn(),
    updateKaderQuestion: vi.fn(),
    saveKaderAssignment: vi.fn(),
}));

const PATH = "/kader/:kaderId?/:sub?";
const SECTION_ORDER = ["roster", "bench", "tentative", "provisional"];
const reader = adminUser({ isAdmin: false, access: { kader: { read: true, write: false } } });

/** What a change inside the Kader answers: the Kader as stored plus the summaries. */
function change(kader: KaderData = kaderData(), extra: Record<string, unknown> = {}) {
    return { kader, kaders: kaderView().kaders, ...extra };
}

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getKader).mockImplementation(async (id = "") => kaderView(id === "k1" ? {} : { kader: null }));
});

async function show(route: string, user = adminUser()) {
    const view = renderPage(<KaderPage />, { route, path: PATH, user });
    await screen.findByRole("button", { name: /Forever-Kader/ });
    return view;
}

describe("KaderPage · Kader", () => {
    it("shows the overview of all Kader when the address names none, without jumping into the last one", async () => {
        localStorage.setItem("eh-kader-last", JSON.stringify("k2"));
        renderPage(<KaderPage />, { route: "/kader", path: PATH });
        expect(await screen.findByRole("heading", { name: t("kader.kaders.title") })).toBeInTheDocument();
        expect(api.getKader).toHaveBeenLastCalledWith("");
        const cards = screen.getByRole("list", { name: t("kader.kaders.cardsAria") });
        const first = within(cards).getByRole("link", { name: /Forever-Kader/ });
        expect(first).toHaveAttribute("href", "/kader/k1/pool");
        expect(within(cards).getByRole("link", { name: /Zweiter Kader/ })).toHaveAttribute("href", "/kader/k2/pool");
        // the counts of the first Kader: pool 1, preselection 2, provisional 1, roster 1; 3 questions; one lead
        expect(first).toHaveTextContent(t("kader.kaders.questions", { count: 3 }));
        expect(first).toHaveTextContent(t("kader.kaders.side.bench", { count: 1 }));
        expect(within(first).getByText(t("kader.state.selected")).previousElementSibling).toHaveTextContent("2");
        expect(within(first).getByRole("img", { name: /Admin/ })).toBeInTheDocument();
        // only the Kader opened last carries the badge
        expect(within(first).queryByText(t("kader.kaders.last"))).toBeNull();
        expect(within(within(cards).getByRole("link", { name: /Zweiter Kader/ })).getByText(t("kader.kaders.last"))).toBeInTheDocument();
    });

    it("draws a lead with their Discord picture, in the overview and the header — else the initial", async () => {
        const PIC = "https://cdn.discordapp.com/avatars/admin.png";
        vi.mocked(api.getKader).mockImplementation(async (id = "") => kaderView({ avatars: { [ME]: PIC }, ...(id === "k1" ? {} : { kader: null }) }));
        const overview = renderPage(<KaderPage />, { route: "/kader", path: PATH });
        const cards = await screen.findByRole("list", { name: t("kader.kaders.cardsAria") });
        const lead = within(within(cards).getByRole("link", { name: /Forever-Kader/ })).getByRole("img", { name: /Admin/ });
        expect(lead.querySelector(".kp-avatar img")).toHaveAttribute("src", PIC);
        expect(lead.querySelector(".kp-avatar")).not.toHaveTextContent("A");
        overview.unmount();

        const page = await show("/kader/k1/pool");
        expect(document.querySelector(".kp-leads .kp-avatar[aria-label=Admin] img")).toHaveAttribute("src", PIC);
        page.unmount();
        // without a picture the initial stands in
        vi.mocked(api.getKader).mockImplementation(async (id = "") => kaderView(id === "k1" ? {} : { kader: null }));
        await show("/kader/k1/pool");
        expect(document.querySelector(".kp-leads .kp-avatar[aria-label=Admin] img")).toBeNull();
        expect(document.querySelector(".kp-leads .kp-avatar[aria-label=Admin]")).toHaveTextContent("A");
    });

    it("creates a Kader from the overview, the head's button and the dashed card, only with write access", async () => {
        vi.mocked(api.createKader).mockResolvedValue({ ...change(), kaderId: "k1" });
        const view = renderPage(<KaderPage />, { route: "/kader", path: PATH });
        await screen.findByRole("heading", { name: t("kader.kaders.title") });
        expect(screen.getAllByRole("button", { name: new RegExp(t("kader.header.new")) })).toHaveLength(2);
        await userEvent.click(screen.getAllByRole("button", { name: new RegExp(t("kader.header.new")) })[0]);
        const dialog = await screen.findByRole("dialog");
        await userEvent.type(within(dialog).getByRole("textbox"), "Neuer");
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.settings.create") }));
        expect(api.createKader).toHaveBeenCalledWith("Neuer");
        view.unmount();
        renderPage(<KaderPage />, { route: "/kader", path: PATH, user: reader });
        await screen.findByRole("heading", { name: t("kader.kaders.title") });
        expect(screen.queryByRole("button", { name: t("kader.header.new") })).toBeNull();
        expect(screen.getByRole("link", { name: /Forever-Kader/ })).toBeInTheDocument();
    });

    it("offers a visible way back to all Kader inside a Kader", async () => {
        await show("/kader/k1/pool");
        expect(screen.getByRole("link", { name: t("kader.header.all") })).toHaveAttribute("href", "/kader");
    });

    it("starts with the flow and creates the first Kader", async () => {
        vi.mocked(api.getKader).mockResolvedValue(kaderView({ kaders: [], kader: null }));
        vi.mocked(api.createKader).mockResolvedValue({ ...change(), kaderId: "k1" });
        renderPage(<KaderPage />, { route: "/kader", path: PATH });
        expect(await screen.findByRole("heading", { name: t("kader.start.title") })).toBeInTheDocument();
        expect(screen.getByText(t("kader.start.rule.internal.t"))).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: t("kader.start.create") }));
        const dialog = await screen.findByRole("dialog");
        const create = within(dialog).getByRole("button", { name: t("kader.settings.create") });
        expect(create).toBeDisabled();
        await userEvent.type(within(dialog).getByRole("textbox"), "Forever-Kader 2027");
        await userEvent.click(create);
        expect(api.createKader).toHaveBeenCalledWith("Forever-Kader 2027");
    });

    it("edits name and leads in the settings: one row per lead, a real add button", async () => {
        await show("/kader/k1/pool");
        await userEvent.click(screen.getByRole("button", { name: t("kader.header.settings") }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByRole("textbox", { name: t("kader.field.name") })).toHaveValue("Forever-Kader");
        // the only lead cannot be removed; adding waits for a member
        expect(within(dialog).getByRole("button", { name: t("kader.settings.removeLead", { name: "Admin" }) })).toBeDisabled();
        const add = within(dialog).getByRole("button", { name: t("common.add") });
        expect(add).toBeDisabled();
        await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: t("kader.settings.addLead") }), U.guest);
        expect(add).toBeEnabled();
        await userEvent.click(add);
        expect(within(dialog).getByText("Gast")).toBeInTheDocument();
    });

    it("shows each lead in the settings with their Discord picture, else the initial", async () => {
        vi.mocked(api.getKader).mockImplementation(async (id = "") => kaderView({ avatars: { [ME]: "https://cdn/admin.png" }, ...(id === "k1" ? {} : { kader: null }) }));
        await show("/kader/k1/pool");
        await userEvent.click(screen.getByRole("button", { name: t("kader.header.settings") }));
        const dialog = await screen.findByRole("dialog");
        await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: t("kader.settings.addLead") }), U.guest);
        await userEvent.click(within(dialog).getByRole("button", { name: t("common.add") }));
        const rows = dialog.querySelectorAll(".kp-leadlist .kp-avatar");
        expect(rows[0].querySelector("img")).toHaveAttribute("src", "https://cdn/admin.png");
        expect(rows[1].querySelector("img")).toBeNull();
        expect(rows[1]).toHaveTextContent("G");
    });

    it("counts the players per state in the status bar, every count with the words behind it", async () => {
        await show("/kader/k1/pool");
        const nav = screen.getByRole("navigation", { name: t("kader.nav.aria") });
        expect(within(nav).getByRole("link", { name: t("kader.nav.count.pool", { count: 1 }) })).toHaveAttribute("aria-current", "page");
        expect(within(nav).getByRole("link", { name: t("kader.nav.count.selected", { count: 2 }) })).not.toHaveAttribute("aria-current");
        // bench and tentative are segments of their own, next to the roster
        for (const s of ["provisional", "roster", "bench", "tentative"]) {
            expect(within(nav).getByRole("link", { name: t(`kader.nav.count.${s}`, { count: 1 }) })).toHaveAttribute("href", "/kader/k1/roster");
        }
        // no step numbers: the only figures are the counts
        expect(within(nav).queryByText("4")).toBeNull();
    });

    it("builds the head from three lines side by side in the page, so that only the tabs stick to it", async () => {
        vi.mocked(api.getKaderRoster).mockResolvedValueOnce({ roster: { id: "r1", name: "Forever-Raid", members: 2 }, candidates: 3, pending: 0, canCreate: false, canSync: false });
        await show("/kader/k1/roster");
        await waitFor(() => expect(document.querySelector(".kp-tools .kp-toollab")).toHaveTextContent(t("kader.nav.rosterGroup")));
        const title = document.querySelector(".kp-title") as HTMLElement;
        const tabs = screen.getByRole("navigation", { name: t("kader.nav.aria") });
        const tools = document.querySelector(".kp-tools") as HTMLElement;
        expect(tabs.previousElementSibling).toBe(title);
        expect(tabs.nextElementSibling).toBe(tools);
        expect(tabs.parentElement).toBe(title.parentElement);
        // the Kader's name, the way back and the people share the title line
        expect(title).toContainElement(screen.getByRole("button", { name: /Forever-Kader/ }));
        expect(title).toContainElement(screen.getByRole("link", { name: t("kader.header.all") }));
        expect(title.querySelector(".kp-leads .kp-lab")).toHaveTextContent(t("kader.header.leads"));
    });

    it("draws the states as tabs without an icon or a box around the count", async () => {
        await show("/kader/k1/pool");
        const nav = screen.getByRole("navigation", { name: t("kader.nav.aria") });
        expect(nav.querySelector(".kp-status .kp-sico")).toBeNull();
        expect(nav.querySelectorAll(".kp-status .kp-htab .kp-htab-n")).toHaveLength(6);
    });

    it("offers the planning pages as tabs and again in the menu a narrow page folds them into", async () => {
        await show("/kader/k1/zusammensetzung");
        const nav = screen.getByRole("navigation", { name: t("kader.nav.aria") });
        const plan = nav.querySelector(".kp-plan") as HTMLElement;
        expect(within(plan).getByRole("link", { name: t("kader.nav.composition") })).toHaveAttribute("aria-current", "page");
        // the short name on the tab, the whole task in its tooltip
        expect(within(plan).getByRole("link", { name: t("kader.nav.setups") })).toHaveAttribute("data-tip", t("kader.nav.setupsTip"));

        const trigger = within(nav).getByRole("button", { name: t("kader.nav.planGroup") });
        expect(trigger).toHaveClass("kp-active");
        await userEvent.click(trigger);
        const menu = within(nav).getByRole("menu", { name: t("kader.nav.planGroup") });
        expect(within(menu).getByRole("menuitem", { name: t("kader.nav.composition") })).toHaveAttribute("href", "/kader/k1/zusammensetzung");
        expect(within(menu).getByRole("menuitem", { name: t("kader.nav.setups") })).toHaveAttribute("href", "/kader/k1/setups");
        await userEvent.keyboard("{Escape}");
        expect(within(nav).queryByRole("menu")).toBeNull();
        expect(trigger).toHaveFocus();
    });

    it("keeps the pages without a status bar free of the tabs", async () => {
        await show("/kader/k1/setups");
        expect(screen.queryByRole("navigation", { name: t("kader.nav.aria") })).toBeNull();
        expect(document.querySelector(".kp-title")).not.toBeNull();
    });

    it("underlines every state the roster page shows, and tells a screen reader only the roster", async () => {
        await show("/kader/k1/roster");
        const nav = screen.getByRole("navigation", { name: t("kader.nav.aria") });
        const label = (s: string) => t(`kader.nav.count.${s}`, { count: 1 });
        expect(Array.from(nav.querySelectorAll(".kp-htab.kp-active")).map((a) => a.getAttribute("aria-label"))).toEqual(["provisional", "roster", "bench", "tentative"].map(label));
        expect(Array.from(nav.querySelectorAll("[aria-current]")).map((a) => a.getAttribute("aria-label"))).toEqual([label("roster")]);
    });

    it("marks only the composition on its page, not the states it counts", async () => {
        await show("/kader/k1/zusammensetzung");
        const nav = screen.getByRole("navigation", { name: t("kader.nav.aria") });
        expect(nav.querySelector(".kp-status .kp-active")).toBeNull();
        expect(nav.querySelector(".kp-status [aria-current]")).toBeNull();
        // the tab or the menu's button is on screen, never both (kader.css)
        const trigger = within(nav).getByRole("button", { name: t("kader.nav.planGroup") });
        expect(trigger).toHaveAttribute("aria-current", "page");
        await userEvent.click(trigger);
        const entry = within(within(nav).getByRole("menu")).getByRole("menuitem", { name: t("kader.nav.composition") });
        expect(entry).toHaveClass("kp-current");
        expect(entry).not.toHaveAttribute("aria-current");
    });

    it("closes the planning menu on Escape even with the focus outside it, and puts the focus on its button", async () => {
        await show("/kader/k1/roster");
        const nav = screen.getByRole("navigation", { name: t("kader.nav.aria") });
        const trigger = within(nav).getByRole("button", { name: t("kader.nav.planGroup") });
        await userEvent.click(trigger);
        expect(within(nav).getByRole("menu")).toBeInTheDocument();
        (document.activeElement as HTMLElement).blur();
        fireEvent.keyDown(document.body, { key: "Escape" });
        expect(within(nav).queryByRole("menu")).toBeNull();
        expect(trigger).toHaveFocus();
    });

    it("keeps the way back a real button, and the whole name of a Kader as a tooltip on the picker and in its menu", async () => {
        await show("/kader/k1/pool");
        expect(screen.getByRole("link", { name: t("kader.header.all") })).toHaveClass("btn", "back-btn");
        const picker = screen.getByRole("button", { name: /Forever-Kader/ });
        expect(picker).toHaveAttribute("data-tip", "Forever-Kader");
        await userEvent.click(picker);
        expect(screen.getByRole("menuitemradio", { name: /Zweiter Kader/ })).toHaveAttribute("data-tip", "Zweiter Kader");
    });

    describe("the tabs as a grid", () => {
        const widthOf = (px: number) => vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(px);

        it("stay a sticking line from the narrowest page next to the sidebar on, with a scrollbar", async () => {
            const width = widthOf(588);
            await show("/kader/k1/pool");
            expect(screen.getByRole("navigation", { name: t("kader.nav.aria") })).not.toHaveClass("kp-htabs-grid");
            width.mockRestore();
        });

        it("become a grid only where the line itself is narrower than that", async () => {
            const width = widthOf(362);
            await show("/kader/k1/pool");
            expect(screen.getByRole("navigation", { name: t("kader.nav.aria") })).toHaveClass("kp-htabs-grid");
            width.mockRestore();
        });
    });

    describe("while a card is dragged", () => {
        const drag = (type: "dragStart" | "dragEnd" | "drop", from: Element, id = U.heal) => {
            const data: Record<string, string> = { [DRAG_TYPE]: id };
            const dataTransfer = { types: [DRAG_TYPE], setData: () => {}, getData: (k: string) => data[k] || "", effectAllowed: "", dropEffect: "" };
            if (type === "dragStart") fireEvent.dragStart(from, { dataTransfer });
            if (type === "dragEnd") fireEvent.dragEnd(from, { dataTransfer });
            if (type === "drop") fireEvent.drop(from, { dataTransfer });
        };
        const tabs = () => screen.getByRole("navigation", { name: t("kader.nav.aria") });
        const tab = (s: string, count = 1) => within(tabs()).getByRole("link", { name: t(`kader.nav.count.${s}`, { count }) });
        const marked = () => tabs().querySelectorAll(".kp-htab-drop, .kp-htab-dim, .kp-over");

        it("shows where it can land from the start and fades the rest, until the drag ends", async () => {
            await show("/kader/k1/roster");
            expect(marked()).toHaveLength(0);
            drag("dragStart", document.body);
            await waitFor(() => expect(tab("pool")).toHaveClass("kp-htab-drop"));
            expect(tab("selected", 2)).toHaveClass("kp-htab-drop");
            for (const s of ["provisional", "roster", "bench", "tentative"]) expect(tab(s)).toHaveClass("kp-htab-dim");
            expect(tabs().querySelector(".kp-plan-menu button")).toHaveClass("kp-htab-dim");
            // over a landing place it says so on top
            fireEvent.dragOver(tab("pool"), { dataTransfer: { types: [DRAG_TYPE] } });
            expect(tab("pool")).toHaveClass("kp-over", "kp-htab-drop");
            fireEvent.dragLeave(tab("pool"), { dataTransfer: { types: [DRAG_TYPE] } });
            expect(tab("pool")).not.toHaveClass("kp-over");
            // Escape or letting go outside: the browser ends the drag, with no drop
            drag("dragEnd", document.body);
            await waitFor(() => expect(marked()).toHaveLength(0));
        });

        it("clears up after a drop as well", async () => {
            vi.mocked(api.setKaderState).mockResolvedValue(change());
            await show("/kader/k1/roster");
            drag("dragStart", document.body);
            await waitFor(() => expect(tab("pool")).toHaveClass("kp-htab-drop"));
            drag("drop", tab("pool"));
            await waitFor(() => expect(marked()).toHaveLength(0));
        });

        it("offers only the states MOVES allows: one in the preselection goes to the pool alone", async () => {
            await show("/kader/k1/roster");
            drag("dragStart", document.body, U.mage);
            await waitFor(() => expect(tab("pool")).toHaveClass("kp-htab-drop"));
            expect(tab("selected", 2)).toHaveClass("kp-htab-dim");
        });

        it("still ends when the dragged card left the page, where nothing bubbles up any more", async () => {
            await show("/kader/k1/roster");
            const card = document.createElement("div");
            document.body.appendChild(card);
            drag("dragStart", card);
            await waitFor(() => expect(tab("pool")).toHaveClass("kp-htab-drop"));
            card.remove();
            drag("dragEnd", card);
            await waitFor(() => expect(marked()).toHaveLength(0));
        });

        it("marks nothing for a reader, on another page, or for another kind of drag", async () => {
            const reading = renderPage(<KaderPage />, { route: "/kader/k1/roster", path: PATH, user: reader });
            await screen.findByRole("button", { name: /Forever-Kader/ });
            const pause = () => new Promise((done) => { setTimeout(done, 5); });
            drag("dragStart", document.body);
            await act(pause);
            expect(marked()).toHaveLength(0);
            drag("dragEnd", document.body);
            reading.unmount();

            const pool = await show("/kader/k1/pool");
            drag("dragStart", document.body);
            await act(pause);
            expect(marked()).toHaveLength(0);
            drag("dragEnd", document.body);
            pool.unmount();

            await show("/kader/k1/roster");
            fireEvent.dragStart(document.body, { dataTransfer: { types: ["text/plain"], getData: () => "" } });
            await act(pause);
            expect(marked()).toHaveLength(0);
        });
    });
});

describe("KaderPage · Pool", () => {
    it("lists everybody with the prefilled character and its source, and moves one by the switch", async () => {
        vi.mocked(api.setKaderState).mockResolvedValue(change());
        await show("/kader/k1/pool");
        // a spec is its icon plus the class; the full name sits in the tooltip and on the icon
        expect(screen.getByText("Magier")).toHaveAttribute("data-tip", "Magier · Frost");
        expect(screen.getAllByRole("img", { name: "Frost · Magier" }).length).toBeGreaterThan(0);
        // the scope says what it counts
        expect(screen.getByRole("radio", { name: t("kader.pool.scopeSelected", { n: 2 }) })).toHaveAttribute("data-tip", t("kader.nav.count.selected", { count: 2 }));
        expect(screen.getByText(t("kader.pool.ofTotal", { count: 7 }))).toBeInTheDocument();
        expect(screen.getAllByText(t("kader.source.profile")).length).toBeGreaterThan(0);
        expect(screen.getByText(t("kader.source.logs"))).toBeInTheDocument();
        // Neuling has no character data
        expect(screen.getAllByText(t("kader.pool.noData")).length).toBeGreaterThan(0);
        // the attendance over the Kader's two categories, each one's share in the tooltip
        expect(screen.getByText("76 %")).toHaveAttribute("data-tip", t("kader.att.tip", { attended: 16, counted: 21 }));
        expect(screen.getByText("76 %")).toHaveAttribute("data-tip-sub", "Mo Raid 9/11 · Do Raid 7/10");
        // Liss: only Do counts (her PUG nights are not picked)
        expect(screen.getByText("40 %")).toHaveAttribute("data-tip-sub", "Do Raid 2/5");
        // with a pick there is no hint above the table
        expect(screen.queryByRole("note")).toBeNull();
        await userEvent.click(screen.getByRole("switch", { name: t("kader.pool.toSelection", { name: "Neuling" }) }));
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.hand], "selected");
        // somebody further along shows their state instead of the switch
        expect(screen.getAllByText(t("kader.state.roster")).length).toBeGreaterThan(0);
    });

    it("shows each player's Discord picture beside the name, else the initial", async () => {
        const view = kaderView();
        view.players = view.players.map((p) => (p.userId === U.tank ? { ...p, avatarUrl: "https://cdn.discordapp.com/avatars/aldric.png" } : p));
        vi.mocked(api.getKader).mockResolvedValue(view);
        await show("/kader/k1/pool");
        const rowOf = (name: string) => screen.getByRole("button", { name }).closest("[role='row']") as HTMLElement;
        expect(rowOf("Aldric").querySelector("img.kp-pava")).toHaveAttribute("src", "https://cdn.discordapp.com/avatars/aldric.png");
        // Neuling has no picture: the initial stands in
        expect(rowOf("Neuling").querySelector("img.kp-pava")).toBeNull();
        expect(rowOf("Neuling").querySelector(".kp-pava")).toHaveTextContent("N");
    });

    it("takes the members of a Discord role into the pool", async () => {
        vi.mocked(api.addKaderPlayers).mockResolvedValue({ ...kaderView(), added: 1, already: 0 });
        await show("/kader/k1/pool");
        await userEvent.click(screen.getByRole("button", { name: t("kader.pool.import") }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(t("kader.import.pickRoles"))).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: /Raider/ }));
        // Gast is new (profile), Aldric is already in this Kader
        expect(within(dialog).getByText("Gast")).toBeInTheDocument();
        expect(within(dialog).getByText(t("kader.import.from.profile"))).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("radio", { name: t("kader.import.listKnown", { n: 1 }) }));
        expect(within(dialog).getByText(t("kader.import.inKader"))).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.import.submit", { n: 1 }) }));
        expect(api.addKaderPlayers).toHaveBeenCalledWith("k1", [{ userId: U.guest, displayName: "Gast" }]);
    });

    it("says so when the member list is not there", async () => {
        vi.mocked(api.getKader).mockResolvedValue(kaderView({ members: [], discordRoles: [] }));
        await show("/kader/k1/pool");
        await userEvent.click(screen.getByRole("button", { name: t("kader.pool.import") }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(t("kader.import.noRoles"))).toBeInTheDocument();
        expect(within(dialog).getByText(t("kader.import.offline"))).toBeInTheDocument();
    });
});

describe("KaderPage · Vorauswahl", () => {
    it("lists the interviews, started first, and saves a change by itself", async () => {
        vi.mocked(api.saveKaderInterview).mockResolvedValue(change());
        await show("/kader/k1/vorauswahl");
        const list = screen.getByRole("region", { name: t("kader.interview.listTitle") });
        const rows = within(list).getAllByRole("button").filter((b) => b.classList.contains("kp-ivrow"));
        expect(rows[0]).toHaveTextContent("Liss");
        expect(within(list).queryByText("Brakk")).toBeNull();
        const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
        // one of two: the wish is there, the raid days are not
        expect(within(panel).getByText(t("kader.interview.progress", { done: 1, total: 2 }))).toBeInTheDocument();
        expect(within(panel).getByRole("button", { name: t("kader.interview.complete") })).toBeDisabled();
        await userEvent.click(within(panel).getByRole("button", { name: "Mittwoch" }));
        expect(within(panel).getByRole("button", { name: t("kader.interview.complete") })).toBeEnabled();
        await waitFor(() => expect(api.saveKaderInterview).toHaveBeenCalledWith("k1", U.mage, { answers: { q1: ["d3"] } }, { baseRev: 0 }), { timeout: 2500 });
    });

    it("completes an interview and goes on", async () => {
        const done = kaderData();
        done.players[U.mage].interview.completedAt = "2026-10-04T18:00:00.000Z";
        vi.mocked(api.saveKaderInterview).mockResolvedValue(change());
        vi.mocked(api.completeKaderInterview).mockResolvedValue(change(done));
        await show(`/kader/k1/vorauswahl?spieler=${U.mage}`);
        const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
        await userEvent.click(within(panel).getByRole("button", { name: "Donnerstag" }));
        await userEvent.click(within(panel).getByRole("button", { name: t("kader.interview.complete") }));
        expect(api.saveKaderInterview).toHaveBeenCalledWith("k1", U.mage, { answers: { q1: ["d4"] } }, { baseRev: 0 });
        expect(api.completeKaderInterview).toHaveBeenCalledWith("k1", U.mage);
    });

    it("locks a held interview until it is opened again", async () => {
        await show(`/kader/k1/vorauswahl?spieler=${U.done}`);
        const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Brakk" }) });
        expect(within(panel).getByRole("button", { name: t("kader.interview.reopen") })).toBeInTheDocument();
        expect(within(panel).getByRole("button", { name: "Mittwoch" })).toBeDisabled();
        // a held interview carries its check beside the name
        expect(within(panel).getByRole("img", { name: t("kader.interview.statusDoneTip") })).toBeInTheDocument();
    });

    it("marks the status with icons: the list filters, the questions and the progress", async () => {
        await show(`/kader/k1/vorauswahl?spieler=${U.mage}`);
        const list = screen.getByRole("region", { name: t("kader.interview.listTitle") });
        const open = within(list).getByRole("radio", { name: t("kader.interview.listOpen", { n: 1 }) });
        expect(open.querySelector("svg")).not.toBeNull();
        expect(open).toHaveAttribute("data-tip", t("kader.interview.listOpenTip", { count: 1 }));
        const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
        // the voice question is answered, the raid days (required) are still open
        expect(within(panel).getAllByRole("img", { name: t("kader.interview.answered") })).toHaveLength(1);
        expect(within(panel).getAllByRole("img", { name: t("kader.interview.stillOpen") })).toHaveLength(1);
    });

    it("adds a wish by class and one of its spec icons", async () => {
        vi.mocked(api.saveKaderInterview).mockResolvedValue(change());
        await show(`/kader/k1/vorauswahl?spieler=${U.mage}`);
        const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
        await userEvent.selectOptions(within(panel).getByRole("combobox", { name: t("kader.field.class") }), "Mage");
        const specs = within(panel).getByRole("radiogroup", { name: t("kader.field.spec") });
        // Frost is wished already, Fire can be added
        expect(within(specs).getByRole("radio", { name: "Frost · Magier" })).toBeDisabled();
        await userEvent.click(within(specs).getByRole("radio", { name: "Feuer · Magier" }));
        await userEvent.click(within(panel).getByRole("button", { name: t("kader.interview.addWish") }));
        await waitFor(() => expect(api.saveKaderInterview).toHaveBeenCalledWith("k1", U.mage, { wishes: [{ className: "Mage", spec: "Mage-Frost" }, { className: "Mage", spec: "Mage-Fire" }] }, { baseRev: 0 }), { timeout: 2500 });
    });

    it("compares everybody in the overview, filters by an answer and moves the marked on", async () => {
        vi.mocked(api.setKaderState).mockResolvedValue(change());
        await show("/kader/k1/uebersicht");
        expect(screen.getByText("Liss")).toBeInTheDocument();
        expect(screen.getByText("Brakk")).toBeInTheDocument();
        // the filter menu (the column head of the same name sorts)
        await userEvent.click(screen.getByRole("button", { name: /Im Voice-Chat aktiv\?/, expanded: false }));
        await userEvent.click(screen.getByRole("menuitemcheckbox", { name: /Meistens/ }));
        expect(screen.queryByText("Liss")).toBeNull();
        expect(screen.getByText("Brakk")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("checkbox", { name: t("kader.batch.mark", { name: "Brakk" }) }));
        await userEvent.click(screen.getByRole("button", { name: t("kader.overview.toProvisional") }));
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.done], "provisional");
    });
});

describe("KaderPage · Vorläufig und Roster", () => {
    it("shows the columns and the drawer: votes, comments and the decision", async () => {
        vi.mocked(api.setKaderVote).mockResolvedValue(change());
        vi.mocked(api.addKaderComment).mockResolvedValue(change());
        vi.mocked(api.setKaderState).mockResolvedValue(change());
        await show(`/kader/k1/roster?spieler=${U.heal}`);
        for (const s of ["provisional", "roster", "bench", "tentative"]) expect(screen.getByRole("region", { name: t(`kader.state.${s}`) })).toBeInTheDocument();
        const drawer = screen.getByRole("complementary", { name: t("kader.decide.drawer", { name: "Mira" }) });
        expect(within(drawer).getByText(`Admin · ${t("kader.vote.yes")}`)).toBeInTheDocument();
        expect(within(drawer).getByText("Zuverlässig.")).toBeInTheDocument();
        await userEvent.click(within(drawer).getByRole("radio", { name: t("kader.vote.noAction") }));
        expect(api.setKaderVote).toHaveBeenCalledWith("k1", U.heal, "no");
        await userEvent.type(within(drawer).getByRole("textbox", { name: t("kader.decide.comment") }), "Passt gut.");
        await userEvent.click(within(drawer).getByRole("button", { name: t("kader.decide.send") }));
        expect(api.addKaderComment).toHaveBeenCalledWith("k1", U.heal, "Passt gut.");
        await userEvent.click(within(drawer).getByRole("button", { name: new RegExp(`^${t("kader.decide.decisionAria")}`) }));
        const menu = await screen.findByRole("menu", { name: t("kader.decide.decisionAria") });
        const items = within(menu).getAllByRole("menuitemradio");
        expect(items.map((b) => b.getAttribute("aria-label"))).toEqual([
            `${t("kader.picker.rank", { n: 1 })}: Schamane · Wiederherstellung`,
            `${t("kader.picker.rank", { n: 2 })}: Schamane · Verstärkung`,
        ]);
        expect(items[0]).toHaveAttribute("aria-checked", "true");
        await userEvent.click(items[1]);
        await userEvent.click(within(drawer).getByRole("button", { name: t("kader.decide.toRoster") }));
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.heal], "roster", { className: "Shaman", spec: "Shaman-Enhancement" });
    });

    it("lays the sections out as one grid with the same card everywhere", async () => {
        await show("/kader/k1/roster");
        const sections = SECTION_ORDER.map((s) => screen.getByRole("region", { name: t(`kader.state.${s}`) }));
        // one card per player, the same component in every section
        expect(sections.map((sec) => sec.querySelectorAll(".kp-card:not(.kp-card-empty)").length)).toEqual([1, 1, 1, 1]);
        // the cards carry votes and comments with the words behind the numbers
        const provisional = sections[3];
        expect(within(provisional).getByText(t("kader.decide.yesVotes", { count: 1 }))).toBeInTheDocument();
        expect(within(provisional).getByText(t("kader.decide.commentCount", { count: 1 }))).toBeInTheDocument();
    });

    it("changes a roster decision only when it differs, and shows the current state as the pressed button", async () => {
        vi.mocked(api.setKaderState).mockResolvedValue(change());
        await show(`/kader/k1/roster?spieler=${U.sham}`);
        const drawer = screen.getByRole("complementary", { name: t("kader.decide.drawer", { name: "Tomas" }) });
        // Tomas is on the bench: bench is the pressed, disabled one; tentative and "Ins Roster" can be used
        expect(within(drawer).getByRole("button", { name: t("kader.state.bench") })).toBeDisabled();
        expect(within(drawer).getByRole("button", { name: t("kader.state.bench") })).toHaveAttribute("aria-pressed", "true");
        expect(within(drawer).getByRole("button", { name: t("kader.state.tentative") })).toBeEnabled();
        expect(within(drawer).getByRole("button", { name: t("kader.decide.toRoster") })).toBeEnabled();
    });

    it("keeps the decision change off until another spec is picked", async () => {
        const k = kaderData();
        k.players[U.tank].wishes = [{ className: "Warrior", spec: "Warrior-Protection" }, { className: "Warrior", spec: "Warrior-Fury" }];
        vi.mocked(api.getKader).mockResolvedValue(kaderView({ kader: k }));
        vi.mocked(api.setKaderState).mockResolvedValue(change(k));
        await show(`/kader/k1/roster?spieler=${U.tank}`);
        const drawer = screen.getByRole("complementary", { name: t("kader.decide.drawer", { name: "Aldric" }) });
        const changeButton = within(drawer).getByRole("button", { name: t("kader.decide.changeDecision") });
        expect(changeButton).toBeDisabled();
        await userEvent.click(within(drawer).getByRole("button", { name: new RegExp(`^${t("kader.decide.decisionAria")}`) }));
        await userEvent.click(await screen.findByRole("menuitemradio", { name: `${t("kader.picker.rank", { n: 2 })}: Krieger · Furor` }));
        expect(changeButton).toBeEnabled();
        await userEvent.click(changeButton);
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.tank], "roster", { className: "Warrior", spec: "Warrior-Fury" });
    });

    it("moves a card back a step from the drawer", async () => {
        vi.mocked(api.setKaderState).mockResolvedValue(change());
        await show(`/kader/k1/roster?spieler=${U.tank}`);
        await userEvent.click(screen.getByRole("button", { name: t("kader.decide.back.provisional") }));
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.tank], "provisional", undefined);
    });
});

describe("KaderPage · attendance per raid category", () => {
    it("picks the raid categories in the attendance column's head, for the whole Kader", async () => {
        vi.mocked(api.updateKader).mockResolvedValue(change(kaderData({ attendanceCategories: [CAT.mo, CAT.do, CAT.pug] })));
        await show("/kader/k1/pool");
        await userEvent.click(screen.getByRole("button", { name: t("kader.att.fromChange", { cats: "Mo Raid, Do Raid" }) }));
        const menu = await screen.findByRole("menu", { name: t("kader.att.menuTitle") });
        const items = within(menu).getAllByRole("menuitemcheckbox");
        expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["true", "true", "false"]);
        // every count with its word
        expect(within(menu).getByText(t("kader.att.nights", { count: 4 }))).toBeInTheDocument();
        // the keyboard: the first category has the focus, the arrows move it
        expect(items[0]).toHaveFocus();
        await userEvent.keyboard("{ArrowDown}");
        expect(items[1]).toHaveFocus();
        await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: /PUG/ }));
        expect(api.updateKader).toHaveBeenCalledWith("k1", { attendanceCategories: [CAT.mo, CAT.do, CAT.pug] });
        // with the PUG nights Liss has 6 of 9
        expect(await screen.findByText("67 %")).toHaveAttribute("data-tip-sub", "Do Raid 2/5 · PUG 4/4");
    });

    it("shows \"—\" and asks for a pick while the Kader counts in no category", async () => {
        vi.mocked(api.getKader).mockResolvedValue(kaderView({ kader: kaderData({ attendanceCategories: [] }) }));
        await show("/kader/k1/pool");
        expect(screen.queryByText("76 %")).toBeNull();
        const dashes = screen.getAllByText("—").filter((el) => el.getAttribute("data-tip") === t("kader.att.noneTip"));
        expect(dashes).toHaveLength(7);
        expect(dashes[0]).toHaveAttribute("data-tip-sub", t("kader.att.noneSub"));
        expect(screen.getByRole("button", { name: t("kader.att.pickLong") })).toHaveTextContent(t("kader.att.pick"));
        // and the hint above the table says where to pick them
        expect(screen.getByRole("note")).toHaveTextContent(t("kader.att.noneSub"));
        // the account dialog says the same
        await userEvent.click(screen.getByRole("button", { name: "Aldric" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(`${t("kader.att.noneTip")}. ${t("kader.att.noneSub")}`)).toBeInTheDocument();
    });

    it("picks the raid categories in the Kader's settings too", async () => {
        vi.mocked(api.updateKader).mockResolvedValue(change());
        await show("/kader/k1/pool");
        await userEvent.click(screen.getByRole("button", { name: t("kader.header.settings") }));
        const dialog = await screen.findByRole("dialog");
        const group = within(dialog).getByRole("group", { name: t("kader.att.menuTitle") });
        expect(within(group).getAllByRole("checkbox").map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "true", "false"]);
        expect(within(group).getByText(t("kader.att.nights", { count: 11 }))).toBeInTheDocument();
        await userEvent.click(within(group).getByRole("checkbox", { name: /Mo Raid/ }));
        await userEvent.click(within(group).getByRole("checkbox", { name: /PUG/ }));
        await userEvent.click(within(dialog).getByRole("button", { name: t("common.save") }));
        expect(api.updateKader).toHaveBeenCalledWith("k1", { name: "Forever-Kader", leads: [ME], attendanceCategories: [CAT.do, CAT.pug] });
    });

    it("shows it in the drawer and in the account dialog, with each category's share and the nights", async () => {
        await show(`/kader/k1/roster?spieler=${U.tank}`);
        const drawer = screen.getByRole("complementary", { name: t("kader.decide.drawer", { name: "Aldric" }) });
        expect(within(drawer).getByText("76 %")).toBeInTheDocument();
        expect(within(drawer).getByText(`${t("kader.att.tip", { attended: 16, counted: 21 })} · Mo Raid 9/11 · Do Raid 7/10`)).toBeInTheDocument();
        await userEvent.click(within(drawer).getByRole("button", { name: "Aldric" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("76 %")).toBeInTheDocument();
        expect(within(dialog).getByText(t("kader.att.from", { cats: "Mo Raid 9/11 · Do Raid 7/10" }))).toBeInTheDocument();
        expect(within(dialog).getByText(t("kader.account.nights", { n: 21, there: 16, missed: 5 }))).toBeInTheDocument();
        // one square per night, newest first, the category in its tooltip
        const nights = Array.from(dialog.querySelectorAll(".kp-nights i"));
        expect(nights.map((n) => n.className)).toEqual(["on", "on", "off"]);
        expect(nights[1].getAttribute("data-tip")).toContain("Do Raid");
    });
});

describe("KaderPage · sorting", () => {
    const rowNames = (table: HTMLElement) => within(table).getAllByRole("row")
        .filter((r) => r.classList.contains("kp-trow") && !r.classList.contains("kp-thead"))
        .map((r) => (r.querySelector(".kp-namebtn, .kp-strong") || r).textContent);

    it("sorts the pool by a column head, says so with aria-sort and remembers it", async () => {
        await show("/kader/k1/pool");
        const table = screen.getByRole("table", { name: t("kader.pool.tableLabel", { name: "Forever-Kader" }) });
        expect(rowNames(table)).toEqual(["Aldric", "Brakk", "Kael", "Liss", "Mira", "Neuling", "Tomas"]);
        const head = within(table).getByRole("button", { name: t("kader.pool.colAttendance") });
        await userEvent.click(head);
        // highest first, "—" last
        expect(rowNames(table)).toEqual(["Mira", "Aldric", "Liss", "Brakk", "Kael", "Neuling", "Tomas"]);
        expect(head.closest("[role=columnheader]")).toHaveAttribute("aria-sort", "descending");
        // the keyboard: the head is a button
        head.focus();
        await userEvent.keyboard("{Enter}");
        expect(rowNames(table)).toEqual(["Liss", "Aldric", "Mira", "Brakk", "Kael", "Neuling", "Tomas"]);
        expect(head.closest("[role=columnheader]")).toHaveAttribute("aria-sort", "ascending");
        expect(JSON.parse(localStorage.getItem("eh-kader-pool-sort") || "{}")).toEqual({ sort: "attendance", dir: "asc" });
        await userEvent.click(within(table).getByRole("button", { name: t("kader.pool.colSelection") }));
        expect(rowNames(table)).toEqual(["Kael", "Tomas", "Aldric", "Mira", "Brakk", "Liss", "Neuling"]);
    });

    it("sorts the overview by a column head, inside every group", async () => {
        const k = kaderData();
        k.players[U.hand] = { ...k.players[U.hand], state: "selected", wishes: [{ className: "Warrior", spec: "Warrior-Fury" }] };
        vi.mocked(api.getKader).mockResolvedValue(kaderView({ kader: k }));
        await show("/kader/k1/uebersicht");
        const table = screen.getByRole("table", { name: t("kader.overview.tableLabel", { name: "Forever-Kader" }) });
        // grouped by role: melee (Brakk, Neuling), ranged (Liss)
        expect(rowNames(table)).toEqual(["Brakk", "Neuling", "Liss"]);
        await userEvent.click(within(table).getByRole("button", { name: t("kader.overview.colInterview") }));
        // open before held — inside the melee group
        expect(rowNames(table)).toEqual(["Neuling", "Brakk", "Liss"]);
        expect(within(table).getByRole("button", { name: t("kader.overview.colInterview") }).closest("[role=columnheader]")).toHaveAttribute("aria-sort", "ascending");
        await userEvent.click(screen.getByRole("radio", { name: t("kader.overview.byNone") }));
        expect(rowNames(table)).toEqual(["Neuling", "Liss", "Brakk"]);
        // a question column: the voice answers in option order, unanswered last
        await userEvent.click(within(table).getByRole("button", { name: "Im Voice-Chat aktiv?" }));
        expect(rowNames(table)).toEqual(["Liss", "Brakk", "Neuling"]);
    });

    it("sorts the import's member list", async () => {
        await show("/kader/k1/pool");
        await userEvent.click(screen.getByRole("button", { name: t("kader.pool.import") }));
        const dialog = await screen.findByRole("dialog");
        await userEvent.click(within(dialog).getByRole("button", { name: /Raider/ }));
        await userEvent.click(within(dialog).getByRole("button", { name: /Trial/ }));
        const table = within(dialog).getByRole("table", { name: t("kader.import.tableLabel") });
        expect(rowNames(table)).toEqual(["Gast", "Ohne"]);
        await userEvent.click(within(table).getByRole("button", { name: t("kader.import.colDiscord") }));
        expect(rowNames(table)).toEqual(["Ohne", "Gast"]);
        expect(within(table).getByRole("columnheader", { name: t("kader.import.colDiscord") })).toHaveAttribute("aria-sort", "descending");
        // the prefilled character, nothing known last in both directions
        const prefill = within(table).getByRole("button", { name: t("kader.import.colPrefill") });
        await userEvent.click(prefill);
        expect(rowNames(table)).toEqual(["Gast", "Ohne"]);
        await userEvent.click(prefill);
        expect(rowNames(table)).toEqual(["Gast", "Ohne"]);
    });
});

describe("KaderPage · answer colours", () => {
    it("colours the overview: picked days in their day colour, choices as chips, a dot per option in the filter", async () => {
        await show("/kader/k1/uebersicht");
        const table = screen.getByRole("table", { name: t("kader.overview.tableLabel", { name: "Forever-Kader" }) });
        const brakk = within(table).getByText("Brakk").closest("[role=row]") as HTMLElement;
        // Mittwoch and Donnerstag, the rest stays neutral
        expect(Array.from(brakk.querySelectorAll(".kp-week i")).map((i) => i.getAttribute("data-day"))).toEqual(["mo", "di", "mi", "do", "fr", "sa", "so"]);
        expect(Array.from(brakk.querySelectorAll(".kp-week i.on")).map((i) => i.getAttribute("data-day"))).toEqual(["mi", "do"]);
        // the label stays beside the colour
        expect(within(brakk).getByText("Meistens").closest(".kp-ochip")).toHaveAttribute("data-opt", "amber");
        const liss = within(table).getByText("Liss").closest("[role=row]") as HTMLElement;
        expect(within(liss).getByText("Immer").closest(".kp-ochip")).toHaveAttribute("data-opt", "blue");
        await userEvent.click(screen.getByRole("button", { name: /Im Voice-Chat aktiv\?/, expanded: false }));
        const selten = screen.getByRole("menuitemcheckbox", { name: /Selten/ });
        expect(selten.querySelector(".kp-tonedot")).toHaveAttribute("data-opt", "slate");
    });

    it("tints a picked pill in its option's colour and a picked day in its day colour", async () => {
        vi.mocked(api.saveKaderInterview).mockResolvedValue(change());
        await show(`/kader/k1/vorauswahl?spieler=${U.mage}`);
        const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
        const immer = within(panel).getByRole("radio", { name: /Immer/ });
        expect(immer).toHaveAttribute("data-opt", "blue");
        expect(immer).toHaveClass("kp-on");
        expect(within(panel).getByRole("radio", { name: /Selten/ })).toHaveAttribute("data-opt", "slate");
        const wednesday = within(panel).getByRole("button", { name: "Mittwoch" });
        expect(wednesday).toHaveAttribute("data-day", "mi");
        expect(wednesday).not.toHaveClass("kp-on");
        await userEvent.click(wednesday);
        expect(wednesday).toHaveClass("kp-on");
        // free text stays plain
        expect(within(panel).getByRole("textbox", { name: "Anmerkung" })).not.toHaveAttribute("data-opt");
    });

    it("shows the answers in the drawer as coloured chips", async () => {
        const k = kaderData();
        k.players[U.heal].interview = { ...k.players[U.heal].interview, answers: { q1: ["d1", "d5"], q2: "o3", q3: "Kann leiten" } };
        vi.mocked(api.getKader).mockResolvedValue(kaderView({ kader: k }));
        await show(`/kader/k1/roster?spieler=${U.heal}`);
        const drawer = screen.getByRole("complementary", { name: t("kader.decide.drawer", { name: "Mira" }) });
        expect(within(drawer).getByText("Mo").closest(".kp-ochip")).toHaveAttribute("data-day", "mo");
        expect(within(drawer).getByText("Fr").closest(".kp-ochip")).toHaveAttribute("data-day", "fr");
        expect(within(drawer).getByText("Selten").closest(".kp-ochip")).toHaveAttribute("data-opt", "slate");
        expect(within(drawer).getByText("Kann leiten").closest(".kp-ochip")).toBeNull();
    });

    it("lets the lead change an option's colour in the editor and saves it with the question", async () => {
        vi.mocked(api.updateKaderQuestion).mockResolvedValue(change());
        const first = await show("/kader/k1/fragen?frage=q2");
        const editor = screen.getByRole("region", { name: t("kader.questions.editor") });
        const name = t("kader.questions.optionColor", { label: "Immer", color: t("kader.color.blue") });
        await userEvent.click(within(editor).getByRole("button", { name }));
        const palette = await screen.findByRole("radiogroup", { name });
        expect(within(palette).getAllByRole("radio")).toHaveLength(8);
        expect(within(palette).getByRole("radio", { name: t("kader.color.blue") })).toHaveAttribute("aria-checked", "true");
        await userEvent.click(within(palette).getByRole("radio", { name: t("kader.color.teal") }));
        // the preview follows
        expect(editor.querySelector(".kp-preview .kp-pill")).toHaveAttribute("data-opt", "teal");
        await userEvent.click(within(editor).getByRole("button", { name: t("common.save") }));
        expect(api.updateKaderQuestion).toHaveBeenCalledWith("k1", "q2", {
            text: "Im Voice-Chat aktiv?", type: "single", required: false,
            options: [{ id: "o1", label: "Immer", color: "teal" }, { id: "o2", label: "Meistens", color: "amber" }, { id: "o3", label: "Selten", color: "slate" }],
        }, { baseRev: 0 });
        first.unmount();
        // weekdays keep their day colours: no swatches
        renderPage(<KaderPage />, { route: "/kader/k1/fragen?frage=q1", path: PATH });
        await screen.findByRole("button", { name: /Forever-Kader/ });
        const days = screen.getByRole("region", { name: t("kader.questions.editor") });
        expect(days.querySelectorAll(".kp-swatchbtn")).toHaveLength(0);
        expect(days.querySelectorAll(".kp-tonedot-fixed")).toHaveLength(7);
        expect(within(days).getByText(t("kader.questions.colorHintDays"))).toBeInTheDocument();
    });
});

describe("KaderPage · back buttons", () => {
    it("draws every step back as the same coloured button with an arrow", async () => {
        vi.mocked(api.setKaderState).mockResolvedValue(change());
        const first = await show(`/kader/k1/vorauswahl?spieler=${U.mage}`);
        const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
        const toPool = within(panel).getByRole("button", { name: t("kader.interview.toPool") });
        expect(toPool).toHaveClass("btn", "btn-ghost", "kp-backbtn");
        expect(toPool.querySelector("svg")).not.toBeNull();
        await userEvent.click(toPool);
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.mage], "pool");
        first.unmount();

        const second = renderPage(<KaderPage />, { route: `/kader/k1/roster?spieler=${U.heal}`, path: PATH });
        await screen.findByRole("button", { name: /Forever-Kader/ });
        const drawer = screen.getByRole("complementary", { name: t("kader.decide.drawer", { name: "Mira" }) });
        expect(within(drawer).getByRole("button", { name: t("kader.decide.back.selected") })).toHaveClass("kp-backbtn", "kp-wide");
        expect(within(drawer).getByRole("button", { name: t("kader.decide.takeBack") })).toHaveClass("kp-backbtn", "btn-sm");
        second.unmount();

        renderPage(<KaderPage />, { route: "/kader/k1/fragen", path: PATH });
        await screen.findByRole("button", { name: /Forever-Kader/ });
        const back = screen.getByRole("link", { name: t("kader.questions.back") });
        expect(back).toHaveClass("kp-backbtn");
        expect(back).toHaveAttribute("href", "/kader/k1/vorauswahl");
    });
});

describe("KaderPage · Fragen", () => {
    it("adds a question with its options", async () => {
        vi.mocked(api.addKaderQuestion).mockResolvedValue({ ...change(), questionId: "q9" });
        await show("/kader/k1/fragen");
        expect(screen.getByText(t("kader.questions.own", { n: 3 }))).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: t("kader.questions.add") }));
        const editor = screen.getByRole("region", { name: t("kader.questions.editor") });
        await userEvent.type(within(editor).getByPlaceholderText(t("kader.questions.textPlaceholder")), "Erfahrung");
        await userEvent.type(within(editor).getByRole("textbox", { name: t("kader.questions.optionN", { n: 1 }) }), "Neu");
        await userEvent.type(within(editor).getByRole("textbox", { name: t("kader.questions.optionN", { n: 2 }) }), "Viel");
        await userEvent.click(within(editor).getByRole("button", { name: t("kader.questions.create") }));
        expect(api.addKaderQuestion).toHaveBeenCalledWith("k1", { text: "Erfahrung", type: "single", required: false, options: [{ label: "Neu", color: "blue" }, { label: "Viel", color: "amber" }] });
    });

    it("says how many answers go with a deleted question", async () => {
        vi.mocked(api.deleteKaderQuestion).mockResolvedValue(change());
        await show("/kader/k1/fragen?frage=q2");
        await userEvent.click(screen.getByRole("button", { name: t("kader.questions.delete") }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(t("kader.questions.deleteText", { n: 2 }))).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: t("common.delete") }));
        expect(api.deleteKaderQuestion).toHaveBeenCalledWith("k1", "q2");
    });
});

describe("KaderPage · Beispiel-Setups", () => {
    it("offers the sizes of the version's instances, a 40er included (#751)", async () => {
        vi.mocked(api.saveKaderVariant).mockResolvedValue(change());
        await show("/kader/k1/setups");
        for (const n of [10, 20, 40]) expect(screen.getByRole("button", { name: t("kader.setups.sizeN", { n }) })).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: t("kader.setups.sizeN", { n: 40 }) }));
        expect(api.saveKaderVariant).toHaveBeenCalledWith("k1", "v1", { size: 40 });
    });

    it("switches the size and places a picked player on a free slot", async () => {
        vi.mocked(api.saveKaderVariant).mockResolvedValue(change());
        await show("/kader/k1/setups");
        expect(screen.getAllByRole("heading", { name: /^Gruppe \d$/ })).toHaveLength(4);
        await userEvent.click(screen.getByRole("button", { name: t("kader.setups.sizeN", { n: 10 }) }));
        expect(api.saveKaderVariant).toHaveBeenCalledWith("k1", "v1", { size: 10 });
        // Mira (Vorläufig) has no group yet: pick her, then the second slot of group 1
        await userEvent.click(screen.getByRole("button", { name: /Mira/ }));
        await userEvent.click(screen.getByRole("button", { name: t("kader.setups.freeSlot", { group: 1, n: 2 }) }));
        const groups = vi.mocked(api.saveKaderVariant).mock.calls.at(-1)?.[2].groups;
        expect(groups?.[0][1]).toEqual({ userId: U.heal, spec: "Shaman-Restoration" });
    });
});

describe("KaderPage · spec picker in the setups", () => {
    it("picks a slot's spec from the player's wishes, with rank, icon and class", async () => {
        const k = kaderData();
        k.setups[0].groups[0][1] = { userId: U.heal, spec: "Shaman-Restoration" };
        vi.mocked(api.getKader).mockResolvedValue(kaderView({ kader: k }));
        vi.mocked(api.saveKaderVariant).mockResolvedValue(change(k));
        await show("/kader/k1/setups");
        await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${t("kader.setups.specOf", { name: "Mira" })}`) }));
        const menu = await screen.findByRole("menu", { name: t("kader.setups.specOf", { name: "Mira" }) });
        const [first, second] = within(menu).getAllByRole("menuitemradio");
        expect(first).toHaveAttribute("aria-checked", "true");
        expect(within(second).getByText("Schamane")).toHaveAttribute("data-tip", "Schamane · Verstärkung");
        await userEvent.click(second);
        const groups = vi.mocked(api.saveKaderVariant).mock.calls.at(-1)?.[2].groups;
        expect(groups?.[0][1]).toEqual({ userId: U.heal, spec: "Shaman-Enhancement" });
    });
});

describe("KaderPage · moving back", () => {
    const TAKEOVER = { rosterId: "r9", roleId: "role1", roleName: "Raider", categoryId: "c1", channelIds: [], by: ME, at: "2026-10-01T18:00:00.000Z", status: "done" as const, results: {} };
    const drawerOf = (name: string) => screen.getByRole("complementary", { name: t("kader.decide.drawer", { name }) });
    const stage = (state: "pool" | "selected", count: number) => screen.getByRole("link", { name: t(`kader.nav.count.${state}`, { count }) });
    const drag = (userId: string) => ({ dataTransfer: { types: [DRAG_TYPE], dropEffect: "", getData: () => userId } });
    const dropOn = (target: HTMLElement, userId: string) => {
        fireEvent.dragOver(target, drag(userId));
        fireEvent.drop(target, drag(userId));
    };
    const withKader = (k: KaderData) => {
        vi.mocked(api.getKader).mockResolvedValue(kaderView({ kader: k }));
        vi.mocked(api.setKaderState).mockResolvedValue(change(k));
    };
    const backLabels = (drawer: HTMLElement) => {
        const labels = ["provisional", "selected", "pool"].map((to) => t(`kader.decide.back.${to}`));
        return within(drawer).getAllByRole("button").map((b) => b.textContent || "").filter((text) => labels.includes(text));
    };

    it("offers every state before the current one in the drawer, the nearest first", async () => {
        withKader(kaderData());
        await show(`/kader/k1/roster?spieler=${U.tank}`);
        expect(backLabels(drawerOf("Aldric"))).toEqual([t("kader.decide.back.provisional"), t("kader.decide.back.selected"), t("kader.decide.back.pool")]);
        await userEvent.click(within(drawerOf("Aldric")).getByRole("button", { name: t("kader.decide.back.pool") }));
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.tank], "pool", undefined);
    });

    it("offers a provisional player only Vorauswahl and Pool", async () => {
        withKader(kaderData());
        await show(`/kader/k1/roster?spieler=${U.heal}`);
        expect(backLabels(drawerOf("Mira"))).toEqual([t("kader.decide.back.selected"), t("kader.decide.back.pool")]);
    });

    it("takes a card dropped on Pool or Vorauswahl in the status bar, without asking", async () => {
        withKader(kaderData());
        await show("/kader/k1/roster");
        fireEvent.dragOver(stage("pool", 1), drag(U.tank));
        expect(stage("pool", 1)).toHaveClass("kp-over");
        fireEvent.drop(stage("pool", 1), drag(U.tank));
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.tank], "pool", undefined);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(await screen.findByText(t("kader.decide.moved", { name: "Aldric", state: t("kader.state.pool") }))).toBeInTheDocument();
        dropOn(stage("selected", 2), U.heal);
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.heal], "selected", undefined);
    });

    it("takes no drop off the decision page, nor from a reader, nor on the player's own state", async () => {
        withKader(kaderData());
        const view = await show("/kader/k1/pool");
        fireEvent.dragOver(stage("pool", 1), drag(U.tank));
        expect(stage("pool", 1)).not.toHaveClass("kp-over");
        fireEvent.drop(stage("pool", 1), drag(U.tank));
        view.unmount();
        const readerView = await show("/kader/k1/roster", reader);
        dropOn(stage("pool", 1), U.tank);
        readerView.unmount();
        await show("/kader/k1/roster");
        dropOn(stage("pool", 1), U.hand);
        expect(api.setKaderState).not.toHaveBeenCalled();
    });

    it("asks before a move takes the Discord role away, and only then", async () => {
        withKader(kaderData({ takeover: TAKEOVER }));
        await show("/kader/k1/roster");
        // cancelled: nothing happens
        dropOn(stage("pool", 1), U.tank);
        const asked = await screen.findByRole("dialog");
        expect(asked).toHaveTextContent(t("kader.decide.roleLoss.title", { name: "Aldric", state: t("kader.state.pool") }));
        expect(asked).toHaveTextContent("Raider");
        await userEvent.click(within(asked).getByRole("button", { name: t("common.cancel") }));
        expect(api.setKaderState).not.toHaveBeenCalled();
        // confirmed: moved
        dropOn(stage("pool", 1), U.tank);
        const again = await screen.findByRole("dialog");
        await userEvent.click(within(again).getByRole("button", { name: t("kader.decide.roleLoss.action") }));
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.tank], "pool", undefined);
        // a player who holds no role moves without a question
        dropOn(stage("pool", 1), U.mage);
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.mage], "pool", undefined);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("knows which moves cost the role", () => {
        expect(losesRole(TAKEOVER, { state: "roster" }, "pool")).toBe(true);
        expect(losesRole(TAKEOVER, { state: "provisional" }, "selected")).toBe(true);
        expect(losesRole(TAKEOVER, { state: "roster" }, "provisional")).toBe(false);
        expect(losesRole(TAKEOVER, { state: "selected" }, "pool")).toBe(false);
        expect(losesRole(null, { state: "roster" }, "pool")).toBe(false);
    });
});

describe("KaderPage · read-only and English", () => {
    it("lets a read-only grant look at everything but change nothing", async () => {
        await show("/kader/k1/pool", reader);
        expect(screen.queryByRole("button", { name: t("kader.pool.import") })).toBeNull();
        // the attendance's categories as plain text, no menu
        expect(screen.getByText("Mo Raid, Do Raid")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("kader.att.fromChange", { cats: "Mo Raid, Do Raid" }) })).toBeNull();
        expect(screen.getByRole("switch", { name: t("kader.pool.toSelection", { name: "Neuling" }) })).toBeDisabled();
        expect(screen.queryByRole("button", { name: t("kader.header.settings") })).toBeNull();
    });

    it("keeps a read-only interview and drawer free of controls", async () => {
        const view = renderPage(<KaderPage />, { route: `/kader/k1/vorauswahl?spieler=${U.mage}`, path: PATH, user: reader });
        await screen.findByRole("button", { name: /Forever-Kader/ });
        expect(screen.queryByRole("button", { name: t("kader.interview.complete") })).toBeNull();
        expect(screen.getByRole("button", { name: "Mittwoch" })).toBeDisabled();
        view.unmount();
        renderPage(<KaderPage />, { route: `/kader/k1/roster?spieler=${U.heal}`, path: PATH, user: reader });
        await screen.findByRole("button", { name: /Forever-Kader/ });
        expect(screen.queryByRole("radio", { name: t("kader.vote.yesAction") })).toBeNull();
        expect(screen.queryByRole("textbox", { name: t("kader.decide.comment") })).toBeNull();
    });

    it("speaks English", async () => {
        await switchLang("en");
        try {
            await show("/kader/k1/vorauswahl");
            expect(screen.getByRole("link", { name: "Interviews" })).toBeInTheDocument();
            expect(screen.getByRole("heading", { name: "Preselection" })).toBeInTheDocument();
            expect(screen.getByRole("radio", { name: "Done 1" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Complete interview" })).toBeInTheDocument();
        } finally {
            await switchLang("de");
        }
    });
});

describe("KaderPage · saving a character keeps the page", () => {
    async function saveFirstName() {
        await show("/kader/k1/pool");
        await userEvent.click(screen.getByRole("button", { name: "Aldric" }));
        const dialog = await screen.findByRole("dialog");
        const first = within(dialog).getByLabelText(t("kader.field.firstName"));
        await userEvent.type(first, "x");
        await userEvent.click(within(dialog).getByRole("button", { name: t("common.apply") }));
    }

    it("sends the open Kader with the save", async () => {
        vi.mocked(api.saveKaderAssignment).mockResolvedValue(kaderView());
        await saveFirstName();
        await waitFor(() => expect(api.saveKaderAssignment).toHaveBeenCalled());
        expect(vi.mocked(api.saveKaderAssignment).mock.calls[0][0]).toBe("k1");
    });

    it("does not go blank when the answer is a whole view without the Kader", async () => {
        vi.mocked(api.saveKaderAssignment).mockResolvedValue(kaderView({ kader: null }));
        await saveFirstName();
        await waitFor(() => expect(api.saveKaderAssignment).toHaveBeenCalled());
        expect(await screen.findByRole("button", { name: /Forever-Kader/ })).toBeInTheDocument();
        await waitFor(() => expect(vi.mocked(api.getKader).mock.calls.length).toBeGreaterThan(1));
    });
});

describe("KaderPage · assigning from the profile", () => {
    it("offers every profile character with version and main, marks the ones already in, and fills the picked one", async () => {
        const base = kaderView();
        const players = base.players.map((p) => (p.userId === U.tank ? {
            ...p,
            pickable: [
                { key: "forever~aldric sturmwind", name: "Aldric Sturmwind", className: "Warrior", versionId: "forever", canTank: true, canHeal: false, specs: [{ spec: "Warrior-Protection", main: true, gear: "ready" as const }], source: "profile" as const },
                { key: "tbc~brakk", name: "Brakk", className: "Warrior", versionId: "tbc", canTank: false, canHeal: false, specs: [{ spec: "Warrior-Fury", main: true, gear: "usable" as const }], source: "profile" as const },
            ],
        } : p));
        vi.mocked(api.getKader).mockResolvedValue({ ...base, players });
        vi.mocked(api.saveKaderAssignment).mockResolvedValue({ ...base, players });
        await show("/kader/k1/pool");
        await userEvent.click(screen.getByRole("button", { name: "Aldric" }));
        const dialog = await screen.findByRole("dialog");
        const group = within(dialog).getByRole("group", { name: t("kader.account.pickTitle") });
        expect(within(group).getByRole("button", { name: "Aldric Sturmwind" })).toBeDisabled();
        // no "Main" badge — the profile only has an order
        expect(within(group).queryByText("Main")).not.toBeInTheDocument();
        expect(within(group).getByText("Forever")).toBeInTheDocument();
        expect(within(group).getByText("TBC")).toBeInTheDocument();
        await userEvent.click(within(group).getByRole("button", { name: "Brakk" }));
        expect(within(group).getByRole("button", { name: "Brakk" })).toBeDisabled();
        await userEvent.click(within(dialog).getByRole("button", { name: t("common.apply") }));
        await waitFor(() => expect(api.saveKaderAssignment).toHaveBeenCalled());
        const sent = vi.mocked(api.saveKaderAssignment).mock.calls[0][2];
        expect(sent[1]).toMatchObject({ name: "Brakk", nameStyle: "nick", className: "Warrior", onlineKey: "tbc~brakk", specs: [{ spec: "Warrior-Fury", main: true, gear: "usable" }] });
    });
});

describe("KaderPage · removing a character in the account dialog", () => {
    it("asks first, then drops the character from the draft", async () => {
        await show("/kader/k1/pool");
        await userEvent.click(screen.getByRole("button", { name: "Aldric" }));
        const dialog = await screen.findByRole("dialog");
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.account.removeChar") }));
        const dialogs = await screen.findAllByRole("dialog");
        const confirm = dialogs[dialogs.length - 1];
        expect(within(confirm).getByText(t("kader.account.removeCharText"))).toBeInTheDocument();
        await userEvent.click(within(confirm).getByRole("button", { name: t("common.remove") }));
        await waitFor(() => expect(within(dialog).queryByRole("tab", { name: /Aldric Sturmwind/ })).toBeNull());
    });
});

// One game version at a time (#741): the picker lists the Kader of the menu's version.
describe("KaderPage per game version", () => {
    it("asks for the Kader of the shown version and creates a new one in it", async () => {
        localStorage.setItem("eh-content-version", "forever");
        vi.mocked(api.getKader).mockResolvedValue(kaderView({ kaders: [], kader: null }));
        vi.mocked(api.createKader).mockResolvedValue({ ...change(), kaderId: "k1" });
        renderPage(<KaderPage />, { route: "/kader", path: PATH, content: twoVersions() });
        await screen.findByRole("heading", { name: t("kader.start.title") });
        expect(api.getKader).toHaveBeenLastCalledWith("", "forever");
        await userEvent.click(screen.getByRole("button", { name: t("kader.start.create") }));
        const dialog = await screen.findByRole("dialog");
        await userEvent.type(within(dialog).getByRole("textbox"), "Forever-Kader 2027");
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.settings.create") }));
        expect(api.createKader).toHaveBeenCalledWith("Forever-Kader 2027", "forever");
    });

    it("switches the TBC view to the version of a linked Forever Kader and says so", async () => {
        vi.mocked(api.getKader).mockImplementation(async () => kaderView({ kader: { ...kaderData(), versionId: "forever" } }));
        renderPage(<KaderPage />, { route: "/kader/k1/pool", path: PATH, content: twoVersions() });
        expect(await screen.findByText(t("shell.followVersion.switched", { version: "Forever" }))).toBeInTheDocument();
        const segment = screen.getAllByRole("radiogroup", { name: t(CONTENT_ARIA) })[0];
        await waitFor(() => expect(within(segment).getByRole("radio", { checked: true })).toHaveAccessibleName("Forever"));
        await waitFor(() => expect(api.getKader).toHaveBeenLastCalledWith("k1", "forever"));
    });
});
