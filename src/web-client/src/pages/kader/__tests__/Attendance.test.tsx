// Attendance from raid categories of another game version (docs/kaderplaner.md,
// docs/game-versions.md: the one deliberate reading across versions): the pick
// grouped by version with the Kader's own first and a hidden version marked
// "archiviert", "TBC · Mo Raider" in the column head and the tooltips, the
// whole view fetched again once a category of an uncounted version is picked,
// and the same in English.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { KaderData, KaderRaidCategory } from "../../../api";
import { t } from "../../../i18n";
import { switchLang } from "../../../test/i18n";
import { adminUser, renderPage } from "../../../test/render";
import { CAT, RAID_CATEGORIES, kader as kaderData, kaderView, U } from "../kader.fixture";
import KaderPage from "../KaderPage";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getKader: vi.fn(),
    getKaderLive: vi.fn(),
    leaveKaderLive: vi.fn(),
    getKaderRoster: vi.fn(async () => null),
    updateKader: vi.fn(),
}));

const PATH = "/kader/:kaderId?/:sub?";
const TBC: KaderRaidCategory = { id: "c-tbc", name: "Mo Raider", versionId: "tbc", versionLabel: "TBC", hidden: false, nights: 11 };
const OLD: KaderRaidCategory = { id: "c-old", name: "Alt-Raid", versionId: "classic", versionLabel: "Classic", hidden: true, nights: null };

/** The Forever Kader counting Mo Raid and the TBC category; Aldric was there on 10 of 11 TBC nights. */
function view(kader: KaderData = kaderData({ attendanceCategories: [CAT.mo, TBC.id] }), cats: KaderRaidCategory[] = [...RAID_CATEGORIES, TBC, OLD]) {
    const base = kaderView({ kader, raidCategories: cats });
    return {
        ...base,
        players: base.players.map((p) => (p.userId === U.tank
            ? { ...p, attendance: { ...(p.attendance || {}), [TBC.id]: { attended: 10, counted: 11, versionId: "tbc", nights: [{ date: "2026-09-25", title: "Karazhan", attended: true, reason: null }] } } }
            : p)),
    };
}

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getKader).mockResolvedValue(view());
});

async function show(route = "/kader/k1/pool") {
    renderPage(<KaderPage />, { route, path: PATH, user: adminUser() });
    await screen.findByRole("button", { name: /Forever-Kader/ });
}

describe("Kaderplaner · attendance from another game version", () => {
    it("groups the pick by version, the Kader's own first, a hidden version marked archived", async () => {
        await show();
        await userEvent.click(screen.getByRole("button", { name: t("kader.att.fromChange", { cats: "Mo Raid, TBC · Mo Raider" }) }));
        const menu = await screen.findByRole("menu", { name: t("kader.att.menuTitle") });
        const groups = within(menu).getAllByRole("group");
        expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Forever", "TBC", `Classic (${t("kader.att.archived")})`]);
        // the Kader's version, the other one with what it counts, each with its version's dot
        expect(within(groups[0]).getByText(t("kader.att.groupOwn"))).toBeInTheDocument();
        expect(within(groups[1]).getByText(t("kader.att.groupOther", { version: "TBC" }))).toBeInTheDocument();
        expect(groups[1].querySelector(".ver-dot.ver-tbc")).not.toBeNull();
        expect(within(groups[2]).getByText(t("kader.att.archived"))).toBeInTheDocument();
        // the rows: name and nights; a version nobody picked yet is counted once picked
        expect(within(groups[1]).getByRole("menuitemcheckbox", { name: /Mo Raider/ })).toHaveAttribute("aria-checked", "true");
        expect(within(groups[1]).getByText(t("kader.att.nights", { count: 11 }))).toBeInTheDocument();
        expect(within(groups[2]).getByText(t("kader.att.nightsLater"))).toBeInTheDocument();
        // the keyboard walks over the groups
        const items = within(menu).getAllByRole("menuitemcheckbox");
        expect(items).toHaveLength(5);
        expect(items[0]).toHaveFocus();
    });

    it("names the other version in the value's tooltip and in the account dialog's nights", async () => {
        await show();
        // Aldric: Mo Raid 9/11 plus TBC 10/11 = 19 of 22
        const value = screen.getByText("86 %");
        expect(value).toHaveAttribute("data-tip-sub", "Mo Raid 9/11 · TBC · Mo Raider 10/11");
        await userEvent.click(screen.getByRole("button", { name: "Aldric" }));
        const dialog = await screen.findByRole("dialog");
        const tbcNight = Array.from(dialog.querySelectorAll(".kp-nights i")).find((n) => (n.getAttribute("data-tip") || "").includes("Karazhan") && (n.getAttribute("data-tip") || "").includes("TBC"));
        expect(tbcNight?.getAttribute("data-tip")).toContain("TBC · Mo Raider");
    });

    it("fetches the whole view again once a category of an uncounted version is picked", async () => {
        vi.mocked(api.updateKader).mockResolvedValue({ kader: kaderData({ attendanceCategories: [CAT.mo, TBC.id, OLD.id] }), kaders: kaderView().kaders });
        await show();
        expect(api.getKader).toHaveBeenCalledTimes(1);
        await userEvent.click(screen.getByRole("button", { name: t("kader.att.fromChange", { cats: "Mo Raid, TBC · Mo Raider" }) }));
        const menu = await screen.findByRole("menu", { name: t("kader.att.menuTitle") });
        // the server counts the Classic category now
        vi.mocked(api.getKader).mockResolvedValue(view(kaderData({ attendanceCategories: [CAT.mo, TBC.id, OLD.id] }), [...RAID_CATEGORIES, TBC, { ...OLD, nights: 3 }]));
        await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: /Alt-Raid/ }));
        expect(api.updateKader).toHaveBeenCalledWith("k1", { attendanceCategories: [CAT.mo, TBC.id, OLD.id] });
        await waitFor(() => expect(api.getKader).toHaveBeenCalledTimes(2));
        // once counted, no further request
        await screen.findByText(t("kader.att.nights", { count: 3 }));
        expect(api.getKader).toHaveBeenCalledTimes(2);
    });

    it("keeps the plain list while every category plays the Kader's version", async () => {
        vi.mocked(api.getKader).mockResolvedValue(view(kaderData(), RAID_CATEGORIES));
        await show();
        await userEvent.click(screen.getByRole("button", { name: t("kader.att.fromChange", { cats: "Mo Raid, Do Raid" }) }));
        const menu = await screen.findByRole("menu", { name: t("kader.att.menuTitle") });
        expect(within(menu).queryAllByRole("group")).toHaveLength(0);
        expect(within(menu).getAllByRole("menuitemcheckbox")).toHaveLength(3);
    });

    it("speaks English", async () => {
        await switchLang("en");
        try {
            await show();
            await userEvent.click(screen.getByRole("button", { name: "Attendance from: Mo Raid, TBC · Mo Raider – change" }));
            const menu = await screen.findByRole("menu", { name: "Attendance from" });
            expect(within(menu).getByText("the squad's version")).toBeInTheDocument();
            expect(within(menu).getByText("counts the TBC nights")).toBeInTheDocument();
            expect(within(menu).getByText("archived")).toBeInTheDocument();
            expect(within(menu).getByText("counted once picked")).toBeInTheDocument();
            expect(within(menu).getByRole("group", { name: "Classic (archived)" })).toBeInTheDocument();
        } finally {
            await switchLang("de");
        }
    });
});
