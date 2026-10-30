// The posting dialog with forums and link buttons: a forum as the target needs
// a post title and switches the button to a link; the link comes from the bot
// (a permanent invite) or is pasted, and only Discord links are taken.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { RecruitmentData } from "../../api";
import { renderPage } from "../../test/render";
import { PostDialog } from "./PostDialog";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    postRecruitmentTemplate: vi.fn(),
    createRecruitmentInvite: vi.fn(),
}));

function data(over: Partial<RecruitmentData> = {}): RecruitmentData {
    return {
        view: "", guildName: "Pulse", editing: null, editingPost: null,
        templates: [{ id: "t1", name: "Partnergilde Nachtwache", content: "Komm zu uns!", title: "", body: "", buttonLabel: "", versionId: "tbc" }],
        posts: [],
        channels: [{ id: "c1", name: "recruitment", category: "Allgemein" }],
        targets: [
            { id: "c1", name: "recruitment", category: "Allgemein", parentId: "", kind: "text" },
            { id: "f1", name: "gilden-suchen", category: "Allgemein", parentId: "", kind: "forum" },
        ],
        inviteServers: [{
            id: "g1", name: "Pulse", suggestedChannelId: "w1",
            channels: [
                { id: "w1", name: "willkommen", category: "Start", canInvite: true },
                { id: "w2", name: "geschlossen", category: "Start", canInvite: false },
            ],
        }],
        emojis: [], specCatalog: [], applications: [], applicationsError: null, applicationChannelId: "",
        activeGuildId: "g1", gameVersions: [], mainVersion: "tbc",
        ...over,
    };
}

function open(d: RecruitmentData = data()) {
    const onPosted = vi.fn();
    renderPage(<PostDialog data={d} presetTemplateId="" onPosted={onPosted} onClose={() => {}} />);
    return { dialog: screen.getByRole("dialog"), onPosted };
}

beforeEach(() => {
    vi.mocked(api.postRecruitmentTemplate).mockReset().mockResolvedValue({} as never);
    vi.mocked(api.createRecruitmentInvite).mockReset();
});

describe("PostDialog targets", () => {
    it("marks a forum and keeps the apply button for a text channel", async () => {
        const user = userEvent.setup();
        const { dialog } = open();
        const target = within(dialog).getByLabelText("Ziel");
        expect(within(target).getByRole("option", { name: "gilden-suchen (Forum)" })).toBeInTheDocument();
        await user.selectOptions(target, "c1");
        expect(within(dialog).queryByLabelText(/Titel des Forum-Beitrags/)).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "In Channel posten" }));
        await waitFor(() => expect(api.postRecruitmentTemplate).toHaveBeenCalledWith({ templateId: "t1", channelId: "c1" }));
    });

    it("a forum needs a title, prefills it with the template's name and switches to the link button", async () => {
        const user = userEvent.setup();
        const { dialog } = open();
        await user.selectOptions(within(dialog).getByLabelText("Ziel"), "f1");
        const title = within(dialog).getByLabelText(/Titel des Forum-Beitrags/) as HTMLInputElement;
        expect(title.value).toBe("Partnergilde Nachtwache");
        expect(within(dialog).getByText("23 / 100 Zeichen")).toBeInTheDocument();
        expect(within(dialog).getByRole("radio", { name: "Link" })).toBeChecked();
        expect(document.querySelector(".dc-forum-title")).toHaveTextContent("Partnergilde Nachtwache");

        await user.clear(title);
        const send = within(dialog).getByRole("button", { name: "Im Forum posten" });
        expect(send).toBeDisabled();
        expect(document.querySelector(".dc-forum-title")).toHaveTextContent("Titel fehlt");
    });
});

describe("PostDialog link button", () => {
    it("posts into a forum with an invite the bot created in the suggested channel", async () => {
        const user = userEvent.setup();
        vi.mocked(api.createRecruitmentInvite).mockResolvedValue({ code: "abc", url: "https://discord.gg/abc" });
        const { dialog, onPosted } = open();
        await user.selectOptions(within(dialog).getByLabelText("Ziel"), "f1");
        expect((within(dialog).getByLabelText("Channel der Einladung") as HTMLSelectElement).value).toBe("w1");
        const send = within(dialog).getByRole("button", { name: "Im Forum posten" });
        expect(send).toBeDisabled();

        await user.click(within(dialog).getByRole("button", { name: "Einladung erzeugen" }));
        expect(api.createRecruitmentInvite).toHaveBeenCalledWith({ guildId: "g1", channelId: "w1", fresh: false });
        expect(await within(dialog).findByText("https://discord.gg/abc")).toBeInTheDocument();
        expect(document.querySelector(".dc-btn-link")).toHaveTextContent("Server beitreten");

        await user.type(within(dialog).getByLabelText("Text auf dem Link-Knopf"), "Zur Nachtwache");
        await user.click(send);
        await waitFor(() => expect(api.postRecruitmentTemplate).toHaveBeenCalledWith({
            templateId: "t1", channelId: "f1", buttonKind: "link", linkUrl: "https://discord.gg/abc",
            buttonLabel: "Zur Nachtwache", forumTitle: "Partnergilde Nachtwache",
        }));
        expect(onPosted).toHaveBeenCalled();
    });

    it("without the invite right it says so and offers to paste instead", async () => {
        const user = userEvent.setup();
        const { dialog } = open();
        await user.selectOptions(within(dialog).getByLabelText("Ziel"), "f1");
        await user.selectOptions(within(dialog).getByLabelText("Channel der Einladung"), "w2");
        expect(within(dialog).getByText(/Recht .Einladung erstellen/)).toBeInTheDocument();
        expect(within(dialog).queryByRole("button", { name: "Einladung erzeugen" })).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Link einfügen" }));
        expect(within(dialog).getByRole("radio", { name: "Einfügen" })).toBeChecked();
    });

    it("takes only a pasted Discord link, also into a text channel", async () => {
        const user = userEvent.setup();
        const { dialog } = open(data({ inviteServers: [] }));
        await user.selectOptions(within(dialog).getByLabelText("Ziel"), "c1");
        await user.click(within(dialog).getByRole("radio", { name: "Link" }));
        expect(within(dialog).getByRole("radio", { name: "Bot erzeugt" })).toBeDisabled();
        expect(within(dialog).getByText(/kann der Bot einladen/)).toBeInTheDocument();

        const url = within(dialog).getByLabelText("Link");
        const send = within(dialog).getByRole("button", { name: "In Channel posten" });
        await user.type(url, "https://example.com/x");
        expect(within(dialog).getByText(/kein Discord-Einladungs/)).toBeInTheDocument();
        expect(send).toBeDisabled();

        await user.clear(url);
        await user.type(url, "https://discord.com/invite/partner");
        expect(send).toBeEnabled();
        await user.click(send);
        await waitFor(() => expect(api.postRecruitmentTemplate).toHaveBeenCalledWith({
            templateId: "t1", channelId: "c1", buttonKind: "link", linkUrl: "https://discord.com/invite/partner", buttonLabel: "",
        }));
    });

    it("asks for a fresh invite only on 'Neu erzeugen', and starts the next post empty", async () => {
        const user = userEvent.setup();
        vi.mocked(api.createRecruitmentInvite)
            .mockResolvedValueOnce({ code: "abc", url: "https://discord.gg/abc", reused: true })
            .mockResolvedValueOnce({ code: "neu", url: "https://discord.gg/neu" });
        const { dialog, onPosted } = open();
        await user.selectOptions(within(dialog).getByLabelText("Ziel"), "f1");
        await user.click(within(dialog).getByRole("button", { name: "Einladung erzeugen" }));
        await user.click(await within(dialog).findByRole("button", { name: "Neu erzeugen" }));
        expect(api.createRecruitmentInvite).toHaveBeenLastCalledWith({ guildId: "g1", channelId: "w1", fresh: true });
        expect(await within(dialog).findByText("https://discord.gg/neu")).toBeInTheDocument();

        await user.type(within(dialog).getByLabelText("Text auf dem Link-Knopf"), "Zur Nachtwache");
        await user.click(within(dialog).getByRole("button", { name: "Im Forum posten" }));
        await waitFor(() => expect(onPosted).toHaveBeenCalled());
        expect(within(dialog).queryByText("https://discord.gg/neu")).not.toBeInTheDocument();
        expect((within(dialog).getByLabelText(/Titel des Forum-Beitrags/) as HTMLInputElement).value).toBe("");
        expect((within(dialog).getByLabelText("Text auf dem Link-Knopf") as HTMLInputElement).value).toBe("");
    });

    it("starts the invite on the server of an existing post and shows the server's default label", async () => {
        const user = userEvent.setup();
        const servers = [
            { id: "g1", name: "Pulse", suggestedChannelId: "w1", channels: [{ id: "w1", name: "willkommen", category: "Start", canInvite: true }] },
            { id: "g2", name: "Pugs", suggestedChannelId: "p1", channels: [{ id: "p1", name: "welcome", category: "Start", canInvite: true }] },
        ];
        const posts = [{ id: "x", guildId: "g2", channelId: "f9", messageId: "m", templateId: "t1" }] as unknown as RecruitmentData["posts"];
        const { dialog } = open(data({ inviteServers: servers, posts, defaultLinkLabel: "Join server" }));
        await user.selectOptions(within(dialog).getByLabelText("Ziel"), "f1");
        expect((within(dialog).getByLabelText("Server") as HTMLSelectElement).value).toBe("g2");
        expect(within(dialog).getByLabelText("Text auf dem Link-Knopf")).toHaveAttribute("placeholder", "Join server");
        expect(document.querySelector(".dc-btn-link")).toHaveTextContent("Join server");
    });

    it("cuts a long template name to 100 characters, not splitting an emoji", async () => {
        const user = userEvent.setup();
        const name = `${"a".repeat(99)}\u{1F525}zz`;
        const { dialog } = open(data({ templates: [{ id: "t1", name, content: "x", title: "", body: "", buttonLabel: "", versionId: "tbc" }] }));
        await user.selectOptions(within(dialog).getByLabelText("Ziel"), "f1");
        const title = (within(dialog).getByLabelText(/Titel des Forum-Beitrags/) as HTMLInputElement).value;
        expect(Array.from(title)).toHaveLength(100);
        expect(title.endsWith("\u{1F525}")).toBe(true);
    });

    it("shows a refused invite's reason from the server", async () => {
        const user = userEvent.setup();
        vi.mocked(api.createRecruitmentInvite).mockRejectedValue({ code: "invite_permission", message: "Bot darf hier nicht einladen." });
        const { dialog } = open();
        await user.selectOptions(within(dialog).getByLabelText("Ziel"), "f1");
        await user.click(within(dialog).getByRole("button", { name: "Einladung erzeugen" }));
        expect(await within(dialog).findByText("Bot darf hier nicht einladen.")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Link einfügen" })).toBeInTheDocument();
    });
});
