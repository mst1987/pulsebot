// Several channels at once on the Kanäle page (#259): the bar a selection
// brings up, the "only what you change" edit, rename by schema, archiving and
// deleting — every change channel by channel, the progress in the job toast.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import ChannelsPage from "./ChannelsPage";
import { adminUser, renderPage } from "../test/render";
import { requireBackend } from "../test/backend";
import { BULK_DELETE_WORD } from "../lib/channels";
import { channelsData, TALK } from "./ChannelsPage.fixture";
import type { ChannelsData } from "../api";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getChannels: vi.fn(),
    patchChannels: vi.fn(),
    archiveChannels: vi.fn(),
    deleteChannels: vi.fn(),
    renamePreview: vi.fn(),
    saveChannelConfig: vi.fn(),
}));

const okResults = async (ids: string[]) => ({ results: ids.map((id) => ({ id, ok: true })), done: ids.length, failed: 0, message: "" });

async function openPage(data: ChannelsData = channelsData()) {
    vi.mocked(api.getChannels).mockResolvedValue(data);
    renderPage(<ChannelsPage />, { route: "/channels", user: adminUser() });
    await screen.findByRole("radiogroup", { name: "Ansicht" });
}

function row(name: string): HTMLElement {
    return screen.getByText(name, { selector: ".kn-name" }).closest<HTMLElement>("[data-channel]")!;
}

async function pick(user: ReturnType<typeof userEvent.setup>, ...names: string[]) {
    for (const name of names) await user.click(screen.getByRole("checkbox", { name: `#${name} wählen` }));
}

const bar = () => screen.getByRole("toolbar", { name: "Auswahl bearbeiten" });

beforeEach(() => {
    vi.mocked(api.patchChannels).mockImplementation(okResults);
    vi.mocked(api.archiveChannels).mockImplementation(okResults);
    vi.mocked(api.deleteChannels).mockImplementation(async (ids) => ({ results: [], done: ids.length, failed: 0, message: `${ids.length} gelöscht` }));
});

describe("ChannelsPage — the bulk bar", () => {
    it("appears only with a selection, with the actions of the design", async () => {
        const user = userEvent.setup();
        await openPage();
        expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
        await pick(user, "regeln", "raid-voice");
        const actions = within(bar()).getAllByRole("button").map((b) => b.getAttribute("aria-label") || b.textContent);
        expect(actions).toEqual(["Kategorie …", "Thema …", "Umbenennen nach Schema …", "Löschen …", "Archivieren", "Auswahl aufheben"]);
        expect(within(bar()).getByText("2 ausgewählt")).toBeInTheDocument();
        expect(within(bar()).getByText("Pulse")).toBeInTheDocument();
        await user.click(within(bar()).getByRole("button", { name: "Auswahl aufheben" }));
        expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    });

    it("selects every past event channel from its figure", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.click(screen.getByRole("button", { name: /Vergangene Events/ }));
        expect(within(bar()).getByText("1 ausgewählt")).toBeInTheDocument();
        expect(screen.getByRole("checkbox", { name: "#mi-10-09-ssc wählen" })).toBeChecked();
    });
});

describe("ChannelsPage — bulk edit", () => {
    it("applies only the changed fields, 'unverändert' by default, channel by channel with the progress in the toast", async () => {
        const user = userEvent.setup();
        await openPage();
        await pick(user, "mi-17-09-ssc", "mi-10-09-ssc");
        await user.click(within(bar()).getByRole("button", { name: "Kategorie …" }));

        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("2 Kanäle bearbeiten")).toBeInTheDocument();
        expect(within(dialog).getByRole("combobox", { name: "Kategorie" })).toHaveDisplayValue("unverändert");
        expect(within(dialog).getByRole("combobox", { name: "Slowmode" })).toHaveDisplayValue("unverändert");
        // the archive is no target of a move
        expect(within(within(dialog).getByRole("combobox", { name: "Kategorie" })).queryByRole("option", { name: "Archiv" })).not.toBeInTheDocument();
        const apply = within(dialog).getByRole("button", { name: "Übernehmen" });
        expect(apply).toBeDisabled();

        await user.selectOptions(within(dialog).getByRole("combobox", { name: "Kategorie" }), "Allgemein");
        await user.click(apply);

        // one request per channel, only the category in it
        await waitFor(() => expect(api.patchChannels).toHaveBeenCalledTimes(1));
        expect(api.patchChannels).toHaveBeenNthCalledWith(1, ["c-mi"], { parentId: TALK });
        expect(await screen.findByText("1 von 2")).toBeInTheDocument();
        expect(await screen.findByText("2 Kanäle geändert", {}, { timeout: 3000 })).toBeInTheDocument();
        expect(api.patchChannels).toHaveBeenNthCalledWith(2, ["c-old"], { parentId: TALK });
        expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    });

    it("clears a topic only with 'Thema leeren' and reports a failed channel in the toast", async () => {
        const user = userEvent.setup();
        vi.mocked(api.patchChannels)
            .mockImplementationOnce(okResults)
            .mockResolvedValueOnce({ results: [{ id: "c-old", ok: false, error: "fehlende Rechte" }], done: 0, failed: 1, message: "" });
        await openPage();
        await pick(user, "mi-17-09-ssc", "mi-10-09-ssc");
        await user.click(within(bar()).getByRole("button", { name: "Thema …" }));
        const dialog = screen.getByRole("dialog");
        await user.click(within(dialog).getByRole("checkbox", { name: "Thema leeren" }));
        expect(within(dialog).getByRole("textbox", { name: "Thema" })).toBeDisabled();
        await user.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
        expect(await screen.findByText("1 Kanal geändert, 1 fehlgeschlagen: fehlende Rechte", {}, { timeout: 3000 })).toBeInTheDocument();
        expect(api.patchChannels).toHaveBeenCalledWith(["c-mi"], { topic: "" });
    });

    it("saves only what changed in the full edit of one channel", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.click(within(row("bewerbungen")).getByRole("button", { name: "Bearbeiten" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("#bewerbungen bearbeiten")).toBeInTheDocument();
        const save = within(dialog).getByRole("button", { name: "Speichern" });
        expect(save).toBeDisabled();
        const topic = within(dialog).getByRole("textbox", { name: "Thema" });
        await user.clear(topic);
        await user.type(topic, "Neue Bewerbungen");
        await user.click(save);
        await waitFor(() => expect(api.patchChannels).toHaveBeenCalledWith(["c-app"], { topic: "Neue Bewerbungen" }));
    });
});

describe("ChannelsPage — rename by schema", () => {
    it("previews on the server, marks conflicts and renames only the rest", async () => {
        const user = userEvent.setup();
        vi.mocked(api.renamePreview).mockResolvedValue({
            rows: [
                {
                    id: "c-mi", from: "mi-17-09-ssc", to: "mi-17-09-ssc-tk", hasDate: true, conflict: false,
                    naming: { source: "previous", label: "abgeleitet aus #mi-10-09-ssc", detail: "Datum ersetzt", design: "Rechte von #mi-10-09-ssc", fromChannel: "c-old", templateChannelId: "c-old", templateChannelName: "mi-10-09-ssc" },
                },
                { id: "c-old", from: "mi-10-09-ssc", to: "regeln", hasDate: true, conflict: true },
            ],
        });
        await openPage();
        await pick(user, "mi-17-09-ssc", "mi-10-09-ssc");
        await user.click(within(bar()).getByRole("button", { name: "Umbenennen nach Schema …" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByRole("textbox", { name: "Schema" })).toHaveAttribute("placeholder", "leer = wie der letzte Event-Kanal");

        await waitFor(() => expect(api.renamePreview).toHaveBeenCalledWith({ ids: ["c-mi", "c-old"], schema: "", raid: "" }));
        expect(await within(dialog).findByText("mi-17-09-ssc-tk")).toBeInTheDocument();
        expect(within(dialog).getByText("existiert")).toHaveAttribute("data-tip", "Konflikt");
        // where the new name comes from: one short badge per row, the details in its tooltip
        const naming = within(dialog).getByText("abgeleitet");
        expect(naming).toHaveAttribute("data-tip", "abgeleitet aus #mi-10-09-ssc");
        expect(naming).toHaveAttribute("data-tip-sub", "Datum ersetzt · Rechte von #mi-10-09-ssc");

        // a placeholder chip appends to the schema and asks again
        await user.click(within(dialog).getByRole("button", { name: "{raid}" }));
        expect(within(dialog).getByRole("textbox", { name: "Schema" })).toHaveValue("{raid}");
        await waitFor(() => expect(api.renamePreview).toHaveBeenLastCalledWith({ ids: ["c-mi", "c-old"], schema: "{raid}", raid: "" }));

        await user.click(within(dialog).getByRole("button", { name: "1 umbenennen" }));
        await waitFor(() => expect(api.patchChannels).toHaveBeenCalledWith(["c-mi"], { name: "mi-17-09-ssc-tk" }));
        expect(api.patchChannels).toHaveBeenCalledTimes(1);
    });
});

describe("ChannelsPage — archiving", () => {
    it("asks before archiving and says nothing is deleted", async () => {
        const user = userEvent.setup();
        await openPage();
        await pick(user, "mi-10-09-ssc");
        await user.click(within(bar()).getByRole("button", { name: "Archivieren" }));
        const ask = screen.getByRole("dialog");
        expect(within(ask).getByText("#mi-10-09-ssc archivieren?")).toBeInTheDocument();
        expect(within(ask).getByText(/Sie wandern in „Archiv“.*Gelöscht wird nichts/)).toBeInTheDocument();
        await user.click(within(ask).getByRole("button", { name: "Archivieren" }));
        await waitFor(() => expect(api.archiveChannels).toHaveBeenCalledWith(["c-old"]));
        expect(await screen.findByText("1 Kanal archiviert")).toBeInTheDocument();
    });

    it("archives nothing when the question is cancelled", async () => {
        const user = userEvent.setup();
        await openPage();
        await pick(user, "mi-10-09-ssc");
        await user.click(within(bar()).getByRole("button", { name: "Archivieren" }));
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Abbrechen" }));
        expect(api.archiveChannels).not.toHaveBeenCalled();
    });

    it("leads to the archive settings when there is no archive yet, then carries on", async () => {
        const user = userEvent.setup();
        const noArchive = channelsData({ archive: { categoryId: "", count: 0, overdue: 0, hintDays: 14, rows: [] } });
        await openPage(noArchive);
        vi.mocked(api.saveChannelConfig).mockResolvedValue({ config: { archiveCategoryId: "cat-new", archiveDeleteHintDays: 14 } });
        await pick(user, "mi-10-09-ssc");
        await user.click(within(bar()).getByRole("button", { name: "Archivieren" }));

        const settings = screen.getByRole("dialog");
        expect(within(settings).getByText("Archiv-Einstellungen")).toBeInTheDocument();
        expect(within(settings).getByRole("button", { name: "Speichern" })).toBeDisabled();
        await user.selectOptions(within(settings).getByRole("combobox", { name: "Archiv-Kategorie" }), "+ neue Kategorie anlegen");
        expect(within(settings).getByRole("textbox", { name: "Name der neuen Kategorie" })).toHaveValue("Archiv");

        // the reload after saving brings the new archive category
        vi.mocked(api.getChannels).mockResolvedValue(channelsData({
            categories: [...noArchive.categories, { id: "cat-new", name: "Altlasten" }],
            archive: { categoryId: "cat-new", count: 0, overdue: 0, hintDays: 14, rows: [] },
        }));
        await user.click(within(settings).getByRole("button", { name: "Speichern" }));
        expect(api.saveChannelConfig).toHaveBeenCalledWith({ createArchiveCategory: "Archiv", archiveDeleteHintDays: 14 });
        expect(await screen.findByText(/Sie wandern in „Altlasten“/)).toBeInTheDocument();
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archivieren" }));
        await waitFor(() => expect(api.archiveChannels).toHaveBeenCalledWith(["c-old"]));
    });
});

describe("ChannelsPage — deleting from the channel list", () => {
    it("deletes one channel only with its name typed, and names an upcoming event first", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.click(within(row("mi-17-09-ssc")).getByRole("button", { name: "Löschen" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("#mi-17-09-ssc löschen")).toBeInTheDocument();
        expect(within(dialog).getByText("Kanäle", { selector: ".kicker" })).toBeInTheDocument();
        expect(within(dialog).getByText(/#mi-17-09-ssc gehört zum anstehenden Event „SSC Mittwoch“.*Anmelde-Nachricht geht mit verloren/)).toBeInTheDocument();

        const confirm = within(dialog).getByRole("button", { name: "Endgültig löschen" });
        const input = within(dialog).getByRole("textbox", { name: /Zum Bestätigen/ });
        expect(confirm).toBeDisabled();
        await user.type(input, "mi-17-09");
        expect(confirm).toBeDisabled();
        await user.type(input, "-ssc");
        expect(confirm).toBeEnabled();
        await user.click(confirm);
        await waitFor(() => expect(api.deleteChannels).toHaveBeenCalledWith(["c-mi"], "mi-17-09-ssc", true));
        expect(await screen.findByText("1 gelöscht")).toBeInTheDocument();
    });

    it("says nothing about a past event's channel", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.click(within(row("mi-10-09-ssc")).getByRole("button", { name: "Löschen" }));
        expect(within(screen.getByRole("dialog")).queryByText(/Anmelde-Nachricht/)).not.toBeInTheDocument();
    });

    it("deletes several with the server's bulk word, from the bar", async () => {
        const user = userEvent.setup();
        await openPage();
        await pick(user, "regeln", "raid-voice");
        await user.click(within(bar()).getByRole("button", { name: "Löschen …" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("2 Kanäle löschen")).toBeInTheDocument();
        expect(within(dialog).getByText("#regeln")).toBeInTheDocument();
        expect(within(dialog).getByText(BULK_DELETE_WORD, { selector: "b" })).toBeInTheDocument();
        await user.type(within(dialog).getByRole("textbox", { name: /Zum Bestätigen/ }), "regeln");
        expect(within(dialog).getByRole("button", { name: "Endgültig löschen" })).toBeDisabled();
        await user.clear(within(dialog).getByRole("textbox", { name: /Zum Bestätigen/ }));
        await user.type(within(dialog).getByRole("textbox", { name: /Zum Bestätigen/ }), BULK_DELETE_WORD);
        await user.click(within(dialog).getByRole("button", { name: "Endgültig löschen" }));
        await waitFor(() => expect(api.deleteChannels).toHaveBeenCalledWith(["c-loose", "c-voice"], BULK_DELETE_WORD, true));
    });

    it("confirms with the same word the server checks", () => {
        expect(BULK_DELETE_WORD).toBe(requireBackend("web/apiRoutes/channels").BULK_DELETE_WORD);
    });
});
