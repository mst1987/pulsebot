// System › Vermerke (#980): the compact list (level as symbol and word, reasons
// with ×2, the count, "Zuletzt", left/shared icons), sorting, the level filter
// and the archive tab; the drawer by link with a shared read-only entry of another
// server that may only be hidden here; the dialog (person search, reason, raids,
// `too_many` in plain words); the hints from the data (hidden when empty, five
// then "Alle zeigen", ignore, prefilled dialog); read-only accounts see no buttons.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/vermerke";
import type { VermerkEntry, VermerkPerson, VermerkPersonDetail, VermerkSignal } from "../../api/vermerke";
import { adminUser, renderPage } from "../../test/render";
import VermerkePage from "./VermerkePage";

vi.mock("../../api/vermerke", async (orig) => ({
    ...(await orig<typeof import("../../api/vermerke")>()),
    getVermerke: vi.fn(),
    getVermerkPerson: vi.fn(),
    createVermerk: vi.fn(),
    updateVermerk: vi.fn(),
    archiveVermerk: vi.fn(),
    hideVermerk: vi.fn(),
    searchVermerkPeople: vi.fn(),
    getVermerkRaids: vi.fn(),
    getVermerkSignals: vi.fn(),
    ignoreVermerkSignal: vi.fn(),
}));

const day = (d: number) => Date.UTC(2026, 9, d, 12);

function person(over: Partial<VermerkPerson>): VermerkPerson {
    return { userId: "u", name: "Name", level: "hint", reasons: {}, activeCount: 1, totalCount: 1, lastAt: day(1), lastByName: "Orga", sharedCount: 0, left: false, ...over };
}

const THRALL = person({ userId: "t", name: "Thrall", level: "warning", reasons: { no_show: 2, late_signoff: 1 }, activeCount: 3, totalCount: 3, lastAt: day(27), lastByName: "Varian" });
const JAINA = person({ userId: "j", name: "Jaina", level: "shadowban", reasons: { behavior: 1 }, activeCount: 2, totalCount: 3, lastAt: day(20), sharedCount: 1, left: true });
const NEU = person({ userId: "n", name: "Neu", level: "hint", reasons: { other: 1 }, lastAt: day(25) });
const ALT = person({ userId: "a", name: "Altmann", level: null, reasons: { loot: 2 }, activeCount: 0, totalCount: 2, lastAt: day(2) });

function entry(over: Partial<VermerkEntry>): VermerkEntry {
    return {
        id: "e", level: "warning", reason: "behavior", text: "", eventIds: [], expiresAt: null, shared: false, by: "o", byName: "Orga", at: day(20),
        history: [{ by: "o", byName: "Orga", at: day(20), action: "create" }], own: true, originGuildId: "g1", hidden: false, active: true, ...over,
    };
}

const JAINA_DETAIL: VermerkPersonDetail = {
    userId: "j", name: "Jaina", level: "shadowban",
    entries: [
        entry({ id: "own", level: "warning", text: "Hat im Raid geflamed." }),
        entry({ id: "shared", level: "shadowban", reason: "no_show", text: "Dreimal nicht gekommen.", own: false, shared: true, originGuildId: "g2", originName: "Talkgilde" }),
        entry({ id: "old", level: "hint", reason: "loot", text: "Alter Eintrag.", archived: true, archivedAt: day(10), active: false }),
    ],
};

function signal(i: number, over: Partial<VermerkSignal> = {}): VermerkSignal {
    return { userId: `s${i}`, name: `Raider${i}`, kind: "no_show", count: 2, windowDays: 30, events: [{ eventId: `ev${i}`, title: "Kara", startTime: 1_790_000_000 }], lastAt: day(28), ...over };
}

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getVermerke).mockReset().mockResolvedValue({ guildId: "g1", guildName: "Testgilde", people: [THRALL, JAINA, NEU, ALT] });
    vi.mocked(api.getVermerkPerson).mockReset().mockResolvedValue(JAINA_DETAIL);
    vi.mocked(api.getVermerkSignals).mockReset().mockResolvedValue([]);
    vi.mocked(api.searchVermerkPeople).mockReset().mockResolvedValue({ results: [{ userId: "t", name: "Thrall", gone: false }, { userId: "x", name: "Thralline", gone: true }] });
    vi.mocked(api.getVermerkRaids).mockReset().mockResolvedValue({ raids: [{ eventId: "r1", title: "Karazhan", startTime: 1_792_000_000, signed: true }] });
    vi.mocked(api.createVermerk).mockReset().mockResolvedValue({ entry: entry({}) });
    vi.mocked(api.hideVermerk).mockReset().mockResolvedValue({ id: "shared", hidden: true });
    vi.mocked(api.ignoreVermerkSignal).mockReset().mockResolvedValue({});
});

const names = () => screen.getAllByRole("row").slice(1).map((r) => r.querySelector(".vmk-name")!.textContent);
const readOnly = () => adminUser({ isAdmin: false, access: { vermerke: { read: true, write: false } } });

describe("Vermerke: list", () => {
    it("shows the people with notes that count, newest first, compact", async () => {
        renderPage(<VermerkePage />, { route: "/vermerke" });
        expect(await screen.findByText("Thrall")).toBeInTheDocument();
        expect(names()).toEqual(["Thrall", "Neu", "Jaina"]);
        expect(screen.getByText("3 Personen")).toBeInTheDocument();
        const thrall = screen.getByRole("row", { name: /Thrall/ });
        // level as symbol and word, reasons as icons with ×2, the count only
        expect(within(thrall).getAllByText("Warnung").length).toBeGreaterThan(0);
        expect(within(thrall).getAllByRole("img", { name: "Nicht erschienen ×2" }).length).toBeGreaterThan(0);
        expect(within(thrall).getAllByRole("img", { name: "Späte Abmeldung" }).length).toBeGreaterThan(0);
        expect(thrall.querySelector(".vmk-c-n")!.textContent).toBe("3");
        expect(thrall.querySelector(".vmk-c-last [data-tip-sub]")!.getAttribute("data-tip-sub")).toBe("Von Varian");
        // the last column: one icon for "left" or "shared"
        const jaina = screen.getByRole("row", { name: /Jaina/ });
        expect(within(jaina).getByRole("img", { name: "Hat den Server verlassen" })).toBeInTheDocument();
        expect(within(jaina).getByRole("img", { name: "1 geteilter Vermerk" })).toBeInTheDocument();
        expect(within(thrall).queryByRole("img", { name: "Hat den Server verlassen" })).not.toBeInTheDocument();
    });

    it("sorts by name and level", async () => {
        const user = userEvent.setup();
        renderPage(<VermerkePage />, { route: "/vermerke" });
        await screen.findByText("Thrall");
        await user.click(screen.getByRole("button", { name: /^Person/ }));
        expect(names()).toEqual(["Jaina", "Neu", "Thrall"]);
        await user.click(screen.getByRole("button", { name: /^Stufe/ }));
        expect(names()).toEqual(["Jaina", "Thrall", "Neu"]);
    });

    it("filters by level and keeps the archive in its own tab", async () => {
        const user = userEvent.setup();
        renderPage(<VermerkePage />, { route: "/vermerke" });
        await screen.findByText("Thrall");
        await user.click(screen.getByRole("radio", { name: "Warnung" }));
        expect(names()).toEqual(["Thrall"]);
        await user.click(screen.getByRole("radio", { name: "Archiv · 1" }));
        expect(names()).toEqual(["Altmann"]);
        expect(screen.getAllByText("abgelaufen").length).toBeGreaterThan(0);
        // the archive counts every entry
        expect(screen.getByRole("row", { name: /Altmann/ }).querySelector(".vmk-c-n")!.textContent).toBe("2");
        expect(screen.queryByRole("radiogroup", { name: "Nach Stufe filtern" })).not.toBeInTheDocument();
    });

    it("says when there is nothing yet and when no server is chosen", async () => {
        vi.mocked(api.getVermerke).mockResolvedValue({ guildId: "g1", guildName: "Testgilde", people: [] });
        const { unmount } = renderPage(<VermerkePage />, { route: "/vermerke" });
        expect(await screen.findByText("Noch keine Vermerke auf diesem Server.")).toBeInTheDocument();
        unmount();
        vi.mocked(api.getVermerke).mockRejectedValue(Object.assign(new Error("x"), { code: "no_server" }));
        renderPage(<VermerkePage />, { route: "/vermerke" });
        expect(await screen.findByText(/Kein Server gewählt/)).toBeInTheDocument();
    });

    it("shows no add buttons to a read-only account", async () => {
        vi.mocked(api.getVermerkSignals).mockResolvedValue([signal(1)]);
        renderPage(<VermerkePage />, { route: "/vermerke?user=j", user: readOnly() });
        await screen.findByText("Hat im Raid geflamed.");
        expect(await screen.findByText("Hinweise aus den Daten")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Vermerk anlegen/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Eintrag hinzufügen" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Für diesen Server ausblenden" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Bearbeiten" })).not.toBeInTheDocument();
    });
});

describe("Vermerke: drawer", () => {
    it("opens by link with the entries, a shared one read only and the archive folded", async () => {
        renderPage(<VermerkePage />, { route: "/vermerke?user=j" });
        const drawer = await screen.findByRole("complementary", { name: "Jaina" });
        expect(api.getVermerkPerson).toHaveBeenCalledWith("j");
        expect(await within(drawer).findByText("Hat im Raid geflamed.")).toBeInTheDocument();
        expect(within(drawer).getByText("Dreimal nicht gekommen.")).toBeInTheDocument();
        expect(within(drawer).getByText("2 Einträge zählen")).toBeInTheDocument();
        const own = drawer.querySelector('[data-entry="own"]') as HTMLElement;
        const shared = drawer.querySelector('[data-entry="shared"]') as HTMLElement;
        expect(within(own).getByRole("button", { name: "Bearbeiten" })).toBeInTheDocument();
        expect(within(own).getByRole("button", { name: "Archivieren" })).toBeInTheDocument();
        // the shared one: lock with the origin server, no edit, only "hide here"
        expect(within(shared).getByText("Von Talkgilde")).toBeInTheDocument();
        expect(within(shared).queryByRole("button", { name: "Bearbeiten" })).not.toBeInTheDocument();
        expect(within(shared).queryByRole("button", { name: "Archivieren" })).not.toBeInTheDocument();
        expect(within(shared).getByRole("button", { name: "Für diesen Server ausblenden" })).toBeInTheDocument();
        const archive = within(drawer).getByText("Archiv · 1 Eintrag").closest("details")!;
        expect(archive).not.toHaveAttribute("open");
        expect(within(archive).getByRole("button", { name: "Wiederherstellen" })).toBeInTheDocument();
    });

    it("hides a shared entry for this server and loads again", async () => {
        const user = userEvent.setup();
        renderPage(<VermerkePage />, { route: "/vermerke?user=j" });
        const drawer = await screen.findByRole("complementary", { name: "Jaina" });
        await within(drawer).findByText("Dreimal nicht gekommen.");
        await user.click(within(drawer).getByRole("button", { name: "Für diesen Server ausblenden" }));
        expect(api.hideVermerk).toHaveBeenCalledWith("shared", true);
        await waitFor(() => expect(api.getVermerkPerson).toHaveBeenCalledTimes(2));
        expect(api.getVermerke).toHaveBeenCalledTimes(2);
    });

    it("opens a person from the list and closes with Esc", async () => {
        const user = userEvent.setup();
        renderPage(<VermerkePage />, { route: "/vermerke" });
        await user.click(await screen.findByRole("button", { name: "Jaina" }));
        expect(await screen.findByRole("complementary", { name: "Jaina" })).toBeInTheDocument();
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("complementary", { name: "Jaina" })).not.toBeInTheDocument());
    });
});

describe("Vermerke: dialog", () => {
    it("adds a note: person search, reason, a raid, default expiry \"Nie\"", async () => {
        const user = userEvent.setup();
        renderPage(<VermerkePage />, { route: "/vermerke" });
        await screen.findByText("Thrall");
        await user.click(screen.getByRole("button", { name: "Vermerk anlegen" }));
        const dlg = await screen.findByRole("dialog");
        const save = within(dlg).getByRole("button", { name: "Vermerk anlegen" });
        expect(save).toBeDisabled();
        expect(within(dlg).getByRole("radio", { name: "Nie" })).toBeChecked();
        await user.type(within(dlg).getByRole("searchbox"), "Thr");
        // who left is found too, and said so
        expect(await within(dlg).findByText("nicht mehr auf dem Server")).toBeInTheDocument();
        await user.click(within(dlg).getByRole("button", { name: /^Thrall$/ }));
        expect(api.getVermerkRaids).toHaveBeenCalledWith("t");
        await user.click(within(dlg).getByRole("button", { name: "Nicht erschienen" }));
        await user.click(await within(dlg).findByRole("button", { name: /Karazhan/ }));
        expect(within(dlg).getByRole("button", { name: /Karazhan/ })).toHaveAttribute("aria-pressed", "true");
        await user.click(within(dlg).getByRole("switch", { name: /Auf allen Servern zeigen/ }));
        await user.click(save);
        expect(api.createVermerk).toHaveBeenCalledWith("t", "Thrall", {
            level: "hint", reason: "no_show", text: "", eventIds: ["r1"], expiresAt: null, shared: true,
        });
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("says in plain words when the person already has fifty notes", async () => {
        const user = userEvent.setup();
        vi.mocked(api.createVermerk).mockRejectedValue(Object.assign(new Error("too many"), { code: "too_many" }));
        renderPage(<VermerkePage />, { route: "/vermerke?user=j" });
        const drawer = await screen.findByRole("complementary", { name: "Jaina" });
        await user.click(within(drawer).getByRole("button", { name: "Eintrag hinzufügen" }));
        const dlg = await screen.findByRole("dialog");
        expect(within(dlg).getByText("Jaina")).toBeInTheDocument();
        await user.click(within(dlg).getByRole("button", { name: "Verhalten" }));
        await user.click(within(dlg).getByRole("button", { name: "Vermerk anlegen" }));
        expect(await within(dlg).findByRole("alert")).toHaveTextContent("schon 50 Vermerke gespeichert – das Archiv zählt mit");
    });
});

describe("Vermerke: hints from the data", () => {
    it("is hidden without hints", async () => {
        renderPage(<VermerkePage />, { route: "/vermerke" });
        await screen.findByText("Thrall");
        await waitFor(() => expect(api.getVermerkSignals).toHaveBeenCalled());
        expect(screen.queryByText("Hinweise aus den Daten")).not.toBeInTheDocument();
    });

    it("shows five, the rest on request, ignores one and opens the dialog prefilled", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getVermerkSignals).mockResolvedValue([
            signal(1, { kind: "signoff_after_setup", count: 3 }), signal(2), signal(3), signal(4), signal(5), signal(6, { kind: "left_server" }),
        ]);
        renderPage(<VermerkePage />, { route: "/vermerke" });
        const section = (await screen.findByText("Hinweise aus den Daten")).closest("section")!;
        expect(section.querySelectorAll(".vmk-sig")).toHaveLength(5);
        expect(within(section).getByText("Abmeldung nach Setzung · 3× in 30 Tagen")).toBeInTheDocument();
        await user.click(within(section).getByRole("button", { name: "1 weiteren Hinweis zeigen" }));
        expect(section.querySelectorAll(".vmk-sig")).toHaveLength(6);
        // "left the server" has no count
        expect(within(section).getByText("Server verlassen")).toBeInTheDocument();

        const second = section.querySelector('[data-user="s2"]') as HTMLElement;
        await user.click(within(second).getByRole("button", { name: "Ignorieren" }));
        expect(api.ignoreVermerkSignal).toHaveBeenCalledWith("s2", "no_show");
        await waitFor(() => expect(section.querySelector('[data-user="s2"]')).toBeNull());

        const first = section.querySelector('[data-user="s1"]') as HTMLElement;
        await user.click(within(first).getByRole("button", { name: "Vermerk anlegen" }));
        const dlg = await screen.findByRole("dialog");
        expect(within(dlg).getByText("Vermerk für Raider1")).toBeInTheDocument();
        // "Abmeldung nach Setzung" is a late signoff
        expect(within(dlg).getByRole("button", { name: "Späte Abmeldung" })).toHaveAttribute("aria-pressed", "true");
    });
});
