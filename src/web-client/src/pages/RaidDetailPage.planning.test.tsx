// A raid category plans with the raid plan OR a Google Sheet, never both
// (src/services/events/planning.js): the raid detail page reads `planning` and
// offers only that one — "sheet" has no Raidplan tab and no plan switch,
// "raidplan" no Raidsheet entry and no sheet dialog. The steps themselves come
// gated from the server (test/web/events/raidDetailSteps.test.js).
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { RaidDetailData } from "../api";
import { t } from "../i18n";
import { adminUser, renderPage } from "../test/render";
import { raidDetail, raidhelperDetail } from "../test/fixtures/raidDetail";
import RaidDetailPage from "./RaidDetailPage";

vi.mock("../api/client", async (orig) => ({ ...(await orig<typeof import("../api/client")>()), get: vi.fn(), send: vi.fn() }));

let detail: RaidDetailData;

beforeEach(() => {
    vi.mocked(client.get).mockImplementation((path: string) => {
        if (path.startsWith("/api/raids/detail?")) return Promise.resolve(detail);
        return Promise.reject({ code: "not_mocked", message: path });
    });
    vi.mocked(client.send).mockResolvedValue({ message: "ok" });
});

async function show(data: RaidDetailData) {
    detail = data;
    renderPage(<RaidDetailPage />, { route: `/raids/detail?event=${data.event.id}`, user: adminUser() });
    await screen.findByRole("heading", { name: data.event.title });
}

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent?.replace(/\d+$/, "") || "");
const manageButton = () => screen.queryByRole("button", { name: t("raidDetail.manage.button") });

async function menuLabels() {
    const user = userEvent.setup();
    await user.click(manageButton()!);
    return within(screen.getByRole("menu")).getAllByRole("menuitem").map((i) => i.textContent || "");
}

describe("raid detail: raid plan or sheet", () => {
    it("a category planning with a sheet shows no Raidplan tab, but the Raidsheet entry", async () => {
        await show(raidDetail({ planning: "sheet" }));
        expect(tabNames()).not.toContain(t("raidDetail.page.tab.plan"));
        expect((await menuLabels()).some((l) => l.startsWith(t("raidDetail.manage.sheet")))).toBe(true);
    });

    it("a category planning with the raid plan shows the Raidplan tab and no Raidsheet entry", async () => {
        await show(raidDetail({ planning: "raidplan" }));
        expect(tabNames()).toContain(t("raidDetail.page.tab.plan"));
        expect((await menuLabels()).some((l) => l.startsWith(t("raidDetail.manage.sheet")))).toBe(false);
    });

    it("an older server without planning keeps both", async () => {
        await show(raidDetail());
        expect(tabNames()).toContain(t("raidDetail.page.tab.plan"));
        expect((await menuLabels()).some((l) => l.startsWith(t("raidDetail.manage.sheet")))).toBe(true);
    });

    it("never opens the sheet dialog for a raid-plan category, even from an old step", async () => {
        const user = userEvent.setup();
        await show(raidhelperDetail({
            planning: "raidplan",
            progress: { steps: [], next: "sheet", primary: { label: "Raidsheet füllen", icon: "inv_scroll_03", modal: "sheet" } },
        }));
        await user.click(screen.getByRole("button", { name: "Raidsheet füllen" }));
        expect(screen.queryByText(t("raidModals.sheet.none"))).not.toBeInTheDocument();
    });

    it("offers no raid plan switch on a Raid-Helper event of a sheet category", async () => {
        await show(raidhelperDetail({ planning: "sheet" }));
        expect(manageButton()).not.toBeInTheDocument();
        expect(tabNames()).not.toContain(t("raidDetail.page.tab.plan"));
    });

    it("keeps the raid plan switch on a Raid-Helper event of a raid-plan category", async () => {
        await show(raidhelperDetail({ planning: "raidplan" }));
        expect(await menuLabels()).toEqual([expect.stringContaining(t("raidDetail.manage.raidplanOn"))]);
    });
});
