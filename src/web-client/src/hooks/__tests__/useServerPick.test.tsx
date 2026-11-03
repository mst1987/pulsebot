// The server of System › Discord: always the one active in the sidebar, the first of
// the list only without one, never one from the URL; the list is kept between pages.
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { renderPage } from "../../test/render";
import { resetServerPickCache, useServerPick } from "../useServerPick";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getServerChoices: vi.fn(),
}));

const S = (guildId: string, name: string): api.DiscordServerChoice => ({ guildId, name, label: "", online: true, iconUrl: "" });
const TWO = [S("g1", "Testgilde"), S("g2", "Talkgilde")];

function Probe() {
    const pick = useServerPick();
    return (
        <>
            <span data-testid="server">{pick.ready ? pick.guildId || "-" : "wait"}</span>
            <span data-testid="error">{pick.error}</span>
        </>
    );
}

beforeEach(() => {
    resetServerPickCache();
    vi.mocked(api.getServerChoices).mockReset().mockResolvedValue(TWO);
});

describe("useServerPick", () => {
    it("takes the server active in the sidebar", async () => {
        renderPage(<Probe />, { route: "/channels/overview", activeGuildId: "g2" });
        await waitFor(() => expect(screen.getByTestId("server")).toHaveTextContent("g2"));
    });

    it("ignores the ?guild= of an old link", async () => {
        renderPage(<Probe />, { route: "/channels/overview?guild=g2", activeGuildId: "g1" });
        await waitFor(() => expect(screen.getByTestId("server")).toHaveTextContent("g1"));
    });

    it("keeps a server outside the list, so the API can say why there is nothing", async () => {
        renderPage(<Probe />, { route: "/channels/overview", activeGuildId: "g9" });
        await waitFor(() => expect(screen.getByTestId("server")).toHaveTextContent("g9"));
    });

    it("takes the first of the list while none is active", async () => {
        renderPage(<Probe />, { route: "/channels/overview" });
        await waitFor(() => expect(screen.getByTestId("server")).toHaveTextContent("g1"));
    });

    it("is ready without a server when the list is empty", async () => {
        vi.mocked(api.getServerChoices).mockResolvedValue([]);
        renderPage(<Probe />, { route: "/channels/overview" });
        await waitFor(() => expect(screen.getByTestId("server")).toHaveTextContent("-"));
    });

    it("stays on the active server and says why when the list fails", async () => {
        vi.mocked(api.getServerChoices).mockRejectedValue({ code: "http_500", message: "Serverfehler" });
        renderPage(<Probe />, { route: "/channels/overview", activeGuildId: "g2" });
        await waitFor(() => expect(screen.getByTestId("server")).toHaveTextContent("g2"));
        expect(screen.getByTestId("error")).toHaveTextContent("Serverfehler");
    });

    it("keeps the server list for the next page", async () => {
        const first = renderPage(<Probe />, { route: "/channels/overview" });
        await waitFor(() => expect(screen.getByTestId("server")).toHaveTextContent("g1"));
        first.unmount();
        renderPage(<Probe />, { route: "/channels/members" });
        expect(screen.getByTestId("server")).toHaveTextContent("g1");
    });
});
