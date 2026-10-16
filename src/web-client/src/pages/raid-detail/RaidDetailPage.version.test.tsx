// A raid is shown in its own game version (#741): a link to a raid of another
// version (a Discord post, a bookmark) switches the menu's content version to it
// and says so; switching the menu away from it goes back to the raid list.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import type { RaidDetailData } from "../../api";
import { t } from "../../i18n";
import { CONTENT_ARIA, renderPage, twoVersions } from "../../test/render";
import { raidDetail } from "../../test/fixtures/raidDetail";
import RaidDetailPage from "./RaidDetailPage";

vi.mock("../../api/client", async (orig) => ({ ...(await orig<typeof import("../../api/client")>()), get: vi.fn(), send: vi.fn() }));

let detail: RaidDetailData;

beforeEach(() => {
    localStorage.clear();
    vi.mocked(client.get).mockImplementation((path: string) => {
        if (path.startsWith("/api/raids/detail?")) return Promise.resolve(detail);
        return Promise.reject({ code: "not_mocked", message: path });
    });
});

function Where() {
    const location = useLocation();
    return <output data-testid="where">{location.pathname}</output>;
}

/** The raid detail of a TBC raid, the menu remembering `shown`. */
async function show(shown: string, versionId = "tbc") {
    if (shown !== "tbc") localStorage.setItem("eh-content-version", shown);
    detail = { ...raidDetail(), versionId };
    renderPage(<><RaidDetailPage /><Where /></>, { route: `/raids/detail?event=${detail.event.id}`, content: twoVersions() });
    await screen.findByRole("heading", { name: detail.event.title });
}

const segment = () => screen.getAllByRole("radiogroup", { name: t(CONTENT_ARIA) })[0];
const checked = () => within(segment()).getByRole("radio", { checked: true });

describe("a raid of another version (#741)", () => {
    it("switches the Forever view to TBC and says so", async () => {
        await show("forever");
        expect(await screen.findByText(t("shell.followVersion.switched", { version: "TBC" }))).toBeInTheDocument();
        await waitFor(() => expect(checked()).toHaveAccessibleName("TBC"));
        expect(localStorage.getItem("eh-content-version")).toBeNull();
    });

    it("leaves the menu alone for a raid of the version shown", async () => {
        await show("tbc");
        expect(checked()).toHaveAccessibleName("TBC");
        expect(screen.queryByText(t("shell.followVersion.switched", { version: "TBC" }))).not.toBeInTheDocument();
    });

    it("goes back to the raid list when the menu switches away from the raid", async () => {
        const user = userEvent.setup();
        await show("tbc");
        await user.click(within(segment()).getByRole("radio", { name: "Forever" }));
        await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/raids"));
        expect(screen.getByTestId("where")).not.toHaveTextContent("/raids/detail");
    });
});
