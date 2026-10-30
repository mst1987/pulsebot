// Notes in the roster's members tab (#981): the mark right after the person's
// name, a link to the notes with read access, a plain symbol without - and
// nothing without the field.
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { t } from "../../i18n";
import { adminUser, renderPage } from "../../test/render";
import RosterDetailPage from "./RosterDetailPage";
import { detail, member, sync } from "./rosters.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRosterDetail: vi.fn(),
    getRosterSync: vi.fn(),
    getRosterComposition: vi.fn(),
}));

const MEMBERS = [member("Thorgrim"), member("Lunaria")];
const NOTES = { "u-thorgrim": { level: "warning" as const, reasons: { no_show: 3 } } };
const markOf = (summary: string) => t("vermerke.mark.aria", { summary });

beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(api.getRosterSync).mockResolvedValue(sync({ canManage: false }));
});

async function openPage(data = detail(MEMBERS), user = adminUser()) {
    vi.mocked(api.getRosterDetail).mockResolvedValue(data);
    renderPage(<RosterDetailPage />, { route: "/roster/r/raid-mo-do-abc", path: "/roster/r/:rosterId/:tab?", user });
    await screen.findByRole("heading", { name: "Raid Mo / Do" });
}

describe("RosterDetailPage with notes (#981)", () => {
    it("puts the mark after the name, as a link to the notes for the admin", async () => {
        await openPage(detail(MEMBERS, { vermerke: NOTES }));
        const mark = screen.getByRole("img", { name: markOf("Warnung · Nicht erschienen ×3") });
        expect(mark.closest(".rn-person-cell")).toHaveTextContent("Thorgrim");
        expect(mark.closest("a")).toHaveAttribute("href", "/vermerke?user=u-thorgrim");
        expect(document.querySelectorAll(".vm-mark")).toHaveLength(1);
    });

    it("keeps it a plain symbol without read access to \"vermerke\"", async () => {
        const manager = adminUser({ isAdmin: false, access: { roster: { read: true, write: true } } });
        await openPage(detail(MEMBERS, { vermerke: NOTES }), manager);
        expect(screen.getByRole("img", { name: markOf("Warnung · Nicht erschienen ×3") }).closest("a")).toBeNull();
    });

    it("draws no mark without the field", async () => {
        await openPage();
        expect(document.querySelector(".vm-mark")).toBeNull();
    });
});
