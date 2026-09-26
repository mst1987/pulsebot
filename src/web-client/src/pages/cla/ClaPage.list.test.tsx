// The Log-Auswertung list (design issue #217): the page head, the filter
// segment with a count per option (remembered), the columns with their
// tooltips, the raid and evaluation badges, one action per row and the row
// menu. The API is mocked; the dialogs are in ClaPage.actions.test.tsx.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { ClaData, ClaFilter, ClaRow } from "../../api";
import { renderPage } from "../../test/render";
import { t } from "../../i18n";
import { LOG_FALLBACK_ICON, raidIcon } from "../../lib/logRaids";
import { RAID_CONTENTS } from "../../lib/raidIcons";
import ClaPage from "./ClaPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getClaData: vi.fn(),
    evalLog: vi.fn(),
}));

function row(over: Partial<ClaRow> = {}): ClaRow {
    return {
        kind: "log", id: "l1", logId: "l1", title: "Hyjal Mittwoch", zone: "", reportId: "abc",
        wclUrl: "", postedAt: Date.UTC(2026, 8, 16, 19, 58), source: "channel",
        guildId: "", channelId: "", messageId: "", channelName: "logs", categoryId: "", categoryName: "",
        sections: [], report: null, raids: [], eventId: "", eventLabel: "", eventStartTime: 0, eventLinkSource: "",
        ...over,
    };
}

function data(items: ClaRow[], over: Partial<ClaData> = {}): ClaData {
    return {
        filter: "all",
        page: { items, sort: "date", dir: "desc", page: 1, totalPages: 1, total: items.length, pageSize: 25 },
        counts: { all: 3, open: 1, unlinked: 2, done: 0 },
        autoMatchCount: 0,
        matchEventsError: null,
        logChannelsConfigured: true,
        activeGuildId: "g1",
        ...over,
    };
}

/** Answers every list request with `items`, echoing the filter and sort asked for. */
function serve(items: ClaRow[], over: Partial<ClaData> = {}) {
    vi.mocked(api.getClaData).mockImplementation((filter: ClaFilter, sort?: string, dir?: string) => Promise.resolve(data(items, {
        filter,
        ...over,
        page: { items, sort: sort || "date", dir: dir === "asc" ? "asc" : "desc", page: 1, totalPages: 1, total: items.length, pageSize: 25 },
    })));
}

function Where() {
    const loc = useLocation();
    return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function show(route = "/cla") {
    return renderPage(<><ClaPage /><Where /></>, { route });
}

async function rowOf(title: string): Promise<HTMLElement> {
    const el = await screen.findByText(title);
    const r = el.closest<HTMLElement>("[role=\"row\"]");
    if (!r) throw new Error(`no row for ${title}`);
    return r;
}

/** A row's cell by the column label it carries for narrow screens. */
function cell(r: HTMLElement, label: string): HTMLElement {
    const c = r.querySelector<HTMLElement>(`[data-label="${label}"]`);
    if (!c) throw new Error(`no cell ${label}`);
    return c;
}

/** The last cell: the row's action and its menu. */
function actionsCell(r: HTMLElement): HTMLElement {
    const cells = within(r).getAllByRole("cell");
    return cells[cells.length - 1];
}

const iconSrc = (img: Element) => decodeURIComponent(img.getAttribute("src") || "");

beforeEach(() => {
    serve([row()]);
    vi.mocked(api.evalLog).mockResolvedValue({ status: "done", url: "/r/abc" });
});

describe("Log-Auswertung: finding it", () => {
    it("has a page head with exactly one primary action, which opens the dialog", async () => {
        const user = userEvent.setup();
        show();
        expect(await screen.findByRole("heading", { level: 1, name: "Log-Auswertung" })).toBeInTheDocument();
        expect(screen.getByText("Warcraft Logs · CLA & RPB")).toBeInTheDocument();
        // one list, no tabs any more
        expect(screen.queryByRole("tab")).not.toBeInTheDocument();
        expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Neue Auswertung" }));
        const dlg = screen.getByText("Warcraft-Logs-Report per Link").closest("dialog");
        expect(dlg).toHaveAttribute("open");
    });
});

describe("Log-Auswertung: one list", () => {
    it("filters by Alle, Offen, Ohne Raid-Event, Ausgewertet with a count each and a tooltip", async () => {
        show();
        const group = await screen.findByRole("radiogroup", { name: "Logs filtern" });
        const opts = within(group).getAllByRole("radio");
        expect(opts.map((o) => o.textContent)).toEqual(["Alle3", "Offen1", "Ohne Raid-Event2", "Ausgewertet0"]);
        expect(opts[0]).toHaveAttribute("aria-checked", "true");
        // something waiting is yellow, nothing waiting is not
        expect(within(opts[1]).getByText("1")).toHaveClass("mid");
        expect(within(opts[2]).getByText("2")).toHaveClass("mid");
        expect(within(opts[3]).getByText("0")).not.toHaveClass("mid");
        // the explanations are tooltips on the options, not paragraphs
        expect(opts[1]).toHaveAttribute("data-tip", "Noch nicht ausgewertet");
        expect(opts[1].getAttribute("data-tip-sub")).toMatch(/weder CLA noch RPB/);
        for (const o of opts) expect(o.getAttribute("data-tip-sub")).toBeTruthy();
    });

    it("asks the API for the chosen filter, puts it in the URL and remembers it", async () => {
        const user = userEvent.setup();
        const first = show("/cla?page=3");
        await user.click(await screen.findByRole("radio", { name: /^Offen/ }));
        await waitFor(() => expect(api.getClaData).toHaveBeenLastCalledWith("open", "date", "desc", 1));
        expect(screen.getByRole("radio", { name: /^Offen/ })).toHaveAttribute("aria-checked", "true");
        // a new filter starts on its first page
        expect(screen.getByTestId("where")).toHaveTextContent(/^\/cla\?filter=open$/);
        first.unmount();

        // back later without a query string: the remembered filter applies
        vi.mocked(api.getClaData).mockClear();
        show("/cla");
        await screen.findByRole("radiogroup", { name: "Logs filtern" });
        expect(api.getClaData).toHaveBeenCalledWith("open", "date", "desc", 1);
    });

    it("shows the filter's own empty text", async () => {
        serve([]);
        show("/cla?filter=open");
        expect(await screen.findByText("Kein Log wartet auf eine Auswertung.")).toBeInTheDocument();
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("sends old ?view= links to the full list", async () => {
        show("/cla?view=logs&filter=open");
        await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/cla\?filter=open$/));
        expect(api.getClaData).toHaveBeenCalledWith("open", "date", "desc", 1);
    });

    it("does not trust a sort remembered by the old two-tab page", async () => {
        window.localStorage.setItem("eh-cla-sort", JSON.stringify({ sort: "posted", dir: "asc", view: "logs" }));
        show();
        await rowOf("Hyjal Mittwoch");
        expect(api.getClaData).toHaveBeenCalledWith("all", "date", "desc", 1);
        expect(api.getClaData).not.toHaveBeenCalledWith("all", "posted", expect.anything(), expect.anything());
    });

    it("sorts by a column head and remembers the sort", async () => {
        const user = userEvent.setup();
        const first = show();
        await user.click(await screen.findByRole("button", { name: "Inhalt" }));
        await waitFor(() => expect(api.getClaData).toHaveBeenLastCalledWith("all", "content", "asc", 1));
        await waitFor(() => expect(screen.getByRole("columnheader", { name: /Inhalt/ })).toHaveAttribute("aria-sort", "ascending"));
        first.unmount();

        vi.mocked(api.getClaData).mockClear();
        show();
        await rowOf("Hyjal Mittwoch");
        expect(api.getClaData).toHaveBeenCalledWith("all", "content", "asc", 1);
    });

    it("has a sortable head with a tooltip on each column", async () => {
        show();
        await rowOf("Hyjal Mittwoch");
        const heads = screen.getAllByRole("columnheader");
        expect(heads.map((h) => h.textContent)).toEqual(["Log", "Inhalt", "Auswertung", "Raid-Event"]);
        expect(heads[0]).toHaveAttribute("aria-sort", "descending");
        for (const h of heads) {
            const btn = within(h).getByRole("button");
            expect(btn).toHaveAttribute("data-tip", h.textContent);
            expect(btn.getAttribute("data-tip-sub")).toBeTruthy();
        }
    });

    it("moves time, players and problems into the evaluation badge's tooltip", async () => {
        serve([row({
            sections: ["cla"],
            report: { id: "r1", url: "/r/r1", generatedAt: Date.UTC(2026, 8, 16, 21, 0), playerCount: 25, issueCount: 7 },
        })]);
        show();
        const evalCell = cell(await rowOf("Hyjal Mittwoch"), "Auswertung");
        const done = within(evalCell).getByText("CLA");
        expect(done).toHaveAttribute("data-tip", "CLA ausgewertet");
        expect(done.getAttribute("data-tip-sub")).toMatch(/25 Spieler · 7 Probleme$/);
        expect(within(evalCell).getByText("RPB offen")).toHaveAttribute("data-tip", "RPB offen");
        // no extra columns for them
        expect(screen.queryByRole("columnheader", { name: /Spieler|Probleme|Erstellt/ })).not.toBeInTheDocument();
    });

    it("shows each raid as a badge with its boss icon, yellow while the final boss stands", async () => {
        serve([row({
            raids: [
                { contentId: "hyjal", label: "Hyjal", killed: 3, total: 5, finalKilled: false, finalBoss: "Archimonde", missing: ["Azgalor", "Archimonde"], bosses: [] },
                { contentId: "bt", label: "BT", killed: 9, total: 9, finalKilled: true, finalBoss: "Illidan", missing: [], bosses: [] },
            ],
        })]);
        show();
        const content = cell(await rowOf("Hyjal Mittwoch"), "Inhalt");
        const hyjal = within(content).getByText("Hyjal 3/5");
        expect(hyjal).toHaveClass("mid");
        expect(hyjal).toHaveAttribute("data-tip", t("raidDetail.logRaid.openHead"));
        expect(hyjal.getAttribute("data-tip-sub")).toContain("Azgalor, Archimonde");
        expect(iconSrc(hyjal.querySelector("img")!)).toContain(RAID_CONTENTS.hyjal.icon);
        const bt = within(content).getByText("BT 9/9");
        expect(bt).toHaveClass("ok");
        expect(iconSrc(bt.querySelector("img")!)).toContain(RAID_CONTENTS.bt.icon);
    });

    it("uses the shared raid icons and its own pocket watch for an unknown raid", () => {
        expect(raidIcon("hyjal")).toBe(RAID_CONTENTS.hyjal.icon);
        expect(raidIcon("naxx")).toBe(LOG_FALLBACK_ICON);
        expect(raidIcon(undefined)).toBe("inv_misc_pocketwatch_01");
    });
});

describe("Log-Auswertung: one action per row", () => {
    it("offers Auswerten for a new log and runs CLA, then RPB", async () => {
        const user = userEvent.setup();
        show();
        const actions = actionsCell(await rowOf("Hyjal Mittwoch"));
        // exactly one action next to the row menu
        const controls = within(actions).queryAllByRole("button").concat(within(actions).queryAllByRole("link"));
        expect(controls).toHaveLength(2);
        expect(within(actions).queryByText(/CLA \+ RPB/)).not.toBeInTheDocument();
        await user.click(within(actions).getByRole("button", { name: "Auswerten" }));
        await waitFor(() => expect(api.evalLog).toHaveBeenCalledTimes(2));
        expect(vi.mocked(api.evalLog).mock.calls).toEqual([
            ["l1", "cla", { force: false }],
            ["l1", "rpb", { force: false }],
        ]);
        expect(await screen.findByText("CLA + RPB ausgewertet.")).toBeInTheDocument();
    });

    it("shows a running row while the evaluation goes on", async () => {
        const user = userEvent.setup();
        let finish: (v: api.EvalStart) => void = () => undefined;
        vi.mocked(api.evalLog).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        show();
        const r = await rowOf("Hyjal Mittwoch");
        await user.click(within(r).getByRole("button", { name: "Auswerten" }));
        expect(await within(actionsCell(r)).findByRole("button", { name: /läuft/ })).toBeInTheDocument();
        expect(within(cell(r, "Auswertung")).getByText("CLA läuft")).toBeInTheDocument();
        finish({ status: "done", url: "/r/abc" });
    });

    it("offers only the missing half of a half-done log", async () => {
        const user = userEvent.setup();
        serve([row({ sections: ["cla"], report: { id: "r1", url: "/r/r1", generatedAt: 0, playerCount: 0, issueCount: 0 } })]);
        show();
        const actions = actionsCell(await rowOf("Hyjal Mittwoch"));
        expect(within(actions).queryByRole("button", { name: "Auswerten" })).not.toBeInTheDocument();
        expect(within(actions).queryByRole("link", { name: "Report" })).not.toBeInTheDocument();
        await user.click(within(actions).getByRole("button", { name: "RPB" }));
        await waitFor(() => expect(api.evalLog).toHaveBeenCalledWith("l1", "rpb", { force: false }));
        expect(api.evalLog).toHaveBeenCalledTimes(1);
    });

    it("links to the report once everything is done", async () => {
        serve([
            row({ sections: ["cla", "rpb"], report: { id: "r1", url: "/r/r1", generatedAt: 0, playerCount: 0, issueCount: 0 } }),
            row({ kind: "report", id: "r2", logId: "", title: "Per Link", source: "link", sections: ["cla"], report: { id: "r2", url: "/r/r2", generatedAt: 0, playerCount: 0, issueCount: 0 } }),
        ]);
        show();
        for (const [title, url] of [["Hyjal Mittwoch", "/r/r1"], ["Per Link", "/r/r2"]]) {
            const actions = actionsCell(await rowOf(title));
            expect(within(actions).getByRole("link", { name: "Report" })).toHaveAttribute("href", url);
            expect(within(actions).getAllByRole("button")).toHaveLength(1); // the menu
        }
    });

    it("keeps everything rare in the row menu, with discard and delete last", async () => {
        const user = userEvent.setup();
        serve([row({
            sections: ["cla", "rpb"],
            report: { id: "r1", url: "/r/r1", generatedAt: 0, playerCount: 0, issueCount: 0 },
            wclUrl: "https://classic.warcraftlogs.com/reports/abc",
            guildId: "g1", channelId: "c1", messageId: "m1",
            eventId: "e1", eventLabel: "Hyjal-Raid",
        })]);
        show();
        const r = await rowOf("Hyjal Mittwoch");
        const toggle = within(r).getByRole("button", { name: "Weitere Aktionen für „Hyjal Mittwoch“" });
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        await user.click(toggle);
        const menu = within(r).getByRole("menu");
        const items = within(menu).getAllByRole("menuitem");
        expect(items.map((i) => i.textContent)).toEqual([
            "Report öffnen", "Log bei Warcraft Logs", "Nachricht im Log-Channel",
            "Zuordnung ändern", "CLA-Auswertung verwerfen", "RPB-Auswertung verwerfen",
            "Aus der Liste löschen",
        ]);
        expect(items[0]).toHaveAttribute("href", "/r/r1");
        expect(items[1]).toHaveAttribute("href", "https://classic.warcraftlogs.com/reports/abc");
        expect(items[1]).toHaveAttribute("target", "_blank");
        expect(items[2]).toHaveAttribute("href", "https://discord.com/channels/g1/c1/m1");
        expect(items[6]).toHaveClass("danger");
        expect(within(menu).getAllByRole("separator")).toHaveLength(2);
        // Escape closes it again
        await user.keyboard("{Escape}");
        expect(within(r).queryByRole("menu")).not.toBeInTheDocument();
    });

    it("offers only assign and delete for a bare log, and never a separator at the edge", async () => {
        const user = userEvent.setup();
        show();
        const r = await rowOf("Hyjal Mittwoch");
        await user.click(within(r).getByRole("button", { name: /^Weitere Aktionen/ }));
        const menu = within(r).getByRole("menu");
        expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Raid-Event zuordnen", "Aus der Liste löschen"]);
        expect(within(menu).getAllByRole("separator")).toHaveLength(1);
        expect(menu.firstElementChild).toHaveAttribute("role", "menuitem");
    });
});
