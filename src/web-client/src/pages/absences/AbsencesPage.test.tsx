// Roster › Abwesenheiten as the orga uses it: the timeline draws bars and rings
// on the right days, the filters reach the request or the rows, the view switch
// shows one card per coming raid, a row opens the raider drawer (which deletes
// an entry), the hint is a quiet "Hinweis" without a DM button, and "Abwesenheit
// eintragen" opens the signup page's dialog. The API is mocked at its transport
// (api/client), so every test also pins the request that is sent.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import type { AbsenceOverview, AbsencePeriod, AbsenceRaider, AbsenceRaiderDetail, AvailabilityData } from "../../api";
import { t } from "../../i18n";
import { renderPage, adminUser } from "../../test/render";
import { switchLang } from "../../test/i18n";
import AbsencesPage from "./AbsencesPage";

vi.mock("../../api/client", async (orig) => ({ ...(await orig<typeof import("../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const period = (id: string, from: string, to: string, days: number, over: Partial<AbsencePeriod> = {}): AbsencePeriod => ({
    id, kind: "absence", from, to, days, comment: "", categoryId: "", categoryName: "", byOrga: false, state: "planned", ...over,
});

const raider = (userId: string, character: string, over: Partial<AbsenceRaider> = {}): AbsenceRaider => ({
    userId, name: `${character}-acc`, character, spec: "Priest-Holy", specLabel: "Heilig", classId: "Priest", classColor: "#FFFFFF",
    specIcon: "spell_holy_guardianspirit", role: "healer", periods: [], singles: [], longest: 0, long: false, awayToday: false,
    hint: null, onlyPresence: false, firstDay: "9999", ...over,
});

const HINT = { categoryId: "mon", categoryName: "TBC Montag", count: 3, of: 4, days: ["2026-09-14", "2026-09-21", "2026-10-05"] };
const gap = (need: number, have: number, away: number) => ({ need, have, away });
const at = (day: string) => Date.parse(`${day}T17:30:00Z`) / 1000;
const absent = (userId: string, how: "period" | "single" = "period", until = "") => ({ userId, how, until, comment: "" });

function overview(over: Partial<AbsenceOverview> = {}): AbsenceOverview {
    return {
        from: "2026-10-05", to: "2026-11-29", today: "2026-10-08", weeks: 8,
        categories: [{ id: "mon", name: "TBC Montag" }, { id: "wed", name: "TBC Mittwoch" }],
        raiders: [
            raider("202", "Heilchen", { periods: [period("p2", "2026-10-07", "2026-10-09", 3, { state: "running" })], awayToday: true, longest: 3 }),
            raider("201", "Tankadin", {
                spec: "Paladin-Protection", specLabel: "Schutz", classId: "Paladin", classColor: "#F58CBA", role: "tank",
                periods: [period("p1", "2026-10-12", "2026-11-08", 28, { comment: "Urlaub" })], longest: 28, long: true,
            }),
            raider("205", "Weltreise", { periods: [period("p5", "2026-09-28", "2026-12-10", 74)], longest: 74, long: true }),
            raider("203", "Nwek", { spec: "Druid-Restoration", classId: "Druid", singles: [{ eventId: "e2", day: "2026-10-19", title: "Kara Montag" }], hint: HINT }),
            raider("204", "Daheim", { periods: [period("p4", "2026-10-14", "2026-10-15", 2, { kind: "presence" })], onlyPresence: true }),
        ],
        raids: [
            { id: "e0", title: "Kara alt", startTime: at("2026-10-05"), day: "2026-10-05", categoryId: "mon", categoryName: "TBC Montag", size: 10, signed: 9, away: 0, roles: { tank: gap(2, 2, 0), healer: gap(3, 3, 0) }, absent: [], url: "" },
            { id: "e1", title: "Kara Montag", startTime: at("2026-10-12"), day: "2026-10-12", categoryId: "mon", categoryName: "TBC Montag", size: 25, signed: 20, away: 1, roles: { tank: gap(2, 1, 1), healer: gap(5, 5, 0) }, absent: [{ ...absent("201", "period", "2026-11-08"), comment: "Urlaub" }], url: "https://discord.com/channels/1/2/3" },
            { id: "e2", title: "Gruul Montag", startTime: at("2026-10-19"), day: "2026-10-19", categoryId: "mon", categoryName: "TBC Montag", size: 25, signed: 21, away: 2, roles: { tank: gap(2, 2, 1), healer: gap(5, 5, 1) }, absent: [absent("201", "period", "2026-11-08"), absent("203", "single")], url: "" },
            { id: "e3", title: "Mag Mittwoch", startTime: at("2026-10-21"), day: "2026-10-21", categoryId: "wed", categoryName: "TBC Mittwoch", size: 25, signed: 24, away: 0, roles: { tank: gap(2, 2, 0), healer: gap(5, 5, 0) }, absent: [], url: "" },
            { id: "e4", title: "SSC Montag", startTime: at("2026-10-26"), day: "2026-10-26", categoryId: "mon", categoryName: "TBC Montag", size: 25, signed: 15, away: 4, roles: { tank: gap(2, 2, 0), healer: gap(5, 3, 2) }, absent: ["201", "205", "206", "207"].map((id) => absent(id)), url: "" },
        ],
        hints: [{ ...HINT, userId: "203", name: "Nwek-acc", character: "Nwek", spec: "Druid-Restoration", specLabel: "Wiederherstellung", classId: "Druid", classColor: "#FF7D0A", specIcon: "", role: "healer" }],
        tiles: { today: ["202"], nextWeek: ["201", "205"], long: ["201", "205"], biggest: { raidId: "e4", day: "2026-10-26", title: "SSC Montag", away: 4, healers: 2, tanks: 0 } },
        canEdit: true, withReasons: true,
        ...over,
    };
}

const DETAIL: AbsenceRaiderDetail = {
    userId: "201", name: "Anna", character: "Tankadin", spec: "Paladin-Protection", specLabel: "Schutz", classId: "Paladin", classColor: "#F58CBA",
    specIcon: "spell_holy_devotionaura", role: "tank", canEdit: true,
    entries: [
        { ...period("p1", "2026-10-12", "2026-11-08", 28, { comment: "Urlaub", byOrga: true }), done: 4, character: "", spec: "" },
        { ...period("p0", "2026-08-01", "2026-08-03", 3, { state: "past" }), done: 1, character: "", spec: "" },
    ],
    history: [
        { eventId: "h1", day: "2026-09-14", title: "Kara", status: "in" },
        { eventId: "h2", day: "2026-09-21", title: "Kara", status: "off" },
        { eventId: "h3", day: "2026-09-28", title: "Kara", status: "none" },
    ],
    counts: { in: 1, off: 1, none: 1, other: 0 },
};

const OWN: AvailabilityData = { userId: "u1", name: "Admin", orga: true, today: "2026-10-08", maxDays: 180, entries: [], characters: [] };

let data: AbsenceOverview;

beforeEach(() => {
    data = overview();
    vi.mocked(client.get).mockReset().mockImplementation((path: string) => {
        if (path.startsWith("/api/availability/overview/raider?")) return Promise.resolve(DETAIL);
        if (path.startsWith("/api/availability/overview?")) return Promise.resolve(data);
        if (path.startsWith("/api/availability")) return Promise.resolve(OWN);
        return Promise.reject({ code: "not_mocked", message: path });
    });
    vi.mocked(client.send).mockReset().mockImplementation((_m: string, path: string) => (path === "/api/availability/preview"
        ? Promise.resolve({ raids: [] })
        : Promise.resolve({ id: "p1" })));
});

async function show() {
    const view = renderPage(<AbsencesPage />, { route: "/roster/absences" });
    await screen.findByRole("heading", { name: t("absences.title") });
    return view;
}

const gets = (prefix: string) => vi.mocked(client.get).mock.calls.map(([p]) => p as string).filter((p) => p.startsWith(prefix));
const row = (name: string) => screen.getByRole("button", { name: t("absences.timeline.open", { name }) });
const bar = (from: string, to: string) => document.querySelector<HTMLElement>(`.ab-bar[data-from="${from}"][data-to="${to}"]`);

describe("Abwesenheiten: Zeitleiste", () => {
    it("loads eight weeks and shows the head: four figures with their words", async () => {
        await show();
        expect(gets("/api/availability/overview?")).toEqual(["/api/availability/overview?weeks=8"]);
        expect(screen.getByText(t("absences.lead"))).toBeInTheDocument();
        expect(screen.getByText(t("absences.tiles.today")).closest(".ab-tile")).toHaveTextContent("1");
        expect(screen.getByText(t("absences.tiles.today")).closest(".ab-tile")).toHaveTextContent("Heilchen");
        expect(screen.getByText(t("absences.tiles.long")).closest(".ab-tile")).toHaveTextContent("Tankadin, Weltreise");
        expect(screen.getByText(/größte Lücke: 4 fehlen, davon 2 Heiler/)).toBeInTheDocument();
    });

    it("draws each period as a bar on its days — long ones filled, cut ones open at the edge — and single raids as rings", async () => {
        await show();
        const long = bar("2026-10-12", "2026-11-08");
        expect(long).not.toBeNull();
        expect(long?.style.getPropertyValue("--ab-at")).toBe("7");
        expect(long?.style.getPropertyValue("--ab-span")).toBe("28");
        expect(long).toHaveClass("is-long");
        expect(long).toHaveTextContent("Urlaub");

        const short = bar("2026-10-07", "2026-10-09");
        expect(short?.style.getPropertyValue("--ab-at")).toBe("2");
        expect(short).not.toHaveClass("is-long");
        expect(short).toHaveTextContent(t("absences.days", { count: 3 }));

        const cut = bar("2026-09-28", "2026-12-10");
        expect(cut).toHaveClass("is-cut-start", "is-cut-end");
        expect(cut?.style.getPropertyValue("--ab-at")).toBe("0");
        expect(cut?.style.getPropertyValue("--ab-span")).toBe("56");
        expect(cut).toHaveTextContent("→");

        const ring = within(row("Nwek")).getByText((_, el) => !!el?.classList.contains("ab-single"));
        expect(ring.style.getPropertyValue("--ab-at")).toBe("14");
        expect(within(row("Nwek")).getByText(t("absences.timeline.hintPill", { count: 3, of: 4 }))).toBeInTheDocument();
    });

    it("tints raid days and counts who is missing, strong from four", async () => {
        await show();
        expect(document.querySelector(".ab-day[data-day='2026-10-12']")).toHaveClass("is-raid");
        expect(document.querySelector(".ab-day[data-day='2026-10-13']")).not.toHaveClass("is-raid");
        expect(document.querySelectorAll(".ab-day[data-day='2026-10-12'] .ab-day-dots i")).toHaveLength(1);
        expect(document.querySelector(".ab-gap[data-day='2026-10-19']")).toHaveTextContent("2");
        expect(document.querySelector(".ab-gap[data-day='2026-10-19']")).not.toHaveClass("is-many");
        expect(document.querySelector(".ab-gap[data-day='2026-10-26']")).toHaveClass("is-many");
        expect(document.querySelector(".ab-today")?.getAttribute("style")).toContain("--ab-at: 3");
    });

    it("keeps the server's order and filters rows by the switch and the search", async () => {
        const user = userEvent.setup();
        await show();
        const names = () => [...document.querySelectorAll(".ab-tl-raider")].map((r) => r.getAttribute("data-user"));
        expect(names()).toEqual(["202", "201", "205", "203", "204"]);

        await user.click(screen.getByRole("switch", { name: t("absences.filter.presence") }));
        expect(names()).toEqual(["202", "201", "205", "203"]);

        await user.type(screen.getByRole("searchbox", { name: t("absences.filter.searchAria") }), "tank");
        expect(names()).toEqual(["201"]);
    });

    it("asks the server again for another period or category", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(screen.getByRole("radio", { name: t("absences.filter.weeks", { count: 4 }) }));
        await waitFor(() => expect(gets("/api/availability/overview?")).toContain("/api/availability/overview?weeks=4"));
        await user.click(screen.getByRole("radio", { name: t("absences.filter.months", { count: 3 }) }));
        await waitFor(() => expect(gets("/api/availability/overview?")).toContain("/api/availability/overview?weeks=13"));
        await user.click(screen.getByRole("radio", { name: "TBC Mittwoch" }));
        await waitFor(() => expect(gets("/api/availability/overview?")).toContain("/api/availability/overview?weeks=13&category=wed"));
        // the filtered answer names one category only — the segment keeps offering the others
        expect(screen.getByRole("radio", { name: "TBC Montag" })).toBeInTheDocument();
    });

    it("shows the hint as a quiet „Hinweis“ with one button to enter a period — never a DM", async () => {
        const user = userEvent.setup();
        await show();
        const card = screen.getByRole("region", { name: t("absences.hint.title") });
        expect(t("absences.hint.title")).toBe("Hinweis");
        expect(screen.queryByText(/Auffällig/i)).not.toBeInTheDocument();
        expect(card).toHaveTextContent("Nwek hat 3 der letzten 4 Raids von TBC Montag einzeln abgesagt, aber keinen Zeitraum eingetragen.");
        expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["Nwek", t("absences.hint.enter")]);
        expect(within(card).queryByRole("button", { name: /DM|Nachricht/i })).not.toBeInTheDocument();

        await user.click(within(card).getByRole("button", { name: t("absences.hint.enter") }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(t("signups.availability.dialog.titleAbsence"))).toBeInTheDocument();
        expect(within(dialog).getByText(t("signups.availability.dialog.forName", { name: "Nwek-acc" }))).toBeInTheDocument();
        await waitFor(() => expect(gets("/api/availability?userId=203")).toHaveLength(1));
    });

    it("opens the dialog from the head for the raid lead, and has neither button nor hint button for anyone else", async () => {
        const user = userEvent.setup();
        const view = await show();
        await user.click(await screen.findByRole("button", { name: t("absences.enter") }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(t("signups.availability.dialog.titleAbsence"))).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: t("signups.availability.dialog.forRaider") })).toBeInTheDocument();
        view.unmount();
        vi.mocked(client.get).mockClear();

        data = overview({ canEdit: false, withReasons: false });
        await show();
        expect(screen.queryByRole("button", { name: t("absences.enter") })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("absences.hint.enter") })).not.toBeInTheDocument();
        expect(gets("/api/availability?")).toEqual([]);
        expect(gets("/api/availability").filter((p) => p === "/api/availability")).toEqual([]);
    });
});

describe("Abwesenheiten: Pro Raid", () => {
    it("shows one card per coming raid with the role lines that matter and the absent as chips", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(screen.getByRole("radio", { name: t("absences.view.raids") }));
        const cards = screen.getAllByRole("article");
        expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual(["Kara Montag", "Gruul Montag", "Mag Mittwoch", "SSC Montag"]);

        const kara = cards[0];
        expect(kara).toHaveClass("ab-short");
        expect(within(kara).getByText("Tanks: 1 weg · 1 dabei (Soll 2)").closest("li")).toHaveClass("ab-short");
        expect(within(kara).queryByText(/^Heiler:/)).not.toBeInTheDocument();
        expect(within(kara).getByRole("link", { name: "Kara Montag" })).toHaveAttribute("href", "https://discord.com/channels/1/2/3");
        expect(within(kara).getByRole("link", { name: t("absences.raids.toSetup") })).toHaveAttribute("href", "/raids/detail?event=e1&tab=setup");
        const chip = within(kara).getByRole("button", { name: /Tankadin/ });
        expect(chip).toHaveTextContent(t("absences.raids.until", { date: "08.11." }));
        expect(chip).toHaveTextContent("Urlaub");
        expect(chip.querySelector(".ab-mark-bar")).not.toBeNull();

        const gruul = cards[1];
        expect(gruul).not.toHaveClass("ab-short");
        expect(within(gruul).getByText("Heiler: 1 weg · 5 dabei (Soll 5)")).toBeInTheDocument();
        expect(within(gruul).getByRole("button", { name: /Nwek/ }).querySelector(".ab-mark-ring")).not.toBeNull();

        expect(within(cards[2]).getByText(t("absences.raids.rolesOk"))).toBeInTheDocument();
        expect(within(cards[3]).getByText("Heiler: 2 weg · 3 dabei (Soll 5)").closest("li")).toHaveClass("ab-short");
    });
});

describe("Abwesenheiten: Raider", () => {
    it("opens a raider in the drawer: the absence ahead, the entries, the effect and the last raids", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(row("Tankadin"));
        const drawer = await screen.findByRole("complementary", { name: t("absences.drawer.aria") });
        await within(drawer).findByText(t("absences.drawer.entries"));
        expect(gets("/api/availability/overview/raider?")).toEqual(["/api/availability/overview/raider?userId=201"]);
        expect(drawer.querySelector(".ab-now")).toHaveTextContent("28");
        expect(drawer.querySelector(".ab-now")).toHaveTextContent("Urlaub");
        expect(within(drawer).getByText(t("absences.drawer.done", { count: 5 }), { exact: false })).toBeInTheDocument();
        expect(within(drawer).getByText(t("absences.drawer.later"), { exact: false })).toBeInTheDocument();
        expect(within(drawer).getAllByText(t("absences.drawer.byOrga")).length).toBeGreaterThan(0);
        expect(drawer.querySelectorAll(".ab-hist-dot")).toHaveLength(3);
        expect(drawer.querySelector(".ab-hist-dot.ab-h-off")).not.toBeNull();
        expect(within(drawer).getByText(t("absences.drawer.counts", { in: 1, off: 1, none: 1 }))).toBeInTheDocument();
        // the past entry cannot be deleted, the planned one can
        expect(within(drawer).getAllByRole("button", { name: t("absences.drawer.remove") })).toHaveLength(1);
        expect(within(drawer).getByRole("link", { name: t("absences.drawer.toCharacter") })).toHaveAttribute("href", "/roster/char?name=Tankadin");

        await user.keyboard("{Escape}");
        expect(screen.queryByRole("complementary", { name: t("absences.drawer.aria") })).not.toBeInTheDocument();
    });

    it("deletes an entry after asking, then loads the raider and the overview again", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(row("Tankadin"));
        const drawer = await screen.findByRole("complementary", { name: t("absences.drawer.aria") });
        await user.click(await within(drawer).findByRole("button", { name: t("absences.drawer.remove") }));
        const confirm = await screen.findByRole("dialog");
        await user.click(within(confirm).getByRole("button", { name: t("common.delete") }));
        await waitFor(() => expect(client.send).toHaveBeenCalledWith("DELETE", "/api/availability", { id: "p1" }));
        await waitFor(() => expect(gets("/api/availability/overview/raider?")).toHaveLength(2));
        expect(gets("/api/availability/overview?")).toHaveLength(2);
    });

    it("enters an absence for the raider from the drawer", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(row("Tankadin"));
        const drawer = await screen.findByRole("complementary", { name: t("absences.drawer.aria") });
        await user.click(await within(drawer).findByRole("button", { name: t("absences.drawer.enterFor", { name: "Tankadin" }) }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(t("signups.availability.dialog.forName", { name: "Anna" }))).toBeInTheDocument();
    });
});

describe("Abwesenheiten in English", () => {
    afterAll(() => switchLang("de"));
    it("speaks English", async () => {
        await switchLang("en");
        renderPage(<AbsencesPage />, { route: "/roster/absences", user: adminUser() });
        expect(await screen.findByRole("heading", { name: "Absences" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Note" })).toHaveTextContent("signed off from 3 of the last 4 raids of TBC Montag one by one");
    });
});
