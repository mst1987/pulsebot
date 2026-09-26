// The Raid-Events list (design issue #222) as the admin sees it: one list with
// a Kommend/Vergangen switch in the url, category pills, time bands, the
// signup bar, log/loot badges and the row's icon buttons. "Neues Event" is a
// dialog over this list. The API is mocked at its transport (api/client), so
// the tests also pin which endpoint each view loads from.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { PastRaid, PastRaidsData, RaidCreateContext, RaidsData, UpcomingRaid } from "../api";
import { t } from "../i18n";
import { adminUser, renderPage } from "../test/render";
import RaidsPage from "./RaidsPage";
import RaidCreatePage from "./RaidCreatePage";

vi.mock("../api/client", async (orig) => ({ ...(await orig<typeof import("../api/client")>()), get: vi.fn() }));

// Thursday 17 September 2026, noon in Berlin: the raid ID runs 16.09.–22.09.
const NOW = Date.UTC(2026, 8, 17, 10, 0);
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function upcoming(over: Partial<UpcomingRaid>): UpcomingRaid {
    return {
        id: "1000", title: "", startTime: 0, channelId: "", channelName: "", categoryId: "", categoryName: "",
        contentIds: [], contentSources: [], softres: null, signupCount: 0, raidSize: 25, raidSizeKnown: true, ...over,
    };
}

function past(over: Partial<PastRaid>): PastRaid {
    return {
        id: "2000", title: "", startTime: 0, channelId: "", channelName: "", categoryId: "", categoryName: "",
        contentIds: [], contentSources: [], softres: null, logs: [], pendingLogs: [], pendingLogCount: 0, lootCount: 0, ...over,
    };
}

const RAIDS: RaidsData = {
    activeGuildId: "g1",
    guildName: "Pulse",
    error: null,
    events: [
        // deliberately out of order: the list sorts by date itself
        upcoming({
            id: "1002", title: "Hyjal + BT", startTime: at("2026-09-24T17:30:00Z"), channelId: "ch2", channelName: "t6-do-24-09",
            categoryId: "c2", categoryName: "T6", contentIds: ["hyjal", "bt"], signupCount: 12, raidSize: 25,
            softres: { url: "https://softres.it/raid/abc" },
        }),
        upcoming({
            id: "1001", title: "Kara Donnerstag", startTime: at("2026-09-17T17:45:00Z"), channelId: "ch1", channelName: "kara-do-17-09",
            categoryId: "c1", categoryName: "T4", contentIds: ["kara"], signupCount: 9, raidSize: 10,
        }),
        upcoming({
            id: "1003", title: "Gruul Freitag", startTime: at("2026-09-18T18:00:00Z"), channelId: "ch3",
            categoryId: "c1", categoryName: "T4", contentIds: ["gruul"], signupCount: 20, raidSize: 25,
        }),
    ],
};

const PAST: PastRaidsData = {
    activeGuildId: "g1",
    error: null,
    events: [
        past({
            id: "2001", title: "BT September", startTime: at("2026-09-10T17:30:00Z"), categoryId: "c2", categoryName: "T6",
            logs: [{ title: "BT Log", reportId: "abc", status: "done" }], lootCount: 12,
        }),
        past({
            id: "2002", title: "SSC September", startTime: at("2026-09-03T17:30:00Z"), categoryId: "c2", categoryName: "T6",
            pendingLogs: [{ title: "SSC Log", alsoFits: [] }], pendingLogCount: 1,
        }),
        past({ id: "2003", title: "Kara August", startTime: at("2026-08-20T17:45:00Z"), categoryId: "c1", categoryName: "T4" }),
    ],
};

/** What the create dialog loads — just enough to open it over the list. */
const CREATE_CONTEXT: RaidCreateContext = {
    defaults: { templateId: "", channelId: "" },
    categoryTemplates: {},
    leaderId: "u1",
    leaderCandidates: [{ id: "u1", name: "Admin" }],
    channels: [],
    templates: [],
    reusableEvents: [{
        id: "1002", title: "Hyjal + BT", templateId: "", description: "", channelId: "ch2", channelName: "t6-do-24-09",
        categoryId: "c2", categoryName: "T6", startTime: at("2026-09-24T17:30:00Z"), contentIds: ["hyjal", "bt"],
    }],
    categories: [{ id: "c1", name: "T4" }, { id: "c2", name: "T6" }],
    versions: [],
};

const ROUTES: Record<string, unknown> = {
    "/api/raids": RAIDS,
    "/api/raids/past": PAST,
    "/api/raids/new": CREATE_CONTEXT,
};

/** Where the router is — the page's own navigation shows up here. */
function Where() {
    const location = useLocation();
    return <output data-testid="where">{location.pathname + location.search}</output>;
}

function show(route = "/raids", user = adminUser()) {
    return renderPage(<><RaidsPage /><Where /></>, { route, user });
}

const where = () => screen.getByTestId("where").textContent;

/** The event titles of the list's rows, top to bottom. */
function rowTitles(): string[] {
    const table = screen.getByRole("table");
    return within(table).getAllByRole("row")
        .map((row) => within(row).queryAllByRole("link")[0]?.textContent || "")
        .filter(Boolean);
}

function rowOf(title: string): HTMLElement {
    const row = screen.getByRole("link", { name: title }).closest<HTMLElement>("[role=\"row\"]");
    if (!row) throw new Error(`no row for ${title}`);
    return row;
}

async function openPast(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("radio", { name: new RegExp(`^${t("raids.page.past")}`) }));
    await screen.findByRole("table", { name: t("raids.list.pastAria") });
}

beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
});

afterAll(() => {
    vi.useRealTimers();
});

beforeEach(() => {
    vi.mocked(client.get).mockReset();
    vi.mocked(client.get).mockImplementation((path: string) => (path in ROUTES
        ? Promise.resolve(ROUTES[path])
        : Promise.reject({ code: "not_found", message: `unexpected ${path}` })) as never);
});

describe("Raid-Events list", () => {
    it("keeps the open view in the url and remembers it", async () => {
        const user = userEvent.setup();
        show("/raids");
        const coming = await screen.findByRole("radio", { name: new RegExp(`^${t("raids.page.upcoming")}`) });
        expect(coming).toHaveAttribute("aria-checked", "true");
        expect(screen.getByRole("table", { name: t("raids.list.upcomingAria") })).toBeInTheDocument();

        await openPast(user);
        expect(where()).toBe("/raids?view=past");
        expect(JSON.parse(localStorage.getItem("eh-raids-view") || "null")).toBe("past");

        // back to the default drops the param again
        await user.click(screen.getByRole("radio", { name: new RegExp(`^${t("raids.page.upcoming")}`) }));
        expect(where()).toBe("/raids");
    });

    it("opens the view the url names, and without a param the remembered one", async () => {
        show("/raids?view=past");
        expect(await screen.findByRole("table", { name: t("raids.list.pastAria") })).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: new RegExp(`^${t("raids.page.past")}`) })).toHaveAttribute("aria-checked", "true");
    });

    it("comes back to the remembered view when the url has none", async () => {
        localStorage.setItem("eh-raids-view", JSON.stringify("past"));
        show("/raids");
        expect(await screen.findByRole("table", { name: t("raids.list.pastAria") })).toBeInTheDocument();
    });

    it("filters by category pills, not tabs, and remembers the pick by id", async () => {
        const user = userEvent.setup();
        show();
        const pills = await screen.findByRole("radiogroup", { name: t("raids.page.categoryAria") });
        expect(screen.queryAllByRole("tab")).toHaveLength(0);
        const all = within(pills).getByRole("radio", { name: new RegExp(`^${t("raids.page.all")}`) });
        expect(all).toHaveAttribute("aria-checked", "true");
        expect(within(pills).getByRole("radio", { name: /^T4/ })).toHaveTextContent("2");
        expect(within(pills).getByRole("radio", { name: /^T6/ })).toHaveTextContent("1");

        await user.click(within(pills).getByRole("radio", { name: /^T4/ }));
        expect(rowTitles()).toEqual(["Kara Donnerstag", "Gruul Freitag"]);
        expect(within(pills).getByRole("radio", { name: /^T4/ })).toHaveAttribute("aria-checked", "true");
        expect(JSON.parse(localStorage.getItem("eh-raids-category") || "null")).toBe("c1");
    });

    it("shows everything when the remembered category has no event any more", async () => {
        localStorage.setItem("eh-raids-category", JSON.stringify("gone"));
        show();
        const pills = await screen.findByRole("radiogroup", { name: t("raids.page.categoryAria") });
        expect(within(pills).getByRole("radio", { name: new RegExp(`^${t("raids.page.all")}`) })).toHaveAttribute("aria-checked", "true");
        expect(rowTitles()).toHaveLength(3);
    });

    it("loads the past raids from their own endpoint next to the coming ones", async () => {
        show();
        await waitFor(() => expect(screen.getByRole("radio", { name: new RegExp(`^${t("raids.page.past")}`) })).toHaveTextContent("3"));
        expect(client.get).toHaveBeenCalledWith("/api/raids");
        expect(client.get).toHaveBeenCalledWith("/api/raids/past");
        expect(screen.getByRole("radio", { name: new RegExp(`^${t("raids.page.upcoming")}`) })).toHaveTextContent("3");
    });

    it("groups coming raids by raid ID (Wednesday to Tuesday), sorted by date", async () => {
        show();
        await screen.findByRole("table", { name: t("raids.list.upcomingAria") });
        const groups = screen.getAllByRole("rowgroup");
        expect(groups).toHaveLength(2);
        expect(groups[0]).toHaveTextContent(t("raids.time.thisWeek"));
        expect(groups[0]).toHaveTextContent("16.–22.09.");
        expect(within(groups[0]).getAllByRole("row").map((r) => within(r).getAllByRole("link")[0].textContent))
            .toEqual(["Kara Donnerstag", "Gruul Freitag"]);
        expect(groups[1]).toHaveTextContent(t("raids.time.nextWeek"));
        expect(groups[1]).toHaveTextContent("23.–29.09.");
        expect(within(groups[1]).getByRole("link", { name: "Hyjal + BT" })).toBeInTheDocument();
    });

    it("groups past raids by month, the newest first", async () => {
        const user = userEvent.setup();
        show();
        await openPast(user);
        const groups = screen.getAllByRole("rowgroup");
        expect(groups.map((g) => within(g).getByText(/2026/).textContent)).toEqual(["September 2026", "August 2026"]);
    });

    it("gives each list its own sort memory", async () => {
        const user = userEvent.setup();
        show();
        await screen.findByRole("table", { name: t("raids.list.upcomingAria") });
        expect(rowTitles()).toEqual(["Kara Donnerstag", "Gruul Freitag", "Hyjal + BT"]);
        await user.click(screen.getByRole("button", { name: t("raids.list.sortByTime", { dir: t("raids.list.asc") }) }));
        expect(rowTitles()).toEqual(["Hyjal + BT", "Gruul Freitag", "Kara Donnerstag"]);

        // the past list keeps its own order: the latest raid first
        await openPast(user);
        expect(rowTitles()).toEqual(["BT September", "SSC September"]);

        await user.click(screen.getByRole("radio", { name: new RegExp(`^${t("raids.page.upcoming")}`) }));
        expect(rowTitles()).toEqual(["Hyjal + BT", "Gruul Freitag", "Kara Donnerstag"]);
    });

    it("folds older months away and keeps the newest open", async () => {
        const user = userEvent.setup();
        show();
        await openPast(user);
        const [september, august] = screen.getAllByRole("rowgroup");
        expect(within(september).getByRole("button", { expanded: true })).toBeInTheDocument();
        expect(within(august).getByRole("button", { expanded: false })).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Kara August" })).not.toBeInTheDocument();

        await user.click(within(august).getByRole("button", { expanded: false }));
        expect(screen.getByRole("link", { name: "Kara August" })).toBeInTheDocument();
        await user.click(within(september).getByRole("button", { expanded: true }));
        expect(screen.queryByRole("link", { name: "BT September" })).not.toBeInTheDocument();
    });

    it("measures signups as a bar against the raid size", async () => {
        show();
        await screen.findByRole("table", { name: t("raids.list.upcomingAria") });
        const kara = within(rowOf("Kara Donnerstag")).getByText("9 / 10");
        const karaTip = kara.closest("[data-tip]");
        expect(karaTip).toHaveAttribute("data-tip", t("raids.list.seatsOf", { count: 9, size: 10 }));
        const karaBar = kara.parentElement as HTMLElement;
        expect(karaBar.querySelector("i")).toHaveStyle({ width: "90%" });
        expect(karaBar).toHaveClass("ok");

        const hyjal = within(rowOf("Hyjal + BT")).getByText("12 / 25").parentElement as HTMLElement;
        expect(hyjal.querySelector("i")).toHaveStyle({ width: "48%" });
        expect(hyjal).toHaveClass("mid");
    });

    it("shows logs and loot as badges linking to where they are handled", async () => {
        const user = userEvent.setup();
        show();
        await openPast(user);

        const bt = rowOf("BT September");
        const analysed = within(bt).getByRole("link", { name: t("raids.list.analysed", { count: 1 }) });
        expect(analysed).toHaveAttribute("href", "/raids/detail?event=2001&tab=logs");
        // the log's title lives in the tooltip, not as a text line in the cell
        expect(analysed.querySelector("[data-tip-sub]")?.getAttribute("data-tip-sub")).toContain("BT Log");
        expect(bt).not.toHaveTextContent("BT Log");
        expect(within(bt).getByRole("link", { name: t("raids.list.lootBadge", { count: 12 }) })).toHaveAttribute("href", "/history/event?event=2001");

        const ssc = rowOf("SSC September");
        const pending = within(ssc).getByRole("link", { name: t("raids.list.pending", { count: 1 }) });
        expect(pending).toHaveAttribute("href", "/raids/detail?event=2002&tab=logs");
        expect(pending.querySelector("[data-tip-sub]")?.getAttribute("data-tip-sub")).toContain("SSC Log");
        expect(within(ssc).getByRole("link", { name: t("raids.list.noLootBadge") })).toHaveAttribute("href", "/history?tab=import");
        expect(screen.getByRole("table")).not.toHaveTextContent("↗");
    });

    it("turns the row links into icon buttons with tooltips", async () => {
        show();
        await screen.findByRole("table", { name: t("raids.list.upcomingAria") });
        const row = rowOf("Hyjal + BT");
        const icon = (el: HTMLElement) => el.querySelector("img")?.getAttribute("src") || "";

        const post = within(row).getByRole("link", { name: t("raids.list.discordPost") });
        expect(post).toHaveAttribute("href", "https://discord.com/channels/g1/ch2/1002");
        expect(post).toHaveAttribute("data-tip-sub", t("raids.list.discordPostSubIn", { channel: "t6-do-24-09" }));
        expect(icon(post)).toContain("inv_letter_15");

        const setup = within(row).getByRole("link", { name: t("raids.list.setup") });
        expect(setup).toHaveAttribute("href", "https://raid-helper.xyz/raidplan/1002");
        expect(icon(setup)).toContain("inv_misc_groupneedmore");

        const softres = within(row).getByRole("link", { name: "Softres" });
        expect(softres).toHaveAttribute("href", "https://softres.it/raid/abc");
        expect(icon(softres)).toContain("inv_scroll_11");

        const repeat = within(row).getByRole("button", { name: t("raids.list.repeat") });
        expect(icon(repeat)).toContain("spell_holy_borrowedtime");
        // no Softres link where the event has none
        expect(within(rowOf("Kara Donnerstag")).queryByRole("link", { name: "Softres" })).not.toBeInTheDocument();
    });

    it("repeats an event through the create dialog, prefilled from it", async () => {
        const user = userEvent.setup();
        show();
        await screen.findByRole("table", { name: t("raids.list.upcomingAria") });
        await user.click(within(rowOf("Hyjal + BT")).getByRole("button", { name: t("raids.list.repeat") }));
        expect(where()).toBe("/raids/new?source=1002");
        const dialog = await screen.findByRole("dialog");
        expect(await within(dialog).findByLabelText(t("raidCreate.termin.title"))).toHaveValue("Hyjal + BT");
    });

    it("offers no repeat and no new event to a read-only account", async () => {
        show("/raids", adminUser({ isAdmin: false, access: { raids: "read" } }));
        await screen.findByRole("table", { name: t("raids.list.upcomingAria") });
        expect(screen.queryByRole("button", { name: t("raids.list.repeat") })).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: t("raids.page.newEvent") })).not.toBeInTheDocument();
    });
});

describe("Neues Event dialog over the list", () => {
    it("opens over the list at /raids/new and closes back to it", async () => {
        const user = userEvent.setup();
        show("/raids/new");
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(t("raidCreate.footer.titleNew"))).toBeInTheDocument();
        // the list stays behind the dialog
        expect(await screen.findByRole("link", { name: "Kara Donnerstag" })).toBeInTheDocument();

        await user.click(within(dialog).getByRole("button", { name: t("common.close") }));
        expect(where()).toBe("/raids");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("is the same page under the /raids/new route", async () => {
        renderPage(<RaidCreatePage />, { route: "/raids/new" });
        expect(await screen.findByRole("dialog")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: new RegExp(t("raids.page.title")) })).toBeInTheDocument();
    });
});
