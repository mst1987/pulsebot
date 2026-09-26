// The Recruitment page (design issue #215): three tabs of compact tables —
// posted messages, templates, applications — and everything that is more than
// a row in a modal. Rendered with the API mocked; what is checked is what an
// officer sees and what a click does.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { Application, RecruitmentData, RecruitmentPost, RecruitmentTemplate } from "../api";
import { DISCORD_CONTENT_LIMIT } from "../lib/discordMarkdown";
import { renderPage } from "../test/render";
import RecruitmentPage from "./RecruitmentPage";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getRecruitmentData: vi.fn(),
    scanRecruitmentPosts: vi.fn(),
    postRecruitmentTemplate: vi.fn(),
}));

const CHANNEL_NAME = "🔎》recruitment";
const CATEGORY = "「・」TBC Montag";

function template(over: Partial<RecruitmentTemplate> = {}): RecruitmentTemplate {
    return { id: "t1", name: "Heiler gesucht", content: "## Holy Paladin\n## Restoration Druid\nKomm zu uns!", title: "", body: "", buttonLabel: "", ...over };
}

function post(over: Partial<RecruitmentPost> = {}): RecruitmentPost {
    return {
        id: "p1", guildId: "g1", channelId: "c1", messageId: "m1", channelName: "",
        content: "## Holy Paladin\n## Restoration Druid\nKomm zu uns!", title: "", body: "", buttonLabel: "",
        source: "web", templateId: "t1", postedAt: Date.UTC(2026, 8, 13, 20, 41), ...over,
    };
}

function application(over: Partial<Application> = {}): Application {
    return {
        threadId: "th1", name: "Bewerbung Thrall", url: "https://discord.com/channels/g1/th1", createdAt: Date.UTC(2026, 8, 20, 18, 0),
        archived: false, applicantId: "u9", displayName: "Thrall", character: "Thrall", classSpec: "Schamane Enhancement",
        armory: "https://classic-armory.org/character/eu/thunderstrike/thrall", wcl: "", description: "Ich raide seit Classic.",
        discordName: "thrall", date: "", className: "Schamane", spec: "Enhancement", classColor: "#0070DE",
        classIcon: "class_shaman", specIcon: "spell_nature_lightningshield", status: "neu", ...over,
    };
}

function data(over: Partial<RecruitmentData> = {}): RecruitmentData {
    return {
        view: "", guildName: "Pulse", editing: null, editingPost: null,
        templates: [template()],
        posts: [post(), post({ id: "p2", channelId: "c2", channelName: "gesucht", messageId: "m2", source: "scan", templateId: "" })],
        channels: [{ id: "c1", name: CHANNEL_NAME, category: CATEGORY }, { id: "c2", name: "gesucht", category: "" }],
        emojis: [],
        specCatalog: [
            { key: "paladin-holy", name: "Holy Paladin", icon: "spell_holy_holybolt", role: "healer" },
            { key: "druid-restoration", name: "Restoration Druid", icon: "spell_nature_healingtouch", role: "healer" },
        ],
        applications: [application()],
        applicationsError: null,
        applicationChannelId: "c9",
        activeGuildId: "g1",
        ...over,
    };
}

/** A WoW icon on the page, found by its name in the zamimg url. */
function wowIcon(root: ParentNode, name: string): HTMLImageElement | null {
    return root.querySelector<HTMLImageElement>(`img[src*="/${name}.jpg"]`);
}

beforeEach(() => {
    vi.mocked(api.getRecruitmentData).mockReset().mockResolvedValue(data());
    vi.mocked(api.scanRecruitmentPosts).mockReset();
    vi.mocked(api.postRecruitmentTemplate).mockReset();
});

describe("Recruitment page head", () => {
    it("names the server, carries the page's WoW icon and one primary action that opens the posting dialog", async () => {
        const user = userEvent.setup();
        const { container } = renderPage(<RecruitmentPage />, { route: "/recruitment" });

        expect(await screen.findByRole("heading", { level: 1, name: "Recruitment" })).toBeInTheDocument();
        expect(screen.getByText("Pulse")).toBeInTheDocument();
        const head = container.querySelector(".page-head")!;
        expect(wowIcon(head, "inv_misc_grouplooking")).not.toBeNull();
        const action = within(head as HTMLElement).getByRole("button", { name: "Nachricht posten" });
        expect(wowIcon(action, "ability_warrior_battleshout")).not.toBeNull();
        expect(within(head as HTMLElement).getAllByRole("button")).toHaveLength(1);

        await user.click(action);
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("Nachricht posten")).toBeInTheDocument();
    });

    it("posts the chosen template into the chosen channel from that dialog", async () => {
        const user = userEvent.setup();
        vi.mocked(api.postRecruitmentTemplate).mockResolvedValue(post());
        renderPage(<RecruitmentPage />, { route: "/recruitment" });

        await user.click(await screen.findByRole("button", { name: "Nachricht posten" }));
        const dialog = await screen.findByRole("dialog");
        const send = within(dialog).getByRole("button", { name: "In Channel posten" });
        expect(send).toBeDisabled();
        await user.selectOptions(within(dialog).getByLabelText("Ziel-Channel"), "c1");
        await user.click(send);

        await waitFor(() => expect(api.postRecruitmentTemplate).toHaveBeenCalledWith({ templateId: "t1", channelId: "c1" }));
        expect(await screen.findByText("Nachricht gepostet.")).toBeInTheDocument();
    });
});

describe("the three tabs", () => {
    it("gives every tab its WoW icon and opens a part head of its own", async () => {
        const user = userEvent.setup();
        renderPage(<RecruitmentPage />, { route: "/recruitment" });

        const tabs = [
            { name: /Nachrichten/, icon: "inv_letter_15", head: "Gepostete Nachrichten" },
            { name: /Vorlagen/, icon: "inv_scroll_03", head: "Recruitment-Vorlagen" },
            { name: /Bewerbungen/, icon: "inv_misc_note_01", head: "Bewerbungen" },
        ];
        await screen.findByRole("tablist");
        for (const t of tabs) {
            const tab = screen.getByRole("tab", { name: t.name });
            expect({ tab: t.head, icon: !!wowIcon(tab, t.icon) }).toEqual({ tab: t.head, icon: true });
            await user.click(tab);
            await waitFor(() => expect(screen.getByRole("tab", { name: t.name })).toHaveAttribute("aria-selected", "true"));
            const partHead = document.querySelector(".part-head") as HTMLElement;
            expect(within(partHead).getByText(t.head)).toBeInTheDocument();
            expect(wowIcon(partHead, t.icon)).not.toBeNull();
        }
    });
});

describe("posted messages", () => {
    it("shows the wanted specs as icons named in the tooltip, not the raw text", async () => {
        renderPage(<RecruitmentPage />, { route: "/recruitment" });

        const row = (await screen.findByText(`#${CHANNEL_NAME}`)).closest("tr")!;
        const wanted = row.querySelector("[data-tip='Holy Paladin · Restoration Druid']");
        expect(wanted).not.toBeNull();
        expect(wanted!.querySelectorAll("img")).toHaveLength(2);
        expect(within(row).queryByText(/Komm zu uns/)).not.toBeInTheDocument();
    });

    it("marks the source with a badge: posted from here or found by the scan", async () => {
        renderPage(<RecruitmentPage />, { route: "/recruitment" });

        const posted = (await screen.findByText(`#${CHANNEL_NAME}`)).closest("tr")!;
        const found = screen.getByText("#gesucht").closest("tr")!;
        const postedBadge = within(posted).getByText("Gepostet");
        expect(postedBadge).toHaveClass("badge", "accent");
        expect(wowIcon(postedBadge, "ability_warrior_battleshout")).not.toBeNull();
        const foundBadge = within(found).getByText("Gefunden");
        expect(foundBadge).toHaveClass("badge");
        expect(wowIcon(foundBadge, "inv_misc_spyglass_02")).not.toBeNull();
        expect(within(posted).queryByText(/^(web|scan)$/)).not.toBeInTheDocument();
    });

    // A Discord channel is called "🔎》recruitment" and its category
    // "「・」TBC Montag": the cell cuts the name off (recruitment.css) and the
    // tooltip keeps it readable in full.
    it("keeps the full channel name and its category in the cell's tooltip", async () => {
        renderPage(<RecruitmentPage />, { route: "/recruitment" });

        const cell = (await screen.findByText(`#${CHANNEL_NAME}`)).closest("td")!;
        expect(cell).toHaveAttribute("data-tip", `#${CHANNEL_NAME}`);
        expect(cell).toHaveAttribute("data-tip-sub", CATEGORY);
        expect(within(cell).getByText(CATEGORY)).toBeInTheDocument();
        // The channel column takes what the fixed ones leave: no width of its own.
        const channelHead = screen.getByRole("columnheader", { name: /Channel/ });
        expect(channelHead.style.width).toBe("");
    });

    it("scans the server as a job toast and reloads the list afterwards", async () => {
        const user = userEvent.setup();
        let finish: (r: { count: number }) => void = () => undefined;
        vi.mocked(api.scanRecruitmentPosts).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        renderPage(<RecruitmentPage />, { route: "/recruitment" });

        await user.click(await screen.findByRole("button", { name: "Server durchsuchen" }));
        const toast = await screen.findByRole("status");
        expect(within(toast).getByText("Server durchsuchen")).toBeInTheDocument();
        expect(api.scanRecruitmentPosts).toHaveBeenCalledTimes(1);
        const loads = vi.mocked(api.getRecruitmentData).mock.calls.length;

        finish({ count: 3 });
        expect(await screen.findByText("3 Nachricht(en) gefunden oder aktualisiert.")).toBeInTheDocument();
        await waitFor(() => expect(vi.mocked(api.getRecruitmentData).mock.calls.length).toBeGreaterThan(loads));
    });

    it("offers no scan without an active server", async () => {
        vi.mocked(api.getRecruitmentData).mockResolvedValue(data({ activeGuildId: "" }));
        renderPage(<RecruitmentPage />, { route: "/recruitment" });

        await screen.findByText("Gepostete Nachrichten");
        expect(screen.queryByRole("button", { name: "Server durchsuchen" })).not.toBeInTheDocument();
    });
});

describe("applications", () => {
    it("draws one row per application in the class colour and opens its details in a modal", async () => {
        const user = userEvent.setup();
        renderPage(<RecruitmentPage />, { route: "/recruitment?view=applications" });

        const name = await screen.findByText("Thrall", { selector: ".cname span" });
        expect(name.style.getPropertyValue("--cc")).toBe("#0070DE");
        expect(screen.queryByText("Ich raide seit Classic.")).not.toBeInTheDocument();

        await user.click(name);
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("Ich raide seit Classic.")).toBeInTheDocument();
        expect(within(dialog).getByText("Schamane")).toBeInTheDocument();
        expect(within(dialog).getByRole("link", { name: /Thread in Discord öffnen/ })).toHaveAttribute("href", "https://discord.com/channels/g1/th1");

        await user.click(within(dialog).getByText("Schließen", { selector: "button" }));
        await waitFor(() => expect(screen.queryByText("Ich raide seit Classic.")).not.toBeInTheDocument());
    });

    it("toggles the same modal from the row's expand button without opening the armory", async () => {
        const user = userEvent.setup();
        const open = vi.spyOn(window, "open").mockReturnValue(null);
        renderPage(<RecruitmentPage />, { route: "/recruitment?view=applications" });

        const row = (await screen.findByText("Thrall", { selector: ".cname span" })).closest("tr")!;
        const buttons = within(row).getAllByRole("button");
        await user.click(buttons[buttons.length - 1]);
        expect(await screen.findByText("Ich raide seit Classic.")).toBeInTheDocument();
        expect(open).not.toHaveBeenCalled();
        open.mockRestore();
    });
});

describe("the message editor", () => {
    it("counts the text against Discord's message limit and flags going over it", async () => {
        const user = userEvent.setup();
        renderPage(<RecruitmentPage />, { route: "/recruitment?view=templates&edit=new" });

        const dialog = await screen.findByRole("dialog");
        const text = within(dialog).getByLabelText(/^Nachrichtentext/);
        expect(within(dialog).getByText(`0 / ${DISCORD_CONTENT_LIMIT}`)).toBeInTheDocument();
        await user.type(text, "Hallo");
        const count = within(dialog).getByText(`5 / ${DISCORD_CONTENT_LIMIT}`);
        expect(count).not.toHaveClass("over");

        await user.clear(text);
        await user.click(text);
        await user.paste("x".repeat(DISCORD_CONTENT_LIMIT + 1));
        expect(within(dialog).getByText(`${DISCORD_CONTENT_LIMIT + 1} / ${DISCORD_CONTENT_LIMIT}`)).toHaveClass("over");
    });

    it("previews what is typed live, with the bot's default button label", async () => {
        const user = userEvent.setup();
        renderPage(<RecruitmentPage />, { route: "/recruitment?view=templates&edit=new" });

        const dialog = await screen.findByRole("dialog");
        const preview = dialog.querySelector(".rc-preview") as HTMLElement;
        expect(within(preview).getByText("Jetzt bewerben")).toBeInTheDocument();
        await user.type(within(dialog).getByLabelText(/^Nachrichtentext/), "Wir suchen **Heiler**");
        expect(within(preview).getByText("Heiler").closest("strong")).not.toBeNull();
        await user.type(within(dialog).getByLabelText("Button-Beschriftung"), "Bewirb dich");
        expect(within(preview).getByText("Bewirb dich")).toBeInTheDocument();
    });
});
