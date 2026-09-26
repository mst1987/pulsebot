// "Anmeldungen" (#256/#293/#306) as the raider sees it: the page renders
// against a mocked signups API — one calm row per raid, grouped by raid ID,
// Raid-Helper raids pointing to Discord, the dialog in the url, and several own
// raids at once through the bulk dialog. The dialog itself is tested in
// components/SignupDialog.test.tsx; the stylesheet and routing promises that
// cannot be rendered stay in test/web-client/conventions/signupsPage.test.js.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { BulkSignupResult, SignupsData } from "../api";
import { t } from "../i18n";
import { formatEventTime } from "../lib/format";
import { roleCountText, rowSubline, SIGNUP_STATUS } from "../lib/signups";
import { specLabel } from "../lib/wowNames";
import { adminUser, renderPage } from "../test/render";
import { at, counts, ownRow, raidHelperRow, signup, signupsData } from "../test/signupFixtures";
import SignupsPage from "./SignupsPage";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getSignups: vi.fn(),
    saveSignup: vi.fn(),
    saveSignupsBulk: vi.fn(),
}));

// Thursday 17 September 2026, noon in Berlin: the raid ID runs 16.09.–22.09.
const NOW = Date.UTC(2026, 8, 17, 10, 0);

const KARA = ownRow();
const GRUUL = raidHelperRow();
const SSC = ownRow({ id: "eh-ssc", title: "SSC Donnerstag", startTime: at("2026-09-24T17:30:00Z"), deadline: at("2026-09-24T15:00:00Z"), size: 25, attending: 20, counts: counts({ attending: 20, tentative: 2 }) });
const STARTED = ownRow({ id: "eh-mag", title: "Magtheridon", startTime: at("2026-09-17T09:00:00Z"), started: true, deadlinePassed: true, allowedStatuses: [] });

function Where() {
    const location = useLocation();
    return <output data-testid="where">{location.pathname + location.search}</output>;
}
const where = () => screen.getByTestId("where").textContent;

async function show(data: SignupsData = signupsData({ events: [KARA, GRUUL, SSC] }), route = "/signups") {
    vi.mocked(api.getSignups).mockResolvedValue(data);
    const view = renderPage(<><SignupsPage /><Where /></>, { route, user: adminUser({ name: "Zibbo" }) });
    await screen.findByRole("heading", { name: t("signups.page.title") });
    return view;
}

/** A raid's row — the element that opens the event. */
function rowOf(title: string): HTMLElement {
    const row = screen.getAllByText(title).map((el) => el.closest<HTMLElement>(".an-row")).find(Boolean);
    if (!row) throw new Error(`no row for ${title}`);
    return row;
}

let openSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
});

afterAll(() => {
    vi.useRealTimers();
});

beforeEach(() => {
    vi.mocked(api.getSignups).mockReset();
    vi.mocked(api.saveSignup).mockReset();
    vi.mocked(api.saveSignupsBulk).mockReset();
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
});

describe("SignupsPage", () => {
    it("shows a loader while waiting, then the head with the raider and the count", async () => {
        let resolve: (d: SignupsData) => void = () => {};
        vi.mocked(api.getSignups).mockReturnValue(new Promise((r) => { resolve = r; }));
        renderPage(<SignupsPage />, { route: "/signups", user: adminUser({ name: "Zibbo" }) });
        expect(screen.getByText(t("signups.page.loading"))).toBeInTheDocument();

        resolve(signupsData({ events: [KARA, GRUUL, SSC] }));
        expect(await screen.findByRole("heading", { name: t("signups.page.title") })).toBeInTheDocument();
        expect(screen.getByText(`Zibbo · ${t("signups.page.upcoming", { count: 3 })}`)).toBeInTheDocument();
    });

    it("says so when nothing is coming", async () => {
        await show(signupsData({ events: [] }));
        expect(screen.getByText(t("signups.page.empty"))).toBeInTheDocument();
    });

    it("says why the list could not be loaded", async () => {
        vi.mocked(api.getSignups).mockRejectedValue({ code: "boom", message: "Server weg" });
        renderPage(<SignupsPage />, { route: "/signups" });
        expect(await screen.findByText(t("signups.page.loadError", { message: "Server weg" }))).toBeInTheDocument();
    });

    it("shows a row as title, one small line, a fill bar with the role counts as tooltip, and one action", async () => {
        await show();
        const row = rowOf("Kara Freitag");
        expect(within(row).getByText(rowSubline(KARA))).toBeInTheDocument();
        expect(rowSubline(KARA)).toContain(t("signups.deadlineAt", { time: formatEventTime(KARA.deadline) }));
        const bar = within(row).getByText("3/10").closest(".an-bar");
        expect(bar).toHaveAttribute("data-tip", roleCountText(KARA.counts));
        // exactly one action: sign up
        expect(within(row).getAllByRole("button")).toHaveLength(1);
        expect(within(row).getByRole("button", { name: t("signups.signUp") })).toBeInTheDocument();
        // the other counts only in the bar's second line
        expect(within(rowOf("SSC Donnerstag")).getByText("20/25").closest(".an-bar")).toHaveAttribute("data-tip-sub", t("signups.row.tentative", { count: 2 }));
    });

    it("offers only sign-off or late after the deadline, and nothing once the raid has started", async () => {
        await show(signupsData({ events: [ownRow({ deadlinePassed: true, allowedStatuses: ["late", "absence"] }), STARTED] }));
        expect(within(rowOf("Kara Freitag")).getByRole("button", { name: t("signups.row.offOrLate") })).toHaveAttribute("data-tip", t("signups.deadlinePassed"));
        expect(within(rowOf("Magtheridon")).queryByRole("button")).not.toBeInTheDocument();
        expect(within(rowOf("Magtheridon")).getByText(t("signups.row.started"))).toBeInTheDocument();
    });

    it("shows the own signup as a status badge that opens the dialog, the characters in its tooltip", async () => {
        const user = userEvent.setup();
        const mine = signup({
            characters: [
                { ...signup().characters[0], status: "signed" },
                { character: "Zibbowar", className: "Warrior", classColor: "", spec: "Warrior-Protection", specLabel: "Protection", specIcon: "", role: "tank", status: "late" },
            ],
            comment: "etwas später",
        });
        await show(signupsData({ events: [ownRow({ mine })] }));
        const label = `${SIGNUP_STATUS.signed.label} · ${specLabel("Priest-Holy", "Holy")} +1`;
        const badge = within(rowOf("Kara Freitag")).getByRole("button", { name: label });
        expect(badge.getAttribute("data-tip-sub")).toContain(`+Zibbowar (${specLabel("Warrior-Protection", "Protection")}, ${SIGNUP_STATUS.late.label})`);
        expect(badge.getAttribute("data-tip-sub")).toContain(t("signups.quoted", { text: "etwas später" }));

        await user.click(badge);
        expect(where()).toBe("/signups?event=eh-kara");
        expect(openSpy).not.toHaveBeenCalled();
        expect(screen.getByRole("dialog")).toHaveTextContent(t("signups.dialog.change"));
    });

    it("links a Raid-Helper event to Discord instead of offering the dialog", async () => {
        const user = userEvent.setup();
        await show();
        const row = rowOf("Gruul Samstag");
        expect(within(row).getByText(rowSubline(GRUUL))).toHaveTextContent(t("signups.viaRaidHelper"));
        expect(within(row).queryByRole("button")).not.toBeInTheDocument();
        const discord = within(row).getByRole("link", { name: t("signups.row.inDiscord") });
        expect(discord).toHaveAttribute("href", GRUUL.discordUrl);
        expect(discord).toHaveAttribute("target", "_blank");

        // clicking the link opens only the link, not the row's window as well
        await user.click(discord);
        expect(openSpy).not.toHaveBeenCalled();
    });

    it("never opens the dialog for a Raid-Helper event, even when the url names it", async () => {
        await show(undefined, "/signups?event=rh-1");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("groups the raids by raid ID, Wednesday to Tuesday", async () => {
        await show();
        const groups = screen.getAllByRole("group");
        expect(groups).toHaveLength(2);
        expect(groups[0]).toHaveAccessibleName(`${t("raids.time.thisWeek")} 16.–22.09.`);
        expect(groups[1]).toHaveAccessibleName(`${t("raids.time.nextWeek")} 23.–29.09.`);
        expect(within(groups[0]).getByText("Kara Freitag")).toBeInTheDocument();
        expect(within(groups[0]).getByText("Gruul Samstag")).toBeInTheDocument();
        expect(within(groups[1]).getByText("SSC Donnerstag")).toBeInTheDocument();
    });

    it("makes the whole row open the event — an own raid's public page, a Raid-Helper raid's Discord post", async () => {
        const user = userEvent.setup();
        await show(signupsData({ events: [ownRow({ id: "eh kara" }), GRUUL] }));
        const own = rowOf("Kara Freitag");
        expect(own).toHaveAttribute("role", "link");
        expect(own).toHaveAttribute("tabindex", "0");
        expect(own).toHaveAttribute("data-tip", t("signups.dialog.publicPage"));

        await user.click(within(own).getByText("Kara Freitag"));
        expect(openSpy).toHaveBeenLastCalledWith("/e/eh%20kara", "_blank", "noopener,noreferrer");

        await user.click(within(rowOf("Gruul Samstag")).getByText("Gruul Samstag"));
        expect(openSpy).toHaveBeenLastCalledWith(GRUUL.discordUrl, "_blank", "noopener,noreferrer");

        // by keyboard, too
        openSpy.mockClear();
        own.focus();
        await user.keyboard("{Enter}");
        expect(openSpy).toHaveBeenCalledWith("/e/eh%20kara", "_blank", "noopener,noreferrer");
    });

    it("keeps the row's click away from its sign-up button and checkbox", async () => {
        const user = userEvent.setup();
        await show();
        const row = rowOf("Kara Freitag");
        await user.click(within(row).getByRole("checkbox"));
        await user.click(within(row).getByRole("button", { name: t("signups.signUp") }));
        expect(openSpy).not.toHaveBeenCalled();
    });

    it("keeps the open dialog in the url so the Discord dialog's web button can link to it", async () => {
        const user = userEvent.setup();
        await show(undefined, "/signups?event=eh-ssc");
        const dialog = screen.getByRole("dialog");
        expect(dialog).toHaveTextContent(`SSC Donnerstag · ${t("signups.signUp")}`);

        await user.click(within(dialog).getByRole("button", { name: t("common.cancel") }));
        expect(where()).toBe("/signups");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        await user.click(within(rowOf("Kara Freitag")).getByRole("button", { name: t("signups.signUp") }));
        expect(where()).toBe("/signups?event=eh-kara");
        expect(screen.getByRole("dialog")).toHaveTextContent(`Kara Freitag · ${t("signups.signUp")}`);
    });

    it("updates the row after saving and closes the dialog", async () => {
        const user = userEvent.setup();
        vi.mocked(api.saveSignup).mockResolvedValue({ signup: signup(), counts: counts({ attending: 4 }) });
        await show(undefined, "/signups?event=eh-kara");
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("signups.signUp") }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        const row = rowOf("Kara Freitag");
        expect(within(row).getByText("4/10")).toBeInTheDocument();
        expect(within(row).getByRole("button", { name: `${SIGNUP_STATUS.signed.label} · ${specLabel("Priest-Holy", "Holy")}` })).toBeInTheDocument();
        expect(where()).toBe("/signups");
    });
});

describe("several raids at once on the page (#293)", () => {
    const toolbar = () => screen.queryByRole("toolbar", { name: t("signups.page.bulkAria") });
    const check = (title: string) => within(rowOf(title)).queryByRole("checkbox", { name: t("signups.row.selectAria", { title }) });

    it("lets only own raids that still take a signup be picked, with a compact bar at the bottom", async () => {
        const user = userEvent.setup();
        await show(signupsData({ events: [KARA, GRUUL, SSC, STARTED] }));
        expect(check("Kara Freitag")).toBeInTheDocument();
        expect(check("SSC Donnerstag")).toBeInTheDocument();
        expect(check("Gruul Samstag")).not.toBeInTheDocument();
        expect(check("Magtheridon")).not.toBeInTheDocument();
        expect(toolbar()).not.toBeInTheDocument();

        await user.click(check("Kara Freitag")!);
        const bar = toolbar()!;
        expect(bar).toHaveTextContent(t("signups.selectedCount", { count: 1 }));
        await user.click(within(bar).getByRole("button", { name: t("signups.page.selectAll") }));
        expect(check("SSC Donnerstag")).toBeChecked();
        expect(within(bar).queryByRole("button", { name: t("signups.page.selectAll") })).not.toBeInTheDocument();

        await user.click(within(bar).getByRole("button", { name: t("signups.page.clearSelection") }));
        expect(toolbar()).not.toBeInTheDocument();
    });

    it("offers no picking without a character in the profile, and points to the profile instead", async () => {
        await show(signupsData({ events: [KARA], profile: { characters: [], canHeal: false, canOfftank: false } }));
        expect(check("Kara Freitag")).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: t("signups.page.noCharLink") })).toHaveAttribute("href", "/profile");
    });

    it("asks once for characters and status and lists every raid's result with the reason", async () => {
        const user = userEvent.setup();
        const results: BulkSignupResult[] = [
            {
                eventId: "eh-kara", title: "Kara Freitag", ok: true, error: "", code: "", signup: signup(), counts: counts({ attending: 4 }),
                skipped: [{ character: "Zibbowar", spec: "Warrior-Protection", reason: "Klasse passt nicht zu diesem Raid" }],
            },
            { eventId: "eh-ssc", title: "SSC Donnerstag", ok: false, error: "Anmeldeschluss vorbei", code: "deadline", skipped: [], signup: null, counts: null },
        ];
        vi.mocked(api.saveSignupsBulk).mockResolvedValue({ results });
        await show();
        await user.click(check("Kara Freitag")!);
        await user.click(check("SSC Donnerstag")!);
        await user.click(within(toolbar()!).getByRole("button", { name: t("signups.bulkTitle") }));

        const dialog = screen.getByRole("dialog");
        expect(dialog).toHaveTextContent(t("signups.bulkTitle"));
        // one status for every raid, no per-character one — even with two characters
        await user.click(within(dialog).getByRole("button", { name: (n) => n.startsWith(t("signups.picks.add")) }));
        expect(within(dialog).getByRole("radiogroup", { name: t("signups.statusForAll") })).toBeInTheDocument();
        expect(within(dialog).queryByRole("combobox", { name: t("signups.picks.statusAria", { n: 1 }) })).not.toBeInTheDocument();

        await user.click(within(dialog).getByRole("button", { name: t("signups.bulk.signUpAll", { count: 2 }) }));
        expect(api.saveSignupsBulk).toHaveBeenCalledWith({
            eventIds: ["eh-kara", "eh-ssc"],
            characters: [{ character: "Zibbo", spec: "Priest-Holy" }, { character: "Zibbowar", spec: "Warrior-Protection" }],
            status: "signed",
        });

        // the dialog stays with the answer although the selection is cleared
        const list = await within(dialog).findByRole("list");
        const [kara, ssc] = within(list).getAllByRole("listitem");
        expect(kara).toHaveTextContent(t("signups.bulk.saved"));
        expect(kara).toHaveTextContent(t("signups.bulk.skipped", { character: "Zibbowar", reason: "Klasse passt nicht zu diesem Raid" }));
        expect(ssc).toHaveTextContent(t("signups.bulk.notSaved"));
        expect(ssc).toHaveTextContent("Anmeldeschluss vorbei");
        expect(toolbar()).not.toBeInTheDocument();
        expect(screen.getByText(t("signups.bulk.toast", { saved: 1, total: 2 }))).toBeInTheDocument();
        // the saved raid's row shows the signup behind the dialog
        expect(within(rowOf("Kara Freitag")).getByText("4/10")).toBeInTheDocument();

        // the footer's "Schließen" (the head's × has the same name)
        await user.click(within(dialog).getAllByRole("button", { name: t("common.close") }).at(-1)!);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
});

// #306 — the waiting list reaches the raider, not only the roster.
describe("Warteliste in der Sammelanmeldung (#306)", () => {
    it("badget die Raids, in denen es nur die Bank wurde, mit dem Hinweis des Servers", async () => {
        const user = userEvent.setup();
        vi.mocked(api.saveSignupsBulk).mockResolvedValue({
            results: [{
                eventId: "eh-kara", title: "Kara Freitag", ok: true, error: "", code: "", skipped: [],
                waitlisted: true, notice: "Der Raid ist voll – du stehst auf der Warteliste.",
                signup: signup({ status: "bench" }), counts: counts(),
            }],
        });
        await show(signupsData({ events: [KARA] }));
        await user.click(check("Kara Freitag"));
        await user.click(within(screen.getByRole("toolbar")).getByRole("button", { name: t("signups.bulkTitle") }));
        await user.click(screen.getByRole("button", { name: t("signups.bulk.signUpAll", { count: 1 }) }));

        const item = await screen.findByRole("listitem");
        expect(item).toHaveTextContent(t("signups.bulk.waitlisted"));
        expect(item).not.toHaveTextContent(t("signups.bulk.saved"));
        expect(item).toHaveTextContent("Der Raid ist voll – du stehst auf der Warteliste.");
    });

    function check(title: string) {
        return within(rowOf(title)).getByRole("checkbox", { name: t("signups.row.selectAria", { title }) });
    }
});
