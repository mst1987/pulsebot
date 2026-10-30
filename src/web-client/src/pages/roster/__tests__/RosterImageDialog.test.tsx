// "Roster als Bild": the server's PNG as preview (the switches change its address), the
// download link, posting into the prefilled channel, a refused post as a sentence in the
// dialog, a reader without the right to post (no channel, no post button), English.
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
}));

const CHANNELS = [
    { id: "c-roster", name: "roster", category: "Raid", parentId: null },
    { id: "c-news", name: "news", category: "", parentId: null },
];
const data = () => detail([member("Thorgrim", { userId: "u-thorgrim" })]);

function open() {
    const onClose = vi.fn();
    renderPage(<RosterImageDialog data={data()} onClose={onClose} />);
    return { onClose };
}
const preview = () => screen.getByRole("img", { name: "Roster Raid Mo / Do als Bild" });

beforeEach(() => {
    vi.mocked(api.getRosterImageInfo).mockResolvedValue({ canPost: true, channelId: "c-roster", channels: CHANNELS });
    vi.mocked(api.postRosterImage).mockResolvedValue({ url: "https://discord.com/channels/g1/c-roster/m1", channelId: "c-roster" });
});
afterEach(() => switchLang("de"));

describe("RosterImageDialog", () => {
    it("shows the server's PNG; the switches change its address and the download follows", async () => {
        open();
        expect(screen.getByText("Roster als Bild")).toBeInTheDocument();
        expect(preview()).toHaveAttribute("src", "/api/rosters/image?id=raid-mo-do-abc");
        expect(screen.getByText("Bild wird erstellt …")).toBeInTheDocument();
        fireEvent.load(preview());
        expect(screen.queryByText("Bild wird erstellt …")).not.toBeInTheDocument();
        const reserve = screen.getByRole("switch", { name: "Ersatz und Pause zeigen" });
        const chars = screen.getByRole("switch", { name: "Weitere Chars zeigen" });
        expect(reserve).not.toBeChecked();
        expect(chars).not.toBeChecked();
        await userEvent.click(reserve);
        expect(preview()).toHaveAttribute("src", "/api/rosters/image?id=raid-mo-do-abc&reserve=1");
        await userEvent.click(chars);
        expect(preview()).toHaveAttribute("src", "/api/rosters/image?id=raid-mo-do-abc&reserve=1&chars=1");
        const link = screen.getByRole("link", { name: "Bild herunterladen" });
        expect(link).toHaveAttribute("href", "/api/rosters/image?id=raid-mo-do-abc&reserve=1&chars=1");
        expect(link).toHaveAttribute("download", "roster-raid-mo-do.png");
    });

    it("says so when the picture could not be drawn", () => {
        open();
        fireEvent.error(preview());
        expect(screen.getByRole("alert")).toHaveTextContent("Das Bild konnte nicht erstellt werden.");
    });

    it("posts into the roster's last channel with the switches and links the message", async () => {
        open();
        const picker = await screen.findByLabelText("Kanal");
        expect(picker).toHaveValue("c-roster");
        expect(screen.getByText("Das Bild mit einer kurzen Zeile, ohne Ping.")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("switch", { name: "Ersatz und Pause zeigen" }));
        await userEvent.click(screen.getByRole("button", { name: "In Kanal posten" }));
        expect(api.postRosterImage).toHaveBeenCalledWith("raid-mo-do-abc", "c-roster", { reserve: true, chars: false });
        expect(await screen.findByRole("status")).toHaveTextContent("In #roster gepostet.");
        expect(screen.getByRole("link", { name: "Nachricht öffnen" })).toHaveAttribute("href", "https://discord.com/channels/g1/c-roster/m1");
    });

    it("posts into another picked channel", async () => {
        open();
        await userEvent.selectOptions(await screen.findByLabelText("Kanal"), "c-news");
        await userEvent.click(screen.getByRole("button", { name: "In Kanal posten" }));
        expect(api.postRosterImage).toHaveBeenCalledWith("raid-mo-do-abc", "c-news", { reserve: false, chars: false });
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
        vi.mocked(api.getRosterImageInfo).mockResolvedValue({ canPost: true, channelId: null, channels: CHANNELS });
        open();
        expect(await screen.findByLabelText("Kanal")).toHaveValue("");
        await userEvent.click(screen.getByRole("button", { name: "In Kanal posten" }));
        expect(screen.getByRole("alert")).toHaveTextContent("Bitte zuerst einen Kanal wählen.");
        expect(api.postRosterImage).not.toHaveBeenCalled();
    });

    it("lets a reader look and download, but offers no channel and no post button", async () => {
        vi.mocked(api.getRosterImageInfo).mockResolvedValue({ canPost: false, channelId: null, channels: [] });
        open();
        await waitFor(() => expect(api.getRosterImageInfo).toHaveBeenCalledWith("raid-mo-do-abc"));
        expect(screen.getByRole("link", { name: "Bild herunterladen" })).toBeInTheDocument();
        expect(screen.queryByLabelText("Kanal")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "In Kanal posten" })).not.toBeInTheDocument();
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
    });
});
