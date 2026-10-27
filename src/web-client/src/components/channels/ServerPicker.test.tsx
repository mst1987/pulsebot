// The server picker of System › Discord (#895): hidden with one server, a
// segment with the Discord names up to three servers, a select beyond that; the
// pick goes into ?guild= (none for the first server), drops the old side=talk
// and the named parameters of the old server, and the list is kept between pages.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { renderPage } from "../../test/render";
import { pickSearch, resetServerPickCache, useServerPick } from "../../hooks/useServerPick";
import ServerPicker from "./ServerPicker";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getServerChoices: vi.fn(),
}));

const S = (guildId: string, name: string, label = "", online = true): api.DiscordServerChoice => ({ guildId, name, label, online, iconUrl: "" });
const TWO = [S("g1", "Testgilde"), S("g2", "Talkgilde", "Talk")];

function Probe({ drop }: { drop?: string[] }) {
    const pick = useServerPick();
    const location = useLocation();
    return (
        <>
            <ServerPicker pick={pick} drop={drop} />
            <span data-testid="search">{location.search}</span>
            <span data-testid="picked">{pick.ready ? pick.guildId || "-" : "wait"}</span>
            <span data-testid="link">{pickSearch(pick)}</span>
        </>
    );
}

beforeEach(() => {
    resetServerPickCache();
    vi.mocked(api.getServerChoices).mockReset().mockResolvedValue(TWO);
});

describe("ServerPicker", () => {
    it("shows nothing with a single server and picks it", async () => {
        vi.mocked(api.getServerChoices).mockResolvedValue([TWO[0]]);
        renderPage(<Probe />, { route: "/channels/overview" });
        await waitFor(() => expect(screen.getByTestId("picked")).toHaveTextContent("g1"));
        expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
        expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("is ready without a server when the list is empty", async () => {
        vi.mocked(api.getServerChoices).mockResolvedValue([]);
        renderPage(<Probe />, { route: "/channels/overview" });
        await waitFor(() => expect(screen.getByTestId("picked")).toHaveTextContent("-"));
    });

    it("switches by segment, writes ?guild= and drops it again for the first server", async () => {
        const user = userEvent.setup();
        renderPage(<Probe />, { route: "/channels/overview" });
        const first = await screen.findByRole("radio", { name: "Testgilde" });
        expect(first).toBeChecked();
        expect(screen.getByTestId("link")).toHaveTextContent(/^$/);
        await user.click(screen.getByRole("radio", { name: "Talkgilde" }));
        expect(screen.getByTestId("search")).toHaveTextContent(/^\?guild=g2$/);
        expect(screen.getByTestId("picked")).toHaveTextContent("g2");
        expect(screen.getByTestId("link")).toHaveTextContent("?guild=g2");
        await user.click(screen.getByRole("radio", { name: "Testgilde" }));
        expect(screen.getByTestId("search")).toHaveTextContent(/^$/);
    });

    it("drops the old side=talk and the named parameters of the old server", async () => {
        const user = userEvent.setup();
        renderPage(<Probe drop={["role"]} />, { route: "/channels/server-roles?side=talk&role=kochen&q=a" });
        expect(await screen.findByRole("radio", { name: "Talkgilde" })).toBeChecked();
        await user.click(screen.getByRole("radio", { name: "Testgilde" }));
        expect(screen.getByTestId("search")).toHaveTextContent(/^\?q=a$/);
    });

    it("takes a select beyond three servers, with label and a missing bot in words", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getServerChoices).mockResolvedValue([...TWO, S("g3", "Dritte"), S("g4", "Vierte", "", false)]);
        renderPage(<Probe />, { route: "/channels/overview" });
        const select = await screen.findByRole("combobox", { name: "Server" });
        expect(screen.getByRole("option", { name: "Talkgilde · Talk" })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: "Vierte · Bot nicht da" })).toBeInTheDocument();
        await user.selectOptions(select, "g4");
        expect(screen.getByTestId("search")).toHaveTextContent(/^\?guild=g4$/);
    });

    it("keeps the server list for the next page", async () => {
        const first = renderPage(<Probe />, { route: "/channels/overview" });
        await screen.findByRole("radio", { name: "Testgilde" });
        first.unmount();
        renderPage(<Probe />, { route: "/channels/members?guild=g2" });
        expect(screen.getByRole("radio", { name: "Talkgilde" })).toBeChecked();
    });
});
