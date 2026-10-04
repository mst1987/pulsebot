// The read view /p/<token> as a stage ("Karte als Bühne"): one bar with the open section, its arrows and "Alle N Abschnitte";
// the map under it; "Deine Aufgaben" floating over the map and "Alle Aufgaben" behind a tab on the right edge. A section
// without a map shows card and tables in the page's flow.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { RaidplanAssignment, RaidplanPlayer, RaidplanPublic, RaidplanPublicBoss } from "../api";
import PlanPublicPage from "./PlanPublicPage";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getRaidplanPublic: vi.fn(),
}));
// jsdom has no ResizeObserver; the board and the stage only read their size through it
class NoResize { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", NoResize);

const player = (userId: string, character: string, group: number, role = "melee"): RaidplanPlayer => ({ userId, character, classId: "Rogue", className: "Rogue", classColor: "", spec: "", specLabel: "", role, iconUrl: "", group });
const heal = (id: string, who: string, group: string): RaidplanAssignment => ({ id, type: "heal", title: "", spell: null, assignees: [`user:${who}`], targets: [{ kind: "group", ref: group }], note: "", suggested: false });
function section(key: string, name: string, instanceName: string, assignments: RaidplanAssignment[], extra: Partial<RaidplanPublicBoss> = {}): RaidplanPublicBoss {
    return {
        key, name, instanceName, iconUrl: "", mapUrl: "", trash: false, general: false,
        tokens: [], slots: [], marks: [], icons: [], zones: [], lines: [], texts: [], targets: [], assignments,
        notes: "", profileName: "", mapOpacity: 1, objectScale: 1, ...extra,
    };
}
function plan(me: string): RaidplanPublic {
    return {
        event: { title: "Hyjal + BT", startTime: 0 },
        bosses: [
            section("general", "Allgemein", "", [], { general: true, notes: "Flasks mitbringen" }),
            // Muhcola heals the visitor's group: it acts on him, he has nothing of his own here
            section("bt/najentus", "Najentus", "Black Temple", [heal("h1", "u2", "1")], { notes: "Spines" }),
            // the visitor heals group 2 himself
            section("bt/supremus", "Supremus", "Black Temple", [heal("h2", "u1", "2")]),
            section("hyjal/anetheron", "Anetheron", "Hyjal", []),
        ],
        roster: [player("u1", "Dvra", 1), player("u2", "Muhcola", 5, "healer")],
        me, meIds: me ? [me] : [], catalog: { mobs: [], spells: [] }, loggedIn: !!me,
    };
}

async function open(at = "bt/najentus", me = "u1") {
    window.history.replaceState(null, "", `/p/abc#boss=${at}`);
    vi.mocked(api.getRaidplanPublic).mockResolvedValue({ data: plan(me), etag: "" });
    const r = render(<PlanPublicPage token="abc" />);
    await screen.findByRole("heading", { level: 1 });
    return r;
}
const heading = () => screen.getByRole("heading", { level: 1 });
const card = () => screen.getByRole("region", { name: /Deine Aufgaben/ });

beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(api.getRaidplanPublic).mockReset();
});

describe("the bar", () => {
    it("names the open section with its place and steps to its neighbours", async () => {
        await open();
        expect(heading()).toHaveTextContent("Najentus");
        expect(screen.getByText("Black Temple · Boss 1 von 2")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Nächster Abschnitt: Supremus" }));
        expect(heading()).toHaveTextContent("Supremus");
        await userEvent.click(screen.getByRole("button", { name: "Vorheriger Abschnitt: Najentus" }));
        expect(heading()).toHaveTextContent("Najentus");
    });

    it("the last section has no next arrow to press", async () => {
        await open("hyjal/anetheron");
        const arrows = screen.getByRole("banner").querySelectorAll(".rp-sheet-arrow");
        expect(arrows[1]).toBeDisabled();
    });

    it("lists every section by instance, says where the visitor has a task, and closes on a pick", async () => {
        await open();
        await userEvent.click(screen.getByRole("button", { name: /Alle 4 Abschnitte/ }));
        const menu = screen.getByRole("dialog", { name: "Abschnitte" });
        expect(within(menu).getByText("Black Temple")).toBeInTheDocument();
        expect(within(menu).getByText("Hyjal")).toBeInTheDocument();
        expect(within(menu).getByRole("button", { name: /Najentus/ })).toHaveAttribute("aria-current", "true");
        expect(within(menu).getByRole("button", { name: /Supremus/ })).toHaveTextContent("Aufgabe für dich");
        await userEvent.click(within(menu).getByRole("button", { name: /Anetheron/ }));
        expect(heading()).toHaveTextContent("Anetheron");
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("Esc closes the section menu", async () => {
        await open();
        await userEvent.click(screen.getByRole("button", { name: /Alle 4 Abschnitte/ }));
        await userEvent.keyboard("{Escape}");
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});

describe("Deine Aufgaben", () => {
    it("says when the visitor has nothing of his own and who acts on him", async () => {
        await open();
        expect(card()).toHaveTextContent("Dvra");
        expect(card()).toHaveTextContent("Gruppe 1");
        expect(card()).toHaveTextContent("Bei diesem Boss hast du keine eigene Aufgabe.");
        expect(card()).toHaveTextContent("Wirkt auf dich");
        expect(card()).toHaveTextContent("Muhcola");
    });

    it("shows his own task and links the other sections where he has one", async () => {
        await open();
        await userEvent.click(within(card()).getByRole("button", { name: /Supremus/ }));
        expect(heading()).toHaveTextContent("Supremus");
        expect(card()).toHaveTextContent("Du machst");
        expect(card()).not.toHaveTextContent("keine eigene Aufgabe");
    });

    it("folds to its head and opens again", async () => {
        await open();
        await userEvent.click(within(card()).getByRole("button", { name: "Deine Aufgaben einklappen" }));
        expect(card()).not.toHaveTextContent("Wirkt auf dich");
        await userEvent.click(within(card()).getByRole("button", { name: "Deine Aufgaben aufklappen" }));
        expect(card()).toHaveTextContent("Wirkt auf dich");
    });

    it("without a login it is the login hint", async () => {
        await open("bt/najentus", "");
        const note = screen.getByRole("region", { name: "Meine Aufgaben" });
        expect(within(note).getByRole("link", { name: "Mit Discord anmelden" })).toHaveAttribute("href", "/auth/login?next=/p/abc");
    });
});

describe("Alle Aufgaben", () => {
    it("opens as a panel with the note and the tables, without the visitor's own part, and closes again", async () => {
        const r = await open();
        expect(screen.queryByText("Spines")).toBeNull();
        await userEvent.click(screen.getByRole("button", { name: /Alle Aufgaben/ }));
        const panel = screen.getByRole("complementary", { name: "Alle Aufgaben" });
        expect(within(panel).getByText("Spines")).toBeInTheDocument();
        expect(panel.querySelector(".rp-rtable")).not.toBeNull();
        expect(panel.querySelector(".rp-personal")).toBeNull();
        await userEvent.click(within(panel).getByRole("button", { name: "Schließen" }));
        expect(screen.queryByRole("complementary")).toBeNull();
        expect(r.container.querySelector(".rp-sheet-tab")).not.toBeNull();
    });

    it("a section without a map shows card and tables in the page, without tab or close button", async () => {
        const r = await open("general");
        expect(r.container.querySelector(".rp-sheet-stage")).toBeNull();
        expect(r.container.querySelector(".rp-sheet-tab")).toBeNull();
        const panel = screen.getByRole("complementary", { name: "Alle Aufgaben" });
        expect(within(panel).getByText("Flasks mitbringen")).toBeInTheDocument();
        expect(within(panel).queryByRole("button", { name: "Schließen" })).toBeNull();
        expect(card()).toBeInTheDocument();
    });
});
