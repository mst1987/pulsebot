// Making channels on the Kanäle page and the dialogs behind a row or the side
// panel: quick-create by schema (with "gleich Event anlegen"), a category's
// naming schema, duplicating a channel and assigning the purposes.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import ChannelsPage from "./ChannelsPage";
import { adminUser, renderPage } from "../test/render";
import { channelsData, purpose, RAIDS } from "./ChannelsPage.fixture";
import type { ChannelNaming, ChannelsData, QuickCreateInput } from "../api";
import { switchLang } from "../test/i18n";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getChannels: vi.fn(),
    quickCreateChannels: vi.fn(),
    saveChannelSchema: vi.fn(),
    duplicateChannel: vi.fn(),
    saveChannelPurpose: vi.fn(),
}));

const naming: ChannelNaming = {
    source: "previous", label: "abgeleitet aus #mi-17-09-ssc", detail: "Datum und Wochentag ersetzt", design: "Rechte wie #mi-17-09-ssc",
    fromChannel: "c-mi", templateChannelId: "c-mi", templateChannelName: "mi-17-09-ssc",
};

const writer = adminUser();

async function openPage(data: ChannelsData = channelsData(), user = writer) {
    vi.mocked(api.getChannels).mockResolvedValue(data);
    renderPage(<ChannelsPage />, { route: "/channels", user });
    await screen.findByRole("radiogroup", { name: "Ansicht" });
}

function row(name: string): HTMLElement {
    return screen.getByText(name, { selector: ".kn-name" }).closest<HTMLElement>("[data-channel]")!;
}

function categoryHead(name: string): HTMLElement {
    return screen.getByRole("button", { name: `${name} zuklappen` }).closest<HTMLElement>(".kn-cat-row")!;
}

/** The last quick-create call that was (or was not) a dry run. */
function lastCall(dryRun: boolean): QuickCreateInput | undefined {
    return vi.mocked(api.quickCreateChannels).mock.calls.map((c) => c[0]).filter((i) => !!i.dryRun === dryRun).pop();
}

beforeEach(() => {
    vi.mocked(api.quickCreateChannels).mockImplementation(async (input) => (input.dryRun
        ? {
            plan: [
                { date: "2026-09-24", name: "do-24-09-ssc", exists: false },
                { date: "2026-10-01", name: "regeln", exists: true },
            ],
            naming,
        }
        : { plan: [], results: [], done: 1, failed: 0, message: "1 Kanal angelegt." }));
    vi.mocked(api.saveChannelSchema).mockResolvedValue({ schema: { schema: "", raid: "", templateChannelId: "" } });
    vi.mocked(api.duplicateChannel).mockResolvedValue({ id: "c-new", name: "bewerbungen-2" });
    vi.mocked(api.saveChannelPurpose).mockResolvedValue({ config: {} as never });
});

describe("ChannelsPage — quick-create by schema", () => {
    it("opens from 'Anlegen', previews on the server and marks the names that exist", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.click(screen.getByRole("button", { name: "Anlegen" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Kanäle anlegen")).toBeInTheDocument();
        expect(within(dialog).getByText("Raids · nach Schema")).toBeInTheDocument();

        expect(await within(dialog).findByText("do-24-09-ssc")).toBeInTheDocument();
        expect(lastCall(true)).toMatchObject({ categoryId: RAIDS, schema: "", interval: "weekly", count: 4, dryRun: true });
        const exists = within(dialog).getByText("existiert");
        expect(exists).toHaveClass("mid");
        expect(exists.closest(".kn-preview-row")).toHaveTextContent("regeln");
        // where the names come from: one badge above the preview, the details in its tooltip
        const badge = within(dialog).getByText("abgeleitet aus #mi-17-09-ssc");
        expect(badge).toHaveAttribute("data-tip-sub", "Datum und Wochentag ersetzt · Rechte wie #mi-17-09-ssc");

        // once or weekly, weekly from 2 to 12 times
        expect(within(dialog).getByRole("radio", { name: "Serie" })).toHaveAttribute("aria-checked", "true");
        const count = within(dialog).getByRole("combobox", { name: "Wie oft" });
        expect(within(count).getAllByRole("option").map((o) => o.textContent)).toEqual(Array.from({ length: 11 }, (_, i) => `${i + 2} × wöchentlich`));
        await user.click(within(dialog).getByRole("radio", { name: "Einzeln" }));
        expect(within(dialog).queryByRole("combobox", { name: "Wie oft" })).not.toBeInTheDocument();
        await waitFor(() => expect(lastCall(true)).toMatchObject({ interval: "once", count: 1 }));

        // schema and template fold away
        expect(within(dialog).getByText("Schema & Vorlage", { selector: "summary" })).toBeInTheDocument();
        expect(within(dialog).getByRole("textbox", { name: "Namensschema" })).toHaveAttribute("placeholder", "leer = wie der letzte Event-Kanal");
    });

    it("creates only the new names as a job", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.click(screen.getByRole("button", { name: "Anlegen" }));
        const dialog = screen.getByRole("dialog");
        const create = await within(dialog).findByRole("button", { name: "1 anlegen" });
        await user.click(create);
        await waitFor(() => expect(lastCall(false)).toBeDefined());
        expect(lastCall(false)).not.toHaveProperty("withEvent");
        expect(await screen.findByText("1 Kanal angelegt.")).toBeInTheDocument();
    });

    it("offers the single channel in the split menu", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.click(screen.getByRole("button", { name: "Weitere Arten anzulegen" }));
        await user.click(screen.getByRole("menuitem", { name: "Einzelnen Kanal erstellen" }));
        expect(within(screen.getByRole("dialog")).getByText("Kanal erstellen", { selector: ".dlg-title" })).toBeInTheDocument();
    });
});

describe("ChannelsPage — 'gleich Event anlegen'", () => {
    const withEvents = () => channelsData({
        canCreateEvents: true,
        eventDefaults: { [RAIDS]: { templateId: "t25", templateName: "Raid 25", source: "eventhelper" } },
    });

    it("is a switch; the time and the template badge show only when it is on", async () => {
        const user = userEvent.setup();
        await openPage(withEvents());
        await user.click(screen.getByRole("button", { name: "Anlegen" }));
        const dialog = screen.getByRole("dialog");
        const toggle = within(dialog).getByRole("checkbox", { name: "Gleich Event anlegen" });
        expect(toggle).not.toBeChecked();
        expect(within(dialog).queryByLabelText("Uhrzeit")).not.toBeInTheDocument();

        await user.click(toggle);
        expect(within(dialog).getByLabelText("Uhrzeit")).toHaveValue("19:30");
        const template = within(dialog).getByText("Raid 25 · EventHelper");
        expect(template).toHaveAttribute("data-tip", "Vorlage: Raid 25");
        expect(template).toHaveAttribute("data-tip-sub", expect.stringContaining("Anmeldung über EventHelper"));

        // the creation stays open, so the running job's toast can be read
        let finish: (value: Awaited<ReturnType<typeof api.quickCreateChannels>>) => void = () => undefined;
        const preview = vi.mocked(api.quickCreateChannels).getMockImplementation()!;
        vi.mocked(api.quickCreateChannels).mockImplementation((input) => (input.dryRun ? preview(input) : new Promise((resolve) => { finish = resolve; })));
        await user.click(await within(dialog).findByRole("button", { name: "1 anlegen" }));
        await waitFor(() => expect(lastCall(false)).toMatchObject({ categoryId: RAIDS, withEvent: true, time: "19:30" }));
        // the job says what it does
        expect(await screen.findByText("Kanäle und Events anlegen")).toBeInTheDocument();
        finish({ plan: [], results: [], done: 1, failed: 0, message: "1 Kanal und 1 Event angelegt." });
        expect(await screen.findByText("1 Kanal und 1 Event angelegt.")).toBeInTheDocument();
    });

    it("is not offered without the right to create raids, nor without a category", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.click(screen.getByRole("button", { name: "Anlegen" }));
        expect(within(screen.getByRole("dialog")).queryByRole("checkbox", { name: "Gleich Event anlegen" })).not.toBeInTheDocument();
    });

    it("disappears when the category is taken away", async () => {
        const user = userEvent.setup();
        await openPage(withEvents());
        await user.click(screen.getByRole("button", { name: "Anlegen" }));
        const dialog = screen.getByRole("dialog");
        await user.selectOptions(within(dialog).getByRole("combobox", { name: "Kategorie" }), "— keine Kategorie —");
        expect(within(dialog).queryByRole("checkbox", { name: "Gleich Event anlegen" })).not.toBeInTheDocument();
    });
});

describe("ChannelsPage — naming schema per category", () => {
    it("opens from the category head, only for writers and real categories", async () => {
        const user = userEvent.setup();
        await openPage();
        expect(within(categoryHead("Ohne Kategorie")).queryByRole("button", { name: "Namensschema" })).not.toBeInTheDocument();
        const pencil = within(categoryHead("Raids")).getByRole("button", { name: "Namensschema" });
        expect(pencil).toHaveAttribute("data-tip-sub", expect.stringContaining("wie der letzte Event-Kanal"));
        await user.click(pencil);
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Namensschema", { selector: ".dlg-title" })).toBeInTheDocument();
        expect(within(dialog).getByText("Raids", { selector: ".kicker" })).toBeInTheDocument();
    });

    it("offers no pencil to a reader", async () => {
        await openPage(channelsData(), adminUser({ isAdmin: false, access: { channels: { read: true, write: false } } }));
        expect(screen.queryByRole("button", { name: "Namensschema" })).not.toBeInTheDocument();
    });

    it("marks a category with its own schema, the schema in the tooltip", async () => {
        await openPage(channelsData({
            schemas: {
                [RAIDS]: { schema: "{tag}-{raid}", raid: "ssc", templateChannelId: "" },
                "cat-talk": { schema: "{tag}-{dd}-{mm}-{raid}", raid: "", templateChannelId: "" },
            },
        }));
        const badge = within(categoryHead("Raids")).getByText("Schema");
        expect(badge).toHaveAttribute("data-tip-sub", expect.stringContaining("{tag}-{raid}"));
        // the default schema an old quick-create stored is no schema of its own
        expect(within(categoryHead("Allgemein")).queryByText("Schema")).not.toBeInTheDocument();
    });

    it("previews what an empty field means and saves through its own endpoint", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.click(within(categoryHead("Raids")).getByRole("button", { name: "Namensschema" }));
        const dialog = screen.getByRole("dialog");
        const field = within(dialog).getByRole("textbox", { name: "Schema" });
        expect(field).toHaveAttribute("placeholder", "leer = wie der letzte Event-Kanal");
        await waitFor(() => expect(lastCall(true)).toMatchObject({ categoryId: RAIDS, schema: "", count: 3, interval: "weekly", dryRun: true, ignoreStoredSchema: true }));
        expect(await within(dialog).findByText("do-24-09-ssc")).toBeInTheDocument();
        expect(within(dialog).getByText("abgeleitet aus #mi-17-09-ssc")).toBeInTheDocument();

        await user.click(within(dialog).getByRole("button", { name: "{tag}" }));
        // "{{" is a literal brace for userEvent
        await user.type(field, "-{{raid} ");
        expect(field).toHaveValue("{tag}-{raid} ");
        await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.saveChannelSchema).toHaveBeenCalledWith({ categoryId: RAIDS, schema: "{tag}-{raid}", raid: "", templateChannelId: "" }));
        expect(await screen.findByText("Raids: Namensschema gespeichert.")).toBeInTheDocument();
    });
});

describe("ChannelsPage — duplicate", () => {
    it("opens from a row with the source fixed and leaves the purpose behind", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.click(within(row("bewerbungen")).getByRole("button", { name: "Duplizieren" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Kanal duplizieren")).toBeInTheDocument();
        // no picker for the source: it is the row's channel
        expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
        expect(within(dialog).getByText("Zweck nicht")).toHaveAttribute("data-tip-sub", expect.stringContaining("geht nicht mit"));
        const name = within(dialog).getByRole("textbox", { name: "Name des Duplikats" });
        expect(name).toHaveValue("bewerbungen");
        await user.type(name, "-2");
        await user.click(within(dialog).getByRole("button", { name: "Duplizieren" }));
        await waitFor(() => expect(api.duplicateChannel).toHaveBeenCalledWith({ channelId: "c-app", name: "bewerbungen-2" }));
        expect(await screen.findByText("Kanal #bewerbungen-2 dupliziert.")).toBeInTheDocument();
    });
});

describe("ChannelsPage — purposes", () => {
    it("edits a purpose for whoever may change the settings", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.click(screen.getByRole("button", { name: "Alle Zwecke" }));
        await user.click(screen.getByRole("button", { name: "Raid-Anmeldung zuordnen" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Raid-Anmeldung zuordnen", { selector: ".dlg-title" })).toBeInTheDocument();
        // one channel: radio buttons, judged by what the bot may do there
        expect(within(dialog).getByRole("radio", { name: /mi-17-09-ssc/ })).toBeChecked();
        expect(within(dialog).getAllByText("Bot schreibt").length).toBeGreaterThan(0);
        expect(within(dialog).getByRole("link", { name: "Einstellungen" })).toHaveAttribute("href", "/settings?section=raids");
        await user.click(within(dialog).getByRole("radio", { name: /regeln/ }));
        await user.click(within(dialog).getByRole("button", { name: "Zuordnung speichern" }));
        await waitFor(() => expect(api.saveChannelPurpose).toHaveBeenCalledWith(expect.objectContaining({ key: "raidDefaults.channelId" }), ["c-loose"]));
    });

    it("links to Einstellungen instead for someone without write access there", async () => {
        const user = userEvent.setup();
        await openPage(channelsData(), adminUser({ isAdmin: false, access: { channels: { read: true, write: true }, settings: { read: true, write: false } } }));
        await user.click(screen.getByRole("button", { name: "Alle Zwecke" }));
        expect(screen.queryByRole("button", { name: "Raid-Anmeldung zuordnen" })).not.toBeInTheDocument();
        const links = screen.getAllByRole("link", { name: "In Einstellungen öffnen" });
        expect(links[1]).toHaveAttribute("href", "/settings?section=recruitment");
        // nor is "Zweck zuordnen" in the channel's edit
        await user.keyboard("{Escape}");
        await user.click(within(row("bewerbungen")).getByRole("button", { name: "Bearbeiten" }));
        expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Zweck zuordnen" })).not.toBeInTheDocument();
    });

    it("assigns purposes from the channel's edit", async () => {
        const user = userEvent.setup();
        await openPage();
        await user.click(within(row("bewerbungen")).getByRole("button", { name: "Bearbeiten" }));
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Zweck zuordnen" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Zweck zuordnen", { selector: ".dlg-title" })).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: /Bewerbungen/, pressed: true })).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: /Höchstgebote/ }));
        await user.click(within(dialog).getByRole("button", { name: "Zuordnung speichern" }));
        await waitFor(() => expect(api.saveChannelPurpose).toHaveBeenCalledWith(expect.objectContaining({ key: "highestBidsChannelId" }), ["c-app"]));
    });

    it("keeps the ids of other servers when a multi-channel purpose is saved", async () => {
        const user = userEvent.setup();
        const data = channelsData();
        data.purposes.push(purpose({
            id: "logs", label: "Log-Auswertung", key: "logChannelIds", multiple: true, need: "read", ids: ["c-app", "999"],
            items: [
                { id: "c-app", name: "bewerbungen", found: true, status: { tone: "ok", label: "Bot liest mit", tip: "" } },
                { id: "999", name: "", found: false, status: { tone: "mid", label: "Kanal nicht gefunden", tip: "Anderer Server." } },
            ],
        }));
        data.channels.find((c) => c.id === "c-loose")!.botCanSend = false;
        await openPage(data);
        await user.click(screen.getByRole("button", { name: "Alle Zwecke" }));
        await user.click(screen.getByRole("button", { name: "Log-Auswertung zuordnen" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Nicht auf diesem Server")).toBeInTheDocument();
        expect(within(dialog).getByRole("checkbox", { name: /999/ })).toBeChecked();
        // the pickers judge the bot's rights with the server's words
        expect(within(within(dialog).getByRole("checkbox", { name: /regeln/ }).closest("label")!).getByText("Bot darf nicht schreiben")).toHaveClass("mid");
        expect(within(within(dialog).getByRole("checkbox", { name: /bewerbungen/ }).closest("label")!).getByText("Bot liest mit")).toHaveClass("ok");
        await user.click(within(dialog).getByRole("checkbox", { name: /mi-17-09-ssc/ }));
        await user.click(within(dialog).getByRole("button", { name: "Zuordnung speichern" }));
        await waitFor(() => expect(api.saveChannelPurpose).toHaveBeenCalledWith(expect.objectContaining({ key: "logChannelIds" }), ["c-app", "999", "c-mi"]));
    });
});

describe("ChannelsPage — creating in English", () => {
    afterEach(() => switchLang("de"));

    it("shows quick-create and the single-channel dialog in English", async () => {
        await switchLang("en");
        const user = userEvent.setup();
        vi.mocked(api.getChannels).mockResolvedValue(channelsData());
        renderPage(<ChannelsPage />, { route: "/channels", user: writer });
        await screen.findByRole("radiogroup", { name: "View" });
        await user.click(screen.getByRole("button", { name: "Create" }));
        let dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Create channels")).toBeInTheDocument();
        expect(within(dialog).getByText("Raids · by schema")).toBeInTheDocument();
        expect(await within(dialog).findByText("exists")).toHaveClass("mid");
        const count = within(dialog).getByRole("combobox", { name: "How often" });
        expect(within(count).getAllByRole("option")[0]).toHaveTextContent("2 × weekly");
        expect(within(dialog).getByRole("button", { name: "Create 1" })).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

        await user.click(screen.getByRole("button", { name: "More ways to create" }));
        await user.click(screen.getByRole("menuitem", { name: "Create a single channel" }));
        dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Create channel", { selector: ".dlg-title" })).toBeInTheDocument();
        expect(within(dialog).getByRole("radio", { name: "Announcement" })).toBeInTheDocument();
        expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveAttribute("placeholder", "e.g. kara-signup");
    });
});
