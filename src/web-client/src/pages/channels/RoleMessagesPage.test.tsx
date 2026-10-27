// Rollen-Nachrichten: the list, the editor as a dialog over it (?edit=<id|new>)
// with the Discord message next to the fields, roles with rights greyed out with
// their reason, saving (create / update with the trimmed input, warnings as a
// toast), deleting through the confirm dialog, the server's errors in words, and
// the note when the bot is offline; with several servers in the server list (#895)
// the server column, the editor's server choice and the start server from ?guild=.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { RoleMessage, RoleMessageOptions } from "../../api";
import { adminUser, renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { resetServerPickCache } from "../../hooks/useServerPick";
import RoleMessagesPage from "./RoleMessagesPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRoleMessages: vi.fn(),
    getDiscordTabCounts: vi.fn().mockResolvedValue({}),
    getRoleMessageOptions: vi.fn(),
    createRoleMessage: vi.fn(),
    updateRoleMessage: vi.fn(),
    deleteRoleMessage: vi.fn(),
    getServerChoices: vi.fn(),
}));

const ONE: api.DiscordServerChoice = { guildId: "g1", name: "Testgilde", label: "", online: true, iconUrl: "" };
const TWO: api.DiscordServerChoice = { guildId: "g2", name: "Talkgilde", label: "Talk", online: true, iconUrl: "" };

const LIMITS = { roles: 25, reactions: 20, title: 200, body: 3000, label: 80 };

const EVENT: RoleMessageOptions = {
    guildId: "g1", online: true, manageRoles: true,
    roles: [
        { id: "r1", name: "Kochen", color: "#e67e22", managed: false, privileged: "", editable: true },
        { id: "r2", name: "Angeln", color: "", managed: false, privileged: "", editable: true },
        { id: "r9", name: "Orga", color: "#3498db", managed: false, privileged: "the role is an orga role", editable: true },
        { id: "r8", name: "Bot-Rolle", color: "", managed: true, privileged: "", editable: false },
    ],
    channels: [
        { id: "c1", name: "rollen", category: "Info", parentId: "p1", canReact: true },
        { id: "c2", name: "stumm", category: "Info", parentId: "p1", canReact: false },
    ],
    emojis: [],
};
const TALK: RoleMessageOptions = {
    guildId: "g2", online: true, manageRoles: true,
    roles: [{ id: "r5", name: "Musik", color: "", managed: false, privileged: "", editable: true }],
    channels: [{ id: "c5", name: "talk-rollen", category: "Talk", parentId: "p5", canReact: true }],
    emojis: [],
};

const BERUFE: RoleMessage = {
    id: "m1", guildId: "g1", channelId: "c1", messageId: "d1", url: "https://discord.com/channels/g1/c1/d1",
    title: "Berufe", body: "Klick dich rein", imageUrl: "", color: null,
    roles: [{ roleId: "r1", emoji: "🍳", label: "Kochen" }, { roleId: "r2", emoji: "", label: "" }],
};

const MUSIK: RoleMessage = {
    id: "m5", guildId: "g2", channelId: "c5", messageId: "d5", url: "https://discord.com/channels/g2/c5/d5",
    title: "Musik", body: "", imageUrl: "", color: null, roles: [{ roleId: "r5", emoji: "", label: "Musik" }],
};

function setup({ messages = [BERUFE], event = EVENT, servers = [ONE] }: {
    messages?: RoleMessage[]; event?: RoleMessageOptions; servers?: api.DiscordServerChoice[];
} = {}) {
    resetServerPickCache();
    vi.mocked(api.getServerChoices).mockReset().mockResolvedValue(servers);
    vi.mocked(api.getRoleMessages).mockReset().mockResolvedValue({ messages, limits: LIMITS });
    vi.mocked(api.getRoleMessageOptions).mockReset().mockImplementation(async (guildId) => (guildId === "g2" ? TALK : event));
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setup();
    vi.mocked(api.createRoleMessage).mockReset();
    vi.mocked(api.updateRoleMessage).mockReset();
    vi.mocked(api.deleteRoleMessage).mockReset();
});

const preview = () => screen.getByLabelText("Vorschau der Discord-Nachricht");

describe("Rollen-Nachrichten: list", () => {
    it("says so when there is no message yet", async () => {
        setup({ messages: [] });
        renderPage(<RoleMessagesPage />, { route: "/channels/roles" });
        expect(await screen.findByText("Noch keine Rollen-Nachricht.")).toBeInTheDocument();
        expect(screen.getByText("0 Nachrichten")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Neue Rollen-Nachricht/ })).toBeInTheDocument();
    });

    it("lists channel, the roles in words and the Discord link, without a server column for one server", async () => {
        renderPage(<RoleMessagesPage />, { route: "/channels/roles" });
        const row = (await screen.findByText("Berufe")).closest("tr")!;
        expect(screen.queryByRole("columnheader", { name: /Server/ })).not.toBeInTheDocument();
        expect(within(row).queryByText("Testgilde")).not.toBeInTheDocument();
        // once in the channel column, once in the phone line under the title
        expect(within(row).getAllByText("#rollen")).toHaveLength(2);
        expect(within(row).getByText("2 Rollen")).toHaveAttribute("data-tip", "@Kochen, @Angeln");
        expect(within(row).getByRole("link", { name: /In Discord öffnen/ })).toHaveAttribute("href", BERUFE.url);
    });

    it("shows a read-only account the list without the editor's buttons", async () => {
        renderPage(<RoleMessagesPage />, { route: "/channels/roles?edit=m1", user: adminUser({ isAdmin: false, access: { channels: "read" } }) });
        expect(await screen.findByText("Berufe")).toBeInTheDocument();
        expect(screen.getByText("Nur lesen")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Neue Rollen-Nachricht/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("warns when the bot is offline and locks saving", async () => {
        setup({ event: { ...EVENT, online: false, roles: [], channels: [] } });
        renderPage(<RoleMessagesPage />, { route: "/channels/roles?edit=new" });
        const dialog = await screen.findByRole("dialog");
        expect(screen.getAllByText(/Der Bot ist gerade nicht verbunden/).length).toBeGreaterThan(1);
        expect(within(dialog).getByRole("button", { name: /Rolle hinzufügen/ })).toBeDisabled();
        expect(within(dialog).getByRole("button", { name: /Posten/ })).toBeDisabled();
    });

    it("warns when the bot lacks Manage Roles", async () => {
        setup({ event: { ...EVENT, manageRoles: false } });
        renderPage(<RoleMessagesPage />, { route: "/channels/roles" });
        expect(await screen.findByText(/Dem Bot fehlt auf diesem Server das Recht „Rollen verwalten“/)).toBeInTheDocument();
    });
});

describe("Rollen-Nachrichten: editor", () => {
    it("shows roles with rights greyed out with their reason, and does not add them", async () => {
        const user = userEvent.setup();
        renderPage(<RoleMessagesPage />, { route: "/channels/roles?edit=new" });
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: /Rolle hinzufügen/ }));

        const orga = within(dialog).getByRole("button", { name: /@Orga/ });
        expect(orga).toBeDisabled();
        expect(orga).toHaveAttribute("data-tip", "Das ist eine Orga-Rolle.");
        expect(within(orga).getByText("Das ist eine Orga-Rolle.")).toBeInTheDocument();
        const bot = within(dialog).getByRole("button", { name: /@Bot-Rolle/ });
        expect(bot).toBeDisabled();
        expect(bot).toHaveTextContent("Die Rolle gehört zu einem Bot oder einer Integration.");

        await user.click(orga);
        expect(within(dialog).getByText("Noch keine Rolle – „Rolle hinzufügen“ wählt eine.")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: /@Kochen/ }));
        expect(within(dialog).getByLabelText("Knopf-Text für @Kochen")).toHaveValue("Kochen");
    });

    it("lists what is missing and keeps the post button locked until the form is complete", async () => {
        const user = userEvent.setup();
        renderPage(<RoleMessagesPage />, { route: "/channels/roles?edit=new" });
        const dialog = await screen.findByRole("dialog");
        const alert = within(dialog).getByRole("alert");
        expect(alert).toHaveTextContent("Ein Kanal fehlt.");
        expect(alert).toHaveTextContent("Ein Titel fehlt.");
        expect(alert).toHaveTextContent("Mindestens eine Rolle ist nötig.");
        expect(await within(dialog).findByText("3 Punkte fehlen noch")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: /Posten/ })).toBeDisabled();

        await user.selectOptions(within(dialog).getByLabelText("Kanal"), "c1");
        await user.type(within(dialog).getByLabelText(/^Titel/), "Berufe");
        await user.click(within(dialog).getByRole("button", { name: /Rolle hinzufügen/ }));
        await user.click(within(dialog).getByRole("button", { name: /@Angeln/ }));
        expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: /Posten/ })).toBeEnabled();
        expect(within(preview()).getByText("Berufe")).toBeInTheDocument();
        expect(within(preview()).getByText("Angeln")).toBeInTheDocument();
    });

    it("posts a new message with the trimmed input and shows the server's warnings", async () => {
        const user = userEvent.setup();
        vi.mocked(api.createRoleMessage).mockResolvedValue({ entry: { ...BERUFE, id: "m2" }, url: "", warnings: ["Reaktion 🍳 ging nicht"] });
        renderPage(<RoleMessagesPage />, { route: "/channels/roles?edit=new" });
        const dialog = await screen.findByRole("dialog");
        await user.selectOptions(within(dialog).getByLabelText("Kanal"), "c1");
        await user.type(within(dialog).getByLabelText(/^Titel/), "  Berufe  ");
        await user.click(within(dialog).getByRole("button", { name: /Rolle hinzufügen/ }));
        await user.click(within(dialog).getByRole("button", { name: /@Kochen/ }));
        await user.clear(within(dialog).getByLabelText("Knopf-Text für @Kochen"));
        await user.click(within(dialog).getByRole("button", { name: /Posten/ }));

        await waitFor(() => expect(api.createRoleMessage).toHaveBeenCalledTimes(1));
        expect(api.createRoleMessage).toHaveBeenCalledWith({
            guildId: "g1", channelId: "c1", title: "Berufe", body: "", imageUrl: "", color: null,
            roles: [{ roleId: "r1", emoji: "", label: "Kochen" }],
        });
        expect(await screen.findByText("Rollen-Nachricht gepostet.")).toBeInTheDocument();
        expect(screen.getByText("Hinweis: Reaktion 🍳 ging nicht")).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("saves a change of an existing message with its id", async () => {
        const user = userEvent.setup();
        vi.mocked(api.updateRoleMessage).mockResolvedValue({ entry: BERUFE, url: BERUFE.url, warnings: [] });
        renderPage(<RoleMessagesPage />, { route: "/channels/roles?edit=m1" });
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByLabelText(/^Titel/)).toHaveValue("Berufe");
        expect(within(dialog).queryByText("Entwurf")).not.toBeInTheDocument();
        await user.type(within(dialog).getByLabelText(/^Titel/), " & Hobbys");
        expect(within(dialog).getByText("Entwurf")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Speichern" }));

        await waitFor(() => expect(api.updateRoleMessage).toHaveBeenCalledTimes(1));
        expect(api.updateRoleMessage).toHaveBeenCalledWith("m1", expect.objectContaining({
            title: "Berufe & Hobbys",
            roles: [{ roleId: "r1", emoji: "🍳", label: "Kochen" }, { roleId: "r2", emoji: "", label: "Angeln" }],
        }));
        expect(await screen.findByText("Gespeichert und in Discord aktualisiert.")).toBeInTheDocument();
    });

    it("says a server refusal in words, with the role and its reason", async () => {
        const user = userEvent.setup();
        vi.mocked(api.updateRoleMessage).mockRejectedValue({ code: "privileged_role", message: "raw", roleId: "r9", reason: "the role is an orga role" });
        renderPage(<RoleMessagesPage />, { route: "/channels/roles?edit=m1" });
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
        expect(await screen.findByText("@Orga trägt Rechte und darf nicht per Klick vergeben werden: Das ist eine Orga-Rolle.")).toBeInTheDocument();
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("notes a channel where the bot cannot react, once a role has an emoji", async () => {
        const user = userEvent.setup();
        renderPage(<RoleMessagesPage />, { route: "/channels/roles?edit=m1" });
        const dialog = await screen.findByRole("dialog");
        await user.selectOptions(within(dialog).getByLabelText("Kanal"), "c2");
        expect(within(dialog).getByText(/die Knöpfe gehen, die Reaktionen nicht/)).toBeInTheDocument();
        expect(within(preview()).getByLabelText("Reaktionen unter der Nachricht")).toBeInTheDocument();
    });
});

describe("Rollen-Nachrichten: several servers", () => {
    it("names each message's server in its own column and reads every server's options", async () => {
        setup({ messages: [BERUFE, MUSIK], servers: [ONE, TWO] });
        renderPage(<RoleMessagesPage />, { route: "/channels/roles" });
        const row = (await screen.findByText("Musik", { selector: "tr *" })).closest("tr")!;
        expect(screen.getByRole("columnheader", { name: /Server/ })).toBeInTheDocument();
        await waitFor(() => expect(within(row).getByText("#talk-rollen")).toBeInTheDocument());
        expect(within(row).getAllByText("Talkgilde").length).toBeGreaterThan(0);
        const berufe = screen.getByText("Berufe").closest("tr")!;
        expect(within(berufe).getAllByText("Testgilde").length).toBeGreaterThan(0);
        expect(api.getRoleMessageOptions).toHaveBeenCalledWith("g1");
        expect(api.getRoleMessageOptions).toHaveBeenCalledWith("g2");
    });

    it("starts a new message on the server picked on the other tabs and posts it there", async () => {
        const user = userEvent.setup();
        setup({ servers: [ONE, TWO] });
        vi.mocked(api.createRoleMessage).mockResolvedValue({ entry: { ...MUSIK, id: "m6" }, url: "", warnings: [] });
        renderPage(<RoleMessagesPage />, { route: "/channels/roles?edit=new&guild=g2" });
        const dialog = await screen.findByRole("dialog");
        const radio = await within(dialog).findByRole("radio", { name: "Talkgilde" });
        expect(radio).toBeChecked();
        await user.selectOptions(within(dialog).getByLabelText("Kanal"), "c5");
        await user.type(within(dialog).getByLabelText(/^Titel/), "Musik");
        await user.click(within(dialog).getByRole("button", { name: /Rolle hinzufügen/ }));
        await user.click(within(dialog).getByRole("button", { name: /@Musik/ }));
        await user.click(within(dialog).getByRole("button", { name: /Posten/ }));
        await waitFor(() => expect(api.createRoleMessage).toHaveBeenCalledTimes(1));
        expect(api.createRoleMessage).toHaveBeenCalledWith(expect.objectContaining({ guildId: "g2", channelId: "c5" }));
    });

    it("empties channel and roles when the editor switches the server", async () => {
        const user = userEvent.setup();
        setup({ servers: [ONE, TWO] });
        renderPage(<RoleMessagesPage />, { route: "/channels/roles?edit=m1" });
        const dialog = await screen.findByRole("dialog");
        expect(await within(dialog).findByRole("radio", { name: "Testgilde" })).toBeChecked();
        expect(within(dialog).getByLabelText("Kanal")).toHaveValue("c1");
        await user.click(within(dialog).getByRole("radio", { name: "Talkgilde" }));
        expect(within(dialog).getByRole("radio", { name: "Talkgilde" })).toBeChecked();
        expect(within(dialog).getByLabelText("Kanal")).toHaveValue("");
        expect(within(dialog).queryByLabelText("Knopf-Text für @Kochen")).not.toBeInTheDocument();
        expect(within(dialog).getByRole("option", { name: /talk-rollen/ })).toBeInTheDocument();
    });

    it("offers no server choice in the editor with a single server", async () => {
        renderPage(<RoleMessagesPage />, { route: "/channels/roles?edit=new" });
        const dialog = await screen.findByRole("dialog");
        await within(dialog).findByLabelText("Kanal");
        expect(within(dialog).queryByRole("radiogroup", { name: "Server" })).not.toBeInTheDocument();
    });
});

describe("Rollen-Nachrichten: delete", () => {
    it("deletes after the confirm dialog, and not without it", async () => {
        const user = userEvent.setup();
        vi.mocked(api.deleteRoleMessage).mockResolvedValue({ id: "m1", messageDeleted: true });
        renderPage(<RoleMessagesPage />, { route: "/channels/roles" });
        const row = (await screen.findByText("Berufe")).closest("tr")!;

        await user.click(within(row).getByRole("button", { name: "Löschen" }));
        let confirm = await screen.findByRole("dialog");
        expect(confirm).toHaveTextContent("„Berufe“ wird gelöscht");
        await user.click(within(confirm).getByRole("button", { name: "Abbrechen" }));
        expect(api.deleteRoleMessage).not.toHaveBeenCalled();

        await user.click(within(row).getByRole("button", { name: "Löschen" }));
        confirm = await screen.findByRole("dialog");
        await user.click(within(confirm).getByRole("button", { name: "Löschen" }));
        await waitFor(() => expect(api.deleteRoleMessage).toHaveBeenCalledWith("m1"));
        expect(await screen.findByText("Gelöscht – auch in Discord.")).toBeInTheDocument();
    });
});

describe("Rollen-Nachrichten in English", () => {
    afterEach(() => switchLang("de"));

    it("names the list, the editor and the blocked roles in English", async () => {
        await switchLang("en");
        const user = userEvent.setup();
        renderPage(<RoleMessagesPage />, { route: "/channels/roles?edit=new" });
        const dialog = await screen.findByRole("dialog");
        expect(screen.getByRole("heading", { name: /Role messages/ })).toBeInTheDocument();
        expect(within(dialog).getByRole("alert")).toHaveTextContent("A channel is missing.");
        await user.click(within(dialog).getByRole("button", { name: /Add role/ }));
        expect(within(dialog).getByRole("button", { name: /@Orga/ })).toHaveTextContent("It is an orga role.");
        expect(screen.getByLabelText("Preview of the Discord message")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: /Post/ })).toBeDisabled();
    });
});
