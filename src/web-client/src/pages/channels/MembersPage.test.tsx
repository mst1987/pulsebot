// System › Discord › Mitglieder: the tab with its count, the table with roles,
// join date and roster, bots hidden by default, the switches, search, role filter,
// sorting, "alle zeigen", the talk server, offline, and the drawer by click and by
// link (?user=, &side=talk) — opening pushes a history entry, closing replaces it.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { MemberRole, ServerMember, ServerMemberDetail, ServerMembers } from "../../api";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import MembersPage from "./MembersPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getServerMembers: vi.fn(),
    getServerMemberDetail: vi.fn(),
    getDiscordTabCounts: vi.fn(),
}));

function member(over: Partial<ServerMember>): ServerMember {
    return { id: "u", name: "Name", username: "", avatarUrl: null, bot: false, joinedAt: null, roleIds: [], rosters: [], characters: [], missingRosters: [], ...over };
}

const ROLES: MemberRole[] = [
    { id: "orga", name: "Orga", color: "#e74c3c", position: 9 },
    { id: "raider", name: "Raider", color: "", position: 5 },
    { id: "koch", name: "Kochen", color: "#2ecc71", position: 3 },
    { id: "angel", name: "Angeln", color: "", position: 2 },
];

const THRALL = member({
    id: "t", name: "Thrall", username: "thrall_99", roleIds: ["orga", "raider", "koch", "angel"], joinedAt: Date.UTC(2026, 5, 2, 12),
    rosters: [{ id: "r1", name: "Naxx-Kader", categoryId: "c1", versionId: "forever", status: "member" }],
    characters: [{ name: "Gromm", className: "Warrior", versionId: "tbc", rosterIds: [] }, { name: "Thrallo", className: "Shaman", versionId: "forever", rosterIds: ["r1"] }],
});
const JAINA = member({ id: "j", name: "Jaina", username: "jaina", roleIds: ["raider"], joinedAt: Date.UTC(2025, 0, 10, 12), characters: [{ name: "Proudmoore", className: "Mage", versionId: "tbc", rosterIds: [] }], missingRosters: [{ id: "r1", name: "Naxx-Kader" }] });
const NEU = member({ id: "n", name: "Neu", username: "neu" });
const BOT = member({ id: "b", name: "PulseBot", username: "pulsebot", bot: true, roleIds: ["raider"] });

const HEAD = { guildId: "g1", guildName: "Testgilde", online: true, botRole: null, manageRoles: true, membersError: null };
const EVENT: ServerMembers = { side: "event", ...HEAD, total: 4, roles: ROLES, members: [THRALL, JAINA, NEU, BOT] };
const TALK: ServerMembers = { side: "talk", ...HEAD, guildId: "g2", guildName: "Talkgilde", total: 1, roles: [], members: [member({ id: "x", name: "Sylvanas" })] };

const DETAIL: ServerMemberDetail = {
    side: "event", ...HEAD, member: THRALL, roles: ROLES,
    channels: [
        { id: "k1", name: "Raids", visible: 2, total: 3, channels: [{ id: "c1", name: "anmeldung", kind: "text" }, { id: "c2", name: "Raid 1", kind: "voice" }] },
        { id: "k2", name: "Offiziere", visible: 0, total: 2, channels: [] },
    ],
};

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getServerMembers).mockReset().mockImplementation(async (side) => (side === "event" ? EVENT : TALK));
    vi.mocked(api.getServerMemberDetail).mockReset().mockResolvedValue(DETAIL);
    vi.mocked(api.getDiscordTabCounts).mockReset().mockResolvedValue({ channels: 31, serverRoles: 5, members: 4, roleMessages: 2 });
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

const names = () => screen.getAllByRole("row").slice(1).map((r) => r.querySelector(".dmb-name")!.textContent);

describe("Mitglieder: table", () => {
    it("shows the tab with its count and the members without bots", async () => {
        renderPage(<MembersPage />, { route: "/channels/members" });
        expect(await screen.findByText("Thrall")).toBeInTheDocument();
        const tabs = screen.getByRole("navigation", { name: "Bereiche von Discord" });
        expect(within(tabs).getByRole("link", { name: "Mitglieder 4" })).toHaveAttribute("aria-current", "page");
        expect(names()).toEqual(["Jaina", "Neu", "Thrall"]);
        // the badge counts people like the list; the note says how many bots are left out
        expect(screen.getByText("3 Mitglieder")).toBeInTheDocument();
        expect(screen.getByText("3 Mitglieder · 1 Bot ausgeblendet")).toBeInTheDocument();
    });

    it("says \"N von M\" once a search or filter narrows the list", async () => {
        const user = userEvent.setup();
        renderPage(<MembersPage />, { route: "/channels/members" });
        await screen.findByText("Thrall");
        await user.type(screen.getByRole("searchbox"), "jai");
        expect(screen.getByText("1 von 3 Mitgliedern")).toBeInTheDocument();
        await user.clear(screen.getByRole("searchbox"));
        await user.click(screen.getByRole("switch", { name: /Bots ausblenden/ }));
        expect(screen.getByText("4 Mitglieder")).toBeInTheDocument();
    });

    it("shows roles in their colour, at most three, the join date and the roster", async () => {
        renderPage(<MembersPage />, { route: "/channels/members" });
        const row = (await screen.findByText("Thrall")).closest("tr")!;
        const roles = row.querySelector(".dmb-c-roles")!;
        expect([...roles.querySelectorAll(".dmb-role")].map((r) => r.textContent)).toEqual(["Orga", "Raider", "Kochen"]);
        expect(roles.querySelector(".dmb-coloured")).toHaveStyle("--dmb-color: #e74c3c");
        expect(within(roles as HTMLElement).getByText("+1")).toHaveAttribute("data-tip-sub", "Angeln");
        expect(row.querySelector(".dmb-c-joined")!.textContent).toMatch(/02\D06\D2026/);
        const roster = row.querySelector(".dmb-c-roster")!;
        expect(within(roster as HTMLElement).getByText("Thrallo")).toHaveClass("class-colored");
        expect(within(roster as HTMLElement).getByText("Naxx-Kader")).toBeInTheDocument();
        // on a phone the roster and the highest role go under the name
        expect(row.querySelector(".dmb-meta")!.textContent).toBe("ThralloNaxx-KaderOrga+3");
    });

    it("marks members outside the roster and a roster role without the roster", async () => {
        renderPage(<MembersPage />, { route: "/channels/members" });
        const jaina = (await screen.findByText("Jaina")).closest("tr")!;
        const cell = jaina.querySelector(".dmb-c-roster") as HTMLElement;
        expect(within(cell).getByText("nicht im Roster")).toBeInTheDocument();
        expect(within(cell).getByText("Rolle ohne Roster")).toHaveAttribute("data-tip-sub", expect.stringMatching(/von Naxx-Kader/));
        const neu = screen.getByText("Neu").closest("tr")!;
        expect(within(neu).getByText("keine Rolle")).toBeInTheDocument();
        expect(within(neu.querySelector(".dmb-c-roster") as HTMLElement).getByText("kein Charakter verknüpft")).toBeInTheDocument();
        expect(within(neu).getByText("unbekannt")).toBeInTheDocument();
    });

    it("filters by switches, search and role", async () => {
        const user = userEvent.setup();
        renderPage(<MembersPage />, { route: "/channels/members" });
        await screen.findByText("Thrall");
        await user.click(screen.getByRole("switch", { name: /Bots ausblenden/ }));
        expect(names()).toEqual(["Jaina", "Neu", "PulseBot", "Thrall"]);
        expect(screen.getByText("Bot")).toBeInTheDocument();
        await user.click(screen.getByRole("switch", { name: /Bots ausblenden/ }));
        await user.click(screen.getByRole("switch", { name: /ohne Rolle/ }));
        expect(names()).toEqual(["Neu"]);
        await user.click(screen.getByRole("switch", { name: /ohne Rolle/ }));
        await user.click(screen.getByRole("switch", { name: /nicht im Roster/ }));
        expect(names()).toEqual(["Jaina", "Neu"]);
        await user.click(screen.getByRole("switch", { name: /nicht im Roster/ }));
        await user.type(screen.getByRole("searchbox", { name: "Name, Discord-Name oder Charakter" }), "gromm");
        expect(names()).toEqual(["Thrall"]);
        await user.clear(screen.getByRole("searchbox"));
        await user.selectOptions(screen.getByRole("combobox", { name: "Rolle" }), "raider");
        expect(names()).toEqual(["Jaina", "Thrall"]);
        await user.type(screen.getByRole("searchbox"), "zzz");
        expect(screen.getByText("Kein Mitglied passt zu den Filtern.")).toBeInTheDocument();
    });

    it("sorts by roles, join date and roster", async () => {
        const user = userEvent.setup();
        renderPage(<MembersPage />, { route: "/channels/members" });
        await screen.findByText("Thrall");
        await user.click(screen.getByRole("button", { name: /^Rollen/ }));
        expect(names()).toEqual(["Thrall", "Jaina", "Neu"]);
        await user.click(screen.getByRole("button", { name: /^Beigetreten/ }));
        expect(names()).toEqual(["Thrall", "Jaina", "Neu"]);
        await user.click(screen.getByRole("button", { name: /Roster und Charakter/ }));
        expect(names()).toEqual(["Thrall", "Jaina", "Neu"]);
        await user.click(screen.getByRole("button", { name: /Roster und Charakter/ }));
        expect(names()).toEqual(["Neu", "Jaina", "Thrall"]);
    });

    it("shows the first fifty and the rest on request", async () => {
        const many = Array.from({ length: 62 }, (_, i) => member({ id: `m${i}`, name: `Raider ${String(i).padStart(2, "0")}` }));
        vi.mocked(api.getServerMembers).mockResolvedValue({ ...EVENT, total: many.length, members: many });
        const user = userEvent.setup();
        renderPage(<MembersPage />, { route: "/channels/members" });
        await screen.findByText("Raider 00");
        expect(screen.getAllByRole("row")).toHaveLength(51);
        await user.click(screen.getByRole("button", { name: "12 weitere · alle zeigen" }));
        expect(screen.getAllByRole("row")).toHaveLength(63);
    });

    it("switches to the talk server and keeps it in the link", async () => {
        const user = userEvent.setup();
        renderPage(<MembersPage />, { route: "/channels/members" });
        await screen.findByText("Thrall");
        await user.click(screen.getByRole("radio", { name: "Talk-Server" }));
        expect(await screen.findByText("Sylvanas")).toBeInTheDocument();
        expect(api.getServerMembers).toHaveBeenLastCalledWith("talk");
    });

    it("says when the bot is offline, the list is missing or no server is set", async () => {
        vi.mocked(api.getServerMembers).mockResolvedValueOnce({ ...EVENT, online: false, members: [] });
        const first = renderPage(<MembersPage />, { route: "/channels/members" });
        expect(await screen.findAllByText("Bot nicht verbunden")).not.toHaveLength(0);
        expect(screen.getByText(/ohne Verbindung bleibt die Liste leer/)).toBeInTheDocument();
        first.unmount();
        vi.mocked(api.getServerMembers).mockResolvedValueOnce({ ...EVENT, membersError: "timeout", members: [] });
        const second = renderPage(<MembersPage />, { route: "/channels/members" });
        expect(await screen.findByText("Mitgliederliste fehlt")).toBeInTheDocument();
        expect(screen.getByText(/nicht rechtzeitig/)).toBeInTheDocument();
        second.unmount();
        // anything but a timeout: Discord does not hand the list out — the intent is missing
        vi.mocked(api.getServerMembers).mockResolvedValueOnce({ ...EVENT, membersError: "Used disallowed intents", members: [] });
        const third = renderPage(<MembersPage />, { route: "/channels/members" });
        expect(await screen.findByText(/Server-Members-Intent/)).toBeInTheDocument();
        third.unmount();
        vi.mocked(api.getServerMembers).mockResolvedValueOnce({ ...EVENT, guildId: "", members: [] });
        renderPage(<MembersPage />, { route: "/channels/members" });
        expect(await screen.findByText(/Kein Event-Server eingestellt/)).toBeInTheDocument();
    });

    it("reads in English", async () => {
        await switchLang("en");
        try {
            renderPage(<MembersPage />, { route: "/channels/members" });
            expect(await screen.findByText("Thrall")).toBeInTheDocument();
            expect(screen.getByText("3 members · 1 bot hidden")).toBeInTheDocument();
            expect(screen.getByRole("switch", { name: /Hide bots/ })).toBeChecked();
            expect(screen.getByText("not in a roster", { selector: ".dmb-c-roster *" })).toBeInTheDocument();
        } finally {
            await switchLang("de");
        }
    });
});

describe("Mitglieder: drawer", () => {
    it("opens a member with roles, characters by version and visible channels", async () => {
        const user = userEvent.setup();
        renderPage(<MembersPage />, { route: "/channels/members" });
        await user.click(await screen.findByRole("button", { name: "Thrall" }));
        const drawer = await screen.findByRole("complementary", { name: "Thrall" });
        expect(api.getServerMemberDetail).toHaveBeenCalledWith("event", "t");
        expect(await within(drawer).findByText("Mitglied · Testgilde")).toBeInTheDocument();
        expect(within(drawer).getByText(/thrall_99 · beigetreten 02\D06\D2026/)).toBeInTheDocument();
        const chars = drawer.querySelector(".dmb-chars")!;
        const rows = [...chars.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent));
        expect(rows[0]).toEqual(["Gromm", "TBC", "–"]);
        expect(rows[1][0]).toBe("Thrallo");
        expect(rows[1][1]).toBe("Forever");
        expect(rows[1][2]).toMatch(/^Naxx-Kader /);
        // the section heads carry the number with its word
        expect(within(drawer).getByText("4 Rollen")).toBeInTheDocument();
        expect(within(drawer).getByText("2 Charaktere")).toBeInTheDocument();
        expect(within(drawer).getByText("2 von 5 Kanälen")).toBeInTheDocument();
        expect(within(drawer).getByText("#anmeldung")).toBeInTheDocument();
        expect(drawer.querySelector(".dmb-group.dmb-muted")!.textContent).toMatch(/Offiziere/);
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("complementary", { name: "Thrall" })).not.toBeInTheDocument());
    });

    it("opens from a link, also on the talk server", async () => {
        vi.mocked(api.getServerMemberDetail).mockResolvedValue({ ...DETAIL, side: "talk", member: TALK.members[0], roles: [], channels: [] });
        renderPage(<MembersPage />, { route: "/channels/members?user=x&side=talk" });
        expect(await screen.findByRole("complementary", { name: "Sylvanas" })).toBeInTheDocument();
        expect(api.getServerMembers).toHaveBeenCalledWith("talk");
        expect(api.getServerMemberDetail).toHaveBeenCalledWith("talk", "x");
        expect(await screen.findByText("Keine Rolle außer @everyone.")).toBeInTheDocument();
        expect(screen.getByText("Kein Charakter verknüpft.")).toBeInTheDocument();
    });

    it("says when the member has left", async () => {
        vi.mocked(api.getServerMemberDetail).mockResolvedValue({ ...DETAIL, member: null, roles: [], channels: [] });
        renderPage(<MembersPage />, { route: "/channels/members?user=gone" });
        expect(await screen.findByText("Dieses Mitglied ist nicht mehr auf dem Server.")).toBeInTheDocument();
    });

    it("says the same for an account the server marks as gone", async () => {
        vi.mocked(api.getServerMemberDetail).mockResolvedValue({ ...DETAIL, gone: true, roles: [], channels: [] });
        renderPage(<MembersPage />, { route: "/channels/members?user=t" });
        expect(await screen.findByText("Dieses Mitglied ist nicht mehr auf dem Server.")).toBeInTheDocument();
        expect(screen.queryByText("4 Rollen")).not.toBeInTheDocument();
    });

    it("opens as a history step: back closes it, Esc replaces it", async () => {
        const user = userEvent.setup();
        renderPage(<><MembersPage /><HistoryProbe /></>, { route: "/channels/members" });
        await user.click(await screen.findByRole("button", { name: "Thrall" }));
        expect(await screen.findByRole("complementary", { name: "Thrall" })).toBeInTheDocument();
        expect(screen.getByTestId("search")).toHaveTextContent("?user=t");
        // the browser's back button closes the drawer instead of leaving the page
        await user.click(screen.getByRole("button", { name: "probe-back" }));
        await waitFor(() => expect(screen.queryByRole("complementary", { name: "Thrall" })).not.toBeInTheDocument());
        expect(screen.getByTestId("search")).toHaveTextContent(/^$/);
        expect(screen.getByText("Thrall")).toBeInTheDocument();
        expect(screen.getByTestId("type")).toHaveTextContent("POP");
        // closing by Esc replaces the entry instead of stacking one more
        await user.click(screen.getByRole("button", { name: "Thrall" }));
        await screen.findByRole("complementary", { name: "Thrall" });
        expect(screen.getByTestId("type")).toHaveTextContent("PUSH");
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.getByTestId("search")).toHaveTextContent(/^$/));
        expect(screen.getByTestId("type")).toHaveTextContent("REPLACE");
    });

    it("opens no drawer without a server", async () => {
        vi.mocked(api.getServerMembers).mockResolvedValue({ ...EVENT, guildId: "", members: [] });
        renderPage(<MembersPage />, { route: "/channels/members?user=t" });
        expect(await screen.findByText(/Kein Event-Server eingestellt/)).toBeInTheDocument();
        expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
        expect(api.getServerMemberDetail).not.toHaveBeenCalled();
    });
});
