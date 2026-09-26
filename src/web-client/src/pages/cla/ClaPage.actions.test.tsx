// The Log-Auswertung's dialogs (design issue #217): "Neue Auswertung" builds a
// report from a link, "Raid-Event zuordnen" picks among the candidates, the
// page's confirm dialog guards discard/delete/unlink, and an unfinished raid
// is asked about with the boss grid. The API is mocked.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { ClaData, ClaRow, IncompleteRaidError, MatchCandidate } from "../../api";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { t } from "../../i18n";
import ClaPage from "./ClaPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getClaData: vi.fn(),
    evalLog: vi.fn(),
    createReport: vi.fn(),
    resetEval: vi.fn(),
    deleteLogEntry: vi.fn(),
    deleteReport: vi.fn(),
    linkLog: vi.fn(),
    unlinkLog: vi.fn(),
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

function serve(items: ClaRow[]) {
    const d: ClaData = {
        filter: "all",
        page: { items, sort: "date", dir: "desc", page: 1, totalPages: 1, total: items.length, pageSize: 25 },
        counts: { all: items.length, open: 0, unlinked: 0, done: 0 },
        autoMatchCount: 0,
        matchEventsError: null,
        logChannelsConfigured: true,
        activeGuildId: "g1",
    };
    vi.mocked(api.getClaData).mockResolvedValue(d);
}

const REPORT = { id: "r1", url: "/r/r1", generatedAt: 0, playerCount: 0, issueCount: 0 };

async function rowOf(title: string): Promise<HTMLElement> {
    const el = await screen.findByText(title, { selector: "[role=\"cell\"] *" });
    const r = el.closest<HTMLElement>("[role=\"row\"]");
    if (!r) throw new Error(`no row for ${title}`);
    return r;
}

/** The open dialog whose head reads `title` (only an open dialog renders its content). */
function dialog(title: string): HTMLElement {
    const heads = screen.getAllByText(title).map((el) => el.closest("dialog")).filter((d): d is HTMLDialogElement => !!d && d.open);
    if (!heads.length) throw new Error(`no open dialog "${title}"`);
    return heads[0];
}

async function openMenuItem(title: string, item: string) {
    const user = userEvent.setup();
    const r = await rowOf(title);
    await user.click(within(r).getByRole("button", { name: /^Weitere Aktionen/ }));
    await user.click(within(r).getByRole("menuitem", { name: item }));
}

beforeEach(() => {
    serve([row()]);
    vi.mocked(api.evalLog).mockResolvedValue({ status: "done", url: "/r/abc" });
    vi.mocked(api.createReport).mockResolvedValue({ id: "r9", url: "/r/r9" });
    vi.mocked(api.resetEval).mockResolvedValue({ logId: "l1", section: "cla", remaining: [], message: "Verworfen." });
    vi.mocked(api.deleteLogEntry).mockResolvedValue({ logId: "l1" });
    vi.mocked(api.deleteReport).mockResolvedValue({ reportId: "r1", logId: "", message: "Report gelöscht." });
    vi.mocked(api.linkLog).mockResolvedValue({ logId: "l1", eventId: "e1", eventLabel: "Hyjal", message: "Zugeordnet." });
    vi.mocked(api.unlinkLog).mockResolvedValue({ logId: "l1", message: "Zuordnung entfernt." });
});

// Drafts live in sessionStorage, which the shared setup does not clear.
afterEach(() => window.sessionStorage.clear());

describe("Log-Auswertung: Neue Auswertung", () => {
    it("offers three option cards, CLA + RPB preselected, and builds the report from the link", async () => {
        const user = userEvent.setup();
        renderPage(<ClaPage />, { route: "/cla" });
        await user.click(await screen.findByRole("button", { name: "Neue Auswertung" }));
        const dlg = dialog("Warcraft-Logs-Report per Link");
        const opts = within(within(dlg).getByRole("radiogroup", { name: "Welche Analysen" })).getAllByRole("radio");
        expect(opts.map((o) => o.querySelector("b")?.textContent)).toEqual(["CLA + RPB", "nur CLA", "nur RPB"]);
        const icons = opts.map((o) => decodeURIComponent(o.querySelector("img")?.getAttribute("src") || ""));
        expect(icons[0]).toContain("inv_misc_book_09");
        expect(icons[1]).toContain("inv_chest_cloth_43");
        expect(icons[2]).toContain("ability_warrior_offensivestance");
        expect(opts[0]).toHaveAttribute("aria-checked", "true");

        const go = within(dlg).getByRole("button", { name: "Auswerten" });
        expect(go).toBeDisabled();
        // the hint is a tooltip on the "?"
        const qm = within(dlg).getByText("?");
        expect(qm).toHaveAttribute("data-tip", "Report-Link oder -ID");
        expect(qm.getAttribute("data-tip-sub")).toBeTruthy();

        await user.type(within(dlg).getByLabelText(/Report-Link oder Report-ID/), "https://classic.warcraftlogs.com/reports/abc");
        await user.click(go);
        await waitFor(() => expect(api.createReport).toHaveBeenCalledWith("https://classic.warcraftlogs.com/reports/abc", { force: false, sections: ["cla", "rpb"] }));
        // the dialog closes at once, the toast reports the finished report
        expect(screen.queryByText("Warcraft-Logs-Report per Link")).not.toBeInTheDocument();
        expect(await screen.findByText("Auswertung erstellt.")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Report ansehen" })).toHaveAttribute("href", "/r/r9");
    });

    it("builds only the chosen half", async () => {
        const user = userEvent.setup();
        renderPage(<ClaPage />, { route: "/cla" });
        await user.click(await screen.findByRole("button", { name: "Neue Auswertung" }));
        const dlg = dialog("Warcraft-Logs-Report per Link");
        await user.type(within(dlg).getByLabelText(/Report-Link oder Report-ID/), "abc123");
        await user.click(within(dlg).getByRole("radio", { name: /nur CLA/ }));
        expect(within(dlg).getByRole("radio", { name: /nur CLA/ })).toHaveAttribute("aria-checked", "true");
        await user.click(within(dlg).getByRole("button", { name: "Auswerten" }));
        await waitFor(() => expect(api.createReport).toHaveBeenCalledWith("abc123", { force: false, sections: ["cla"] }));
    });

    it("keeps the draft when the dialog is closed and clears it once submitted", async () => {
        const user = userEvent.setup();
        renderPage(<ClaPage />, { route: "/cla" });
        const open = async () => {
            await user.click(await screen.findByRole("button", { name: "Neue Auswertung" }));
            return dialog("Warcraft-Logs-Report per Link");
        };
        let dlg = await open();
        await user.type(within(dlg).getByLabelText(/Report-Link oder Report-ID/), "abc123");
        await user.click(within(dlg).getByRole("radio", { name: /nur RPB/ }));
        await user.click(within(dlg).getByRole("button", { name: "Abbrechen" }));
        expect(api.createReport).not.toHaveBeenCalled();

        dlg = await open();
        expect(within(dlg).getByLabelText(/Report-Link oder Report-ID/)).toHaveValue("abc123");
        expect(within(dlg).getByRole("radio", { name: /nur RPB/ })).toHaveAttribute("aria-checked", "true");
        await user.click(within(dlg).getByRole("button", { name: "Auswerten" }));
        await waitFor(() => expect(api.createReport).toHaveBeenCalledWith("abc123", { force: false, sections: ["rpb"] }));

        dlg = await open();
        expect(within(dlg).getByLabelText(/Report-Link oder Report-ID/)).toHaveValue("");
        expect(within(dlg).getByRole("radio", { name: /CLA \+ RPB/ })).toHaveAttribute("aria-checked", "true");
    });
});

describe("Log-Auswertung: Raid-Event zuordnen", () => {
    const cands: MatchCandidate[] = [
        { eventId: "e1", title: "Hyjal Mittwoch", startTime: 1789588800, categoryName: "T6", diffMs: 30 * 60000, sameCategory: true, contentId: "hyjal" },
        { eventId: "e2", title: "BT Mittwoch", startTime: 1789592400, categoryName: "", diffMs: -(2 * 60 + 13) * 60000, sameCategory: false, contentId: "bt" },
    ];

    it("assigns from candidate rows, the first preselected, and has no dropdown", async () => {
        const user = userEvent.setup();
        serve([row({ title: "Log 16.09.", candidates: cands, matchAmbiguous: true })]);
        renderPage(<ClaPage />, { route: "/cla" });
        const r = await rowOf("Log 16.09.");
        const open = within(r).getByRole("button", { name: /Zuordnen/ });
        expect(open).toHaveTextContent("2");
        expect(open).toHaveAttribute("data-tip", "Mehrere Events passen");
        expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
        await user.click(open);

        const dlg = dialog("Raid-Event zuordnen");
        expect(within(dlg).getByText(/^Log 16\.09\. · gepostet /)).toBeInTheDocument();
        expect(within(dlg).getByText("2 Events passen")).toBeInTheDocument();
        const radios = within(within(dlg).getByRole("radiogroup", { name: "Passende Raid-Events" })).getAllByRole("radio");
        expect(radios).toHaveLength(2);
        expect(radios[0]).toHaveAttribute("aria-checked", "true");
        expect(radios[1]).toHaveAttribute("aria-checked", "false");
        expect(within(radios[0]).getByText("30 min nach Start")).toBeInTheDocument();
        expect(within(radios[0]).getByText("gleiche Kategorie")).toBeInTheDocument();
        expect(within(radios[1]).getByText("2 h 13 min vor Start")).toBeInTheDocument();
        expect(within(radios[1]).queryByText("gleiche Kategorie")).not.toBeInTheDocument();

        await user.click(radios[1]);
        expect(radios[1]).toHaveAttribute("aria-checked", "true");
        await user.click(within(dlg).getByRole("button", { name: "Zuordnen" }));
        await waitFor(() => expect(api.linkLog).toHaveBeenCalledWith("l1", "e2"));
        expect(await screen.findByText("Zugeordnet.")).toBeInTheDocument();
        expect(screen.queryByText("Raid-Event zuordnen")).not.toBeInTheDocument();
    });

    it("preselects the current event of a linked log and offers to remove it behind a question", async () => {
        const user = userEvent.setup();
        serve([row({ title: "Log 16.09.", candidates: cands, eventId: "e2", eventLabel: "BT Mittwoch", eventLinkSource: "auto" })]);
        renderPage(<ClaPage />, { route: "/cla" });
        await openMenuItem("Log 16.09.", "Zuordnung ändern");
        const dlg = dialog("Raid-Event zuordnen");
        expect(within(dlg).getByText("ist zugeordnet (automatisch)")).toBeInTheDocument();
        const current = within(dlg).getByRole("radio", { name: /BT Mittwoch/ });
        expect(current).toHaveAttribute("aria-checked", "true");
        expect(within(current).getByText("aktuell")).toBeInTheDocument();
        // assigning the same event again is not offered
        expect(within(dlg).getByRole("button", { name: "Zuordnen" })).toBeDisabled();

        await user.click(within(dlg).getByRole("button", { name: "Zuordnung entfernen" }));
        const ask = dialog("Zuordnung entfernen?");
        expect(within(ask).getByText(/„Log 16\.09\.“ zu „BT Mittwoch“/)).toBeInTheDocument();
        await user.click(within(ask).getByRole("button", { name: "Entfernen" }));
        await waitFor(() => expect(api.unlinkLog).toHaveBeenCalledWith("l1"));
        expect(await screen.findByText("Zuordnung entfernt.")).toBeInTheDocument();
    });

    it("says so when no event fits", async () => {
        renderPage(<ClaPage />, { route: "/cla" });
        await openMenuItem("Hyjal Mittwoch", "Raid-Event zuordnen");
        const dlg = dialog("Raid-Event zuordnen");
        expect(within(dlg).getByText("Kein Raid-Event mit passender Startzeit gefunden.")).toBeInTheDocument();
        expect(within(dlg).getByRole("button", { name: "Zuordnen" })).toBeDisabled();
    });
});

describe("Log-Auswertung: asking first", () => {
    it("asks before discarding a half and only discards on the confirming button", async () => {
        const user = userEvent.setup();
        serve([row({ sections: ["cla", "rpb"], report: REPORT })]);
        renderPage(<ClaPage />, { route: "/cla" });
        await openMenuItem("Hyjal Mittwoch", "CLA-Auswertung verwerfen");
        let ask = dialog("CLA-Auswertung verwerfen?");
        await user.click(within(ask).getByRole("button", { name: t("common.cancel") }));
        expect(api.resetEval).not.toHaveBeenCalled();

        await openMenuItem("Hyjal Mittwoch", "CLA-Auswertung verwerfen");
        ask = dialog("CLA-Auswertung verwerfen?");
        await user.click(within(ask).getByRole("button", { name: "Verwerfen" }));
        await waitFor(() => expect(api.resetEval).toHaveBeenCalledWith("l1", "cla"));
        expect(await screen.findByText("Verworfen.")).toBeInTheDocument();
    });

    it("asks before deleting a log from the list", async () => {
        const user = userEvent.setup();
        renderPage(<ClaPage />, { route: "/cla" });
        await openMenuItem("Hyjal Mittwoch", "Aus der Liste löschen");
        const ask = dialog("Log aus der Liste löschen?");
        expect(within(ask).getByText(/Eine vorhandene Auswertung bleibt als Report erhalten/)).toBeInTheDocument();
        await user.click(within(ask).getByRole("button", { name: "Löschen" }));
        await waitFor(() => expect(api.deleteLogEntry).toHaveBeenCalledWith("l1"));
        expect(await screen.findByText("Gelöscht.")).toBeInTheDocument();
    });

    it("asks before deleting a report built from a link", async () => {
        const user = userEvent.setup();
        serve([row({ kind: "report", id: "r1", logId: "", title: "Per Link", source: "link", sections: ["cla"], report: REPORT })]);
        renderPage(<ClaPage />, { route: "/cla" });
        await openMenuItem("Per Link", "Auswertung löschen");
        const ask = dialog("Auswertung löschen?");
        await user.keyboard("{Escape}");
        expect(api.deleteReport).not.toHaveBeenCalled();
        expect(ask).not.toHaveAttribute("open");

        await openMenuItem("Per Link", "Auswertung löschen");
        await user.click(within(dialog("Auswertung löschen?")).getByRole("button", { name: "Löschen" }));
        await waitFor(() => expect(api.deleteReport).toHaveBeenCalledWith("r1"));
    });
});

describe("Log-Auswertung: a raid that is still running", () => {
    const refusal: IncompleteRaidError = {
        code: api.RAID_INCOMPLETE,
        message: "Archimonde liegt nicht.",
        raids: [{
            contentId: "hyjal", label: "Hyjal", killed: 3, total: 5, finalKilled: false, finalBoss: "Archimonde",
            missing: ["Azgalor", "Archimonde"],
            bosses: [
                { name: "Rage Winterchill", killed: true }, { name: "Anetheron", killed: true }, { name: "Kaz'rogal", killed: true },
                { name: "Azgalor", killed: false }, { name: "Archimonde", killed: false },
            ],
        }],
    };

    it("asks with the boss grid and evaluates both halves with the answer reused", async () => {
        const user = userEvent.setup();
        vi.mocked(api.evalLog).mockRejectedValueOnce(refusal).mockResolvedValue({ status: "done", url: "/r/abc" });
        renderPage(<ClaPage />, { route: "/cla" });
        await user.click(within(await rowOf("Hyjal Mittwoch")).getByRole("button", { name: "Auswerten" }));

        const ask = await waitFor(() => dialog(t("jobs.incomplete.title")));
        const grid = within(ask).getByRole("list", { name: t("jobs.incomplete.bosses", { raid: "Hyjal" }) });
        const bosses = within(grid).getAllByRole("listitem");
        expect(bosses.map((b) => b.textContent)).toEqual(["Rage Winterchill", "Anetheron", "Kaz'rogal", "Azgalor", "Archimonde"]);
        // down with a check, still standing dashed
        expect(bosses[0]).toHaveClass("ok");
        expect(bosses[3]).toHaveClass("miss");
        expect(within(ask).getByText("Hyjal 3/5")).toHaveClass("mid");
        expect(api.evalLog).toHaveBeenCalledTimes(1);

        await user.click(within(ask).getByRole("button", { name: t("jobs.incomplete.action") }));
        await waitFor(() => expect(api.evalLog).toHaveBeenCalledTimes(3));
        expect(vi.mocked(api.evalLog).mock.calls).toEqual([
            ["l1", "cla", { force: false }],
            ["l1", "cla", { force: true }],
            ["l1", "rpb", { force: true }],
        ]);
        expect(await screen.findByText("CLA + RPB ausgewertet.")).toBeInTheDocument();
    });

    it("stops the job when the question is declined", async () => {
        const user = userEvent.setup();
        vi.mocked(api.evalLog).mockRejectedValueOnce(refusal);
        renderPage(<ClaPage />, { route: "/cla" });
        await user.click(within(await rowOf("Hyjal Mittwoch")).getByRole("button", { name: "Auswerten" }));
        const ask = await waitFor(() => dialog(t("jobs.incomplete.title")));
        await user.click(within(ask).getByRole("button", { name: t("common.cancel") }));
        expect(await screen.findByText(t("jobs.incomplete.cancelled"))).toBeInTheDocument();
        expect(api.evalLog).toHaveBeenCalledTimes(1);
    });
});

describe("Log-Auswertung dialogs in English", () => {
    afterEach(() => switchLang("de"));

    it("assigns a raid event in English, with the offset spelled out", async () => {
        await switchLang("en");
        const user = userEvent.setup();
        serve([row({ title: "Log 16.09.", candidates: [
            { eventId: "e1", title: "Hyjal Mittwoch", startTime: 1789588800, categoryName: "T6", diffMs: 30 * 60000, sameCategory: true, contentId: "hyjal" },
            { eventId: "e2", title: "BT Mittwoch", startTime: 1789592400, categoryName: "", diffMs: -(2 * 60 + 13) * 60000, sameCategory: false, contentId: "bt" },
        ], matchAmbiguous: true })]);
        renderPage(<ClaPage />, { route: "/cla" });
        const r = await rowOf("Log 16.09.");
        const open = within(r).getByRole("button", { name: /Assign/ });
        expect(open).toHaveAttribute("data-tip", "Several events fit");
        await user.click(open);

        const dlg = dialog("Assign raid event");
        expect(within(dlg).getByText(/^Log 16\.09\. · posted /)).toBeInTheDocument();
        expect(within(dlg).getByText("2 events fit")).toBeInTheDocument();
        const radios = within(within(dlg).getByRole("radiogroup", { name: "Matching raid events" })).getAllByRole("radio");
        expect(within(radios[0]).getByText("30 min after start")).toBeInTheDocument();
        expect(within(radios[0]).getByText("same category")).toBeInTheDocument();
        expect(within(radios[1]).getByText("2 h 13 min before start")).toBeInTheDocument();
        expect(within(dlg).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    it("offers the new evaluation's analyses in English", async () => {
        await switchLang("en");
        const user = userEvent.setup();
        renderPage(<ClaPage />, { route: "/cla" });
        await user.click(await screen.findByRole("button", { name: "New evaluation" }));
        const dlg = dialog("New evaluation");
        expect(within(dlg).getByText("Report link or report ID")).toBeInTheDocument();
        const opts = within(within(dlg).getByRole("radiogroup")).getAllByRole("radio");
        expect(opts.map((o) => o.querySelector("b")?.textContent)).toEqual(["CLA + RPB", "CLA only", "RPB only"]);
        expect(within(opts[0]).getByText("Full evaluation on one report page")).toBeInTheDocument();
    });
});
