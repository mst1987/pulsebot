// The raid detail page's head and tabs by event kind: an own event gets the
// step bar (#319) and the Setup tab (#263), a Raid-Helper event keeps the
// progress bar of #219 with its primary button. A step's deed turns into
// exactly one thing — a tab, a dialog, a menu action or an evaluation — and a
// reader gets the bar without deeds. API mocked at its transport (api/client).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { RaidDetailData, RaidStepDeed, SessionUser } from "../api";
import { t } from "../i18n";
import { deedLabel } from "../lib/raidSteps";
import { adminUser, renderPage } from "../test/render";
import { OWN_ID, ownSteps, raidDetail, raidhelperDetail } from "../test/fixtures/raidDetail";
import { editorData } from "../test/fixtures/setupEditor";
import RaidDetailPage from "./RaidDetailPage";

vi.mock("../api/client", async (orig) => ({ ...(await orig<typeof import("../api/client")>()), get: vi.fn(), send: vi.fn() }));

const READER = adminUser({ isAdmin: false, access: { raids: "read" } });

let detail: RaidDetailData;

beforeEach(() => {
    detail = raidDetail();
    vi.mocked(client.get).mockImplementation((path: string) => {
        if (path.startsWith("/api/raids/detail?")) return Promise.resolve(detail);
        if (path.startsWith("/api/raids/setup?")) return Promise.resolve(editorData());
        return Promise.reject({ code: "not_mocked", message: path });
    });
    vi.mocked(client.send).mockResolvedValue({ alreadyEvaluated: true, url: "" });
});

async function show(data: RaidDetailData = detail, { user = adminUser(), tab = "" }: { user?: SessionUser; tab?: string } = {}) {
    detail = data;
    renderPage(<RaidDetailPage />, { route: `/raids/detail?event=${data.event.id}${tab ? `&tab=${tab}` : ""}`, user });
    await screen.findByRole("heading", { name: data.event.title });
}

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent?.replace(/\d+$/, "") || "");
const selectedTab = () => screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent?.replace(/\d+$/, "");
const cockpit = () => screen.getByText(/^Schritt \d von \d/).parentElement!;

describe("the tabs", () => {
    it("has a Setup tab only for an own event", async () => {
        await show();
        expect(tabNames()).toContain(t("raidDetail.page.tab.setup"));
    });

    it("has no Setup tab for a Raid-Helper event, and ?tab=setup lands on the roster there", async () => {
        await show(raidhelperDetail(), { tab: "setup" });
        expect(tabNames()).not.toContain(t("raidDetail.page.tab.setup"));
        expect(selectedTab()).toBe(t("raidDetail.page.tab.roster"));
    });

    it("opens the setup editor from ?tab=setup of an own event", async () => {
        await show(raidDetail(), { tab: "setup" });
        expect(selectedTab()).toBe(t("raidDetail.page.tab.setup"));
        expect(await screen.findByRole("region", { name: t("setup.group.title", { index: 1 }) })).toBeInTheDocument();
    });
});

describe("the head by event kind", () => {
    it("gives an own event the step bar and keeps the head's primary button away", async () => {
        await show();
        expect(cockpit()).toBeInTheDocument();
        // the open step carries the one deed; the head does not repeat it
        expect(screen.getAllByRole("button", { name: deedLabel(ownSteps().action!) })).toHaveLength(1);
        expect(screen.queryByRole("button", { name: t("raidDetail.hero.nextOpenStep") })).not.toBeInTheDocument();
    });

    it("keeps the progress bar and its primary button for a Raid-Helper event", async () => {
        await show(raidhelperDetail());
        expect(screen.queryByText(/^Schritt \d von \d/)).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Anmelde-Aufruf posten" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: new RegExp(`^${t("raidDetail.hero.stepAria", { label: "Anmeldung", value: "20", unit: "" }).trim()}`) })).toBeInTheDocument();
    });

    it("shows a reader the same bar without a single deed", async () => {
        await show(raidDetail(), { user: READER });
        expect(within(cockpit()).queryAllByRole("button")).toHaveLength(0);
        expect(screen.getByText(t("raidDetail.steps.title.signup"))).toBeInTheDocument();
    });
});

describe("a step's deed does exactly one thing", () => {
    function withDeed(deed: RaidStepDeed, over: Partial<RaidDetailData> = {}) {
        const steps = ownSteps();
        steps.steps[1] = { ...steps.steps[1], action: deed };
        return raidDetail({ ...over, steps: { ...steps, action: deed } });
    }

    it("opens a tab", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(screen.getByRole("button", { name: new RegExp(t("raidDetail.steps.deed.setup")) }));
        expect(selectedTab()).toBe(t("raidDetail.page.tab.setup"));
    });

    it("opens a dialog", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(screen.getByRole("button", { name: deedLabel(ownSteps().action!) }));
        expect(within(screen.getByRole("dialog")).getByText(t("raidModals.ping.title"))).toBeInTheDocument();
    });

    it("runs a menu action — editing opens the create dialog for this event", async () => {
        const user = userEvent.setup();
        await show(withDeed({ id: "edit", label: "Bearbeiten", icon: "inv_misc_note_05", manage: "edit" }));
        await user.click(within(cockpit()).getAllByRole("button", { name: new RegExp(t("raidDetail.steps.deed.edit")) })[0]);
        await waitFor(() => expect(client.get).toHaveBeenCalledWith(`/api/raids/new?event=${OWN_ID}`));
    });

    it("evaluates a log", async () => {
        const user = userEvent.setup();
        const log = { id: "l1", title: "Kara Log", reportId: "abc", link: "", status: "open" as const, reportUrl: "", reportRefId: "" };
        await show(withDeed({ id: "evaluate", label: "CLA auswerten", icon: "inv_misc_pocketwatch_01", evaluate: { logId: "l1", section: "cla" } }, { eventLogs: [log] }));
        await user.click(screen.getByRole("button", { name: "CLA auswerten" }));
        await waitFor(() => expect(client.send).toHaveBeenCalledWith("POST", "/api/cla/eval", { logId: "l1", section: "cla", force: false }));
    });
});
