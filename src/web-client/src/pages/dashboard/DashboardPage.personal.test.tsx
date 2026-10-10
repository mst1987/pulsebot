// "Für dich" on the start page (design canvas Oct 2026, direction A): a raider
// sees their next raid with signup, setup group, softres and raid plan, the raids
// after it, attendance, profile, the guild's Latest Loot and their last raids —
// and nothing of the orga. The orga gets the same part compact, above its block.
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { DashboardData, DashboardPersonal, PersonalRaid, RaidplanPublic, SessionUser } from "../../api";
import { t } from "../../i18n";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import DashboardPage from "./DashboardPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getDashboard: vi.fn(),
    getRaidplanPublic: vi.fn(),
}));

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
const raider: SessionUser = { id: "u1", name: "Heilbert", isAdmin: false, access: { signup: { read: true, write: true } } };

function myRaid(over: Partial<PersonalRaid> = {}): PersonalRaid {
    return {
        id: "eh-1", source: "eventhelper", title: "Hyjal+BT+Gruul", startTime: now + 2 * DAY, categoryName: "Pulse Fresh",
        icon: "achievement_boss_illidan", status: "signed", character: "Heilbert", spec: "Holy", specIcon: "",
        placement: { group: 2 }, deadline: 0, deadlinePassed: false, signupsClosed: false, cancelled: false, rosterOnly: false,
        softresUrl: "https://softres.it/raid/abc", planToken: "",
        ...over,
    };
}

function personal(over: Partial<DashboardPersonal> = {}): DashboardPersonal {
    return {
        upcoming: [
            myRaid(),
            myRaid({ id: "eh-2", title: "BT&Hyjal&Gruul", categoryName: "Pulse Montag", status: "", placement: null, deadline: now + DAY }),
            myRaid({ id: "eh-3", title: "T6 + Gruul", categoryName: "Pulse Mittwoch", status: "", placement: null, signupsClosed: true }),
            myRaid({ id: "eh-4", title: "Kara", categoryName: "PuG", status: "tentative", placement: null }),
        ],
        upcomingError: null,
        attendance: {
            attended: 7, total: 8, bench: 1,
            last: [
                { eventId: "p1", title: "BT", startTime: now - DAY, status: "present", attended: true },
                { eventId: "p2", title: "Hyjal", startTime: now - 3 * DAY, status: "bench", attended: true },
                { eventId: "p3", title: "BT", startTime: now - 5 * DAY, status: "noShow", attended: false },
            ],
        },
        recent: [
            { eventId: "p1", title: "BT&Hyjal&Gruul", startTime: now - DAY, categoryName: "Pulse Montag", icon: "achievement_boss_illidan", status: "present", attended: true, report: { url: "/r/abc123/p/3", hints: 2 } },
            { eventId: "p2", title: "Hyjal+BT+Gruul", startTime: now - 3 * DAY, categoryName: "Pulse Fresh", icon: "achievement_boss_illidan", status: "bench", attended: true, report: { url: "/r/def456/p/1", hints: 0 } },
            { eventId: "p3", title: "T6 + Gruul", startTime: now - 5 * DAY, categoryName: "Pulse Mittwoch", icon: "achievement_boss_illidan", status: "noShow", attended: false, report: null },
        ],
        profile: { characters: 3, hints: [{ kind: "noSpec", character: "Feuerfritz" }] },
        ...over,
    };
}

function dashboard(over: Partial<DashboardData> = {}): DashboardData {
    return {
        kicker: { guild: "Pulse", realm: "Thunderstrike" },
        orga: false,
        personal: personal(),
        nextRaid: null,
        followingRaid: null,
        nextRaidError: null,
        tasks: [],
        areas: null,
        recentEvents: { events: [], error: null },
        topLoot: { items: [], configured: 3 },
        activeGuildId: "g1",
        version: "tbc",
        mainVersion: "tbc",
        versions: [],
        ...over,
    };
}

async function show(data: DashboardData, user: SessionUser = raider) {
    vi.mocked(api.getDashboard).mockResolvedValue(data);
    const view = renderPage(<DashboardPage />, { user });
    await screen.findByText(t("dashboard.page.title"));
    return view;
}

beforeEach(() => {
    vi.mocked(api.getDashboard).mockReset();
    vi.mocked(api.getRaidplanPublic).mockReset();
});

describe("Übersicht for a raider", () => {
    it("shows their part and nothing of the orga", async () => {
        await show(dashboard());
        expect(screen.getByText(t("dashboard.personal.next.title"))).toBeInTheDocument();
        expect(screen.getByText(t("dashboard.personal.list.title"))).toBeInTheDocument();
        expect(screen.getByText(t("dashboard.personal.recent.title"))).toBeInTheDocument();
        // the guild's newest top items stay for everyone
        expect(screen.getByText(t("dashboard.loot.title"))).toBeInTheDocument();
        for (const orgaPart of ["dashboard.next.title", "dashboard.tasks.title", "dashboard.areas.roster", "dashboard.recent.title", "dashboard.personal.divider"]) {
            expect(screen.queryByText(t(orgaPart))).not.toBeInTheDocument();
        }
        expect(screen.queryByRole("link", { name: t("dashboard.page.newRaid") })).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: t("dashboard.personal.toSignups") })).toHaveAttribute("href", "/signups");
    });

    it("tells the next raid: category, signup with character and spec, setup group and the softres list", async () => {
        await show(dashboard());
        const card = screen.getByText(t("dashboard.personal.next.title")).closest("section")!;
        expect(within(card).getByText("Pulse Fresh")).toBeInTheDocument();
        expect(within(card).getByText("Hyjal+BT+Gruul")).toBeInTheDocument();
        expect(within(card).getByText(t("dashboard.personal.status.signed"))).toBeInTheDocument();
        expect(within(card).getByText("Heilbert · Holy")).toBeInTheDocument();
        expect(within(card).getByText(t("dashboard.personal.setup.group", { group: 2 }))).toBeInTheDocument();
        expect(within(card).getByRole("link", { name: t("dashboard.personal.softres.open") })).toHaveAttribute("href", "https://softres.it/raid/abc");
        expect(within(card).getByRole("link", { name: t("dashboard.personal.next.toSignup") })).toHaveAttribute("href", "/signups?event=eh-1");
        // no published plan: nothing is asked for
        expect(api.getRaidplanPublic).not.toHaveBeenCalled();
    });

    it("lists the raids after it: sign up where it is open, the reason where it is not, the own status else", async () => {
        await show(dashboard());
        const card = screen.getByText(t("dashboard.personal.list.title")).closest("section")!;
        const rows = within(card).getAllByText(/Gruul|Kara/).map((el) => el.closest(".ov-row")!);
        expect(rows).toHaveLength(3);
        expect(within(rows[0]).getByRole("link", { name: t("dashboard.personal.signUp") })).toHaveAttribute("href", "/signups?event=eh-2");
        expect(within(rows[0]).getByText(/Pulse Montag/)).toHaveTextContent(t("dashboard.personal.list.deadline", { when: "" }).trim());
        expect(within(rows[1]).getByText(t("dashboard.personal.closed"))).toBeInTheDocument();
        // a "maybe" names the spec it would bring too
        expect(within(rows[2]).getByText(`${t("dashboard.personal.status.tentative")} · Holy`)).toBeInTheDocument();
        // the next raid is not repeated in the list
        expect(within(card).queryByText("Hyjal+BT+Gruul")).not.toBeInTheDocument();
    });

    it("shows attendance with a lettered field per night, and the profile's hint", async () => {
        await show(dashboard());
        expect(screen.getByText(t("dashboard.personal.attendance.value", { attended: 7, total: 8 }))).toBeInTheDocument();
        const dots = document.querySelectorAll(".ov-dot");
        // oldest left, newest right
        expect([...dots].map((d) => d.textContent)).toEqual([t("attendance.letter.noShow"), t("attendance.letter.bench"), t("attendance.letter.present")]);
        expect(dots[2]).toHaveAttribute("data-tip-sub", t("attendance.status.present"));
        const profile = screen.getByText(t("dashboard.personal.profile.label")).closest("a")!;
        expect(profile).toHaveAttribute("href", "/profile");
        expect(within(profile).getByText(t("dashboard.personal.profile.noSpec", { character: "Feuerfritz" }))).toBeInTheDocument();
    });

    it("gives each last raid the status and that night's evaluation for them", async () => {
        await show(dashboard());
        const card = screen.getByText(t("dashboard.personal.recent.title")).closest("section")!;
        expect(within(card).getByRole("link", { name: t("dashboard.personal.recent.hints", { count: 2 }) })).toHaveAttribute("href", "/r/abc123/p/3");
        expect(within(card).getByRole("link", { name: t("dashboard.personal.recent.allGood") })).toHaveAttribute("href", "/r/def456/p/1");
        expect(within(card).getByText(t("dashboard.personal.recent.noReport"))).toBeInTheDocument();
        expect(within(card).getByText(t("attendance.status.noShow"))).toBeInTheDocument();
    });

    it("reads the published raid plan for the bosses they are assigned on, each a link into the plan", async () => {
        const plan = {
            event: { title: "Hyjal+BT+Gruul", startTime: now + 2 * DAY },
            bosses: [
                { key: "bt/najentus", name: "High Warlord Naj'entus", instanceName: "Black Temple", slots: [], assignments: [{ id: "a1", type: "heal", title: "", assignees: ["user:u1"], targets: [], note: "" }], steps: [], roles: {} },
                { key: "bt/supremus", name: "Supremus", instanceName: "Black Temple", slots: [], assignments: [{ id: "a2", type: "heal", title: "", assignees: ["user:u9"], targets: [], note: "" }], steps: [], roles: {} },
            ],
            roster: [
                { userId: "u1", name: "Heilbert", character: "Heilbert", className: "Priest", role: "healer", group: 2 },
                { userId: "u9", name: "Other", character: "Other", className: "Mage", role: "ranged", group: 3 },
            ],
            me: "u1",
            meIds: ["u1"],
        } as unknown as RaidplanPublic;
        vi.mocked(api.getRaidplanPublic).mockResolvedValue({ data: plan, etag: "" });
        await show(dashboard({ personal: personal({ upcoming: [myRaid({ planToken: "tok" })] }) }));
        expect(api.getRaidplanPublic).toHaveBeenCalledWith("tok");
        const chip = await screen.findByRole("link", { name: "High Warlord Naj'entus" });
        expect(chip).toHaveAttribute("href", "/p/tok?section=bt%2Fnajentus");
        expect(screen.queryByRole("link", { name: "Supremus" })).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: t("dashboard.personal.plan.open") })).toHaveAttribute("href", "/p/tok");
    });

    it("shows the spec as its icon and its name in the reader's language, never the server's German label", async () => {
        const raid = myRaid({ specKey: "Rogue-Combat", spec: "Kampf", specIcon: "ability_backstab", character: "Schleich" });
        await switchLang("en");
        try {
            await show(dashboard({ personal: personal({ upcoming: [raid, myRaid({ id: "eh-2", specKey: "Rogue-Combat", spec: "Kampf", specIcon: "ability_backstab" })] }) }));
            expect(screen.queryByText(/Kampf/)).not.toBeInTheDocument();
            const badge = screen.getByText(`${t("dashboard.personal.status.signed")} · Combat`);
            expect(badge.closest(".badge")!.querySelector("img")!.getAttribute("src")).toContain("ability_backstab");
            const box = screen.getByText("Schleich · Combat").closest(".ov-me-spec")!;
            expect(box.querySelector("img")!.getAttribute("src")).toContain("ability_backstab");
        } finally {
            await switchLang("de");
        }
    });

    it("says so when no raid is coming up", async () => {
        await show(dashboard({ personal: personal({ upcoming: [] }) }));
        expect(screen.getByText(t("dashboard.personal.next.empty"))).toBeInTheDocument();
        expect(screen.getByText(t("dashboard.personal.list.empty"))).toBeInTheDocument();
    });
});

describe("Übersicht for the orga", () => {
    it("puts its own part compact above the orga block, each under its heading", async () => {
        const admin: SessionUser = { id: "a1", name: "Lead", isAdmin: true, access: {} };
        await show(dashboard({
            orga: true,
            areas: { lastReport: null, newLoot: { count: 0, since: 0 }, roster: { total: 40, withoutDiscord: 0 } },
        }), admin);
        const mine = screen.getByText(t("dashboard.personal.divider"));
        const orga = screen.getByText(t("dashboard.orga.divider", { count: 0 }));
        expect(mine.compareDocumentPosition(orga) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // compact: one line with the title and the status, no fields
        const card = screen.getByText(t("dashboard.personal.next.title")).closest("section")!;
        expect(within(card).getByText("Hyjal+BT+Gruul")).toBeInTheDocument();
        expect(within(card).getByText(`${t("dashboard.personal.status.signed")} · Holy`)).toBeInTheDocument();
        expect(within(card).queryByText(t("dashboard.personal.box.setup"))).not.toBeInTheDocument();
        // the orga block and its figures; no raider tiles
        expect(screen.getByText(t("dashboard.next.title"))).toBeInTheDocument();
        expect(screen.getByText(t("dashboard.tasks.title"))).toBeInTheDocument();
        expect(screen.queryByText(t("dashboard.personal.attendance.label"))).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: t("dashboard.page.newRaid") })).toHaveAttribute("href", "/raids/new");
    });
});
