// The server head at the top of the sidebar (#918, design A "Discord-Kopf"):
// which server the menu below belongs to, and the switch to the others.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { SessionGuild } from "../../api";
import { t } from "../../i18n";
import { adminUser, renderPage } from "../../test/render";
import ServerHeader from "./ServerHeader";
import Shell from "./Shell";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    switchGuild: vi.fn(),
    getVersion: vi.fn(),
}));

const GUILDS: SessionGuild[] = [
    { id: "g1", name: "Pulse Raids", label: "PvE" },
    { id: "g2", name: "Pulse PuGs" },
    { id: "g3", name: "Pulse Forever", label: "Forever" },
];

const reload = vi.fn();

beforeEach(() => {
    window.localStorage.clear();
    reload.mockReset();
    vi.mocked(api.switchGuild).mockReset();
    vi.mocked(api.getVersion).mockReturnValue(new Promise(() => undefined));
    vi.stubGlobal("location", { ...window.location, reload });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const headButton = () => screen.getByRole("button", { name: t("shell.guild.choose") });

describe("ServerHeader", () => {
    it("says nothing to pick without a server", () => {
        renderPage(<ServerHeader guilds={[]} activeGuildId="" />);
        expect(screen.getByText(t("shell.guild.none"))).toBeInTheDocument();
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("shows only the name (and label) with one server, no button and no list", () => {
        renderPage(<ServerHeader guilds={[GUILDS[0]]} activeGuildId="g1" />);
        expect(screen.getByText("Pulse Raids")).toBeInTheDocument();
        expect(screen.getByText("PvE")).toBeInTheDocument();
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
        expect(screen.queryByText(t("shell.guild.switch"))).not.toBeInTheDocument();
    });

    it("shows the active server with its label and \"Server wechseln\", and lists every server when opened", () => {
        renderPage(<ServerHeader guilds={GUILDS} activeGuildId="g1" />);
        const btn = headButton();
        expect(btn).toHaveTextContent("Pulse Raids");
        expect(btn).toHaveTextContent(`PvE · ${t("shell.guild.switch")}`);
        expect(btn).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

        fireEvent.click(btn);
        expect(btn).toHaveAttribute("aria-expanded", "true");
        const options = within(screen.getByRole("listbox")).getAllByRole("option");
        expect(options.map((o) => o.textContent)).toEqual(["Pulse RaidsPvE", "Pulse PuGs", "Pulse ForeverForever"]);
        expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    });

    it("closes the list on Escape and on a click beside it", () => {
        renderPage(<ServerHeader guilds={GUILDS} activeGuildId="g1" />);
        fireEvent.click(headButton());
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
        fireEvent.click(headButton());
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("picking the active server only closes the list", () => {
        renderPage(<ServerHeader guilds={GUILDS} activeGuildId="g1" />);
        fireEvent.click(headButton());
        fireEvent.click(within(screen.getByRole("listbox")).getByText("Pulse Raids"));
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
        expect(api.switchGuild).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
    });

    it("switches the session's server and reloads, so every page loads the new server's data", async () => {
        vi.mocked(api.switchGuild).mockResolvedValue({ activeGuildId: "g2" });
        renderPage(<ServerHeader guilds={GUILDS} activeGuildId="g1" />);
        fireEvent.click(headButton());
        fireEvent.click(within(screen.getByRole("listbox")).getByText("Pulse PuGs"));
        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        expect(api.switchGuild).toHaveBeenCalledWith("g2");
    });

    it("keeps the page and says why when the switch fails", async () => {
        vi.mocked(api.switchGuild).mockRejectedValue(Object.assign(new Error("Kein Zugriff"), { status: 403 }));
        renderPage(<ServerHeader guilds={GUILDS} activeGuildId="g1" />);
        fireEvent.click(headButton());
        fireEvent.click(within(screen.getByRole("listbox")).getByText("Pulse PuGs"));
        expect(await screen.findByText("Kein Zugriff")).toBeInTheDocument();
        expect(reload).not.toHaveBeenCalled();
        expect(headButton()).not.toBeDisabled();
    });

    it("asks to choose a server when none is active yet", () => {
        renderPage(<ServerHeader guilds={GUILDS} activeGuildId="" />);
        expect(headButton()).toHaveTextContent(t("shell.guild.choose"));
        expect(screen.getByText(t("shell.guild.notChosen"))).toBeInTheDocument();
    });
});

describe("the sidebar per server (#918)", () => {
    it("puts the head of the active server above its menu block, and after a switch the new server's", async () => {
        vi.mocked(api.switchGuild).mockResolvedValue({ activeGuildId: "g3" });
        const view = renderPage(<Shell user={adminUser()} guilds={GUILDS} activeGuildId="g1" />);
        const nav = screen.getByRole("navigation");
        const head = headButton();
        expect(head).toHaveTextContent("Pulse Raids");
        // the head stands above the menu, outside the nav
        expect(head.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(nav).not.toContainElement(head);

        fireEvent.click(head);
        fireEvent.click(within(screen.getByRole("listbox")).getByText("Pulse Forever"));
        await waitFor(() => expect(reload).toHaveBeenCalled());
        expect(api.switchGuild).toHaveBeenCalledWith("g3");
        view.unmount();

        // after the reload the session names the new server: its head, the same server block below
        renderPage(<Shell user={adminUser()} guilds={GUILDS} activeGuildId="g3" />);
        expect(headButton()).toHaveTextContent("Pulse Forever");
        expect(headButton()).toHaveTextContent(`Forever · ${t("shell.guild.switch")}`);
        expect(within(screen.getByRole("navigation")).getByText(t("shell.group.allServers"))).toBeInTheDocument();
    });
});
