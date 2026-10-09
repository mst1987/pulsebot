// The roster's attendance tab (#677): members x the last counted raids, each cell the night's status in its
// colour with its letter, the quota per member, a corner mark and tooltip for a night set by hand; whoever may
// correct attendance clicks a cell and picks a status (or "Automatisch") — and in English.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { RosterNight } from "../../api";
import AttendanceTab from "./AttendanceTab";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { detail, member, rosterHead } from "./rosters.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    setAttendanceOverride: vi.fn(),
}));

const DAY = 86400;
const S = Math.floor(Date.UTC(2026, 8, 7, 18) / 1000); // Mo 07.09.2026
const NIGHTS = [
    { eventId: "n3", title: "Kara 3", startTime: S + 14 * DAY },
    { eventId: "n2", title: "Kara 2", startTime: S + 7 * DAY },
    { eventId: "n1", title: "Kara 1", startTime: S },
];
const OVERRIDE = { status: "bench" as const, reason: "hat gewartet", by: "u-marc", byName: "Marc", at: Date.UTC(2026, 9, 9, 12) };
const n = (eventId: string, status: NonNullable<RosterNight["status"]>, extra: Partial<RosterNight> = {}) => {
    const night = NIGHTS.find((x) => x.eventId === eventId)!;
    return { ...night, status, detail: "", ...extra };
};

const ANNA = member("Anna", {
    attendance: {
        attended: 2, total: 3, pct: 67,
        present: [n("n1", "present"), n("n2", "bench", { detail: "override", override: OVERRIDE })],
        missed: [{ ...n("n3", "vacation"), reason: "Urlaub" }],
    },
});
const BERT = member("Bert", {
    status: "trial",
    attendance: { attended: 0, total: 2, pct: 0, present: [], missed: [{ ...n("n2", "noShow"), reason: "" }, { ...n("n3", "noSignup"), reason: "" }] },
});
const CARL = member("Carl", { status: "pause", chars: [], attendance: null });

function show(over = {}, onChanged = vi.fn(), onOpen = vi.fn()) {
    const data = detail([CARL, BERT, ANNA], { nights: NIGHTS, canEditAttendance: true, roster: rosterHead(), ...over });
    renderPage(<AttendanceTab data={data} onOpen={onOpen} onChanged={onChanged} />);
    return { onChanged, onOpen };
}

const grid = () => screen.getByRole("table");
const rowOf = (name: string) => within(grid()).getAllByRole("row").find((r) => within(r).queryByText(name))!;
const cellsOf = (name: string) => [...rowOf(name).querySelectorAll("td .att-sq")] as HTMLElement[];

beforeEach(() => {
    vi.mocked(api.setAttendanceOverride).mockResolvedValue({ eventId: "n3", userId: "u-anna", override: null });
});
afterEach(() => switchLang("de"));

describe("AttendanceTab", () => {
    it("draws members x nights: oldest night left, rows by roster status, the quota per member", () => {
        show();
        const heads = within(grid()).getAllByRole("columnheader").map((h) => h.textContent);
        expect(heads).toEqual(["Mitglied · Quote", "07.09.", "14.09.", "21.09."]);
        expect(within(grid()).getAllByRole("columnheader")[1]).toHaveAttribute("data-tip-sub", "Kara 1");
        const names = within(grid()).getAllByRole("rowheader").map((h) => h.querySelector("b")!.textContent);
        expect(names).toEqual(["Anna", "Bert", "Carl"]);
        expect(rowOf("Anna")).toHaveTextContent("67 % · 2 von 3");
        expect(rowOf("Carl")).toHaveTextContent("kein Charakter");
        expect(rowOf("Carl")).toHaveClass("is-pause");
    });

    it("colours each cell by its status with its letter; present and bench filled, a night set by hand marked", () => {
        show();
        const anna = cellsOf("Anna");
        expect(anna.map((c) => c.getAttribute("data-att"))).toEqual(["present", "bench", "vacation"]);
        expect(anna.map((c) => c.textContent)).toEqual(["D", "B", "U"]);
        expect(anna.map((c) => c.classList.contains("is-in"))).toEqual([true, true, false]);
        expect(anna[1]).toHaveClass("is-manual");
        expect(anna[1].getAttribute("data-tip-sub")).toContain("von Hand: Bench (Marc, 09.10.) · hat gewartet");
        const bert = cellsOf("Bert");
        expect(bert.map((c) => c.getAttribute("data-att") || "none")).toEqual(["none", "noShow", "noSignup"]);
        expect(bert[0]).toHaveClass("is-none");
    });

    it("opens a member's drawer from the name", async () => {
        const { onOpen } = show();
        await userEvent.setup().click(within(rowOf("Bert")).getByRole("button", { name: /Bert/ }));
        expect(onOpen).toHaveBeenCalledWith("u-bert");
    });

    it("lets a manager correct a night: pick a status, give a reason, save", async () => {
        const { onChanged } = show();
        const user = userEvent.setup();
        await user.click(cellsOf("Bert")[1]);
        const menu = screen.getByRole("dialog", { name: "Abend korrigieren" });
        expect(within(menu).getAllByRole("radio")).toHaveLength(6);
        expect(within(menu).getByRole("radio", { name: /Nicht erschienen/ })).toHaveAttribute("aria-checked", "true");
        // "Automatisch" only where there is something to undo
        expect(within(menu).getByRole("button", { name: "Automatisch" })).toBeDisabled();
        await user.click(within(menu).getByRole("radio", { name: /^Bench/ }));
        await user.type(within(menu).getByRole("textbox"), "Ersatz gestellt");
        await user.click(within(menu).getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.setAttendanceOverride).toHaveBeenCalledWith({ eventId: "n2", userId: "u-bert", status: "bench", reason: "Ersatz gestellt" }));
        expect(onChanged).toHaveBeenCalled();
        expect(screen.queryByRole("dialog", { name: "Abend korrigieren" })).toBeNull();
    });

    it("puts an overridden night back to automatic", async () => {
        show();
        const user = userEvent.setup();
        await user.click(cellsOf("Anna")[1]);
        const menu = screen.getByRole("dialog", { name: "Abend korrigieren" });
        expect(within(menu).getByRole("radio", { name: /^Bench/ })).toHaveAttribute("aria-checked", "true");
        expect(within(menu).getByRole("textbox")).toHaveValue("hat gewartet");
        await user.click(within(menu).getByRole("button", { name: "Automatisch" }));
        await waitFor(() => expect(api.setAttendanceOverride).toHaveBeenCalledWith({ eventId: "n2", userId: "u-anna", status: null }));
    });

    it("says why a save was refused, in words", async () => {
        vi.mocked(api.setAttendanceOverride).mockRejectedValue({ code: "not_manager", message: "Anwesenheit: not_manager" });
        show();
        const user = userEvent.setup();
        await user.click(cellsOf("Anna")[0]);
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Speichern" }));
        expect(await screen.findByText("Nur Admins, die Raidleitung und Manager dieses Rosters dürfen das.")).toBeInTheDocument();
    });

    it("shows a reader the cells without a button", () => {
        show({ canEditAttendance: false });
        expect(within(grid()).queryAllByRole("button", { name: /korrigieren/ })).toHaveLength(0);
        expect(cellsOf("Anna")[0].tagName).toBe("SPAN");
        fireEvent.click(cellsOf("Anna")[0]);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("lists the six statuses in the legend", () => {
        show();
        const legend = screen.getByRole("list", { name: "Legende" });
        expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
            "DDabei", "BBench", "UUrlaub", "AAbgemeldet", "?Nicht angemeldet", "XNicht erschienen",
        ]);
    });

    it("says so without category, members or nights", () => {
        const { unmount } = renderPage(<AttendanceTab data={detail([ANNA], { roster: rosterHead({ categoryId: null }) })} onOpen={vi.fn()} onChanged={vi.fn()} />);
        expect(screen.getByText(/keine Raid-Kategorie/)).toBeInTheDocument();
        unmount();
        renderPage(<AttendanceTab data={detail([ANNA], { nights: [] })} onOpen={vi.fn()} onChanged={vi.fn()} />);
        expect(screen.getByText("Noch keine gezählten Raids in dieser Kategorie.")).toBeInTheDocument();
    });
});

describe("AttendanceTab — in English", () => {
    it("words the grid, the letters, the quota and the menu in English", async () => {
        await switchLang("en");
        show();
        expect(within(grid()).getAllByRole("columnheader")[0]).toHaveTextContent("Member · quota");
        expect(rowOf("Anna")).toHaveTextContent("67 % · 2 of 3");
        expect(cellsOf("Anna").map((c) => c.textContent)).toEqual(["P", "B", "V"]);
        expect(cellsOf("Anna")[1].getAttribute("data-tip-sub")).toContain("set by hand: Bench (Marc, 09/10) · hat gewartet");
        await userEvent.setup().click(cellsOf("Anna")[2]);
        const menu = screen.getByRole("dialog", { name: "Correct this night" });
        expect(within(menu).getByRole("radio", { name: /^Vacation/ })).toHaveAttribute("aria-checked", "true");
        expect(within(menu).getByRole("button", { name: "Automatic" })).toBeInTheDocument();
    });
});
