// The Kaderplaner live (docs/kaderplaner.md, "Live"), rendered against a mocked
// api: somebody else's change is fetched and said in a toast (never one's own),
// unsaved input survives it, a save over somebody else's change asks instead
// of overwriting (autosave pauses, no loop), who else is here shows in the
// header, on the rows and in the open interview — and the logs: a player's
// Verlauf, the Kader's Aktivität, no "seit … / zuletzt gespeichert" lines on
// the form, the open required questions as a count.
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { KaderActivityItem, KaderData, KaderLive, KaderPresence } from "../../api";
import { t } from "../../i18n";
import { renderPage } from "../../test/render";
import { kader as kaderData, kaderView, ME, U } from "./kader.fixture";
import KaderPage from "./KaderPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getKader: vi.fn(),
    getKaderOnly: vi.fn(),
    getKaderLive: vi.fn(),
    leaveKaderLive: vi.fn(),
    // the roster button of the decision page (#658, RosterLink.test.tsx tests it)
    getKaderRoster: vi.fn(async () => null),
    saveKaderInterview: vi.fn(),
    saveKaderAssignment: vi.fn(),
}));

const PATH = "/kader/:kaderId?/:sub?";
const NAMES = { ...kaderView().names, [U.lead2]: "Lena" };
const view = (k: KaderData = kaderData()) => kaderView({ names: NAMES, kader: k });
const answer = (over: Partial<KaderLive> = {}): KaderLive => ({ rev: 0, sharedRev: 0, changes: [], more: false, presence: [], ...over });
const line = (over: Partial<KaderActivityItem>): KaderActivityItem => ({ rev: 50, at: "2026-10-01T19:49:00.000Z", by: U.lead2, type: "state", ...over });
const LENA_ON_LISS: KaderPresence = { userId: U.lead2, name: "Lena", sub: "vorauswahl", playerId: U.mage, what: "interview", edit: true };

/** The Kader after Lena saved Liss's interview: another note, a newer revision. */
function lenaSaved(rev = 60): KaderData {
    const k = kaderData({ rev });
    k.players[U.mage].interview = { ...k.players[U.mage].interview, note: "Lenas Notiz", updatedBy: U.lead2, rev };
    return k;
}

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
    localStorage.clear();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    vi.mocked(api.getKader).mockImplementation(async () => view());
    vi.mocked(api.getKaderLive).mockResolvedValue(answer());
});

/** One poll now (the page asks at once when the tab becomes visible). */
const poll = () => act(async () => { document.dispatchEvent(new Event("visibilitychange")); await Promise.resolve(); });

async function show(route: string) {
    renderPage(<KaderPage />, { route, path: PATH });
    await screen.findByRole("button", { name: /Forever-Kader/ });
    await waitFor(() => expect(api.getKaderLive).toHaveBeenCalled());
}

describe("KaderPage · live", () => {
    describe("somebody else's change", () => {
        it("fetches only the Kader again and says who did what", async () => {
            await show("/kader/k1/pool");
            const moved = kaderData({ rev: 50 });
            moved.players[U.mage].state = "provisional";
            vi.mocked(api.getKaderOnly).mockResolvedValue({ kader: moved, kaders: kaderView().kaders, sharedRev: 0 });
            vi.mocked(api.getKaderLive).mockResolvedValue(answer({ rev: 50, changes: [line({ playerId: U.mage, from: "selected", to: "provisional" })] }));
            await poll();
            expect(await screen.findByText("Lena hat Liss ins vorläufige Roster geschoben")).toBeInTheDocument();
            expect(api.getKaderOnly).toHaveBeenCalledWith("k1");
            expect(api.getKader).toHaveBeenCalledTimes(1);
            const nav = screen.getByRole("navigation", { name: t("kader.nav.aria") });
            expect(within(nav).getByRole("link", { name: t("kader.nav.count.provisional", { count: 2 }) })).toBeInTheDocument();
        });

        it("fetches the whole view when players came in, and says nothing about one's own changes", async () => {
            await show("/kader/k1/pool");
            vi.mocked(api.getKaderLive).mockResolvedValue(answer({ rev: 51, changes: [line({ rev: 51, by: ME, type: "added", count: 4 })] }));
            vi.mocked(api.getKader).mockImplementation(async () => view(kaderData({ rev: 51 })));
            await poll();
            await waitFor(() => expect(api.getKader).toHaveBeenCalledTimes(2));
            expect(screen.queryByText(/in den Pool übernommen/)).toBeNull();
        });

        it("asks nothing while the tab is hidden", async () => {
            await show("/kader/k1/pool");
            const before = vi.mocked(api.getKaderLive).mock.calls.length;
            visibility = "hidden";
            await poll();
            expect(api.getKaderLive).toHaveBeenCalledTimes(before);
        });
    });

    describe("unsaved input", () => {
        it("keeps a half-typed interview note when Lena saves the same interview, pauses autosave and asks", async () => {
            vi.mocked(api.saveKaderInterview).mockResolvedValue({ kader: lenaSaved(70), kaders: [] });
            await show(`/kader/k1/vorauswahl?spieler=${U.mage}`);
            const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
            const note = within(panel).getByPlaceholderText(t("kader.interview.notePlaceholder"));
            await userEvent.type(note, " und Arkan");
            // Lena's save arrives before the autosave went out
            vi.mocked(api.getKaderOnly).mockResolvedValue({ kader: lenaSaved(), kaders: kaderView().kaders, sharedRev: 0 });
            vi.mocked(api.getKaderLive).mockResolvedValue(answer({ rev: 60, changes: [line({ rev: 60, type: "interview", playerId: U.mage })] }));
            await poll();
            const banner = await within(panel).findByRole("alert");
            expect(banner).toHaveTextContent(t("kader.live.conflict.interview", { name: "Lena" }));
            expect(note).toHaveValue("Will Frost spielen und Arkan");
            // autosave waits for the decision: nothing goes out by itself
            await new Promise((r) => setTimeout(r, 1100));
            expect(api.saveKaderInterview).not.toHaveBeenCalled();
            await userEvent.click(within(banner).getByRole("button", { name: t("kader.live.conflict.overwrite") }));
            expect(api.saveKaderInterview).toHaveBeenCalledWith("k1", U.mage, { note: "Will Frost spielen und Arkan" }, { baseRev: 60, force: true });
            await waitFor(() => expect(within(panel).queryByRole("alert")).toBeNull());
        });

        it("takes Lena's version by itself when nothing is unsaved here", async () => {
            await show(`/kader/k1/vorauswahl?spieler=${U.mage}`);
            const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
            vi.mocked(api.getKaderOnly).mockResolvedValue({ kader: lenaSaved(), kaders: kaderView().kaders, sharedRev: 0 });
            vi.mocked(api.getKaderLive).mockResolvedValue(answer({ rev: 60, changes: [line({ rev: 60, type: "interview", playerId: U.mage })] }));
            await poll();
            await waitFor(() => expect(within(panel).getByPlaceholderText(t("kader.interview.notePlaceholder"))).toHaveValue("Lenas Notiz"));
            expect(within(panel).queryByRole("alert")).toBeNull();
            expect(await screen.findByText("Lena hat das Gespräch mit Liss bearbeitet")).toBeInTheDocument();
        });

        it("answers a save refused as stale with the choice, without a loop, and reloads on request", async () => {
            vi.mocked(api.saveKaderInterview).mockRejectedValue({ code: "stale", message: "geändert", by: U.lead2, rev: 60 });
            vi.mocked(api.getKaderOnly).mockResolvedValue({ kader: lenaSaved(), kaders: kaderView().kaders, sharedRev: 0 });
            await show(`/kader/k1/vorauswahl?spieler=${U.mage}`);
            const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
            const note = within(panel).getByPlaceholderText(t("kader.interview.notePlaceholder"));
            await userEvent.type(note, "!");
            await waitFor(() => expect(api.saveKaderInterview).toHaveBeenCalledWith("k1", U.mage, { note: "Will Frost spielen!" }, { baseRev: 0 }), { timeout: 2500 });
            const banner = await within(panel).findByRole("alert");
            expect(banner).toHaveTextContent(t("kader.live.conflict.interview", { name: "Lena" }));
            expect(screen.queryByText("geändert")).toBeNull();
            await userEvent.type(note, "?");
            await new Promise((r) => setTimeout(r, 1100));
            expect(api.saveKaderInterview).toHaveBeenCalledTimes(1);
            expect(within(panel).getByRole("status", { name: "" })).toBeTruthy();
            await userEvent.click(within(banner).getByRole("button", { name: t("kader.live.conflict.reload") }));
            expect(note).toHaveValue("Lenas Notiz");
            expect(within(panel).queryByRole("alert")).toBeNull();
        });

        it("keeps a half-typed comment in the drawer when the player changes live", async () => {
            await show(`/kader/k1/roster?spieler=${U.heal}`);
            const drawer = screen.getByRole("complementary", { name: t("kader.decide.drawer", { name: "Mira" }) });
            await userEvent.type(within(drawer).getByRole("textbox", { name: t("kader.decide.comment") }), "Halb getippt");
            const benched = kaderData({ rev: 52 });
            benched.players[U.heal].state = "bench";
            vi.mocked(api.getKaderOnly).mockResolvedValue({ kader: benched, kaders: kaderView().kaders, sharedRev: 0 });
            vi.mocked(api.getKaderLive).mockResolvedValue(answer({ rev: 52, changes: [line({ rev: 52, playerId: U.heal, from: "provisional", to: "bench" })] }));
            await poll();
            await screen.findByText("Lena hat Mira auf die Bench gesetzt");
            const now = screen.getByRole("complementary", { name: t("kader.decide.drawer", { name: "Mira" }) });
            expect(within(now).getByRole("textbox", { name: t("kader.decide.comment") })).toHaveValue("Halb getippt");
        });

        it("asks in the account dialog when a save meets somebody else's change, and overwrites on request", async () => {
            vi.mocked(api.saveKaderAssignment)
                .mockRejectedValueOnce({ code: "stale", message: "geändert", by: U.lead2, rev: 9 })
                .mockResolvedValue(view());
            await show("/kader/k1/pool");
            await userEvent.click(screen.getByRole("button", { name: "Aldric" }));
            const dialog = await screen.findByRole("dialog");
            await userEvent.type(within(dialog).getByLabelText(t("kader.field.firstName")), "x");
            await userEvent.click(within(dialog).getByRole("button", { name: t("common.apply") }));
            const banner = await within(dialog).findByRole("alert");
            expect(banner).toHaveTextContent(t("kader.live.conflict.account", { name: "Lena" }));
            expect(vi.mocked(api.saveKaderAssignment).mock.calls[0][4]).toEqual({ baseRev: 0 });
            await userEvent.click(within(banner).getByRole("button", { name: t("kader.live.conflict.overwrite") }));
            await waitFor(() => expect(api.saveKaderAssignment).toHaveBeenCalledTimes(2));
            expect(vi.mocked(api.saveKaderAssignment).mock.calls[1][4]).toEqual({ force: true });
        });
    });

    describe("who else is here", () => {
        it("marks the player Lena has open, says so in the interview and reports one's own interview", async () => {
            vi.mocked(api.getKaderLive).mockResolvedValue(answer({ presence: [LENA_ON_LISS] }));
            await show(`/kader/k1/vorauswahl?spieler=${U.mage}`);
            const list = screen.getByRole("region", { name: t("kader.interview.listTitle") });
            expect(await within(list).findByRole("img", { name: t("kader.live.presence.interviewEdit", { name: "Lena" }) })).toBeInTheDocument();
            const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
            expect(within(panel).getByText(t("kader.live.presence.alsoInterviewEdit", { name: "Lena" }))).toBeInTheDocument();
            await waitFor(() => expect(api.getKaderLive).toHaveBeenLastCalledWith("k1", 0, expect.objectContaining({ sub: "vorauswahl", playerId: U.mage, what: "interview", edit: true })));
        });

        it("rings a lead who is here and adds somebody else with access beside the leads", async () => {
            vi.mocked(api.getKader).mockImplementation(async () => view(kaderData({ leads: [ME, U.lead2] })));
            vi.mocked(api.getKaderLive).mockResolvedValue(answer({ presence: [
                { ...LENA_ON_LISS, sub: "uebersicht", playerId: "", what: "", edit: false },
                { userId: U.guest, name: "Gast", sub: "pool", playerId: "", what: "", edit: false },
            ] }));
            await show("/kader/k1/pool");
            const lena = await screen.findByRole("img", { name: t("kader.live.presence.where", { name: "Lena", where: t("kader.live.where.uebersicht") }) });
            expect(lena).toHaveClass("kp-online");
            const guests = screen.getByRole("group", { name: t("kader.live.presence.others") });
            expect(within(guests).getByRole("img", { name: t("kader.live.presence.where", { name: "Gast", where: t("kader.live.where.pool") }) })).toBeInTheDocument();
        });

        it("marks the card of a player somebody looks at", async () => {
            vi.mocked(api.getKaderLive).mockResolvedValue(answer({ presence: [{ ...LENA_ON_LISS, sub: "roster", playerId: U.heal, what: "drawer", edit: false }] }));
            await show("/kader/k1/roster");
            expect(await screen.findByRole("img", { name: t("kader.live.presence.drawerView", { name: "Lena" }) })).toBeInTheDocument();
        });
    });

    describe("the logs instead of meta lines", () => {
        it("keeps 'seit' and 'zuletzt gespeichert' off the interview; the open required questions are a count", async () => {
            await show(`/kader/k1/vorauswahl?spieler=${U.mage}`);
            const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
            expect(panel).not.toHaveTextContent(/seit \d/);
            expect(panel).not.toHaveTextContent(/Zuletzt gespeichert/);
            expect(within(panel).getByText(t("kader.interview.missingN", { count: 1 }))).toHaveAttribute("data-tip", t("kader.interview.missingTip", { list: "Mögliche Raidtage" }));
            expect(within(panel).getByRole("status", { name: "" })).toHaveAttribute("data-tip", t("kader.interview.saved"));
        });

        it("shows a player's Verlauf newest first from the interview's head", async () => {
            const k = kaderData();
            k.players[U.mage].history = [
                { at: "2026-09-28T18:00:00.000Z", by: ME, type: "added", to: "pool" },
                { at: "2026-09-30T18:00:00.000Z", by: ME, type: "state", from: "pool", to: "selected" },
                { at: "2026-10-01T17:49:00.000Z", by: U.lead2, type: "interview_saved" },
            ];
            vi.mocked(api.getKader).mockImplementation(async () => view(k));
            await show(`/kader/k1/vorauswahl?spieler=${U.mage}`);
            const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
            await userEvent.click(within(panel).getByRole("button", { name: t("kader.log.history") }));
            const log = screen.getByRole("dialog", { name: t("kader.log.historyTitle", { name: "Liss" }) });
            const items = within(log).getAllByRole("listitem");
            expect(items[0]).toHaveTextContent("01.10. 19:49");
            expect(items[0]).toHaveTextContent(t("kader.history.saved"));
            expect(items[0]).toHaveTextContent("Lena");
            expect(items[1]).toHaveTextContent(t("kader.history.state", { from: t("kader.state.pool"), to: t("kader.state.selected") }));
        });

        it("lists the Kader's Aktivität newest first and filters it by person", async () => {
            const k = kaderData({ rev: 3, activity: [
                line({ rev: 1, by: ME, type: "added", count: 3 }),
                line({ rev: 2, playerId: U.mage, from: "pool", to: "selected" }),
                line({ rev: 3, type: "interview", playerId: U.mage }),
            ] });
            vi.mocked(api.getKader).mockImplementation(async () => view(k));
            await show("/kader/k1/pool");
            await userEvent.click(screen.getByRole("button", { name: t("kader.log.activity") }));
            const dialog = await screen.findByRole("dialog");
            const rows = within(dialog).getAllByRole("listitem");
            expect(rows.map((r) => r.textContent)).toEqual([
                expect.stringContaining("Lena hat das Gespräch mit Liss bearbeitet"),
                expect.stringContaining("Lena hat Liss in die Vorauswahl geschoben"),
                expect.stringContaining("Admin hat 3 Spieler in den Pool übernommen"),
            ]);
            await userEvent.click(within(dialog).getByRole("button", { name: `${t("kader.log.person")}: ${t("kader.log.all")}` }));
            await userEvent.click(screen.getByRole("menuitemradio", { name: /Admin/ }));
            expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
        });
    });
});
