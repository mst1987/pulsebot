// System › Discord › Rollen: the tabs with their counts, the table in Discord's
// order with the bot divider, sorting, the "Nur Rollen mit Hinweis" switch, the
// server picker (#895), offline and no server set, and the drawer with facts,
// permissions, channels and the member search — by click and by link (?role=,
// &guild=, the old &side=talk); opening pushes a history entry, closing replaces it.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { ServerRole, ServerRoleDetail, ServerRoles } from "../../api";
import { adminUser, renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { resetServerPickCache } from "../../hooks/useServerPick";
import ServerRolesPage from "./ServerRolesPage";
import { activeTab } from "../../lib/discord/tabs";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getServerRoles: vi.fn(),
    getServerRoleDetail: vi.fn(),
    getDiscordTabCounts: vi.fn(),
    getServerChoices: vi.fn(),
}));

const SERVERS: api.DiscordServerChoice[] = [
    { guildId: "g1", name: "Testgilde", label: "", online: true, iconUrl: "" },
    { guildId: "g2", name: "Talkgilde", label: "Talk", online: true, iconUrl: "" },
];

function role(over: Partial<ServerRole>): ServerRole {
    return {
        id: "r", name: "Rolle", color: "", position: 1, managed: false, everyone: false, isBotRole: false,
        memberCount: 3, permissions: [], sensitive: [], unusual: [], uses: [], assign: { ok: true, reason: "" }, hints: [],
        ...over,
    };
}

const ROLES: ServerRole[] = [
    role({ id: "admin", name: "Admin", color: "#e74c3c", position: 5, memberCount: 2, permissions: ["Administrator"], sensitive: ["Administrator"], unusual: ["Administrator"], uses: [{ code: "admin" }], assign: { ok: false, reason: "above" }, hints: ["sensitive"] }),
    role({ id: "naxx", name: "Naxx-Raider", position: 4, memberCount: 0, uses: [{ code: "categoryRaider", categoryIds: ["c1"], categories: [{ id: "c1", name: "Naxx" }] }], assign: { ok: false, reason: "above" }, hints: ["empty", "aboveBot"] }),
    role({ id: "bot", name: "PulseBot", position: 3, memberCount: 1, managed: true, isBotRole: true, permissions: ["ManageRoles"], sensitive: ["ManageRoles"], unusual: ["ManageRoles"], assign: { ok: false, reason: "botRole" }, hints: ["sensitive"] }),
    role({ id: "kochen", name: "Kochen", color: "#2ecc71", position: 2, memberCount: 12, permissions: ["SendMessages", "MentionEveryone"], sensitive: ["MentionEveryone"], uses: [{ code: "roleMessage", messageId: "m1", title: "Berufe" }] }),
    role({ id: "angeln", name: "Angeln", position: 1, memberCount: 7 }),
    role({ id: "every", name: "@everyone", position: 0, memberCount: 22, everyone: true, permissions: ["SendMessages"], assign: { ok: false, reason: "everyone" } }),
];

const HEAD = { guildId: "g1", guildName: "Testgilde", online: true, botRole: { id: "bot", name: "PulseBot", position: 3 }, manageRoles: true, membersError: null };
const EVENT: ServerRoles = { ...HEAD, total: ROLES.length, roles: ROLES, commonSensitive: [{ key: "MentionEveryone", roles: 4, everyone: false }] };
const TALK: ServerRoles = { ...HEAD, guildId: "g2", guildName: "Talkgilde", total: 1, roles: [ROLES[4]], commonSensitive: [] };
const NONE: ServerRoles = { guildId: "", guildName: "", online: true, botRole: null, manageRoles: null, membersError: null, total: 0, roles: [], commonSensitive: [] };

const MEMBERS = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, name: i === 0 ? "Thrall" : `Raider ${i}`, avatarUrl: i === 1 ? "https://cdn.example/a.png" : null, bot: false }));
const DETAIL: ServerRoleDetail = {
    ...HEAD, role: ROLES[3],
    channels: [
        { id: "k1", name: "Berufe", kind: "category", parentName: "", allow: ["ViewChannel"], deny: [] },
        { id: "c1", name: "kochen", kind: "text", parentName: "Berufe", allow: [], deny: ["SendMessages"] },
    ],
    members: MEMBERS,
    membersTotal: MEMBERS.length,
};

beforeEach(() => {
    localStorage.clear();
    resetServerPickCache();
    vi.mocked(api.getServerChoices).mockReset().mockResolvedValue(SERVERS);
    vi.mocked(api.getServerRoles).mockReset().mockImplementation(async (guildId) => (guildId === "g2" ? TALK : EVENT));
    vi.mocked(api.getServerRoleDetail).mockReset().mockResolvedValue(DETAIL);
    vi.mocked(api.getDiscordTabCounts).mockReset().mockResolvedValue({ channels: 31, serverRoles: 5, roleMessages: 2 });
});

/** The router's view of the history next to the page: the query, how it got there, and a back button. */
function HistoryProbe() {
    const location = useLocation();
    const type = useNavigationType();
    const navigate = useNavigate();
    return (
        <>
            <span data-testid="search">{location.search}</span>
            <span data-testid="type">{type}</span>
            <button type="button" onClick={() => navigate(-1)}>probe-back</button>
        </>
    );
}

const names = () => screen.getAllByRole("row").slice(1).map((r) => (r.querySelector(".drl-name") || r.querySelector(".drl-long") || r).textContent || "");

describe("Rollen: table", () => {
    it("shows the tabs with counts, the roles top first and the bot divider", async () => {
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
        expect(await screen.findByText("Admin")).toBeInTheDocument();
        const tabs = screen.getByRole("navigation", { name: "Bereiche von Discord" });
        expect(within(tabs).getByRole("link", { name: "Rollen 5" })).toHaveAttribute("aria-current", "page");
        expect(within(tabs).getByRole("link", { name: "Kanäle 31" })).toHaveAttribute("href", "/channels");
        expect(names()).toEqual(["Admin", "Naxx-Raider", "Bot-Rolle PulseBot · alles darunter kann der Bot vergeben", "PulseBot", "Kochen", "Angeln", "@everyone"]);
        expect(screen.getByText("5 Rollen")).toBeInTheDocument();
        const naxx = screen.getByText("Naxx-Raider").closest("tr")!;
        expect(within(naxx).getByText("0 Mitglieder")).toBeInTheDocument();
        expect(naxx.querySelector(".drl-c-uses")!.textContent).toBe("Raider-Rolle Naxx");
        expect(naxx.querySelector(".drl-meta")!.textContent).toBe("Raider-Rolle Naxx");
        expect(within(naxx).getByText("zu hoch")).toHaveAttribute("data-tip", "nein, PulseBot darüber ziehen");
        expect(within(naxx).getByText("nein, PulseBot darüber ziehen")).toHaveAttribute("data-tip-sub", expect.stringMatching(/Bot-Rolle über diese Rolle ziehen/));
        const admin = screen.getByText("Admin").closest("tr")!;
        // an outlier: orange in the column and in the phone's second line
        expect(admin.querySelector(".drl-c-sens .drl-sens")!.textContent).toBe("Administrator");
        expect(admin.querySelector(".drl-meta-sens")!.textContent).toBe("Administrator");
        expect(screen.getByText("Bot-Rolle PulseBot")).toHaveClass("drl-short");
        expect(screen.queryByText("Bot-Rolle", { selector: ".drl-botmark" })).not.toBeInTheDocument();
        expect(within(admin).getByText("1")).toBeInTheDocument();
        expect(screen.getByText("@everyone").closest("tr")!.querySelector(".drl-pos")!.textContent).toBe("–");
    });

    it("sorts by members and drops the divider", async () => {
        const user = userEvent.setup();
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
        await screen.findByText("Admin");
        await user.click(screen.getByRole("button", { name: /^Mitglieder/ }));
        expect(names()).toEqual(["@everyone", "Kochen", "Angeln", "Admin", "PulseBot", "Naxx-Raider"]);
        // without the divider the bot's own role says so at its name
        const bot = screen.getByRole("button", { name: "PulseBot" }).closest("tr")!;
        expect(within(bot).getByText("Bot-Rolle")).toHaveClass("drl-botmark");
        expect(document.querySelectorAll(".drl-botmark")).toHaveLength(1);
    });

    it("keeps sensitive permissions normal on the server grey and names them once above the table", async () => {
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
        await screen.findByText("Admin");
        const line = document.querySelector(".drl-common")!;
        expect(line.textContent).toBe("Üblich auf diesem Server, daher grau: @everyone, @here und alle Rollen erwähnen (4 von 5 Rollen)");
        const kochen = screen.getByRole("button", { name: "Kochen" }).closest("tr")!;
        expect(within(kochen).getByText("@everyone, @here und alle Rollen erwähnen")).toHaveClass("drl-muted");
        expect(kochen.querySelector(".drl-meta-sens")).toBeNull();
        expect(kochen.querySelector(".drl-sens")).toBeNull();
    });

    it("keeps the phone's second line short: two outliers, then the rest as a number", async () => {
        const many = role({ id: "mee6", name: "MEE6", position: 6, managed: true, permissions: ["KickMembers", "BanMembers", "ManageGuild", "ManageChannels"], sensitive: ["KickMembers", "BanMembers", "ManageGuild", "ManageChannels"], unusual: ["KickMembers", "BanMembers", "ManageGuild", "ManageChannels"], assign: { ok: false, reason: "managed" }, hints: [] });
        vi.mocked(api.getServerRoles).mockImplementation(async (guildId) => (guildId === "g2" ? TALK : { ...EVENT, roles: [many, ...ROLES] }));
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
        const row = (await screen.findByRole("button", { name: "MEE6" })).closest("tr")!;
        expect(row.querySelector(".drl-meta-sens")!.textContent).toMatch(/^[^,]+, [^,]+ \+2 weitere$/);
    });

    it("leaves out the line when nothing sensitive is common", async () => {
        vi.mocked(api.getServerRoles).mockResolvedValue({ ...EVENT, commonSensitive: [] });
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
        await screen.findByText("Admin");
        expect(document.querySelector(".drl-common")).toBeNull();
    });

    it("says when no server is set and hides the picker", async () => {
        vi.mocked(api.getServerChoices).mockResolvedValue([]);
        vi.mocked(api.getServerRoles).mockResolvedValue(NONE);
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
        expect(await screen.findByText(/Kein Server eingestellt/)).toBeInTheDocument();
        expect(api.getServerRoles).toHaveBeenCalledWith("");
        expect(screen.queryByRole("radiogroup", { name: "Server" })).not.toBeInTheDocument();
    });

    it("shows no picker with a single server", async () => {
        vi.mocked(api.getServerChoices).mockResolvedValue([SERVERS[0]]);
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
        await screen.findByText("Admin");
        expect(screen.queryByRole("radio", { name: "Testgilde" })).not.toBeInTheDocument();
    });

    it("filters to the roles with a hint", async () => {
        const user = userEvent.setup();
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
        await screen.findByText("Admin");
        await user.click(screen.getByRole("switch", { name: /Nur Rollen mit Hinweis/ }));
        expect(names()).toEqual(["Admin", "Naxx-Raider", "Bot-Rolle PulseBot · alles darunter kann der Bot vergeben", "PulseBot"]);
    });

    it("switches to another server of the list and keeps it in the URL", async () => {
        const user = userEvent.setup();
        renderPage(<><ServerRolesPage /><HistoryProbe /></>, { route: "/channels/server-roles" });
        await screen.findByText("Admin");
        expect(api.getServerRoles).toHaveBeenCalledWith("g1");
        expect(screen.getByRole("radio", { name: "Testgilde" })).toBeChecked();
        await user.click(screen.getByRole("radio", { name: "Talkgilde" }));
        await waitFor(() => expect(screen.queryByText("Admin")).not.toBeInTheDocument());
        expect(screen.getByText("Angeln")).toBeInTheDocument();
        expect(api.getServerRoles).toHaveBeenLastCalledWith("g2");
        expect(screen.getByTestId("search")).toHaveTextContent("?guild=g2");
        await waitFor(() => expect(api.getDiscordTabCounts).toHaveBeenLastCalledWith("g2"));
        // the tabs carry the server to the other Discord pages
        const tabs = screen.getByRole("navigation", { name: "Bereiche von Discord" });
        expect(within(tabs).getByRole("link", { name: /^Kanäle/ })).toHaveAttribute("href", "/channels?guild=g2");
    });

    it("says when the bot is offline or cannot hand out roles", async () => {
        vi.mocked(api.getServerRoles).mockResolvedValue({ ...EVENT, online: false, roles: [] });
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
        expect(await screen.findByText("Bot nicht verbunden")).toBeInTheDocument();
        expect(screen.getByText(/ohne Verbindung bleibt die Liste leer/)).toBeInTheDocument();
    });

    it("marks a missing Manage Roles and missing member counts", async () => {
        vi.mocked(api.getServerRoles).mockResolvedValue({ ...EVENT, manageRoles: false, membersError: "timeout", roles: [role({ id: "x", name: "X", memberCount: null })] });
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
        expect(await screen.findByText("Bot darf keine Rollen vergeben")).toBeInTheDocument();
        expect(screen.getByText("Mitgliederzahlen fehlen")).toBeInTheDocument();
        expect(screen.getByText("unbekannt")).toBeInTheDocument();
    });

    it("reads in English", async () => {
        await switchLang("en");
        try {
            renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
            expect(await screen.findByText("Admin")).toBeInTheDocument();
            expect(screen.queryByText("Rollen")).not.toBeInTheDocument();
            expect(screen.getByText("12 members")).toBeInTheDocument();
        } finally {
            await switchLang("de");
        }
    });

    it("finds the active tab and shows the tabs to a read-only account", async () => {
        expect(activeTab([{ id: "channels", href: "/channels" }, { id: "serverRoles", href: "/channels/server-roles" }], "/channels/server-roles")).toBe("serverRoles");
        expect(activeTab([{ id: "channels", href: "/channels" }, { id: "serverRoles", href: "/channels/server-roles" }], "/channels")).toBe("channels");
        expect(activeTab([{ id: "channels", href: "/channels" }], "/raids")).toBe("");
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles", user: adminUser({ isAdmin: false, access: { channels: { read: true, write: false } } }) });
        expect(await screen.findByRole("navigation", { name: "Bereiche von Discord" })).toBeInTheDocument();
    });
});

describe("Rollen: drawer", () => {
    it("opens a role with facts, permissions, channels and members", async () => {
        const user = userEvent.setup();
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
        await user.click(await screen.findByRole("button", { name: "Kochen" }));
        const drawer = await screen.findByRole("complementary", { name: "Kochen" });
        expect(api.getServerRoleDetail).toHaveBeenCalledWith("g1", "kochen");
        expect(within(drawer).getByText("Rolle · Testgilde")).toBeInTheDocument();
        expect(within(drawer).getByText("4 von 5, unter der Bot-Rolle")).toBeInTheDocument();
        expect(within(drawer).getByText("Rollen-Nachricht „Berufe“")).toBeInTheDocument();
        expect(within(drawer).getByText("Bot kann die Rolle vergeben")).toBeInTheDocument();
        expect(within(drawer).getByText(/^2 von \d+ Rechten gesetzt\. Gezeigt sind nur die gesetzten\.$/)).toBeInTheDocument();
        expect(within(drawer).getAllByText("gesetzt")).toHaveLength(1);

        await user.click(within(drawer).getByRole("switch", { name: /Alle Rechte zeigen/ }));
        expect(within(drawer).getAllByText("nicht gesetzt").length).toBeGreaterThan(40);

        expect(within(drawer).getByText("Kategorie Berufe")).toBeInTheDocument();
        const row = within(drawer).getByText("#kochen").closest("tr")!;
        expect(within(row).getAllByText("–")).toHaveLength(1);

        expect(within(drawer).getAllByRole("listitem")).toHaveLength(12);
        await user.type(within(drawer).getByRole("searchbox", { name: "Mitglied suchen" }), "thr");
        expect(within(drawer).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["THThrall"]);
        // a name leads to the member in the member list
        expect(within(drawer).getByRole("link", { name: "Thrall" })).toHaveAttribute("href", "/channels/members?user=u0");
        await user.type(within(drawer).getByRole("searchbox"), "x");
        expect(within(drawer).getByText("Niemand passt zu „thrx“.")).toBeInTheDocument();

        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
    });

    it("says when only part of @everyone's members is loaded and closes on a tap beside it", async () => {
        vi.mocked(api.getServerRoleDetail).mockResolvedValue({ ...DETAIL, role: ROLES[5], membersTotal: 340 });
        const user = userEvent.setup();
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
        await user.click(await screen.findByRole("button", { name: "@everyone" }));
        const drawer = await screen.findByRole("complementary", { name: "@everyone" });
        expect(await within(drawer).findByText("Geladen sind die ersten 12 von 340 Mitgliedern; die Suche durchsucht nur diese.")).toBeInTheDocument();
        expect(within(drawer).queryByText("Position")).not.toBeInTheDocument();
        await user.click(document.querySelector(".drl-backdrop")!);
        expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    });

    it("tells the bot's own role and a role above it", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getServerRoleDetail).mockResolvedValue({ ...DETAIL, role: ROLES[2] });
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
        await user.click(await screen.findByRole("button", { name: "PulseBot" }));
        const drawer = await screen.findByRole("complementary", { name: "PulseBot" });
        expect(await within(drawer).findByText("3 von 5, die Bot-Rolle selbst")).toBeInTheDocument();
        // its own reason, not the app integration's "fixed"
        expect(within(drawer).getByText(/nein, eigene Rolle/)).toBeInTheDocument();
        expect(within(drawer).getByText("Das ist die Rolle des Bots selbst. Er kann sie sich weder geben noch nehmen.")).toBeInTheDocument();
        const row = screen.getByRole("button", { name: "PulseBot" }).closest("tr")!;
        expect(row.querySelector(".drl-assign")!.textContent).toContain("eigene");
        expect(row.textContent).not.toContain("Integration, fest");
    });

    it("keeps the phone's header short: one word for the bot column, the full text in its tooltip", async () => {
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
        await screen.findByRole("button", { name: "PulseBot" });
        const head = screen.getByText("Bot", { selector: ".drl-short" }).closest("button")!;
        expect(head).toHaveAttribute("data-tip", "Bot kann vergeben");
        expect(head.querySelector(".drl-long")!.textContent).toBe("Bot kann vergeben");
        // the position column carries the class the phone hides
        expect(screen.getByText("Pos.").closest("th")).toHaveClass("drl-c-pos");
    });

    it("opens from a link and colours the name in a readable variant of the role colour", async () => {
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles?role=kochen" });
        const drawer = await screen.findByRole("complementary", { name: "Kochen" });
        expect(api.getServerRoleDetail).toHaveBeenCalledWith("g1", "kochen");
        const head = within(drawer).getByRole("heading", { level: 2 });
        expect(head).toHaveClass("drl-coloured");
        expect(head.style.getPropertyValue("--drl-color")).toBe("#2ecc71");
        expect(head.style.getPropertyValue("--drl-color-light")).not.toBe("");
        // a role without colour keeps the text colour
        const angeln = screen.getByRole("button", { name: "Angeln" });
        expect(angeln).not.toHaveClass("drl-coloured");
    });

    it.each([
        ["?role=kochen&guild=g2", "a link to the second server"],
        ["?role=kochen&side=talk", "an old talk-server link"],
    ])("opens from %s (%s)", async (search) => {
        const talk: ServerRoles = { ...EVENT, guildId: "g2", guildName: "Talkgilde" };
        vi.mocked(api.getServerRoles).mockImplementation(async (guildId) => (guildId === "g2" ? talk : EVENT));
        vi.mocked(api.getServerRoleDetail).mockResolvedValue({ ...DETAIL, guildId: "g2", guildName: "Talkgilde" });
        renderPage(<ServerRolesPage />, { route: `/channels/server-roles${search}` });
        const drawer = await screen.findByRole("complementary", { name: "Kochen" });
        expect(api.getServerRoles).toHaveBeenCalledWith("g2");
        expect(api.getServerRoleDetail).toHaveBeenCalledWith("g2", "kochen");
        expect(screen.getByRole("radio", { name: "Talkgilde" })).toBeChecked();
        // the member link keeps the server
        expect(await within(drawer).findByRole("link", { name: "Thrall" })).toHaveAttribute("href", "/channels/members?user=u0&guild=g2");
    });

    it("drops the open role when switching the server", async () => {
        const user = userEvent.setup();
        renderPage(<><ServerRolesPage /><HistoryProbe /></>, { route: "/channels/server-roles?role=kochen" });
        await screen.findByRole("complementary", { name: "Kochen" });
        await user.click(screen.getByRole("radio", { name: "Talkgilde" }));
        await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
        expect(screen.getByTestId("search")).toHaveTextContent(/^\?guild=g2$/);
    });

    it("opens as a history step: back closes it, Esc replaces it", async () => {
        const user = userEvent.setup();
        renderPage(<><ServerRolesPage /><HistoryProbe /></>, { route: "/channels/server-roles" });
        await user.click(await screen.findByRole("button", { name: "Kochen" }));
        await screen.findByRole("complementary", { name: "Kochen" });
        expect(screen.getByTestId("search")).toHaveTextContent("?role=kochen");
        expect(screen.getByTestId("type")).toHaveTextContent("PUSH");
        await user.click(screen.getByRole("button", { name: "probe-back" }));
        await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
        expect(screen.getByTestId("search")).toHaveTextContent(/^$/);
        await user.click(screen.getByRole("button", { name: "Kochen" }));
        await screen.findByRole("complementary", { name: "Kochen" });
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
        expect(screen.getByTestId("type")).toHaveTextContent("REPLACE");
    });

    it("opens no drawer from a link without a server", async () => {
        vi.mocked(api.getServerChoices).mockResolvedValue([]);
        vi.mocked(api.getServerRoles).mockResolvedValue(NONE);
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles?role=kochen" });
        expect(await screen.findByText(/Kein Server eingestellt/)).toBeInTheDocument();
        expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
        expect(api.getServerRoleDetail).not.toHaveBeenCalled();
    });

    it("says when the role is gone", async () => {
        vi.mocked(api.getServerRoleDetail).mockResolvedValue({ ...DETAIL, role: null, channels: [], members: [] });
        const user = userEvent.setup();
        renderPage(<ServerRolesPage />, { route: "/channels/server-roles" });
        await user.click(await screen.findByRole("button", { name: "Angeln" }));
        expect(await screen.findByText("Diese Rolle gibt es auf dem Server nicht mehr.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Schließen" }));
        expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    });
});
