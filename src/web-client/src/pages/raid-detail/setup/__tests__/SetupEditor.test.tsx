// The setup editor of an own event (#263) as the orga uses it: group cards and
// the bench as targets (drag or pick-and-target), the ONE toolbar line (state,
// counts, "Mehr", "Alle bestätigen", one primary button), the raid size and the
// ping text behind "Mehr", the compact view, the summary line and its details,
// approving, posting and pinging, the "nicht zusammen" question. The API is
// mocked at its transport (api/client), so every test also pins the request
// that is sent. The raider drawer, "Suche" and the extra roles: SetupEditor.panel.test.tsx.
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../../../api/client";
import type { SetupEditorData, SetupPlacementInput } from "../../../../api";
import { t } from "../../../../i18n";
import { renderPage } from "../../../../test/render";
import { EVENT_ID, MAGE, PRIEST, ROGUE, TANK, editorData, person, setupCtx } from "../../../../test/fixtures/setupEditor";
import SetupEditor from "../SetupEditor";

vi.mock("../../../../api/client", async (orig) => ({ ...(await orig<typeof import("../../../../api/client")>()), get: vi.fn(), send: vi.fn() }));

let page: SetupEditorData;

beforeEach(() => {
    page = editorData();
    vi.mocked(client.get).mockImplementation((path: string) => (path.startsWith("/api/raids/setup?")
        ? Promise.resolve(page)
        : Promise.reject({ code: "not_mocked", message: path })));
    // a save answers with the lineup it was sent, one version further
    vi.mocked(client.send).mockImplementation((_method: string, path: string) => (path === "/api/raids/setup/ping-text"
        ? Promise.resolve({ ...page, pingText: "neu" })
        : Promise.resolve({ ...page, setup: page.setup && { ...page.setup, version: page.setup.version + 1 } })));
});

async function show(data: SetupEditorData = page) {
    page = data;
    const view = renderPage(<SetupEditor ctx={setupCtx()} />);
    await screen.findByRole("region", { name: t("setup.group.title", { index: 1 }) });
    return view;
}

const group = (index: number) => screen.getByRole("region", { name: t("setup.group.title", { index }) });

/** The raider panel in the side drawer a click opens (SlotTip). */
const panel = () => screen.getByRole("complementary", { name: t("setup.person.tip.aria") });
const noPanel = () => expect(screen.queryByRole("complementary", { name: t("setup.person.tip.aria") })).not.toBeInTheDocument();

/** An entry of "Mehr ▾": opens the menu and finds it (a switch is a menuitemcheckbox). */
async function moreItem(user: ReturnType<typeof userEvent.setup>, name: string, role: "menuitem" | "menuitemcheckbox" = "menuitem") {
    await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
    return screen.getByRole(role, { name: new RegExp(name) });
}

/** An icon toggle of what posting sends along, beside the primary button (its name is "label: an|aus"). */
function postOption(name: string) {
    const group = screen.getByRole("group", { name: t("setup.postOptions.aria") });
    return within(group).getByRole("button", { name: new RegExp(`^${name}: `) });
}

/** The details of the summary line: role tiles, buffs and the switches (Summary). */
async function openDetails(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: t("setup.line.details") }));
    return screen.getByRole("complementary", { name: t("setup.summary.aria") });
}

/** A raider's line: the element that is picked, dragged and dropped on. */
function slot(character: string): HTMLElement {
    // the raider panel repeats the name of the raider touched last; the line is the one with data-user
    const el = screen.getAllByText(character).map((e) => e.closest<HTMLElement>("[data-user]")).find(Boolean);
    if (!el) throw new Error(`no slot for ${character}`);
    return el;
}

/** The calls of one request, by method and path. */
function calls(method: string, path: string) {
    return vi.mocked(client.send).mock.calls.filter(([m, p]) => m === method && p === path);
}

/** Every request but the editor's heartbeat (setupPresence), which runs on its own. */
const writes = () => vi.mocked(client.send).mock.calls.filter(([, p]) => p !== "/api/raids/setup/presence");

/** The body of the one save request (PUT /api/raids/setup). */
function savedBody(): SetupPlacementInput & { event: string } {
    const put = calls("PUT", "/api/raids/setup");
    expect(put).toHaveLength(1);
    return put[0][2] as SetupPlacementInput & { event: string };
}

const groupOf = (body: SetupPlacementInput, userId: string) => body.groups.find((g) => g.slots.some((s) => s.userId === userId))?.index;

// #517: the groups, the orga's bench and "Angemeldet" (signed up, in neither)
describe("the setup editor: bench and pool \"Angemeldet\" (#517)", () => {
    const WARLOCK = person("u-lock", "Fluch", { classId: "warlock", spec: "warlock-destruction", status: "bench" });

    it("draws three areas, marks a bench signup in the pool and gives it no lock", async () => {
        await show(editorData({}, { pool: [WARLOCK] }));
        expect(screen.getByRole("region", { name: t("setup.bench.aria") })).toBeInTheDocument();
        const pool = screen.getByRole("region", { name: t("setup.pool.aria") });
        expect(within(pool).getByText("Fluch")).toBeInTheDocument();
        // the bench signup is a labelled square field on the card, not a dot
        expect(within(slot("Fluch")).getByText(t("signups.status.bench")).closest(".se-sig")).toHaveClass("se-sigv-bench");
        // fixing is the drawer's: a pool raider has nothing to fix, a bench raider has
        const user = userEvent.setup();
        await user.click(slot("Fluch"));
        expect(within(panel()).queryByRole("button", { name: new RegExp(t("setup.slot.lock")) })).not.toBeInTheDocument();
        await user.keyboard("{Escape}");
        await user.click(slot("Schatten"));
        expect(within(panel()).getByRole("button", { name: new RegExp(t("setup.slot.lock")) })).toBeInTheDocument();
    });

    it("brings somebody from the pool into a group and onto the bench", async () => {
        await show(editorData({}, { pool: [WARLOCK] }));
        fireEvent.drop(group(2), { dataTransfer: { getData: () => WARLOCK.userId } });
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(groupOf(savedBody(), WARLOCK.userId)).toBe(2);
    });

    it("takes a raider out of the setup by dropping them on \"Angemeldet\"", async () => {
        await show(editorData({}, { pool: [WARLOCK] }));
        fireEvent.drop(screen.getByRole("region", { name: t("setup.pool.aria") }), { dataTransfer: { getData: () => MAGE.userId } });
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        const body = savedBody();
        expect(groupOf(body, MAGE.userId)).toBeUndefined();
        expect(body.bench.map((b) => b.userId)).toEqual([ROGUE.userId]);
        expect(body).not.toHaveProperty("pool");
    });

    const line = (userId: string) => document.querySelector<HTMLElement>(`.se-slot[data-user="${userId}"]`)!;

    it("takes a raider out of the raid with a double click on their line in a group", async () => {
        const user = userEvent.setup();
        await show(editorData({}, { pool: [WARLOCK] }));
        await user.dblClick(line(MAGE.userId));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        const body = savedBody();
        expect(groupOf(body, MAGE.userId)).toBeUndefined();
        expect(body.bench.map((b) => b.userId)).toEqual([ROGUE.userId]);
        // nothing stays picked: the next click is no swap
        expect(screen.queryByText(t("setup.editor.pickTarget"))).not.toBeInTheDocument();
    });

    it("takes a raider off the bench with a double click, and does nothing on a double click in \"Angemeldet\"", async () => {
        const user = userEvent.setup();
        await show(editorData({}, { pool: [WARLOCK] }));
        await user.dblClick(line(WARLOCK.userId));
        expect(calls("PUT", "/api/raids/setup")).toHaveLength(0);
        await user.dblClick(line(ROGUE.userId));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(savedBody().bench).toEqual([]);
    });

    it("lays \"Angemeldet\" under the setup, never beside it — the groups keep their width", async () => {
        await show(editorData({}, { pool: [WARLOCK] }));
        const bench = screen.getByRole("region", { name: t("setup.bench.aria") });
        const pool = screen.getByRole("region", { name: t("setup.pool.aria") });
        expect(bench.compareDocumentPosition(pool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(document.querySelector(".se-with-pool")).toBeNull();
    });
});

// a phone: while a raider is picked the sheet is one slim line, so the places to tap stay in view
describe("the setup editor: the pick line of the raider sheet", () => {
    it("says who is picked and opens the details on demand, closed again at the next pick", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(slot("Ignis"));
        const sheet = document.querySelector(".se-drawer")!;
        expect(sheet).toHaveClass("se-drawer-picking");
        expect(within(sheet as HTMLElement).getByText(t("setup.drawer.picked", { name: "Ignis" }))).toBeInTheDocument();
        await user.click(within(sheet as HTMLElement).getByRole("button", { name: t("setup.drawer.details") }));
        expect(sheet).toHaveClass("se-drawer-open");
        expect(within(sheet as HTMLElement).getByRole("button", { name: t("setup.drawer.less") })).toHaveAttribute("aria-expanded", "true");
        // the pick done (here: dropped again), the sheet is the plain drawer
        await user.click(slot("Ignis"));
        await user.click(slot("Ignis"));
        expect(document.querySelector(".se-drawer")).not.toHaveClass("se-drawer-open");
    });

    it("drops the pick with \"Abbrechen\" on the pick line", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(slot("Ignis"));
        const sheet = document.querySelector<HTMLElement>(".se-drawer")!;
        expect(sheet).toHaveClass("se-drawer-picking");
        await user.click(within(sheet).getByRole("button", { name: t("common.cancel") }));
        // the sheet closes with the pick (it leaves the page) and nothing is saved
        expect(document.querySelector(".se-drawer-picking")).toBeNull();
        expect(slot("Ignis")).not.toHaveClass("se-picked");
        expect(calls("PUT", "/api/raids/setup")).toHaveLength(0);
    });
});

// No proposal needed: the editor opens on empty groups with everybody under "Angemeldet"
describe("the setup editor: the empty start and filling", () => {
    const BLANK = { groups: [], bench: [], pool: [TANK, MAGE, PRIEST, ROGUE], version: 0, origin: "manual" as const, blank: true };

    it("opens on empty groups with every signup under \"Angemeldet\", by role — no proposal first", async () => {
        await show(editorData({}, BLANK));
        expect(screen.queryByText(t("setup.editor.noSetup"))).not.toBeInTheDocument();
        for (const i of [1, 2, 3, 4, 5]) expect(within(group(i)).queryAllByRole("button")).toHaveLength(0);
        const pool = screen.getByRole("region", { name: t("setup.pool.aria") });
        const heads = [...pool.querySelectorAll(".se-pp-col-head")].map((h) => h.firstChild?.textContent?.trim());
        expect(heads).toEqual(["tank", "healer", "melee", "ranged"].map((role) => t(`setup.poolPanel.sections.${role}`)));
        expect(within(pool).getByText("Bruno")).toBeInTheDocument();
        // nothing to post while nobody stands in a group
        expect(screen.getByRole("button", { name: t("setup.editor.approve") })).toBeDisabled();
    });

    it("saves the first drag from \"Angemeldet\" on the empty start with version 0", async () => {
        await show(editorData({}, BLANK));
        fireEvent.drop(group(3), { dataTransfer: { getData: () => PRIEST.userId } });
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        const body = savedBody() as SetupPlacementInput & { version?: number };
        expect(groupOf(body, PRIEST.userId)).toBe(3);
        expect(body.version).toBe(0);
    });

    it("fills an empty setup at once with \"Automatisch füllen\" — no question", async () => {
        const user = userEvent.setup();
        await show(editorData({}, BLANK));
        await user.click(await moreItem(user, t("setup.fill.auto")));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/propose")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/propose")[0][2]).toEqual({ event: EVENT_ID });
    });

    it("asks once somebody stands: only the free places by default, or everything anew", async () => {
        const user = userEvent.setup();
        await show(editorData({}, { pool: [person("u-x", "Xara")] }));
        await user.click(await moreItem(user, t("setup.fill.free")));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByRole("radio", { name: new RegExp(t("setup.fill.keepTitle")) })).toHaveAttribute("aria-checked", "true");
        await user.click(within(dialog).getByRole("button", { name: t("setup.fill.go") }));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/propose")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/propose")[0][2]).toEqual({ event: EVENT_ID, keep: "placed" });

        await user.click(await moreItem(user, t("setup.fill.free")));
        const again = screen.getByRole("dialog");
        await user.click(within(again).getByRole("radio", { name: new RegExp(t("setup.fill.anewTitle")) }));
        await user.click(within(again).getByRole("button", { name: t("setup.fill.go") }));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/propose")).toHaveLength(2));
        expect(calls("POST", "/api/raids/setup/propose")[1][2]).toEqual({ event: EVENT_ID });
    });

    it("offers no filling once nobody is left under \"Angemeldet\"", async () => {
        const user = userEvent.setup();
        await show(editorData({}, { pool: [] }));
        await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
        expect(screen.queryByRole("menuitem", { name: new RegExp(t("setup.fill.free")) })).not.toBeInTheDocument();
        expect(screen.queryByRole("menuitem", { name: new RegExp(t("setup.fill.auto")) })).not.toBeInTheDocument();
        await user.keyboard("{Escape}");
        expect(within(screen.getByRole("region", { name: t("setup.pool.aria") })).getByText(t("setup.pool.empty"))).toBeInTheDocument();
    });

    it("finds raiders in \"Angemeldet\" by name or spec", async () => {
        const user = userEvent.setup();
        await show(editorData({ absent: 2 }, BLANK));
        const pool = screen.getByRole("region", { name: t("setup.pool.aria") });
        await user.type(within(pool).getByRole("searchbox", { name: t("setup.poolPanel.search") }), "heil");
        expect(within(pool).getByText("Lumen")).toBeInTheDocument();
        expect(within(pool).queryByText("Bruno")).not.toBeInTheDocument();
        await user.clear(within(pool).getByRole("searchbox", { name: t("setup.poolPanel.search") }));
        expect(within(pool).getByText("Bruno")).toBeInTheDocument();
        expect(within(pool).getByText(t("setup.poolPanel.absent", { count: 2 }))).toBeInTheDocument();
    });

    it("counts each role column in its head and shows an empty column as a dash", async () => {
        await show(editorData({}, { ...BLANK, pool: [TANK, PRIEST] }));
        const pool = screen.getByRole("region", { name: t("setup.pool.aria") });
        const col = (role: string) => within(pool).getByRole("group", { name: t(`setup.poolPanel.sections.${role}`) });
        expect(col("tank").querySelector(".se-pp-col-head b")).toHaveTextContent("1");
        expect(col("healer").querySelector(".se-pp-col-head b")).toHaveTextContent("1");
        expect(col("melee").querySelector(".se-pp-col-empty")).toHaveTextContent("\u2013");
        expect(col("ranged").querySelector(".se-pp-col-empty")).toHaveAttribute("aria-label", t("setup.poolPanel.emptyCol"));
    });

    it("names the signed-off raiders only on demand, never as lines to place", async () => {
        const user = userEvent.setup();
        await show(editorData({ absent: 2, absentNames: ["Weg", "Fort"] }, BLANK));
        const pool = screen.getByRole("region", { name: t("setup.pool.aria") });
        expect(within(pool).getByText(t("setup.poolPanel.absent", { count: 2 }))).toBeInTheDocument();
        expect(within(pool).queryByText(/Weg/)).not.toBeInTheDocument();
        const btn = within(pool).getByRole("button", { name: t("setup.poolPanel.showAbsent") });
        expect(btn).toHaveAttribute("aria-expanded", "false");
        await user.click(btn);
        expect(within(pool).getByText("Weg, Fort")).toBeInTheDocument();
        expect(pool.querySelector('.se-slot[data-character="Weg"]')).toBeNull();
        await user.click(within(pool).getByRole("button", { name: t("setup.poolPanel.hideAbsent") }));
        expect(within(pool).queryByText("Weg, Fort")).not.toBeInTheDocument();
    });

    it("has role tabs for the phone sheet, the chosen one marked on its column", async () => {
        const user = userEvent.setup();
        await show(editorData({}, BLANK));
        const pool = screen.getByRole("region", { name: t("setup.pool.aria") });
        const tabs = within(pool).getByRole("tablist", { name: t("setup.poolPanel.tabs") });
        const tab = (role: string) => within(tabs).getByRole("tab", { name: new RegExp(t(`setup.poolPanel.sections.${role}`)) });
        expect(tab("tank")).toHaveAttribute("aria-selected", "true");
        expect(tab("healer")).toHaveTextContent("1");
        await user.click(tab("healer"));
        expect(tab("healer")).toHaveAttribute("aria-selected", "true");
        expect(tab("tank")).toHaveAttribute("aria-selected", "false");
        expect(within(pool).getByRole("group", { name: t("setup.poolPanel.sections.healer") })).toHaveClass("se-tab");
        expect(within(pool).getByRole("group", { name: t("setup.poolPanel.sections.tank") })).not.toHaveClass("se-tab");
    });

    it("shows \"Angemeldet\" as a sidebar by a switch under \"Aktionen\", remembered in the browser", async () => {
        const KEY = "eh-setup-pool-sidebar";
        localStorage.removeItem(KEY);
        try {
            const user = userEvent.setup();
            const view = await show(editorData({}, BLANK));
            const pool = () => screen.getByRole("region", { name: t("setup.pool.aria") });
            expect(pool()).not.toHaveClass("se-pp-side");
            expect(document.querySelector(".se-layout")).not.toHaveClass("se-pool-side");
            const toggle = await moreItem(user, t("setup.more.poolSide"), "menuitemcheckbox");
            expect(toggle).toHaveAttribute("aria-checked", "false");
            await user.click(toggle);
            expect(pool()).toHaveClass("se-pp-side");
            expect(document.querySelector(".se-layout")).toHaveClass("se-pool-side");
            expect(localStorage.getItem(KEY)).toBe("1");
            view.unmount();
            await show(editorData({}, BLANK));
            expect(pool()).toHaveClass("se-pp-side");
            await user.click(await moreItem(user, t("setup.more.poolSide"), "menuitemcheckbox"));
            expect(pool()).not.toHaveClass("se-pp-side");
            expect(localStorage.getItem(KEY)).toBe("0");
        } finally {
            localStorage.removeItem(KEY);
        }
    });

    it("folds \"Angemeldet\" by its arrow", async () => {
        const user = userEvent.setup();
        await show(editorData({}, BLANK));
        const pool = screen.getByRole("region", { name: t("setup.pool.aria") });
        const toggle = within(pool).getByRole("button", { name: t("setup.poolPanel.collapse") });
        expect(toggle).toHaveAttribute("aria-expanded", "true");
        await user.click(toggle);
        expect(pool).toHaveClass("se-pp-collapsed");
        expect(within(pool).getByRole("button", { name: t("setup.poolPanel.expand") })).toHaveAttribute("aria-expanded", "false");
    });
});

describe("the setup editor: the group grid", () => {
    it("hands the grid its number of groups, so a small raid's cards come out wide (setup-editor.css)", async () => {
        await show(editorData());
        expect(group(1).parentElement).toHaveClass("se-groups");
        expect(group(1).parentElement).toHaveStyle({ "--se-n": "5" });
        cleanup();
        await show(editorData({ event: { ...editorData().event, size: 10 }, groupCount: 2 }));
        expect(group(1).parentElement).toHaveStyle({ "--se-n": "2" });
        expect(screen.queryByRole("region", { name: t("setup.group.title", { index: 3 }) })).not.toBeInTheDocument();
    });
});

describe("the setup editor: moving raiders", () => {
    it("draws every group with its five places and the bench as one row under them", async () => {
        const benched = ["Zwei", "Drei", "Vier", "Fuenf", "Sechs"];
        await show(editorData({}, { bench: [ROGUE, ...benched.map((n, i) => person(`b${i + 2}`, n))] }));
        // the event's size decides how many groups are drawn, empty ones too
        for (const i of [1, 2, 3, 4, 5]) expect(group(i)).toBeInTheDocument();
        expect(within(group(1)).getByText("Bruno")).toBeInTheDocument();
        // free places are numbered boxes, never the word "leer"
        expect(within(group(2)).getByText("5")).toBeInTheDocument();
        expect(screen.queryByText(/leer/i)).not.toBeInTheDocument();
        // six on the bench: one row with all six and its count — no bench cards with empty places, never named like a raid group
        const bench = screen.getByRole("region", { name: t("setup.bench.aria") });
        for (const name of ["Schatten", ...benched]) expect(within(bench).getByText(name)).toBeInTheDocument();
        expect(within(bench).getByText(new RegExp(`^${t("setup.bench.count", { count: 6 })}`))).toBeInTheDocument();
        expect(within(bench).queryByRole("region")).not.toBeInTheDocument();
        // the bench sits under the groups
        expect(group(5).compareDocumentPosition(bench) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("says in one sentence when nobody is on the bench", async () => {
        await show(editorData({}, { bench: [] }));
        expect(within(screen.getByRole("region", { name: t("setup.bench.aria") })).getByText(t("setup.bench.empty"))).toBeInTheDocument();
    });

    it("moves a picked raider onto the exact free place that is chosen", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(slot("Ignis"));
        expect(slot("Ignis")).toHaveAttribute("aria-pressed", "true");
        // every free place of another group now offers "Hierher"; the last one of group 2 is place 5
        const here = within(group(2)).getAllByRole("button", { name: new RegExp(t("setup.group.here")) });
        expect(here).toHaveLength(4);
        await user.click(here[3]);
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        const body = savedBody();
        expect(body.event).toBe(EVENT_ID);
        expect(body.version).toBe(3);
        expect(body.groups.find((g) => g.index === 2)?.slots.find((s) => s.userId === MAGE.userId)?.pos).toBe(5);
    });

    it("moves a raider picked with the keyboard onto the bench, and Escape drops the pick", async () => {
        const user = userEvent.setup();
        await show();
        slot("Bruno").focus();
        await user.keyboard("{Enter}");
        expect(slot("Bruno")).toHaveAttribute("aria-pressed", "true");
        await user.keyboard("{Escape}");
        expect(slot("Bruno")).toHaveAttribute("aria-pressed", "false");
        expect(writes()).toHaveLength(0);

        await user.click(slot("Bruno"));
        const bench = screen.getByRole("region", { name: t("setup.bench.aria") });
        await user.click(within(bench).getByRole("button", { name: t("setup.group.here") }));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(savedBody().bench.map((b) => b.userId)).toContain(TANK.userId);
    });

    it("takes a drop on a group card, and a drop on a raider swaps the two", async () => {
        await show();
        fireEvent.drop(group(2), { dataTransfer: { getData: () => ROGUE.userId } });
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(groupOf(savedBody(), ROGUE.userId)).toBe(2);

        vi.mocked(client.send).mockClear();
        fireEvent.drop(slot("Lumen"), { dataTransfer: { getData: () => TANK.userId } });
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        const body = savedBody();
        expect(groupOf(body, TANK.userId)).toBe(2);
        expect(groupOf(body, "u-priest")).toBe(1);
    });

    it("fixes a raider from the drawer — the pick is dropped, the next click picks, never swaps", async () => {
        const user = userEvent.setup();
        await show();
        // nothing stands open before a click, and nothing to click on the line itself
        noPanel();
        expect(within(slot("Bruno")).queryByRole("button")).not.toBeInTheDocument();
        await user.click(slot("Bruno"));
        expect(within(panel()).getByText(t("setup.person.tip.pinned"))).toBeInTheDocument();
        await user.click(within(panel()).getByRole("button", { name: new RegExp(t("setup.slot.lock")) }));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(savedBody().groups[0].slots.find((s) => s.userId === TANK.userId)?.locked).toBe(true);
        expect(slot("Bruno")).toHaveAttribute("aria-pressed", "false");
        // the drawer stays with Bruno although the pointer passes other raiders
        await user.hover(slot("Lumen"));
        expect(within(panel()).getByText("Bruno")).toBeInTheDocument();
        // a click on Lumen picks Lumen — no swap with Bruno
        await user.click(slot("Lumen"));
        expect(calls("PUT", "/api/raids/setup")).toHaveLength(1);
        expect(slot("Lumen")).toHaveAttribute("aria-pressed", "true");
        expect(within(panel()).getByText("Lumen")).toBeInTheDocument();
        // Esc lets go and closes the drawer; hovering opens no drawer (only the read-only peek, SetupEditor.peek.test.tsx)
        await user.keyboard("{Escape}");
        noPanel();
        await user.hover(slot("Ignis"));
        noPanel();
        // its close button does the same
        await user.click(slot("Ignis"));
        await user.click(screen.getByRole("button", { name: t("common.close") }));
        noPanel();
        expect(slot("Ignis")).toHaveAttribute("aria-pressed", "false");
    });
});

describe("the setup editor: the bar", () => {
    it("changes the raid size as a number of groups, reshuffles at once and then saves size and lineup", async () => {
        let answerSize: (v: unknown) => void = () => {};
        vi.mocked(client.send).mockImplementation((method: string) => (method === "PATCH"
            ? new Promise((resolve) => { answerSize = resolve; })
            : Promise.resolve({ ...page, event: { ...page.event, size: 5 }, groupCount: 1 })));
        await show();
        // the group count is a dialog behind "Mehr" now, the bar holds no field
        expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
        const user = userEvent.setup();
        await user.click(await moreItem(user, t("setup.more.size")));
        const size = screen.getByRole("spinbutton", { name: t("setup.editor.sizeLabel") });
        expect(size).toHaveValue(5);
        expect(t("setup.editor.sizeLabel")).toBe("Gruppen");
        expect(screen.getByText("× 5 = 25 Spieler")).toBeInTheDocument();

        fireEvent.change(size, { target: { value: "1" } });
        // only a typed number: nothing sent, nothing reshuffled yet
        expect(writes()).toHaveLength(0);
        expect(screen.getByText(t("setup.editor.sizeTotal", { perGroup: 5, size: 5 }))).toBeInTheDocument();
        fireEvent.blur(size);

        // reshuffled in the browser before the server answered: one group left, Lumen back under "Angemeldet" (#517 — never onto the bench by itself)
        await waitFor(() => expect(screen.queryByRole("region", { name: t("setup.group.title", { index: 2 }) })).not.toBeInTheDocument());
        const pool = screen.getByRole("region", { name: t("setup.pool.aria") });
        expect(within(pool).getByText("Lumen")).toBeInTheDocument();
        // the size goes through the event's own PATCH, the lineup follows once it is stored
        expect(calls("PATCH", "/api/raids")[0][2]).toEqual({ id: EVENT_ID, size: 5 });
        expect(calls("PUT", "/api/raids/setup")).toHaveLength(0);
        await act(async () => answerSize({ id: EVENT_ID }));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(savedBody().groups.map((g) => g.index)).toEqual([1]);
    });

    // #725: the orga of a category edits the setup; the size is the event's own (PATCH /api/raids), theirs
    // since #728 - the server says so per raid in canEditEvent
    it("offers the raid size only to who may change the event (canEditEvent)", async () => {
        await show(editorData({ canEditEvent: false }));
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
        expect(screen.queryByRole("menuitem", { name: new RegExp(t("setup.more.size")) })).not.toBeInTheDocument();
        // the rest of "Mehr" stays
        expect(screen.getByRole("menuitem", { name: new RegExp(t("setup.pingText.title")) })).toBeInTheDocument();
    });

    it("offers the raid size to the orga of the raid's category as well (canEditEvent from the server, #728)", async () => {
        await show(editorData({ canEditEvent: true }));
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
        expect(screen.getByRole("menuitem", { name: new RegExp(t("setup.more.size")) })).toBeInTheDocument();
    });

    it("offers a compact view under \"Mehr\", off by default and remembered in the browser", async () => {
        const user = userEvent.setup();
        const view = await show();
        const compact = async () => {
            await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
            return screen.getByRole("menuitemcheckbox", { name: new RegExp(t("setup.editor.compact")) });
        };
        expect(t("setup.editor.compact")).toBe("Kompakt");
        expect(await compact()).toHaveAttribute("aria-checked", "false");
        await user.click(screen.getByRole("menuitemcheckbox", { name: new RegExp(t("setup.editor.compact")) }));
        expect(document.querySelector(".se-compact")).not.toBeNull();
        expect(localStorage.getItem("eh-setup-compact")).toBe("1");

        view.unmount();
        await show();
        expect(await compact()).toHaveAttribute("aria-checked", "true");
    });

    it("keeps one bar: the state, the counts as fields with words, \"Aktionen\", the search and ONE primary button — the rest under \"Aktionen\"", async () => {
        const user = userEvent.setup();
        const data = editorData();
        const checks = { ...data.setup!.checks, size: { count: 3, size: 25, ok: false }, roles: { ...data.setup!.checks.roles, tank: { count: 0, min: 2, max: 2, ok: false } } };
        const { container } = await show({ ...data, setup: { ...data.setup!, checks } });
        const bar = document.querySelector<HTMLElement>(".se-bar")!;
        expect(within(bar).getByText("Entwurf")).toBeInTheDocument();
        // the counts: one square field each, compact but every number with its word, complete in the page (they wrap, never cut)
        const counts = within(bar).getByRole("list", { name: t("setup.bar.countsAria") });
        const fields = within(counts).getAllByRole("listitem");
        expect(fields.map((f) => f.textContent)).toEqual(["Tanks 0/2", "Heiler 1/5–6", "DD 3/17", t("setup.bar.placesChip", { count: 3, size: 25 })]);
        expect(t("setup.bar.placesChip", { count: 8, size: 10 })).toBe("8/10 Plätze");
        // toned by the check: nothing yet = red, short = amber; the full sentence in the tooltip
        expect(fields[0]).toHaveClass("se-tone-bad");
        expect(fields[1]).toHaveClass("se-tone-mid");
        expect(fields[3]).toHaveClass("se-tone-mid");
        expect(fields[0]).toHaveAttribute("data-tip", t("setup.summary.statTipTarget", { label: "Tanks", value: 0, target: "2" }));
        const act = document.querySelector<HTMLElement>(".se-bar-act")!;
        expect(within(act).queryByRole("button", { name: t("setup.editor.explain") })).not.toBeInTheDocument();
        expect(within(act).queryByRole("button", { name: t("setup.editor.repropose") })).not.toBeInTheDocument();
        // one primary (filled) button: a draft is posted; beside it only the two icon toggles of what it sends along
        expect(t("setup.editor.more")).toBe("Aktionen");
        const primaries = Array.from(act.querySelectorAll<HTMLElement>(".btn-go"));
        expect(primaries.map((b) => b.textContent)).toEqual([t("setup.editor.approve")]);
        // no channel to post to in this fixture: the button alone, no toggles (they are tested with a channel below)
        expect(act.querySelectorAll(".se-post-toggle")).toHaveLength(0);
        // the search is an icon button of its own, in the bar, not under "Aktionen"
        expect(within(act).getByRole("button", { name: t("setup.editor.search") })).toBeInTheDocument();
        await user.click(within(act).getByRole("button", { name: t("setup.editor.more") }));
        expect(screen.queryByRole("menuitem", { name: new RegExp(t("setup.editor.search")) })).not.toBeInTheDocument();
        for (const name of [t("setup.editor.repropose"), t("setup.more.size"), t("setup.pingText.title"), t("setup.editor.explain"), t("setup.summary.weights"), t("setup.raidGroup.addOrSplit")]) {
            expect(screen.getByRole("menuitem", { name: new RegExp(name) })).toBeInTheDocument();
        }
        for (const name of [t("setup.summary.fairness"), t("setup.summary.wishes"), t("setup.editor.compact"), t("setup.more.benchColumn")]) {
            expect(screen.getByRole("menuitemcheckbox", { name: new RegExp(name) })).toBeInTheDocument();
        }
        // no ping box, no tiles and no empty raider box standing open; tooltips are data-tip, never the browser's title
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
        expect(screen.queryByRole("complementary", { name: t("setup.summary.aria") })).not.toBeInTheDocument();
        noPanel();
        expect(container.querySelector("[title]")).toBeNull();
    });

    it("sums the evening up in one line under the groups, its details in a dialog", async () => {
        const user = userEvent.setup();
        await show();
        const line = document.querySelector<HTMLElement>(".se-sumline")!;
        expect(within(line).getByText(t("setup.line.buffsComplete"))).toBeInTheDocument();
        expect(line).toHaveTextContent(`${t("setup.summary.fairness")} ${t("setup.line.off")}`);
        expect(line).toHaveTextContent(t("setup.line.wishesOff"));
        expect(group(5).compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const details = await openDetails(user);
        expect(within(screen.getByRole("dialog")).getByText(t("setup.line.detailsTitle"))).toBeInTheDocument();
        expect(within(details).getByText(t("setup.summary.buffs"))).toBeInTheDocument();
    });

    it("names tank and healer on a line, never melee or ranged — an off-spec tints the spec instead", async () => {
        await show(editorData({}, { groups: [{ index: 1, slots: [{ ...TANK, pos: 1 }, { ...MAGE, pos: 2, main: false }] }], bench: [] }));
        expect(within(slot("Bruno")).getByText("Tank")).toBeInTheDocument();
        expect(within(slot("Ignis")).queryByText(/Fernkampf/)).not.toBeInTheDocument();
        expect(within(slot("Ignis")).getByText("Feuer")).toHaveClass("se-offrole");
    });

    it("keeps one line per raider: why they stand there is only in the panel", async () => {
        const user = userEvent.setup();
        await show();
        expect(screen.queryByText("Bringt Arkane Brillanz")).not.toBeInTheDocument();
        await user.click(slot("Ignis"));
        const panel = screen.getByRole("complementary", { name: t("setup.person.tip.aria") });
        expect(within(panel).getByText(t("setup.person.tip.why"))).toBeInTheDocument();
        expect(within(panel).getByText("Bringt Arkane Brillanz")).toBeInTheDocument();
        expect(within(slot("Ignis")).queryByText("Bringt Arkane Brillanz")).not.toBeInTheDocument();
    });
});

describe("the setup editor: the details and the dialogs", () => {
    it("holds roles, buffs, fairness and wishes — no weight sliders", async () => {
        await show();
        const side = await openDetails(userEvent.setup());
        for (const label of [t("wow.rolePlural.tank"), t("wow.rolePlural.healer"), t("setup.summary.dps"), t("setup.summary.buffs"), t("setup.summary.fairness"), t("setup.summary.wishes")]) {
            expect(within(side).getByText(label)).toBeInTheDocument();
        }
        expect([t("setup.summary.dps"), t("setup.summary.wishes"), t("setup.summary.weights")]).toEqual(["DD", "Wünsche", "Gewichte…"]);
        expect(within(side).getByText("Aus – hier einschalten")).toBeInTheDocument();
        expect(within(side).queryByRole("slider")).not.toBeInTheDocument();
    });

    it("saves the wishes switch through the usual save request — in the details", async () => {
        const user = userEvent.setup();
        await show();
        await openDetails(user);
        await user.click(screen.getByRole("checkbox", { name: t("setup.summary.wishesAria") }));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(savedBody()).toMatchObject({ wishes: true, event: EVENT_ID });
    });

    it("switches fairness from \"Mehr\" as well, through the same save request", async () => {
        const user = userEvent.setup();
        await show();
        const item = await moreItem(user, t("setup.summary.fairness"), "menuitemcheckbox");
        expect(item).toHaveAttribute("aria-checked", "false");
        await user.click(item);
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(savedBody()).toMatchObject({ fairness: true, event: EVENT_ID });
    });

    it("opens the weights and the explanation as dialogs from \"Mehr\"", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
        await user.click(screen.getByRole("menuitem", { name: new RegExp(t("setup.summary.weights")) }));
        const weights = screen.getByRole("dialog");
        expect(within(weights).getByText("Gewichte")).toBeInTheDocument();
        expect(within(weights).getAllByRole("slider").length).toBeGreaterThan(5);
        await user.click(within(weights).getByRole("button", { name: t("common.close") }));

        await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
        await user.click(screen.getByRole("menuitem", { name: new RegExp(t("setup.editor.explain")) }));
        expect(within(screen.getByRole("dialog")).getByText("KI-Begründung")).toBeInTheDocument();
    });
});

describe("the setup editor: state, approval and posting", () => {
    const PUBLISH = { channelId: "c1", channelName: "kara-do", cancelled: false, dmsEnabled: true, recipients: 3, pendingDms: 0, posted: null, outdated: false, error: "", errorAt: 0, dms: null };
    const POSTED = { messageUrl: "", version: 3, postedAt: 1, editedAt: 0 };

    it.each([
        ["a posted setup", { publish: { ...PUBLISH, posted: POSTED } }, { status: "approved" as const }, "Gepostet · Stand 3"],
        ["an approved setup the bot could not post yet", { publish: PUBLISH }, { status: "approved" as const }, "Freigegeben · nicht gepostet"],
        ["a setup changed after its posting", { publish: { ...PUBLISH, posted: POSTED } }, { changedSinceApproval: true }, "Entwurf · geändert seit dem Posten"],
        ["a proposal", {}, { origin: "proposal" as const }, "Entwurf"],
    ])("says in ONE badge what state %s is in", async (_name, over, setup, label) => {
        await show(editorData(over, setup));
        const bar = document.querySelector<HTMLElement>(".se-bar")!;
        const badge = within(bar).getByText(label);
        expect(badge.closest(".se-state")).not.toBeNull();
        expect(bar.querySelectorAll(".se-state")).toHaveLength(1);
        // never "Gepostet" next to "noch nicht gepostet"
        if (label.startsWith("Freigegeben")) expect(bar.textContent).not.toMatch(/Gepostet/);
    });

    it("keeps a draft made at the deadline one badge, its origin in the tooltip", async () => {
        await show(editorData({}, { origin: "auto", updatedAt: 0 }));
        const badge = document.querySelector<HTMLElement>(".se-bar .se-state")!;
        expect(badge).toHaveTextContent("Entwurf");
        expect(badge.getAttribute("data-tip-sub")).toContain(t("setup.status.autoSub"));
    });

    it("asks before approving a setup whose checks fail, then approves the version shown", async () => {
        const user = userEvent.setup();
        await show(editorData({}, { checks: { ...editorData().setup!.checks, ok: false } }));
        await user.click(screen.getByRole("button", { name: t("setup.editor.approve") }));
        const question = screen.getByRole("dialog");
        expect(within(question).getByText("Trotzdem posten?")).toBeInTheDocument();
        expect(writes()).toHaveLength(0);
        await user.click(within(question).getByRole("button", { name: t("setup.editor.approve") }));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/approve")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/approve")[0][2]).toEqual({ event: EVENT_ID, version: 3, bench: false, dms: false });
    });

    it("approves only after the moves still on their way, with the version the server confirmed", async () => {
        const user = userEvent.setup();
        let answerSave: (v: unknown) => void = () => {};
        vi.mocked(client.send).mockImplementation((method: string) => (method === "PUT"
            ? new Promise((resolve) => { answerSave = resolve; })
            : Promise.resolve(page)));
        await show();
        await user.click(slot("Ignis"));
        await user.click(within(group(2)).getAllByRole("button", { name: new RegExp(t("setup.group.here")) })[0]);
        await user.click(screen.getByRole("button", { name: t("setup.editor.approve") }));
        expect(calls("POST", "/api/raids/setup/approve")).toHaveLength(0);
        await act(async () => answerSave({ ...page, setup: { ...page.setup, version: 4 } }));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/approve")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/approve")[0][2]).toEqual({ event: EVENT_ID, version: 4, bench: false, dms: false });
    });

    it("shows a reader only the approved lineup, without anything to move", async () => {
        page = editorData({ canWrite: false, setup: undefined, approved: { version: 2, approvedAt: 0, approvedBy: "", groups: [{ index: 1, slots: [TANK] }], bench: [] } });
        renderPage(<SetupEditor ctx={setupCtx()} />);
        expect(await screen.findByText("Bruno")).toBeInTheDocument();
        expect(screen.getByText("Bruno").closest("[data-user]")).not.toHaveAttribute("role");
        expect(screen.queryByRole("button", { name: t("setup.editor.approve") })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("setup.line.details") })).not.toBeInTheDocument();
    });

    it("tells a reader when nothing is approved yet", async () => {
        page = editorData({ canWrite: false, setup: undefined, approved: null });
        renderPage(<SetupEditor ctx={setupCtx()} />);
        expect(await screen.findByText(t("setup.readOnly.notApproved"))).toBeInTheDocument();
    });

    it("posts an approved setup the bot could not post yet with the bar's one button, what it will do in the badge's tooltip", async () => {
        const user = userEvent.setup();
        await show(editorData({ publish: { ...PUBLISH, pendingDms: 3 } }, { status: "approved" }));
        const badge = document.querySelector<HTMLElement>(".se-bar .se-state")!;
        expect(badge.getAttribute("data-tip-sub")).toContain(t("setup.publish.notPosted", { channel: "#kara-do" }));
        await user.click(screen.getByRole("button", { name: t("setup.publishLine.post") }));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/post")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/post")[0][2]).toEqual({ event: EVENT_ID, bench: false, dms: true });
    });

    // #517: "Bank mitposten" — the bench goes out only when the orga switches it on; the switch is an icon toggle
    // on the primary split button (head variant B), its state in the icon, the name and aria-pressed — no detour through a menu
    it("posts the bench only with the toggle on — an icon toggle on the split button, pressed or struck through, not under \"Aktionen\"", async () => {
        const user = userEvent.setup();
        const publish = { ...PUBLISH, pendingDms: 3, bench: false, benchCount: 1 };
        await show(editorData({ publish }, { status: "approved" }));
        // no checkbox, no separate state text: two toggles on the split button
        expect(screen.queryByRole("switch")).not.toBeInTheDocument();
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
        expect(document.querySelector(".se-post-state")).toBeNull();
        expect(within(screen.getByRole("group", { name: t("setup.postOptions.aria") })).getAllByRole("button", { pressed: true })).toHaveLength(1);
        const dms = postOption(t("setup.postOptions.dms"));
        expect(dms).toHaveAttribute("aria-pressed", "true");
        expect(dms).toHaveAccessibleName(`${t("setup.postOptions.dms")}: ${t("setup.postOptions.on")}`);
        expect(dms).toHaveClass("is-on");
        const bench = postOption(t("setup.postOptions.bench"));
        expect(bench).toHaveAttribute("aria-pressed", "false");
        expect(bench).toHaveClass("se-off");
        expect(bench).toHaveAttribute("data-tip", `${t("setup.postOptions.bench")}: ${t("setup.postOptions.off")}`);
        await user.click(bench);
        expect(postOption(t("setup.postOptions.bench"))).toHaveAttribute("aria-pressed", "true");
        expect(postOption(t("setup.postOptions.bench"))).toHaveAccessibleName(`${t("setup.postOptions.bench")}: ${t("setup.postOptions.on")}`);
        await user.click(screen.getByRole("button", { name: t("setup.publishLine.post") }));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/post")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/post")[0][2]).toEqual({ event: EVENT_ID, bench: true, dms: true });
        await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
        expect(screen.queryByRole("menuitemcheckbox", { name: new RegExp(t("setup.publishLine.bench")) })).not.toBeInTheDocument();
    });

    it("remembers the event's last choice and approves with it", async () => {
        const user = userEvent.setup();
        const publish = { ...PUBLISH, dmsEnabled: false, pendingDms: 3, bench: true, benchCount: 1 };
        await show(editorData({ publish }));
        expect(postOption(t("setup.postOptions.bench"))).toHaveAttribute("aria-pressed", "true");
        expect(postOption(t("setup.postOptions.dms"))).toHaveAttribute("aria-pressed", "false");
        expect(postOption(t("setup.postOptions.dms"))).toHaveClass("se-off");
        await user.click(screen.getByRole("button", { name: t("setup.editor.approve") }));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/approve")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/approve")[0][2]).toMatchObject({ event: EVENT_ID, bench: true, dms: false });
    });

    it("switches the DMs for this raid with the split button's toggle, and a toggle flipped after the post brings \"Setup posten\" back", async () => {
        const user = userEvent.setup();
        const publish = { ...PUBLISH, dmsEnabled: false, dmsDefault: false, posted: POSTED, bench: false };
        await show(editorData({ publish }, { status: "approved", version: 3 }));
        // posted and current: the one button pings
        expect(screen.getByRole("button", { name: t("setup.ping.button") })).toBeInTheDocument();
        expect(postOption(t("setup.postOptions.dms"))).toHaveAttribute("aria-pressed", "false");
        await user.click(postOption(t("setup.postOptions.dms")));
        const dms = postOption(t("setup.postOptions.dms"));
        expect(dms).toHaveAttribute("aria-pressed", "true");
        // chosen for this raid, unlike the category: the tooltip says so
        expect(dms).toHaveAttribute("data-tip-sub", t("setup.postOptions.dmsSubOwn"));
        await user.click(screen.getByRole("button", { name: t("setup.publishLine.post") }));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/post")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/post")[0][2]).toEqual({ event: EVENT_ID, bench: false, dms: true });
    });

    it("has no separate approval: a draft is posted with \"Setup posten\", a posted setup's one button pings", async () => {
        const user = userEvent.setup();
        const publish = { ...PUBLISH, dmsEnabled: false, posted: POSTED };
        const view = await show(editorData({ publish }));
        expect(screen.getByRole("button", { name: t("setup.editor.approve") })).toBeEnabled();
        expect(screen.queryByRole("button", { name: t("setup.ping.button") })).not.toBeInTheDocument();
        view.unmount();

        await show(editorData({ publish }, { status: "approved" }));
        // posted and current: no "Setup posten" in the bar — posting again (outstanding DMs) sits under "Mehr"
        expect(screen.queryByRole("button", { name: t("setup.editor.approve") })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("setup.ping.button") })).toBeEnabled();
        expect(await moreItem(user, t("setup.publishLine.post"))).toBeInTheDocument();
    });

    it("pings everybody in the posted setup after asking, with how many and the text", async () => {
        const user = userEvent.setup();
        vi.mocked(client.send).mockImplementation((_m: string, path: string, body?: unknown) => (path === "/api/raids/setup/ping"
            ? Promise.resolve((body as { dryRun?: boolean }).dryRun ? { count: 4, text: "Setup steht!" } : { message: "4 Raider aus dem Setup gepingt.", count: 4, url: "" })
            : Promise.resolve(page)));
        await show(editorData({ publish: { ...PUBLISH, posted: POSTED } }, { status: "approved" }));
        await user.click(screen.getByRole("button", { name: t("setup.ping.button") }));
        const question = await screen.findByRole("dialog");
        expect(within(question).getByText(t("setup.ping.askText", { count: 4, text: "Setup steht!" }))).toBeInTheDocument();
        expect(calls("POST", "/api/raids/setup/ping")).toEqual([["POST", "/api/raids/setup/ping", { event: EVENT_ID, dryRun: true }]]);
        await user.click(within(question).getByRole("button", { name: t("setup.ping.action") }));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/ping")).toHaveLength(2));
        expect(calls("POST", "/api/raids/setup/ping")[1][2]).toEqual({ event: EVENT_ID });
    });

    it("counts the confirmed ones in the bar once the setup is out", async () => {
        await show(editorData({ publish: { ...PUBLISH, posted: POSTED }, confirmations: { "u-tank": "confirmed", "u-priest": "declined" } }, { status: "approved" }));
        const counts = screen.getByRole("list", { name: t("setup.bar.countsAria") });
        expect(within(counts).getByText(t("setup.bar.confirmedChip", { count: 1, total: 3 }))).toBeInTheDocument();
        expect(t("setup.bar.confirmedChip", { count: 1, total: 3 })).toBe("1/3 bestätigt");
    });

    describe("Confirm/Cancel in the editor", () => {
        /** The drawer's check for a raider: click the line (the drawer opens), the button sits in it. */
        const userRef = { current: userEvent.setup() };
        const confirmButton = async (character: string) => {
            await userRef.current.click(slot(character));
            return within(panel()).getByRole("button", { name: /Bestätigen|Bestätigt|Abgesagt/ });
        };
        beforeEach(() => { userRef.current = userEvent.setup(); });

        it("tints a confirmed line green, a cancelled one red — group places only", async () => {
            await show(editorData({ confirmations: { "u-tank": "confirmed", "u-priest": "declined", "u-rogue": "confirmed" } }, { status: "approved" }));
            expect(slot("Bruno")).toHaveClass("se-confirmed");
            // the mark is a badge on the spec icon's corner
            expect(within(slot("Bruno")).getByRole("img", { name: t("setup.slot.confirmed") }).closest(".se-slot-tile")).not.toBeNull();
            expect(slot("Lumen")).toHaveClass("se-declined");
            expect(within(slot("Lumen")).getByRole("img", { name: t("setup.slot.declined") }).closest(".se-slot-tile")).not.toBeNull();
            expect(slot("Ignis")).not.toHaveClass("se-confirmed");
            // the bench never shows the mark
            expect(slot("Schatten")).not.toHaveClass("se-confirmed");
        });

        it("lets the orga set and take away the check in the panel — drawn at once, saved on the server", async () => {
            const user = userRef.current;
            // the heartbeat carries the marks as stored, like the server
            let stored: Record<string, string> = {};
            vi.mocked(client.send).mockImplementation((_m: string, path: string, body?: unknown) => {
                if (path === "/api/raids/setup/confirm") {
                    stored = (body as { status: string }).status ? { "u-mage": "confirmed" } : {};
                    return Promise.resolve({ confirmations: stored });
                }
                if (path === "/api/raids/setup/presence") return Promise.resolve({ editors: [], version: 3, confirmations: stored, activity: [] });
                return Promise.resolve(page);
            });
            await show(editorData({ confirmations: {} }, { status: "approved" }));
            await user.click(await confirmButton("Ignis"));
            expect(slot("Ignis")).toHaveClass("se-confirmed");
            await waitFor(() => expect(calls("POST", "/api/raids/setup/confirm")).toHaveLength(1));
            expect(calls("POST", "/api/raids/setup/confirm")[0][2]).toEqual({ event: EVENT_ID, userId: "u-mage", status: "confirmed" });
            // the check never picks the raider for a move
            expect(slot("Ignis")).not.toHaveClass("se-picked");

            await user.click(await confirmButton("Ignis"));
            await waitFor(() => expect(calls("POST", "/api/raids/setup/confirm")).toHaveLength(2));
            expect(calls("POST", "/api/raids/setup/confirm")[1][2]).toEqual({ event: EVENT_ID, userId: "u-mage", status: "" });
            await waitFor(() => expect(slot("Ignis")).not.toHaveClass("se-confirmed"));
        });

        it("keeps quick marks: an older answer never takes back a click still on its way", async () => {
            const user = userRef.current;
            const answers: Array<(v: unknown) => void> = [];
            vi.mocked(client.send).mockImplementation((_m: string, path: string) => (path === "/api/raids/setup/confirm"
                ? new Promise((resolve) => { answers.push(resolve); })
                : Promise.resolve(page)));
            await show(editorData({ confirmations: {} }, { status: "approved" }));
            await user.click(await confirmButton("Bruno"));
            await user.click(await confirmButton("Ignis"));
            expect(slot("Bruno")).toHaveClass("se-confirmed");
            expect(slot("Ignis")).toHaveClass("se-confirmed");
            // one after the other: the second goes out once the first is answered
            expect(calls("POST", "/api/raids/setup/confirm")).toHaveLength(1);
            // the server's answer to the first knows only Bruno — Ignis must stay green
            await act(async () => answers[0]({ confirmations: { "u-tank": "confirmed" } }));
            expect(slot("Ignis")).toHaveClass("se-confirmed");
            await waitFor(() => expect(calls("POST", "/api/raids/setup/confirm")).toHaveLength(2));
            await act(async () => answers[1]({ confirmations: { "u-tank": "confirmed", "u-mage": "confirmed" } }));
            expect(slot("Bruno")).toHaveClass("se-confirmed");
            expect(slot("Ignis")).toHaveClass("se-confirmed");
        });

        it("turns a cancel into a check, and puts the mark back when saving fails", async () => {
            const user = userRef.current;
            vi.mocked(client.send).mockImplementation(() => Promise.reject({ code: "not_placed", message: "nope" }));
            await show(editorData({ confirmations: { "u-priest": "declined" } }, { status: "approved" }));
            await user.click(await confirmButton("Lumen"));
            await waitFor(() => expect(calls("POST", "/api/raids/setup/confirm")).toHaveLength(1));
            expect(calls("POST", "/api/raids/setup/confirm")[0][2]).toEqual({ event: EVENT_ID, userId: "u-priest", status: "confirmed" });
            await waitFor(() => expect(slot("Lumen")).toHaveClass("se-declined"));
        });

        it("confirms everybody without an answer with one entry under \"Aktionen\", which goes once nobody is left", async () => {
            const user = userRef.current;
            vi.mocked(client.send).mockImplementation((_m: string, path: string) => (path === "/api/raids/setup/confirm-all"
                ? Promise.resolve({ confirmations: { "u-tank": "confirmed", "u-mage": "confirmed", "u-priest": "declined" }, count: 2 })
                : Promise.resolve(page)));
            await show(editorData({ confirmations: { "u-priest": "declined" } }, { status: "approved" }));
            await user.click(await moreItem(user, t("setup.editor.confirmAll")));
            // asked once first: how many get the check, a cancel stays
            const question = screen.getByRole("dialog");
            expect(question).toHaveTextContent(t("setup.confirmAll.askText", { count: 2 }));
            expect(calls("POST", "/api/raids/setup/confirm-all")).toHaveLength(0);
            await user.click(within(question).getByRole("button", { name: t("setup.editor.confirmAll") }));
            await waitFor(() => expect(calls("POST", "/api/raids/setup/confirm-all")).toHaveLength(1));
            expect(calls("POST", "/api/raids/setup/confirm-all")[0][2]).toEqual({ event: EVENT_ID });
            await waitFor(() => expect(slot("Bruno")).toHaveClass("se-confirmed"));
            expect(slot("Lumen")).toHaveClass("se-declined");
            await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
            expect(screen.queryByRole("menuitem", { name: new RegExp(t("setup.editor.confirmAll")) })).not.toBeInTheDocument();
        });

        it("offers no check and no \"Alle bestätigen\" before the setup is posted", async () => {
            const user = userRef.current;
            await show(editorData({ confirmations: {} }));
            await user.click(slot("Bruno"));
            expect(within(panel()).queryByRole("button", { name: /Bestätigen/ })).not.toBeInTheDocument();
            await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
            expect(screen.queryByRole("menuitem", { name: new RegExp(t("setup.editor.confirmAll")) })).not.toBeInTheDocument();
        });

        it("keeps the picked raider plainly marked on a green line", async () => {
            const user = userRef.current;
            await show(editorData({ confirmations: { "u-tank": "confirmed" } }, { status: "approved" }));
            await user.click(slot("Bruno"));
            expect(slot("Bruno")).toHaveClass("se-picked");
            expect(slot("Bruno")).toHaveClass("se-confirmed");
        });
    });

    describe("while the DMs are being sent", () => {
        afterEach(() => { vi.useRealTimers(); });

        it("polls only their state, never the lineup", async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            const posted = { messageUrl: "", version: 3, postedAt: 1, editedAt: 0 };
            const publish = { channelId: "c1", channelName: "kara-do", cancelled: false, dmsEnabled: true, recipients: 3, pendingDms: 0, posted, outdated: false, error: "", errorAt: 0, dms: { status: "running" as const, version: 3, at: 1, total: 3, sent: 1, failed: [], unchanged: 0 } };
            await show(editorData({ publish }, { status: "approved" }));
            const badge = () => document.querySelector<HTMLElement>(".se-bar .se-state")!;
            expect(badge()).toHaveTextContent(t("setup.state.dmsRunning"));
            expect(badge().getAttribute("data-tip-sub")).toContain(t("setup.publish.dmsRunning", { done: 1, total: 3 }));
            // meanwhile the server holds another lineup (Bruno on the bench) and the DMs are done
            page = editorData({ publish: { ...publish, dms: { ...publish.dms, status: "done", sent: 3 } } }, { status: "approved", groups: [], bench: [TANK] });
            await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
            await waitFor(() => expect(badge().getAttribute("data-tip-sub")).toContain(t("setup.publish.dmsSent", { count: 3 })));
            expect(badge()).not.toHaveTextContent(t("setup.state.dmsRunning"));
            expect(within(group(1)).getByText("Bruno")).toBeInTheDocument();
        });
    });
});

describe("the setup editor: „nicht zusammen“", () => {
    it("asks once before a proposal when such pairs stand among the signups", async () => {
        const user = userEvent.setup();
        await show(editorData({ avoidPairs: 2 }));
        await user.click(await moreItem(user, t("setup.editor.repropose")));
        const question = await screen.findByRole("dialog");
        expect(within(question).getByText(/2 Raider-Paare/)).toBeInTheDocument();
        await user.click(within(question).getByRole("button", { name: "Nicht berücksichtigen" }));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/propose")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/propose")[0][2]).toEqual({ event: EVENT_ID, avoid: false });
    });

    it("does not ask again once the answer is stored, nor without such pairs", async () => {
        const user = userEvent.setup();
        await show(editorData({ avoidPairs: 2 }, { options: { weights: {}, fairness: false, wishes: false, avoid: true } }));
        await user.click(await moreItem(user, t("setup.editor.repropose")));
        await waitFor(() => expect(calls("POST", "/api/raids/setup/propose")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/propose")[0][2]).toEqual({ event: EVENT_ID });
        expect(screen.queryByText(/Raider-Paare/)).not.toBeInTheDocument();
    });

    it("shows a switch with the count in the details — never who named whom", async () => {
        const user = userEvent.setup();
        await show(editorData({ avoidPairs: 1 }));
        expect(document.querySelector(".se-sumline")).toHaveTextContent(`${t("setup.summary.avoid")} ${t("setup.line.off")}`);
        const side = await openDetails(user);
        const label = within(side).getByText(t("setup.summary.avoid"));
        expect(label.getAttribute("data-tip-sub")).toMatch(/Wer wen genannt hat, sieht niemand/);
        await user.click(within(side).getByRole("checkbox", { name: t("setup.summary.avoidAria") }));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
        expect(savedBody()).toMatchObject({ avoid: true });
    });

    it("has no such switch while nobody named anybody", async () => {
        await show();
        await openDetails(userEvent.setup());
        expect(screen.queryByRole("checkbox", { name: t("setup.summary.avoidAria") })).not.toBeInTheDocument();
    });
});

describe("the setup editor: the ping text (a dialog under \"Mehr\")", () => {
    async function openPingText(user: ReturnType<typeof userEvent.setup>) {
        const item = await moreItem(user, t("setup.pingText.title"));
        // the entry shows the text as it stands
        expect(item).toHaveTextContent("Setup steht!");
        await user.click(item);
        return screen.getByRole("textbox", { name: t("setup.pingText.label") });
    }

    it("saves the edited text on blur to its own endpoint — never per keystroke", async () => {
        const user = userEvent.setup();
        await show();
        const field = await openPingText(user);
        expect(field).toHaveValue("Setup steht!");
        await user.type(field, " Los");
        expect(calls("POST", "/api/raids/setup/ping-text")).toHaveLength(0);
        await user.tab();
        await waitFor(() => expect(calls("POST", "/api/raids/setup/ping-text")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/ping-text")[0][2]).toEqual({ event: EVENT_ID, text: "Setup steht! Los" });
    });

    it("commits on Enter, and an unchanged text is not sent at all", async () => {
        const user = userEvent.setup();
        await show();
        const field = await openPingText(user);
        await user.click(field);
        await user.keyboard("{Enter}");
        expect(calls("POST", "/api/raids/setup/ping-text")).toHaveLength(0);
        await user.clear(field);
        await user.type(field, "Invite in 5{Enter}");
        await waitFor(() => expect(calls("POST", "/api/raids/setup/ping-text")).toHaveLength(1));
        expect(calls("POST", "/api/raids/setup/ping-text")[0][2]).toEqual({ event: EVENT_ID, text: "Invite in 5" });
    });
});

// head variant B: the bench as a row under the groups (default) or as a column beside them,
// a switch under "Aktionen" › Ansicht remembered in this browser; drag, drop and double click work in both
describe("the setup editor: the bench as a row or a column", () => {
    const BENCH_KEY = "eh-setup-bench-column";
    const PUBLISH = { channelId: "c1", channelName: "kara-do", cancelled: false, dmsEnabled: true, recipients: 3, pendingDms: 3, posted: null, outdated: false, error: "", errorAt: 0, dms: null };
    const bench = () => screen.getByRole("region", { name: t("setup.bench.aria") });
    const line = (userId: string) => document.querySelector<HTMLElement>(`.se-slot[data-user="${userId}"]`)!;
    const benchSwitch = (user: ReturnType<typeof userEvent.setup>) => moreItem(user, t("setup.more.benchColumn"), "menuitemcheckbox");

    beforeEach(() => localStorage.removeItem(BENCH_KEY));
    afterEach(() => localStorage.removeItem(BENCH_KEY));

    it("is a row by default; the switch under \"Aktionen\" makes it a column, remembered in the browser", async () => {
        const user = userEvent.setup();
        const view = await show();
        expect(bench()).not.toHaveClass("se-col");
        expect(document.querySelector(".se-main")).not.toHaveClass("se-bench-col");
        const toggle = await benchSwitch(user);
        expect(toggle).toHaveAttribute("aria-checked", "false");
        expect(toggle.querySelector(".se-more-switch")).not.toHaveClass("is-on");
        await user.click(toggle);
        expect(bench()).toHaveClass("se-col");
        expect(document.querySelector(".se-main")).toHaveClass("se-bench-col");
        expect(localStorage.getItem(BENCH_KEY)).toBe("1");

        view.unmount();
        await show();
        expect(bench()).toHaveClass("se-col");
        const again = await benchSwitch(user);
        expect(again).toHaveAttribute("aria-checked", "true");
        await user.click(again);
        expect(bench()).not.toHaveClass("se-col");
        expect(localStorage.getItem(BENCH_KEY)).toBe("0");
    });

    it("counts with a word in both layouts; the row also says whether the bench goes out with the post, the narrow column only on its empty drop area", async () => {
        const three = [ROGUE, person("b2", "Zwei"), person("b3", "Drei")];
        const view = await show(editorData({ publish: { ...PUBLISH, bench: false, benchCount: 3 } }, { bench: three }));
        const state = () => bench().querySelector(".se-bench-state")!;
        expect(state).toBeTruthy();
        expect(state()).toHaveTextContent(t("setup.bench.count", { count: 3 }));
        expect(t("setup.bench.count", { count: 3 })).toBe("3 Spieler");
        expect(state()).toHaveTextContent(t("setup.bench.notPosted"));
        view.unmount();

        localStorage.setItem(BENCH_KEY, "1");
        await show(editorData({ publish: { ...PUBLISH, bench: true, benchCount: 3 } }, { bench: three }));
        expect(bench()).toHaveClass("se-col");
        expect(state()).toHaveTextContent(t("setup.bench.count", { count: 3 }));
        expect(state()).not.toHaveTextContent(t("setup.bench.posted"));
        for (const name of ["Schatten", "Zwei", "Drei"]) expect(within(bench()).getByText(name)).toBeInTheDocument();
    });

    it("shows an empty bench as one sentence in the row and as a drop area in the column", async () => {
        const view = await show(editorData({}, { bench: [] }));
        expect(within(bench()).getByText(t("setup.bench.empty"))).toBeInTheDocument();
        view.unmount();

        localStorage.setItem(BENCH_KEY, "1");
        await show(editorData({}, { bench: [] }));
        expect(within(bench()).getByText(t("setup.bench.count", { count: 0 }))).toBeInTheDocument();
        const drop = bench().querySelector(".se-bench-drop")!;
        expect(drop).toHaveClass("se-empty");
        expect(drop).toHaveTextContent(t("setup.bench.dropHere"));
        expect(drop).not.toHaveTextContent(t("setup.bench.posted"));
    });

    it("draws ten on the bench as one list in both layouts", async () => {
        const ten = [ROGUE, ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => person(`b${i}`, `Bank${i}`))];
        const view = await show(editorData({}, { bench: ten }));
        expect(bench().querySelectorAll(".se-slot[data-user]")).toHaveLength(10);
        expect(bench().querySelector(".se-bench-state")).toHaveTextContent(t("setup.bench.count", { count: 10 }));
        view.unmount();
        localStorage.setItem(BENCH_KEY, "1");
        await show(editorData({}, { bench: ten }));
        expect(bench().querySelectorAll(".se-slot[data-user]")).toHaveLength(10);
    });

    for (const layout of ["row", "column"] as const) {
        describe(`as a ${layout}`, () => {
            beforeEach(() => localStorage.setItem(BENCH_KEY, layout === "column" ? "1" : "0"));

            it("takes a raider dropped on it", async () => {
                await show();
                expect(bench().classList.contains("se-col")).toBe(layout === "column");
                fireEvent.drop(bench(), { dataTransfer: { getData: () => MAGE.userId } });
                await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
                expect(savedBody().bench.map((b) => b.userId)).toEqual(expect.arrayContaining([ROGUE.userId, MAGE.userId]));
            });

            it("takes a picked raider by its \"hierher\" target", async () => {
                const user = userEvent.setup();
                await show();
                await user.click(slot("Bruno"));
                await user.click(within(bench()).getByRole("button", { name: t("setup.group.here") }));
                await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
                expect(savedBody().bench.map((b) => b.userId)).toContain(TANK.userId);
            });

            it("lets a bench raider go with a double click", async () => {
                const user = userEvent.setup();
                await show();
                await user.dblClick(line(ROGUE.userId));
                await waitFor(() => expect(calls("PUT", "/api/raids/setup")).toHaveLength(1));
                expect(savedBody().bench).toEqual([]);
            });
        });
    }
});

describe("the setup editor: head variant B", () => {
    it("has no voice channel feature anywhere, in the bar or under \"Aktionen\"", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
        expect(document.body.textContent).not.toMatch(/Sprachkanal|voice channel/i);
    });

    it("sorts \"Aktionen\" into four sections: Raid, Vorschlag, Posten und benachrichtigen, Ansicht", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(screen.getByRole("button", { name: t("setup.editor.more") }));
        const heads = Array.from(document.querySelectorAll(".se-more-head")).map((h) => h.textContent);
        expect(heads).toEqual([t("setup.more.sectionRaid"), t("setup.more.sectionProposal"), t("setup.more.sectionPost"), t("setup.more.sectionView")]);
        expect(heads).toEqual(["Raid", "Vorschlag", "Posten und benachrichtigen", "Ansicht"]);
    });
});
