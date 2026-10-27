// The server head at the top of the sidebar (#918, design A "Discord-Kopf"):
// which server the menu below belongs to, and the switch to the others.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

    it("shows each server's Discord icon in the head and the list, the crest without one or when it does not load", () => {
        const withIcons: SessionGuild[] = [
            { id: "g1", name: "Pulse Raids", iconUrl: "https://cdn.discordapp.com/icons/g1/a.png?size=64" },
            { id: "g2", name: "Pulse PuGs" },
        ];
        renderPage(<ServerHeader guilds={withIcons} activeGuildId="g1" />);
        const headIcon = headButton().querySelector("img.srv-icon");
        expect(headIcon).toHaveAttribute("src", "https://cdn.discordapp.com/icons/g1/a.png?size=64");
        fireEvent.click(headButton());
        const options = within(screen.getByRole("listbox")).getAllByRole("option");
        expect(options[0].querySelector("img.srv-icon")).toHaveAttribute("src", "https://cdn.discordapp.com/icons/g1/a.png?size=64");
        expect(options[1].querySelector("img.srv-icon")).toBeNull(); // no icon: the crest
        fireEvent.error(headIcon as HTMLImageElement); // the CDN fails: the crest instead
        expect(headButton().querySelector("img.srv-icon")).toBeNull();
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

    describe("keyboard (listbox pattern)", () => {
        const option = (name: string) => within(screen.getByRole("listbox")).getByRole("option", { name: new RegExp(name) });
        const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k });

        it("puts the focus on the active server when the list opens", () => {
            renderPage(<ServerHeader guilds={GUILDS} activeGuildId="g2" />);
            fireEvent.click(headButton());
            expect(option("Pulse PuGs")).toHaveFocus();
        });

        it("puts the focus on the first server when none is active yet", () => {
            renderPage(<ServerHeader guilds={GUILDS} activeGuildId="" />);
            fireEvent.click(headButton());
            expect(option("Pulse Raids")).toHaveFocus();
        });

        it("moves with the arrows, stops at both ends, and jumps with Home and End", () => {
            renderPage(<ServerHeader guilds={GUILDS} activeGuildId="g1" />);
            fireEvent.click(headButton());
            key("ArrowDown");
            expect(option("Pulse PuGs")).toHaveFocus();
            key("ArrowDown");
            key("ArrowDown");
            expect(option("Pulse Forever")).toHaveFocus();
            key("ArrowUp");
            expect(option("Pulse PuGs")).toHaveFocus();
            key("Home");
            expect(option("Pulse Raids")).toHaveFocus();
            key("ArrowUp");
            expect(option("Pulse Raids")).toHaveFocus();
            key("End");
            expect(option("Pulse Forever")).toHaveFocus();
        });

        it("opens the closed list with arrow down on the head", () => {
            renderPage(<ServerHeader guilds={GUILDS} activeGuildId="g3" />);
            headButton().focus();
            key("ArrowDown");
            expect(option("Pulse Forever")).toHaveFocus();
        });

        it.each([["Enter", "{Enter}"], ["Space", " "]])("picks the focused server with %s", async (_name, keys) => {
            vi.mocked(api.switchGuild).mockResolvedValue({ activeGuildId: "g3" });
            const user = userEvent.setup();
            renderPage(<ServerHeader guilds={GUILDS} activeGuildId="g1" />);
            await user.click(headButton());
            await user.keyboard("{End}");
            expect(option("Pulse Forever")).toHaveFocus();
            await user.keyboard(keys);
            await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
            expect(api.switchGuild).toHaveBeenCalledWith("g3");
        });

        it("closes on Escape and hands the focus back to the head", () => {
            renderPage(<ServerHeader guilds={GUILDS} activeGuildId="g1" />);
            fireEvent.click(headButton());
            key("ArrowDown");
            key("Escape");
            expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
            expect(headButton()).toHaveFocus();
        });
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
