// "Roster als Bild": the server's PNG as preview (the switches change its address), the
// download link, posting into the prefilled channel, a refused post as a sentence in the
// dialog, a reader without the right to post (no channel, no post button), the running post
// that keeps itself current (its switches and channel as the start, "Neu posten"), English.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import RosterImageDialog from "../RosterImageDialog";
import { renderPage } from "../../../test/render";
import { switchLang } from "../../../test/i18n";
import { detail, member } from "../rosters.fixture";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getRosterImageInfo: vi.fn(),
    postRosterImage: vi.fn(),
    attachRosterImage: vi.fn(),
}));

const CHANNELS = [
    { id: "c-roster", name: "roster", category: "Raid", parentId: null },
    { id: "c-news", name: "news", category: "", parentId: null },
];
const LIVE = { channelId: "c-news", url: "https://discord.com/channels/g1/c-news/m9", reserve: true, chars: false, text: "" };
const data = () => detail([member("Thorgrim", { userId: "u-thorgrim" })]);

function open() {
    const onClose = vi.fn();
    renderPage(<RosterImageDialog data={data()} onClose={onClose} />);
    return { onClose };
}
const previewName = { name: "Roster Raid Mo / Do als Bild" };
const preview = () => screen.getByRole("img", previewName);

beforeEach(() => {
    vi.mocked(api.getRosterImageInfo).mockReset();
    vi.mocked(api.getRosterImageInfo).mockResolvedValue({ canPost: true, channelId: "c-roster", channels: CHANNELS, live: null });
    vi.mocked(api.postRosterImage).mockResolvedValue({ url: "https://discord.com/channels/g1/c-roster/m1", channelId: "c-roster" });
    vi.mocked(api.attachRosterImage).mockReset();
    vi.mocked(api.attachRosterImage).mockResolvedValue({ url: "https://discord.com/channels/g1/c-news/m7", channelId: "c-news" });
});
afterEach(() => switchLang("de"));

describe("RosterImageDialog", () => {
    it("shows the server's PNG; the switches change its address and the download follows", async () => {
        open();
        expect(screen.getByText("Roster als Bild")).toBeInTheDocument();
        expect(await screen.findByRole("img", previewName)).toHaveAttribute("src", "/api/rosters/image?id=raid-mo-do-abc");
        expect(screen.getByText("Bild wird erstellt …")).toBeInTheDocument();
        fireEvent.load(preview());
        expect(screen.queryByText("Bild wird erstellt …")).not.toBeInTheDocument();
        const reserve = screen.getByRole("switch", { name: "Ersatz und Pause zeigen" });
        const chars = screen.getByRole("switch", { name: "Weitere Chars zeigen" });
        expect(reserve).not.toBeChecked();
        expect(chars).not.toBeChecked();
        await userEvent.click(reserve);
        expect(preview()).toHaveAttribute("src", "/api/rosters/image?id=raid-mo-do-abc&reserve=1");
        expect(screen.getByText("Bild wird erstellt …")).toBeInTheDocument();
        await userEvent.click(chars);
        expect(preview()).toHaveAttribute("src", "/api/rosters/image?id=raid-mo-do-abc&reserve=1&chars=1");
        const link = screen.getByRole("link", { name: "Bild herunterladen" });
        expect(link).toHaveAttribute("href", "/api/rosters/image?id=raid-mo-do-abc&reserve=1&chars=1");
        expect(link).toHaveAttribute("download", "roster-raid-mo-do.png");
    });

    it("says so when the picture could not be drawn", async () => {
        open();
        fireEvent.error(await screen.findByRole("img", previewName));
        expect(screen.getByRole("alert")).toHaveTextContent("Das Bild konnte nicht erstellt werden.");
    });

    it("draws nothing and holds the switches until the server has answered", async () => {
        let answer: (value: api.RosterImageInfo) => void = () => {};
        vi.mocked(api.getRosterImageInfo).mockReturnValue(new Promise((resolve) => { answer = resolve; }));
        open();
        expect(screen.queryByRole("img", previewName)).not.toBeInTheDocument();
        expect(screen.getByRole("switch", { name: "Ersatz und Pause zeigen" })).toBeDisabled();
        answer({ canPost: true, channelId: "c-roster", channels: CHANNELS, live: LIVE });
        expect(await screen.findByRole("img", previewName)).toHaveAttribute("src", "/api/rosters/image?id=raid-mo-do-abc&reserve=1");
        expect(screen.getByRole("switch", { name: "Ersatz und Pause zeigen" })).toBeEnabled();
    });

    it("still shows the picture when the server's answer about posting fails", async () => {
        vi.mocked(api.getRosterImageInfo).mockRejectedValue({ code: "http_500", message: "boom" });
        open();
        expect(await screen.findByRole("img", previewName)).toHaveAttribute("src", "/api/rosters/image?id=raid-mo-do-abc");
        expect(screen.queryByLabelText("Kanal")).not.toBeInTheDocument();
    });

    it("posts into the roster's last channel with the switches and links the message", async () => {
        open();
        const picker = await screen.findByLabelText("Kanal");
        expect(picker).toHaveValue("c-roster");
        expect(screen.getByText("Das Bild mit einer kurzen Zeile, ohne Ping. Es aktualisiert sich danach selbst, bis du es in Discord löschst.")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("switch", { name: "Ersatz und Pause zeigen" }));
        await userEvent.click(screen.getByRole("button", { name: "In Kanal posten" }));
        expect(api.postRosterImage).toHaveBeenCalledWith("raid-mo-do-abc", "c-roster", { reserve: true, chars: false, text: "" });
        expect(await screen.findByRole("status")).toHaveTextContent("In #roster gepostet.");
        expect(screen.getByRole("link", { name: "Nachricht öffnen" })).toHaveAttribute("href", "https://discord.com/channels/g1/c-roster/m1");
    });

    it("posts into another picked channel", async () => {
        open();
        await userEvent.selectOptions(await screen.findByLabelText("Kanal"), "c-news");
        await userEvent.click(screen.getByRole("button", { name: "In Kanal posten" }));
        expect(api.postRosterImage).toHaveBeenCalledWith("raid-mo-do-abc", "c-news", { reserve: false, chars: false, text: "" });
    });

    it("promises no updates for a closed roster: its post stays a snapshot", async () => {
        const closed = data();
        closed.roster.closed = true;
        renderPage(<RosterImageDialog data={closed} onClose={vi.fn()} />);
        expect(await screen.findByText("Das Bild mit einer kurzen Zeile, ohne Ping. Das Roster ist geschlossen, das Bild bleibt also eine Momentaufnahme.")).toBeInTheDocument();
        expect(screen.queryByText(/Es aktualisiert sich danach selbst/)).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "In Kanal posten" })).toBeInTheDocument();
    });

    it("starts from the running post: its switches, its channel, the sentence and 'Neu posten'", async () => {
        vi.mocked(api.getRosterImageInfo).mockResolvedValue({ canPost: true, channelId: "c-roster", channels: CHANNELS, live: LIVE });
        open();
        expect(await screen.findByLabelText("Kanal")).toHaveValue("c-news");
        expect(screen.getByRole("switch", { name: "Ersatz und Pause zeigen" })).toBeChecked();
        expect(screen.getByRole("switch", { name: "Weitere Chars zeigen" })).not.toBeChecked();
        expect(preview()).toHaveAttribute("src", "/api/rosters/image?id=raid-mo-do-abc&reserve=1");
        expect(screen.getByText(/Aktualisiert sich selbst in #news\./)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Nachricht öffnen" })).toHaveAttribute("href", LIVE.url);
        expect(screen.getByText("Das bisherige Bild wird dabei gelöscht.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Neu posten" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "In Kanal posten" })).not.toBeInTheDocument();
    });

    it("lets a switch moved by hand win over the running post", async () => {
        vi.mocked(api.getRosterImageInfo).mockResolvedValue({ canPost: true, channelId: "c-roster", channels: CHANNELS, live: LIVE });
        open();
        await userEvent.click(await screen.findByRole("switch", { name: "Ersatz und Pause zeigen" }));
        expect(screen.getByRole("switch", { name: "Ersatz und Pause zeigen" })).not.toBeChecked();
        await userEvent.click(await screen.findByRole("button", { name: "Neu posten" }));
        expect(api.postRosterImage).toHaveBeenCalledWith("raid-mo-do-abc", "c-news", { reserve: false, chars: false, text: "" });
    });

    it("leaves out the link while the bot cannot tell it", async () => {
        vi.mocked(api.getRosterImageInfo).mockResolvedValue({ canPost: true, channelId: "c-roster", channels: CHANNELS, live: { ...LIVE, url: "" } });
        open();
        expect(await screen.findByText(/Aktualisiert sich selbst in #news\./)).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Nachricht öffnen" })).not.toBeInTheDocument();
    });

    it("asks the server again after a post: the new post is the running one, with one link", async () => {
        vi.mocked(api.getRosterImageInfo)
            .mockResolvedValueOnce({ canPost: true, channelId: "c-roster", channels: CHANNELS, live: null })
            .mockResolvedValue({ canPost: true, channelId: "c-roster", channels: CHANNELS, live: { channelId: "c-roster", url: "https://discord.com/channels/g1/c-roster/m1", reserve: false, chars: false, text: "" } });
        open();
        await screen.findByLabelText("Kanal");
        await userEvent.click(screen.getByRole("button", { name: "In Kanal posten" }));
        expect(await screen.findByRole("status")).toHaveTextContent("In #roster gepostet.");
        expect(api.getRosterImageInfo).toHaveBeenCalledTimes(2);
        expect(screen.getByRole("button", { name: "Neu posten" })).toBeInTheDocument();
        expect(screen.getByText(/Aktualisiert sich selbst in #roster\./)).toBeInTheDocument();
        expect(screen.getAllByRole("link", { name: "Nachricht öffnen" })).toHaveLength(1);
    });

    it("keeps a refused post in the dialog as a clear sentence and also toasts it", async () => {
        vi.mocked(api.postRosterImage).mockRejectedValue({ code: "no_permission", message: "Missing Permissions" });
        const { onClose } = open();
        await screen.findByLabelText("Kanal");
        await userEvent.click(screen.getByRole("button", { name: "In Kanal posten" }));
        const sentence = "Der Bot darf in diesem Kanal nicht schreiben oder keine Dateien anhängen.";
        expect(await screen.findByRole("alert")).toHaveTextContent(sentence);
        // once in the dialog, once in the shared toast
        expect(screen.getAllByText(sentence)).toHaveLength(2);
        expect(api.getRosterImageInfo).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    it("names an unknown code instead of hiding it", async () => {
        vi.mocked(api.postRosterImage).mockRejectedValue({ code: "http_500", message: "boom" });
        open();
        await screen.findByLabelText("Kanal");
        await userEvent.click(screen.getByRole("button", { name: "In Kanal posten" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Posten fehlgeschlagen (Fehler http_500).");
    });

    it("asks for a channel first and does not call the server without one", async () => {
        vi.mocked(api.getRosterImageInfo).mockResolvedValue({ canPost: true, channelId: null, channels: CHANNELS, live: null });
        open();
        expect(await screen.findByLabelText("Kanal")).toHaveValue("");
        await userEvent.click(screen.getByRole("button", { name: "In Kanal posten" }));
        expect(screen.getByRole("alert")).toHaveTextContent("Bitte zuerst einen Kanal wählen.");
        expect(api.postRosterImage).not.toHaveBeenCalled();
    });

    it("lets a reader look and download, but offers no channel and no post button", async () => {
        vi.mocked(api.getRosterImageInfo).mockResolvedValue({ canPost: false, channelId: null, channels: [], live: null });
        open();
        await waitFor(() => expect(api.getRosterImageInfo).toHaveBeenCalledWith("raid-mo-do-abc"));
        expect(await screen.findByRole("img", previewName)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Bild herunterladen" })).toBeInTheDocument();
        expect(screen.queryByLabelText("Kanal")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "In Kanal posten" })).not.toBeInTheDocument();
    });

    it("shows the field for an existing message only after the click", async () => {
        open();
        await screen.findByLabelText("Kanal");
        expect(screen.queryByLabelText("Nachrichten-ID oder Link")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Anhängen" })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Vorhandene Nachricht anhängen" }));
        expect(screen.getByLabelText("Nachrichten-ID oder Link")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Anhängen" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Vorhandene Nachricht anhängen" })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
        expect(screen.queryByLabelText("Nachrichten-ID oder Link")).not.toBeInTheDocument();
    });

    it("offers no attaching for a closed roster", async () => {
        const closed = data();
        closed.roster.closed = true;
        renderPage(<RosterImageDialog data={closed} onClose={vi.fn()} />);
        await screen.findByLabelText("Kanal");
        expect(screen.queryByRole("button", { name: "Vorhandene Nachricht anhängen" })).not.toBeInTheDocument();
    });

    it("offers a reader neither attaching nor a text", async () => {
        vi.mocked(api.getRosterImageInfo).mockResolvedValue({ canPost: false, channelId: null, channels: [], live: null });
        open();
        await screen.findByRole("img", previewName);
        expect(screen.queryByRole("button", { name: "Vorhandene Nachricht anhängen" })).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Text zum Bild")).not.toBeInTheDocument();
    });

    it("attaches with the channel, switches and text, then shows the message like a post", async () => {
        vi.mocked(api.getRosterImageInfo)
            .mockResolvedValueOnce({ canPost: true, channelId: "c-news", channels: CHANNELS, live: null })
            .mockResolvedValue({ canPost: true, channelId: "c-news", channels: CHANNELS, live: { channelId: "c-news", url: "https://discord.com/channels/g1/c-news/m7", reserve: false, chars: false, text: "Heute" } });
        open();
        await screen.findByLabelText("Kanal");
        await userEvent.type(screen.getByLabelText("Text zum Bild"), "Heute");
        await userEvent.click(screen.getByRole("button", { name: "Vorhandene Nachricht anhängen" }));
        await userEvent.type(screen.getByLabelText("Nachrichten-ID oder Link"), "400000000000000009");
        await userEvent.click(screen.getByRole("button", { name: "Anhängen" }));
        expect(api.attachRosterImage).toHaveBeenCalledWith("raid-mo-do-abc", "c-news", "400000000000000009", { reserve: false, chars: false, text: "Heute" });
        expect(await screen.findByRole("status")).toHaveTextContent("In #news angehängt.");
        expect(api.getRosterImageInfo).toHaveBeenCalledTimes(2);
        expect(screen.queryByLabelText("Nachrichten-ID oder Link")).not.toBeInTheDocument();
        expect(screen.getAllByRole("link", { name: "Nachricht öffnen" })).toHaveLength(1);
    });

    it("keeps a refused attachment in the dialog as a sentence and also toasts it", async () => {
        vi.mocked(api.attachRosterImage).mockRejectedValue({ code: "not_roster_picture", message: "nope" });
        open();
        await screen.findByLabelText("Kanal");
        await userEvent.click(screen.getByRole("button", { name: "Vorhandene Nachricht anhängen" }));
        await userEvent.type(screen.getByLabelText("Nachrichten-ID oder Link"), "400000000000000009");
        await userEvent.click(screen.getByRole("button", { name: "Anhängen" }));
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toBeTruthy();
        expect(alert.textContent).not.toContain("not_roster_picture");
        expect(screen.getAllByText(alert.textContent!)).toHaveLength(2);
        expect(screen.getByLabelText("Nachrichten-ID oder Link")).toHaveValue("400000000000000009");
        expect(api.getRosterImageInfo).toHaveBeenCalledTimes(1);
    });

    it("starts the text from the running post and sends it with the new post", async () => {
        vi.mocked(api.getRosterImageInfo).mockResolvedValue({ canPost: true, channelId: "c-roster", channels: CHANNELS, live: { ...LIVE, text: "Heute 20 Uhr" } });
        open();
        const field = await screen.findByLabelText("Text zum Bild");
        expect(field).toHaveValue("Heute 20 Uhr");
        await userEvent.type(field, "!");
        await userEvent.click(screen.getByRole("button", { name: "Neu posten" }));
        expect(api.postRosterImage).toHaveBeenCalledWith("raid-mo-do-abc", "c-news", { reserve: true, chars: false, text: "Heute 20 Uhr!" });
    });

    it("closes from the footer", async () => {
        const { onClose } = open();
        await userEvent.click(screen.getAllByRole("button", { name: "Schließen" }).at(-1)!);
        expect(onClose).toHaveBeenCalled();
    });

    it("speaks English", async () => {
        await switchLang("en");
        open();
        expect(screen.getByText("Roster as image")).toBeInTheDocument();
        expect(screen.getByRole("switch", { name: "Show bench and pause" })).toBeInTheDocument();
        expect(await screen.findByRole("button", { name: "Post to channel" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Download image" })).toBeInTheDocument();
        expect(screen.getByText("The image with one short line, no ping. It then updates itself until you delete it in Discord.")).toBeInTheDocument();
    });

    it("speaks English about the running post too", async () => {
        await switchLang("en");
        vi.mocked(api.getRosterImageInfo).mockResolvedValue({ canPost: true, channelId: "c-roster", channels: CHANNELS, live: LIVE });
        open();
        expect(await screen.findByRole("button", { name: "Post again" })).toBeInTheDocument();
        expect(screen.getByText(/Updates itself in #news\./)).toBeInTheDocument();
        expect(screen.getByText("The current image gets deleted.")).toBeInTheDocument();
        expect(screen.getByLabelText("Text for the image")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Attach existing message" }));
        expect(screen.getByLabelText("Message ID or link")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Attach" })).toBeInTheDocument();
    });
});
