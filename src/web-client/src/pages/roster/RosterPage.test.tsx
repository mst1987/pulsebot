// The roster page (design issue #218): filters, sorting, the remembered view,
// hiding a character and the gear-problem KPI as the filter switch.
// Conventions that cannot be rendered (own stylesheet, shared blocks, no glyph
// icons) stay in test/web-client/conventions/rosterCharakter.test.js.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { RosterChar, RosterData } from "../../api";
import RosterPage from "./RosterPage";
import { adminUser, renderPage } from "../../test/render";
import { gearWithIssues, rosterChar, rosterData } from "./RosterPage.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRoster: vi.fn(),
    getCharacterClaims: vi.fn(),
    setRosterHidden: vi.fn(),
}));

const READER = adminUser({ isAdmin: false, access: { roster: { read: true, write: false } } });

async function openPage(data: RosterData, user = adminUser()) {
    vi.mocked(api.getRoster).mockResolvedValue(data);
    renderPage(<RosterPage />, { route: "/roster", user });
    await screen.findByRole("radiogroup", { name: "Rolle" });
}

/** The group (one raid category) titled `title`. */
function group(title: string): HTMLElement {
    const section = screen.getByText(title, { selector: ".ros-grp-title span" }).closest("section");
    if (!section) throw new Error(`no group ${title}`);
    return section;
}

/** The character names a group lists, top to bottom. */
function names(el: HTMLElement): string[] {
    return within(el).queryAllByRole("link")
        .filter((a) => /^\/roster\/char\?name=[^&]+$/.test(a.getAttribute("href") || "") && a.textContent !== "Öffnen")
        .map((a) => a.textContent || "");
}

function stored(key: string): Record<string, unknown> {
    return JSON.parse(window.localStorage.getItem(`eh-${key}`) || "null");
}

beforeEach(() => {
    vi.mocked(api.getCharacterClaims).mockResolvedValue({ claims: [] });
    vi.mocked(api.setRosterHidden).mockImplementation(async (character, hidden) => ({ character, hidden }));
});

describe("RosterPage — filters", () => {
    it("filters with search, role switch and class chips — no selects, checkboxes or reset button", async () => {
        await openPage(rosterData([rosterChar("Alpha"), rosterChar("Beta", { role: "healer", className: "Priest", spec: "Holy" })]));
        expect(screen.getByRole("searchbox", { name: "Charakter suchen" })).toBeInTheDocument();
        expect(screen.getByRole("group", { name: "Klasse" })).toBeInTheDocument();
        expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
        expect(screen.queryByText(/Filter zurücksetzen/)).not.toBeInTheDocument();

        const user = userEvent.setup();
        await user.click(screen.getByRole("radio", { name: "Heiler" }));
        expect(names(group("Montagsraid"))).toEqual(["Beta"]);
        await user.click(screen.getByRole("radio", { name: "Alle" }));
        await user.type(screen.getByRole("searchbox", { name: "Charakter suchen" }), "alp");
        expect(names(group("Montagsraid"))).toEqual(["Alpha"]);
    });

    it("offers spec pills only once a class with several specs is picked, and a second click takes them back", async () => {
        await openPage(rosterData([
            rosterChar("Alpha", { spec: "Fire" }),
            rosterChar("Beta", { spec: "Frost" }),
            rosterChar("Gamma", { spec: "Frost" }),
            rosterChar("Delta", { className: "Priest", spec: "Holy", role: "healer" }),
        ]));
        const user = userEvent.setup();
        expect(screen.queryByRole("group", { name: "Spec" })).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Priester · 1" }));
        // one spec is no choice
        expect(screen.queryByRole("group", { name: "Spec" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Priester · 1" }));

        await user.click(screen.getByRole("button", { name: "Magier · 3" }));
        const specs = screen.getByRole("group", { name: "Spec" });
        expect(within(specs).getAllByRole("button").map((b) => b.textContent)).toEqual(["Fire1", "Frost2"]);
        await user.click(within(specs).getByRole("button", { name: /^Frost/ }));
        expect(names(group("Montagsraid"))).toEqual(["Beta", "Gamma"]);
        await user.click(within(specs).getByRole("button", { name: /^Frost/ }));
        expect(names(group("Montagsraid"))).toEqual(["Alpha", "Beta", "Gamma"]);
    });

    it("ignores a stored spec the chosen class does not have", async () => {
        window.localStorage.setItem("eh-roster-view", JSON.stringify({ className: "Mage", spec: "Shadow" }));
        await openPage(rosterData([rosterChar("Alpha", { spec: "Fire" }), rosterChar("Beta", { spec: "Frost" })]));
        expect(names(group("Montagsraid"))).toEqual(["Alpha", "Beta"]);
    });

    it("makes the gear-problem figure the filter switch", async () => {
        const data = rosterData([rosterChar("Alpha", { gear: gearWithIssues("Alpha", 2) }), rosterChar("Beta", { gear: gearWithIssues("Beta", 0) })]);
        data.stats = { ...data.stats, withIssues: 1, evaluated: 2, issues: 2 };
        await openPage(data);
        const user = userEvent.setup();
        const toggle = screen.getByRole("button", { name: /Gear-Probleme/ });
        expect(toggle).toHaveAttribute("aria-pressed", "false");
        await user.click(toggle);
        expect(toggle).toHaveAttribute("aria-pressed", "true");
        expect(names(group("Montagsraid"))).toEqual(["Alpha"]);
        await user.click(toggle);
        expect(names(group("Montagsraid"))).toEqual(["Alpha", "Beta"]);
    });
});

describe("RosterPage — remembered view", () => {
    it("reads only the known fields of a stored view and falls back on what it does not trust", async () => {
        const hidden = { ...rosterChar("Gone"), hidden: { character: "Gone", reason: "", at: 0, by: "" } };
        window.localStorage.setItem("eh-roster-view", JSON.stringify({ role: "bogus", tab: "hidden", open: "c1" }));
        await openPage(rosterData([rosterChar("Alpha")], [hidden]));
        expect(screen.getByRole("radio", { name: "Alle" })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByRole("radio", { name: /Ausgeblendet \(1\)/ })).toHaveAttribute("aria-checked", "true");
        expect(names(group("Montagsraid"))).toEqual(["Gone"]);
    });

    it("writes back role, spec and list without the old category/classSpec fields, and the sort in its own store", async () => {
        window.localStorage.setItem("eh-roster-view", JSON.stringify({ category: "c1", classSpec: "Mage-Fire", role: "tank" }));
        await openPage(rosterData([rosterChar("Alpha")]));
        const user = userEvent.setup();
        await user.click(screen.getByRole("radio", { name: "Heiler" }));
        const view = stored("roster-view");
        expect(view).toMatchObject({ role: "healer", spec: "", tab: "active" });
        expect(view).not.toHaveProperty("category");
        expect(view).not.toHaveProperty("classSpec");

        await user.click(screen.getByRole("radio", { name: "Alle" }));
        await user.click(screen.getByRole("button", { name: "Anwesenheit" }));
        expect(stored("roster-sort")).toEqual({ sort: "attendance", dir: "desc" });
    });
});

describe("RosterPage — groups", () => {
    it("sorts by column head, inside each group, against that group's attendance", async () => {
        const att = (pct: number) => ({ attended: pct / 10, total: 10, pct, missed: [] });
        window.localStorage.setItem("eh-roster-view", JSON.stringify({ open: ["c1", "c2"] }));
        await openPage(rosterData([
            rosterChar("Alpha", { categoryIds: ["c1", "c2"], attendance: { c1: att(50), c2: att(100) } }),
            rosterChar("Beta", { categoryIds: ["c1", "c2"], attendance: { c1: att(90), c2: att(10) } }),
            rosterChar("Gamma", { categoryIds: ["c1"] }),
        ]));
        expect(names(group("Montagsraid"))).toEqual(["Alpha", "Beta", "Gamma"]);
        const user = userEvent.setup();
        await user.click(within(group("Montagsraid")).getByRole("button", { name: "Anwesenheit" }));
        // no counted night sorts below 0 %
        expect(names(group("Montagsraid"))).toEqual(["Beta", "Alpha", "Gamma"]);
        expect(names(group("Pug"))).toEqual(["Alpha", "Beta"]);
        await user.click(within(group("Pug")).getByRole("button", { name: "Anwesenheit" }));
        expect(names(group("Pug"))).toEqual(["Beta", "Alpha"]);
    });

    it("shows eleven rows per group before offering the rest", async () => {
        const chars = Array.from({ length: 13 }, (_, n) => rosterChar(`Char${String(n).padStart(2, "0")}`));
        await openPage(rosterData(chars));
        const user = userEvent.setup();
        expect(names(group("Montagsraid"))).toHaveLength(11);
        await user.click(screen.getByRole("button", { name: "2 weitere zeigen" }));
        expect(names(group("Montagsraid"))).toHaveLength(13);
        await user.click(screen.getByRole("button", { name: "Weniger zeigen" }));
        expect(names(group("Montagsraid"))).toHaveLength(11);
    });

    it("links WCL and Armory as icon links with a tooltip, not as text buttons", async () => {
        await openPage(rosterData([
            rosterChar("Alpha", { wclUrl: "https://wcl.example/alpha", armoryUrl: "https://armory.example/alpha" }),
            rosterChar("Beta"),
        ]));
        const wcl = screen.getByRole("link", { name: "Warcraft Logs" });
        expect(wcl).toHaveAttribute("href", "https://wcl.example/alpha");
        expect(wcl).toHaveAttribute("data-tip", "Warcraft Logs");
        expect(wcl).toHaveAttribute("target", "_blank");
        expect(screen.getByRole("link", { name: "Armory" })).toHaveAttribute("href", "https://armory.example/alpha");
        // Beta has no urls, so no links; and no text buttons anywhere
        expect(screen.getAllByRole("link", { name: "Warcraft Logs" })).toHaveLength(1);
        expect(screen.queryByText(/WCL ↗|Armory ↗/)).not.toBeInTheDocument();
    });
});

describe("RosterPage — hiding a character", () => {
    function withAlpha(): RosterData {
        return rosterData([rosterChar("Alpha"), rosterChar("Beta")]);
    }

    it("asks first, then moves the character into the hidden list without deleting anything", async () => {
        vi.mocked(api.getRoster).mockResolvedValueOnce(withAlpha()).mockReturnValue(new Promise<RosterData>(() => undefined));
        renderPage(<RosterPage />, { route: "/roster" });
        await screen.findByRole("radiogroup", { name: "Rolle" });
        const user = userEvent.setup();

        const row = (name: string) => screen.getByRole("link", { name }).closest(".ros-row") as HTMLElement;
        await user.click(within(row("Alpha")).getByRole("button", { name: "Ausblenden" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Charakter ausblenden?")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Ausblenden" }));

        await waitFor(() => expect(api.setRosterHidden).toHaveBeenCalledWith("Alpha", true));
        expect(await screen.findByText("Alpha ausgeblendet.")).toBeInTheDocument();
        expect(names(group("Montagsraid"))).toEqual(["Beta"]);

        await user.click(screen.getByRole("radio", { name: "Ausgeblendet (1)" }));
        expect(names(group("Montagsraid"))).toEqual(["Alpha"]);
        expect(screen.getByText("ausgeblendet")).toHaveAttribute("data-tip-sub", expect.stringContaining("Von Admin"));
        // putting it back needs no question
        await user.click(screen.getByRole("button", { name: "Wieder ins Roster" }));
        await waitFor(() => expect(api.setRosterHidden).toHaveBeenLastCalledWith("Alpha", false));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("does nothing when the question is cancelled", async () => {
        await openPage(withAlpha());
        const user = userEvent.setup();
        await user.click(screen.getAllByRole("button", { name: "Ausblenden" })[0]);
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Abbrechen" }));
        expect(api.setRosterHidden).not.toHaveBeenCalled();
        expect(names(group("Montagsraid"))).toEqual(["Alpha", "Beta"]);
    });

    it("offers hiding only with write access", async () => {
        const rows: RosterChar[] = [rosterChar("Alpha")];
        await openPage(rosterData(rows), READER);
        expect(screen.getByRole("link", { name: "Alpha" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Ausblenden" })).not.toBeInTheDocument();
        // nobody hidden and no right to hide: no list switch either
        expect(screen.queryByRole("radiogroup", { name: "Liste" })).not.toBeInTheDocument();
    });
});
