// The Kanäle page as one list (#216, #259, #361): the tree of categories and
// channels, the side panel with its figures, the tooltips, inline rename,
// selection, folding and the threads nested under their channel.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import ChannelsPage from "./ChannelsPage";
import { adminUser, renderPage } from "../test/render";
import { ThreadIcon } from "../components/channels/channelBits";
import { channel, channelsData } from "./ChannelsPage.fixture";
import { switchLang } from "../test/i18n";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getChannels: vi.fn(),
    patchChannels: vi.fn(),
}));

const writer = adminUser();
/** May see the channels, change nothing. */
const reader = adminUser({ isAdmin: false, access: { channels: { read: true, write: false } } });

async function openPage(data = channelsData(), user = writer) {
    vi.mocked(api.getChannels).mockResolvedValue(data);
    renderPage(<ChannelsPage />, { route: "/channels", user });
    await screen.findByRole("radiogroup", { name: "Ansicht" });
}

/** The row of a channel in the tree. */
function row(name: string): HTMLElement {
    const el = screen.getByText(name, { selector: ".kn-name" }).closest<HTMLElement>("[data-channel]");
    if (!el) throw new Error(`no row for ${name}`);
    return el;
}

/** A category block of the tree, by its name. */
function category(name: string): HTMLElement {
    const el = screen.getByRole("button", { name: new RegExp(`^${name} (zu|auf)klappen$`) }).closest<HTMLElement>("[data-category]");
    if (!el) throw new Error(`no category ${name}`);
    return el;
}

beforeEach(() => {
    vi.mocked(api.patchChannels).mockImplementation(async (ids) => ({
        results: ids.map((id) => ({ id, ok: true })), done: ids.length, failed: 0, message: "",
    }));
});

describe("ChannelsPage — one list", () => {
    it("shows the tree beside three big figures and one purposes panel, with the counts in the tabs", async () => {
        await openPage();
        expect(screen.getByRole("heading", { level: 1, name: "Kanäle" })).toBeInTheDocument();
        expect(screen.getByText("Discord-Server · Pulse")).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "Kanäle · 7" })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByRole("radio", { name: "Archiv · 1" })).toBeInTheDocument();

        const side = screen.getByRole("complementary");
        expect(within(side).getByText("Vergangene Events")).toBeInTheDocument();
        expect(within(side).getByText("Im Archiv, warten auf Löschung")).toBeInTheDocument();
        const figures = within(side).getAllByText(/^\d+$/).map((el) => el.textContent);
        expect(figures).toEqual(["7", "1", "1"]);
        // the purposes: a label, the counts, one way in — no loose sentence, no archive gear here
        expect(within(side).getByText("Zwecke")).toHaveAttribute("data-tip-sub", expect.stringContaining("Am Kanal selbst stehen sie im Tooltip"));
        expect(within(side).getByText("3 gesetzt")).toBeInTheDocument();
        expect(within(side).getByText("1 fehlt")).toBeInTheDocument();
        expect(within(side).getByRole("button", { name: "Alle Zwecke" })).toBeInTheDocument();
        expect(within(side).getAllByRole("button").map((b) => b.getAttribute("aria-label") || b.textContent)).toEqual([
            expect.stringContaining("Vergangene Events"),
            expect.stringContaining("Im Archiv"),
            "Alle Zwecke",
        ]);
        expect(screen.queryByRole("button", { name: "Archiv-Einstellungen" })).not.toBeInTheDocument();
    });

    it("waits with the raid loader, and asks for a server when none is picked", async () => {
        vi.mocked(api.getChannels).mockResolvedValue(channelsData({ activeGuildId: "" }));
        renderPage(<ChannelsPage />, { route: "/channels", user: writer });
        expect(screen.getByText("Kanäle werden geladen")).toBeInTheDocument();
        expect(await screen.findByText("Wähle oben einen Server, um Kanäle zu verwalten.")).toBeInTheDocument();
    });

    it("shows the purposes as a dialog, with 'nicht gesetzt' and the server's 'fehlt' for an empty one", async () => {
        await openPage();
        await userEvent.click(screen.getByRole("button", { name: "Alle Zwecke" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Wofür der Bot welche Kanäle nutzt")).toBeInTheDocument();
        const bids = within(dialog).getByText("Höchstgebote", { selector: ".tipped" }).closest<HTMLElement>("[role=row]")!;
        expect(within(bids).getByText("nicht gesetzt")).toBeInTheDocument();
        expect(within(bids).getByText("fehlt")).toHaveClass("bad");
        const signup = within(dialog).getByText("Raid-Anmeldung", { selector: ".tipped" }).closest<HTMLElement>("[role=row]")!;
        expect(within(signup).getByText("mi-17-09-ssc")).toBeInTheDocument();
        expect(within(signup).getByText("Bot schreibt")).toHaveClass("ok");
    });
});

describe("ChannelsPage — the channel's tooltip", () => {
    it("keeps name and status in the row and everything else in the tooltip", async () => {
        await openPage();
        const name = screen.getByText("bewerbungen", { selector: ".kn-name" });
        expect(name).toHaveAttribute("data-tip", "#bewerbungen");
        const sub = name.getAttribute("data-tip-sub");
        expect(sub).toContain("Thema: Hier landen die Bewerbungen");
        expect(sub).toContain("Zweck: Bewerbungen.");
        expect(sub).toContain("Slowmode 30 s.");
        expect(sub).toContain("Rechte von der Kategorie.");
        // none of it is printed in the row itself
        expect(screen.queryByText("Hier landen die Bewerbungen")).not.toBeInTheDocument();

        const upcoming = screen.getByText("mi-17-09-ssc", { selector: ".kn-name" });
        expect(upcoming.getAttribute("data-tip-sub")).toMatch(/^Event SSC Mittwoch · /);
        expect(screen.getByText("regeln", { selector: ".kn-name" })).toHaveAttribute("data-tip-sub", "Kein Thema, kein Zweck, kein Event.");
    });

    it("shows the status only as badges: Event and vergangen", async () => {
        await openPage();
        const event = within(row("mi-17-09-ssc")).getByText("Event");
        expect(event).toHaveClass("badge", "ok");
        expect(event).toHaveAttribute("data-tip-sub", expect.stringContaining("SSC Mittwoch"));
        const past = within(row("mi-10-09-ssc")).getByText("vergangen");
        expect(past).toHaveClass("badge", "mid");
        expect(past).toHaveAttribute("data-tip-sub", expect.stringContaining("gelöscht wird nichts"));
        expect(within(row("regeln")).queryByText(/Event|vergangen/)).not.toBeInTheDocument();
    });

    it("names a category's purposes in its tooltip and marks it as event category", async () => {
        await openPage();
        const raids = category("Raids");
        expect(within(raids).getByText("Raids", { selector: ".kn-cat-title" })).toHaveAttribute("data-tip-sub", "Zweck: Event-Kategorien.");
        expect(within(raids).getByText("Event-Kategorie")).toBeInTheDocument();
        expect(within(category("Allgemein")).getByText("Allgemein", { selector: ".kn-cat-title" })).toHaveAttribute("data-tip-sub", "2 Kanäle.");
    });
});

describe("ChannelsPage — inline rename", () => {
    it("opens on a double click, applies Discord's rules while typing and saves on Enter", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.dblClick(screen.getByText("regeln", { selector: ".kn-name" }));
        const input = screen.getByRole("textbox", { name: "Neuer Name für #regeln" });
        expect(screen.getByText("Enter speichert · Esc verwirft")).toBeInTheDocument();
        await user.clear(input);
        await user.type(input, "Neue Regeln");
        expect(input).toHaveValue("neue-regeln");
        await user.keyboard("{Enter}");
        await waitFor(() => expect(api.patchChannels).toHaveBeenCalledWith(["c-loose"], { name: "neue-regeln" }));
        expect(screen.queryByRole("textbox", { name: "Neuer Name für #regeln" })).not.toBeInTheDocument();
        expect(await screen.findByText("1 Kanal geändert")).toBeInTheDocument();
    });

    it("discards on Esc and opens from the pencil too", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.click(within(row("regeln")).getByRole("button", { name: "Umbenennen" }));
        const input = screen.getByRole("textbox", { name: "Neuer Name für #regeln" });
        await user.type(input, "-alt");
        await user.keyboard("{Escape}");
        expect(screen.queryByRole("textbox", { name: "Neuer Name für #regeln" })).not.toBeInTheDocument();
        expect(screen.getByText("regeln", { selector: ".kn-name" })).toBeInTheDocument();
        expect(api.patchChannels).not.toHaveBeenCalled();
    });

    it("offers nothing to change to a reader: no check boxes, no pencil, a double click does nothing", async () => {
        const user = userEvent.setup();
        await openPage(channelsData(), reader);
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Umbenennen" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Anlegen" })).not.toBeInTheDocument();
        await user.dblClick(screen.getByText("regeln", { selector: ".kn-name" }));
        expect(screen.queryByRole("textbox", { name: /Neuer Name/ })).not.toBeInTheDocument();
    });
});

describe("ChannelsPage — selection and folding", () => {
    it("selects a whole category with its channels' threads, and shows 'some of them' on the head", async () => {
        const user = userEvent.setup();
        await openPage();
        expect(screen.queryByRole("toolbar", { name: "Auswahl bearbeiten" })).not.toBeInTheDocument();

        await user.click(screen.getByRole("checkbox", { name: "#bewerbungen wählen" }));
        const head = screen.getByRole("checkbox", { name: "Alle in Allgemein wählen" }) as HTMLInputElement;
        expect(head.checked).toBe(false);
        expect(head.indeterminate).toBe(true);
        expect(screen.getByText("1 ausgewählt")).toBeInTheDocument();

        await user.click(head);
        // bewerbungen, its thread and the voice channel
        expect(screen.getByText("3 ausgewählt")).toBeInTheDocument();
        expect(head.checked).toBe(true);
        expect(head.indeterminate).toBe(false);
        expect(screen.getByRole("checkbox", { name: "#Bewerbung Fatigatus wählen" })).toBeChecked();

        await user.click(head);
        expect(screen.queryByText(/ausgewählt/)).not.toBeInTheDocument();
    });

    it("folds a category", async () => {
        const user = userEvent.setup();
        await openPage();
        const fold = screen.getByRole("button", { name: "Raids zuklappen" });
        expect(fold).toHaveAttribute("aria-expanded", "true");
        await user.click(fold);
        expect(screen.getByRole("button", { name: "Raids aufklappen" })).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByText("mi-17-09-ssc", { selector: ".kn-name" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Raids aufklappen" }));
        expect(screen.getByText("mi-17-09-ssc", { selector: ".kn-name" })).toBeInTheDocument();
    });

    it("leaves the archive out of the tree, with the threads of an archived channel", async () => {
        await openPage();
        expect(screen.queryByRole("button", { name: /^Archiv (zu|auf)klappen$/ })).not.toBeInTheDocument();
        expect(screen.queryByText("alt-raid")).not.toBeInTheDocument();
        expect(screen.queryByText("alter thread")).not.toBeInTheDocument();
    });

    it("searches by name and says so when nothing matches", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.type(screen.getByRole("searchbox", { name: "Kanal suchen" }), "fatig");
        expect(screen.getByText("bewerbungen", { selector: ".kn-name" })).toBeInTheDocument();
        expect(screen.getByText("Bewerbung Fatigatus", { selector: ".kn-name" })).toBeInTheDocument();
        expect(screen.queryByText("regeln", { selector: ".kn-name" })).not.toBeInTheDocument();
        await user.type(screen.getByRole("searchbox", { name: "Kanal suchen" }), "xyz");
        expect(screen.getByText("Kein Kanal passt zur Suche.")).toBeInTheDocument();
    });
});

describe("ChannelsPage — threads nest under their channel (#361)", () => {
    it("shows a thread right under its channel, in the channel's category, with a count", async () => {
        await openPage();
        const talk = category("Allgemein");
        const names = within(talk).getAllByText(/./, { selector: ".kn-name" }).map((el) => el.textContent);
        expect(names).toEqual(["bewerbungen", "Bewerbung Fatigatus", "raid-voice"]);
        expect(within(category("Ohne Kategorie")).queryByText("Bewerbung Fatigatus")).not.toBeInTheDocument();
        expect(row("Bewerbung Fatigatus")).toHaveClass("kn-row-thread");
        expect(within(row("bewerbungen")).getByText("1")).toHaveAttribute("data-tip-sub", "1 Thread in diesem Kanal.");
    });

    it("folds a channel's threads", async () => {
        const user = userEvent.setup();
        await openPage();
        const toggle = screen.getByRole("button", { name: "Threads von #bewerbungen zuklappen" });
        expect(toggle).toHaveAttribute("aria-expanded", "true");
        await user.click(toggle);
        expect(screen.queryByText("Bewerbung Fatigatus")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Threads von #bewerbungen aufklappen" })).toHaveAttribute("aria-expanded", "false");
        // a channel without threads has no toggle
        expect(screen.queryByRole("button", { name: /Threads von #regeln/ })).not.toBeInTheDocument();
    });

    it("keeps a thread whose channel is gone as a loose row", async () => {
        const data = channelsData();
        data.channels.push(channel("t-lost", "verwaister thread", { type: 11, typeLabel: "Thread", parentId: "c-gone", isThread: true }));
        await openPage(data);
        expect(within(category("Ohne Kategorie")).getByText("verwaister thread")).toBeInTheDocument();
    });

    it("offers a thread only rename and delete — no edit, no clone", async () => {
        await openPage();
        const thread = within(row("Bewerbung Fatigatus"));
        expect(thread.getByRole("button", { name: "Umbenennen" })).toBeInTheDocument();
        expect(thread.getByRole("button", { name: "Löschen" })).toBeInTheDocument();
        expect(thread.queryByRole("button", { name: "Bearbeiten" })).not.toBeInTheDocument();
        expect(thread.queryByRole("button", { name: "Duplizieren" })).not.toBeInTheDocument();
        const parent = within(row("bewerbungen"));
        expect(parent.getByRole("button", { name: "Bearbeiten" })).toBeInTheDocument();
        expect(parent.getByRole("button", { name: "Duplizieren" })).toHaveAttribute("data-tip-sub", expect.stringContaining("Klon mit Rechten"));
    });

    it("draws a thread with the thread line icon", async () => {
        await openPage();
        const { container } = render(<ThreadIcon />);
        const icon = row("Bewerbung Fatigatus").querySelector(".kn-type svg");
        expect(icon?.innerHTML).toBe(container.querySelector("svg")?.innerHTML);
        expect(row("bewerbungen").querySelector(".kn-type svg")?.innerHTML).not.toBe(icon?.innerHTML);
    });
});

describe("ChannelsPage — in English", () => {
    afterEach(() => switchLang("de"));

    it("shows the tree, the side panel and the tooltips in English", async () => {
        await switchLang("en");
        vi.mocked(api.getChannels).mockResolvedValue(channelsData());
        renderPage(<ChannelsPage />, { route: "/channels", user: writer });
        await screen.findByRole("radiogroup", { name: "View" });
        expect(screen.getByRole("heading", { level: 1, name: "Channels" })).toBeInTheDocument();
        expect(screen.getByText("Discord server · Pulse")).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "Channels · 7" })).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "Archive · 1" })).toBeInTheDocument();
        const side = screen.getByRole("complementary");
        expect(within(side).getByText("Past events")).toBeInTheDocument();
        expect(within(side).getByText("3 set")).toBeInTheDocument();
        expect(within(side).getByRole("button", { name: "All purposes" })).toBeInTheDocument();
        expect(screen.getByRole("searchbox", { name: "Search channel" })).toHaveAttribute("placeholder", "Search channel…");
        const sub = screen.getByText("bewerbungen", { selector: ".kn-name" }).getAttribute("data-tip-sub");
        expect(sub).toContain("Topic: Hier landen die Bewerbungen");
        expect(sub).toContain("Permissions from the category.");
        expect(screen.getByRole("checkbox", { name: "Select #regeln" })).toBeInTheDocument();
    });
});
