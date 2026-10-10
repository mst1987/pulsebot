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
import type { AbsenceOverview, AbsencePeriod, AbsenceRaider, AbsenceRaiderDetail, AttendanceStatus, AvailabilityData, RaiderAttendanceData } from "../../api";
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

const OWN: AvailabilityData = {
    userId: "u1", name: "Admin", orga: true, today: "2026-10-08", maxDays: 180, characters: [],
    entries: [
        { id: "own1", kind: "absence", from: "2026-10-19", to: "2026-10-25", comment: "Urlaub", character: "", spec: "", specLabel: "", versionId: "", categoryId: "", categoryName: "", byOrga: false, done: 1 },
        { id: "old", kind: "absence", from: "2026-09-01", to: "2026-09-03", comment: "", character: "", spec: "", specLabel: "", versionId: "", categoryId: "", categoryName: "", byOrga: false, done: 0 },
    ],
};

const night = (eventId: string, day: string, attended: boolean, reason: string, status?: AttendanceStatus, detail?: string) => (
    { eventId, title: `Kara ${day}`, startTime: at(day), attended, reason, ...(status ? { status, detail } : {}) }
);
const ATTENDANCE: RaiderAttendanceData = {
    userId: "u1", name: "Admin", own: true, orga: true, canEdit: true,
    categories: [
        {
            id: "mon", name: "TBC Montag", pct: 82, attended: 9, total: 11, link: "auto", window: 11,
            raids: [
                night("n3", "2026-10-05", false, "abgemeldet", "absence", "absence"),
                night("n1", "2026-09-21", true, "im Log", "present", "inLog"),
                night("n2", "2026-09-28", true, "angemeldet (später)", "bench", "benchSetup"),
            ],
            upcoming: [
                { eventId: "e1", title: "Kara Montag", startTime: at("2026-10-12"), status: "signed", url: "https://discord.com/channels/1/2/3" },
                { eventId: "e2", title: "Gruul Montag", startTime: at("2026-10-19"), status: "", url: "" },
            ],
        },
        { id: "wed", name: "TBC Mittwoch", pct: null, attended: 0, total: 0, link: "manual", window: 11, raids: [], upcoming: [] },
    ],
};

let data: AbsenceOverview;

beforeEach(() => {
    data = overview();
    vi.mocked(client.get).mockReset().mockImplementation((path: string) => {
        if (path.startsWith("/api/availability/overview/raider?")) return Promise.resolve(DETAIL);
        if (path.startsWith("/api/availability/overview?")) return Promise.resolve(data);
        if (path.startsWith("/api/availability/attendance")) return Promise.resolve(path.includes("userId=") ? { ...ATTENDANCE, userId: "201", name: "", character: "Tankadin", own: false } : ATTENDANCE);
        if (path.startsWith("/api/availability")) return Promise.resolve(OWN);
        return Promise.reject({ code: "not_mocked", message: path });
    });
    vi.mocked(client.send).mockReset().mockImplementation((_m: string, path: string) => (path === "/api/availability/preview"
        ? Promise.resolve({ raids: [] })
        : Promise.resolve({ id: "p1" })));
});

async function show() {
    const view = renderPage(<AbsencesPage />, { route: "/absences" });
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
        await user.click(screen.getByRole("button", { name: "TBC Mittwoch" }));
        await waitFor(() => expect(gets("/api/availability/overview?")).toContain("/api/availability/overview?weeks=13&category=wed"));
        expect(screen.getByRole("button", { name: "TBC Mittwoch" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: t("common.all") })).toHaveAttribute("aria-pressed", "false");
    });

    it("filters by any number of raid categories, each chip in its timeline colour — all of them or none is „Alle“", async () => {
        data = overview({ categories: [{ id: "mon", name: "TBC Montag" }, { id: "wed", name: "TBC Mittwoch" }, { id: "fri", name: "TBC Freitag" }] });
        const user = userEvent.setup();
        await show();
        const chips = screen.getByRole("group", { name: t("absences.filter.categoryAria") });
        expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual([t("common.all"), "TBC Montag", "TBC Mittwoch", "TBC Freitag"]);
        expect(within(chips).getByRole("button", { name: "TBC Freitag" }).querySelector(".ab-catdot.ab-cat-2")).not.toBeNull();

        await user.click(within(chips).getByRole("button", { name: "TBC Montag" }));
        await user.click(within(chips).getByRole("button", { name: "TBC Freitag" }));
        await waitFor(() => expect(gets("/api/availability/overview?")).toContain("/api/availability/overview?weeks=8&category=mon%2Cfri"));
        expect(within(chips).getByRole("button", { name: "TBC Mittwoch" })).toHaveAttribute("aria-pressed", "false");
        // the third one as well: that is every category, so „Alle“ again
        await user.click(within(chips).getByRole("button", { name: "TBC Mittwoch" }));
        await waitFor(() => expect(within(chips).getByRole("button", { name: t("common.all") })).toHaveAttribute("aria-pressed", "true"));
        // one picked and off again: „Alle“ as well
        await user.click(within(chips).getByRole("button", { name: "TBC Mittwoch" }));
        await user.click(within(chips).getByRole("button", { name: "TBC Mittwoch" }));
        await waitFor(() => expect(within(chips).getByRole("button", { name: t("common.all") })).toHaveAttribute("aria-pressed", "true"));
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
    it("shows one calm card per coming raid — how full it is, no absence info", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(screen.getByRole("radio", { name: t("absences.view.raids") }));
        const cards = screen.getAllByRole("article");
        expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual(["Kara Montag", "Gruul Montag", "Mag Mittwoch", "SSC Montag"]);

        const kara = cards[0];
        expect(kara).toHaveTextContent("20 dabei · 25 Plätze");
        expect(kara.querySelector(".ab-raid-in")?.parentElement?.getAttribute("style")).toContain("--ab-in: 80%");
        expect(within(kara).getByRole("link", { name: "Kara Montag" })).toHaveAttribute("href", "https://discord.com/channels/1/2/3");
        expect(within(kara).getByRole("link", { name: t("absences.raids.toSetup") })).toHaveAttribute("href", "/raids/detail?event=e1&tab=setup");
        expect(within(kara).getByText("TBC Montag")).toBeInTheDocument();
        // the user took the absence info out of the cards
        for (const card of cards) {
            expect(card).not.toHaveTextContent(/weg|Soll|Tankadin|Nwek|Urlaub/);
            expect(within(card).queryAllByRole("button")).toEqual([]);
            expect(card.className).toBe("ab-raid");
        }
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

const raiderOnly = () => adminUser({ isAdmin: false, access: { signup: { read: true, write: true } } });

describe("Abwesenheiten: Meine Anwesenheit", () => {
    it("shows a raider role its own attendance even with the roster area - everybody's absences are the orga's", async () => {
        const rosterRaider = adminUser({ isAdmin: false, access: { signup: { read: true, write: true }, roster: { read: true, write: false } } });
        await showMine(rosterRaider);
        expect(screen.getByText(t("absences.mine.lead"))).toBeInTheDocument();
        expect(screen.queryByRole("radiogroup", { name: t("absences.viewAria") })).not.toBeInTheDocument();
    });

    async function showMine(user = raiderOnly(), route = "/absences") {
        const view = renderPage(<AbsencesPage />, { route, user });
        await screen.findByRole("region", { name: "TBC Montag" });
        return view;
    }

    it("shows a raider without the roster area only their own attendance — no overview, no view switch", async () => {
        await showMine();
        expect(gets("/api/availability/attendance")).toEqual(["/api/availability/attendance"]);
        expect(gets("/api/availability/overview")).toEqual([]);
        expect(screen.queryByRole("radiogroup", { name: t("absences.viewAria") })).not.toBeInTheDocument();
        expect(screen.getByText(t("absences.mine.lead"))).toBeInTheDocument();
        expect(document.querySelector(".ab-tl")).toBeNull();
    });

    it("gives every category a card: the quota large, the raids as dots newest last, a short list and the next raids with the own status", async () => {
        await showMine();
        const mon = screen.getByRole("region", { name: "TBC Montag" });
        expect(within(mon).getByText("82 %")).toBeInTheDocument();
        expect(within(mon).getByText("9 von 11 Raids")).toBeInTheDocument();
        expect(within(mon).getByText(t("absences.mine.auto"))).toHaveAttribute("data-tip", t("absences.mine.autoTip"));

        // #677: every night a status field in its colour with its letter, oldest first; the orga may correct it (a button)
        const dots = within(within(mon).getByRole("list", { name: t("absences.mine.nightsAria") })).getAllByRole("listitem");
        const cells = dots.map((d) => d.querySelector(".att-sq") as HTMLElement);
        expect(cells.map((c) => c.getAttribute("data-att"))).toEqual(["present", "bench", "absence"]);
        expect(cells.map((c) => c.textContent)).toEqual(["D", "B", "A"]);
        expect(cells.map((c) => c.getAttribute("data-tip-sub")?.split("\n")[0])).toEqual([
            "Dabei · im Log", "Bench · im Setup auf der Bank", "Abgemeldet · für diesen Raid abgemeldet",
        ]);
        expect(cells.map((c) => c.classList.contains("is-in"))).toEqual([true, true, false]);
        expect(cells[0].tagName).toBe("BUTTON");

        // the list: newest first, the verdict as one short word, why in its tooltip (no word said twice)
        const rows = [...mon.querySelectorAll(".ab-att-list li")].slice(0, 3);
        const verdicts = rows.map((r) => r.querySelector(".ab-att-verdict") as HTMLElement);
        expect(verdicts.map((v) => v.textContent)).toEqual(["Abgemeldet", "Bench", "Dabei"]);
        expect(verdicts.map((v) => v.getAttribute("data-tip-sub"))).toEqual([
            t("attendance.hint.absence"), "im Setup auf der Bank", "im Log",
        ]);
        expect(verdicts[0]).toHaveAttribute("tabindex", "0");
        expect(rows[0]).toHaveClass("ab-att-out");
        expect(rows[1]).toHaveClass("ab-att-in");

        // next raids: the own status as a pill, a link where there is one
        expect(within(mon).getByText(t("absences.mine.next"))).toBeInTheDocument();
        expect(within(mon).getByRole("link", { name: t("absences.mine.status.signed") })).toHaveAttribute("href", "https://discord.com/channels/1/2/3");
        expect(within(mon).getByText(t("absences.mine.status.none"))).toBeInTheDocument();

        // a category without counted raids says so instead of "0 %"
        const wed = screen.getByRole("region", { name: "TBC Mittwoch" });
        expect(within(wed).getByText(t("absences.mine.noRaids"))).toBeInTheDocument();
        expect(within(wed).queryByText(t("absences.mine.auto"))).not.toBeInTheDocument();
    });

    it("says over how many raids each category counts, and filters to one category", async () => {
        const user = userEvent.setup();
        await showMine();
        const mon = screen.getByRole("region", { name: "TBC Montag" });
        expect(within(mon).getByText(t("absences.mine.window", { count: 11 }))).toBeInTheDocument();

        const filter = screen.getByRole("group", { name: t("absences.mine.filterAria") });
        expect(within(filter).getAllByRole("button").map((b) => b.textContent)).toEqual([t("absences.mine.allCategories"), "TBC Montag", "TBC Mittwoch"]);
        await user.click(within(filter).getByRole("button", { name: "TBC Mittwoch" }));
        expect(screen.queryByRole("region", { name: "TBC Montag" })).not.toBeInTheDocument();
        expect(screen.getByRole("region", { name: "TBC Mittwoch" })).toBeInTheDocument();
        expect(within(filter).getByRole("button", { name: "TBC Mittwoch" })).toHaveAttribute("aria-pressed", "true");
        // back to all (the pick is remembered)
        await user.click(within(filter).getByRole("button", { name: t("absences.mine.allCategories") }));
        expect(screen.getByRole("region", { name: "TBC Montag" })).toBeInTheDocument();
    });

    it("offers no filter for a single category", async () => {
        const one = { ...ATTENDANCE, categories: [ATTENDANCE.categories[0]] };
        vi.mocked(client.get).mockImplementation((path: string) => Promise.resolve(path.startsWith("/api/availability/attendance") ? one : OWN));
        await showMine();
        expect(screen.queryByRole("group", { name: t("absences.mine.filterAria") })).not.toBeInTheDocument();
    });

    it("lists the own absences that are not over, enters a new one and deletes one", async () => {
        const user = userEvent.setup();
        await showMine();
        const own = screen.getByRole("region", { name: t("absences.mine.entries") });
        await within(own).findByText("Urlaub", { exact: false });
        expect(within(own).getAllByRole("listitem")).toHaveLength(1);
        expect(within(own).getByText(t("absences.state.planned"))).toBeInTheDocument();
        expect(within(own).getByText(t("absences.days", { count: 7 }))).toBeInTheDocument();

        await user.click(within(own).getByRole("button", { name: t("absences.drawer.remove") }));
        await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("common.delete") }));
        await waitFor(() => expect(client.send).toHaveBeenCalledWith("DELETE", "/api/availability", { id: "own1" }));

        await user.click(within(own).getByRole("button", { name: t("absences.enter") }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(t("signups.availability.dialog.titleAbsence"))).toBeInTheDocument();
    });

    it("says so when the raider has no category yet", async () => {
        const empty = { ...ATTENDANCE, categories: [] };
        vi.mocked(client.get).mockImplementation((path: string) => Promise.resolve(path.startsWith("/api/availability/attendance") ? empty : OWN));
        renderPage(<AbsencesPage />, { route: "/absences", user: raiderOnly() });
        expect(await screen.findByText(t("absences.mine.noCategories"))).toBeInTheDocument();
    });

    it("is the third view for the orga", async () => {
        const user = userEvent.setup();
        await show();
        const views = screen.getByRole("radiogroup", { name: t("absences.viewAria") });
        expect(within(views).getAllByRole("radio").map((r) => r.textContent)).toEqual([t("absences.view.timeline"), t("absences.view.raids"), t("absences.view.mine")]);
        await user.click(within(views).getByRole("radio", { name: t("absences.view.mine") }));
        expect(await screen.findByRole("region", { name: "TBC Montag" })).toBeInTheDocument();
        expect(gets("/api/availability/attendance")).toEqual(["/api/availability/attendance"]);
        expect(screen.getByRole("radio", { name: t("absences.view.mine") })).toHaveAttribute("aria-checked", "true");
    });

    it("opens a raider's attendance from the drawer for the orga, with a way back (named after their character without another name)", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(row("Tankadin"));
        const drawer = await screen.findByRole("complementary", { name: t("absences.drawer.aria") });
        await user.click(await within(drawer).findByRole("button", { name: t("absences.drawer.attendance") }));

        expect(await screen.findByRole("heading", { name: t("absences.mine.of", { name: "Tankadin" }) })).toBeInTheDocument();
        expect(gets("/api/availability/attendance")).toEqual(["/api/availability/attendance?userId=201"]);
        expect(screen.getByText(t("absences.mine.leadRaider"))).toBeInTheDocument();
        expect(screen.queryByRole("complementary", { name: t("absences.drawer.aria") })).not.toBeInTheDocument();
        expect(screen.getByRole("region", { name: t("absences.mine.entriesOf", { name: "Tankadin" }) })).toBeInTheDocument();
        expect(screen.queryByRole("radiogroup", { name: t("absences.viewAria") })).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: t("absences.mine.back") }));
        expect(await screen.findByRole("region", { name: t("absences.timeline.aria") })).toBeInTheDocument();
    });

    it("offers the drawer link only to the raid lead", async () => {
        const user = userEvent.setup();
        vi.mocked(client.get).mockImplementation((path: string) => {
            if (path.startsWith("/api/availability/overview/raider?")) return Promise.resolve({ ...DETAIL, canEdit: false });
            if (path.startsWith("/api/availability/overview?")) return Promise.resolve(overview({ canEdit: false }));
            return Promise.resolve(OWN);
        });
        await show();
        await user.click(row("Tankadin"));
        const drawer = await screen.findByRole("complementary", { name: t("absences.drawer.aria") });
        await within(drawer).findByText(t("absences.drawer.entries"));
        expect(within(drawer).queryByRole("button", { name: t("absences.drawer.attendance") })).not.toBeInTheDocument();
    });
});

describe("Abwesenheiten in English", () => {
    afterAll(() => switchLang("de"));
    it("speaks English", async () => {
        await switchLang("en");
        renderPage(<AbsencesPage />, { route: "/absences", user: adminUser() });
        expect(await screen.findByRole("heading", { name: "Absences" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Note" })).toHaveTextContent("signed off from 3 of the last 4 raids of TBC Montag one by one");
    });
});
