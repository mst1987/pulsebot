// The "Groups" bar of the read view /p/<token> (#512): a chip highlights its group — the raiders of the other groups
// dim on the map (group markers with their ring and members, role slots, free tokens) and in the group heal table —
// a second click ends it. Nothing of it is saved; "Only for me" and the highlight work side by side.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { RaidplanPlayer, RaidplanPublic, RaidplanPublicBoss, RaidplanSlot } from "../api";
import PlanPublicPage from "./PlanPublicPage";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getRaidplanPublic: vi.fn(),
}));

const player = (userId: string, character: string, group: number): RaidplanPlayer => ({ userId, character, classId: "Priest", className: "Priest", classColor: "", spec: "", specLabel: "", role: "healer", iconUrl: "", group });
const slot = (kind: RaidplanSlot["kind"], n: number, x: number, y: number, userId = ""): RaidplanSlot => ({ id: `${kind}${n}`, kind, n, label: "", x, y, userId, size: 0, hideMembers: false, split: false, offsets: {}, opacity: 1, lock: false, hidden: false });

function plan(): RaidplanPublic {
    const boss: RaidplanPublicBoss = {
        key: "bt/supremus", name: "Supremus", instanceName: "Black Temple", iconUrl: "", mapUrl: "", trash: false, general: false,
        tokens: [{ userId: "u3", x: 0.7, y: 0.2, size: 0, opacity: 1, lock: false, hidden: false }],
        slots: [slot("group", 1, 0.2, 0.8), slot("group", 2, 0.5, 0.8), slot("group", 3, 0.8, 0.8), slot("healer", 1, 0.3, 0.3, "u2")],
        marks: [], icons: [], zones: [], lines: [], texts: [], targets: [],
        assignments: [
            { id: "h1", type: "heal", title: "", spell: null, assignees: ["user:u1"], targets: [{ kind: "group", ref: "2" }, { kind: "group", ref: "3" }], note: "", suggested: false },
            { id: "h2", type: "heal", title: "", spell: null, assignees: ["slot:healer:1"], targets: [{ kind: "group", ref: "1" }], note: "", suggested: false },
        ],
        notes: "", profileName: "", mapOpacity: 1, objectScale: 1,
    };
    return {
        event: { title: "BT", startTime: 0 }, bosses: [boss], roster: [player("u1", "Heilbert", 1), player("u2", "Lichtbringer", 2), player("u3", "Flutwelle", 3), player("u4", "Bank", 0)],
        me: "u1", meIds: ["u1"], catalog: { mobs: [], spells: [] }, loggedIn: true,
    };
}

async function open() {
    vi.mocked(api.getRaidplanPublic).mockResolvedValue({ data: plan(), etag: "" });
    const r = render(<PlanPublicPage token="abc" />);
    const bar = await screen.findByRole("group", { name: "Gruppen" });
    return { r, bar, chip: (n: number) => within(bar).getByRole("button", { name: new RegExp(`Gruppe ${n}`) }) };
}

/** the group markers on the map, in the order of their number */
const wraps = (c: HTMLElement) => Array.from(c.querySelectorAll(".rp-board .rp-groupwrap"));
const rowOf = (c: HTMLElement, n: number) => Array.from(c.querySelectorAll(".rp-rtable tr")).find((tr) => tr.querySelector(".rp-gnum")?.textContent === `Gruppe ${n}`) as HTMLElement;

// jsdom has no ResizeObserver; the board only reads its size through it
class NoResize { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", NoResize);

beforeEach(() => vi.mocked(api.getRaidplanPublic).mockReset());

describe("PlanPublicPage — highlighting a group (#512)", () => {
    it("nothing is dimmed until a chip is clicked", async () => {
        const { r } = await open();
        expect(r.container.querySelectorAll(".rp-gdim")).toHaveLength(0);
        expect(wraps(r.container)).toHaveLength(3);
    });

    it("a chip highlights its group: the other groups' markers, role slots, tokens and table rows dim", async () => {
        const { r, chip } = await open();
        await userEvent.click(chip(3));
        expect(chip(3)).toHaveAttribute("aria-pressed", "true");
        const [g1, g2, g3] = wraps(r.container);
        expect(g1).toHaveClass("rp-gdim");
        expect(g2).toHaveClass("rp-gdim");
        expect(g3).toHaveClass("is-focus");
        expect(g3).not.toHaveClass("rp-gdim");
        // the healer slot of group 2 dims, the free token of group 3 stays bright
        expect(r.container.querySelector('.rp-board [data-slot="healer1"]')).toHaveClass("rp-gdim");
        expect(r.container.querySelector('.rp-board [data-obj="token:u3"]')).toHaveClass("is-focus");
        expect(r.container.querySelector('.rp-board [data-obj="token:u3"]')).not.toHaveClass("rp-gdim");
        // the group heal table
        expect(rowOf(r.container, 1)).toHaveClass("rp-gdim");
        expect(rowOf(r.container, 2)).toHaveClass("rp-gdim");
        expect(rowOf(r.container, 3)).toHaveClass("is-focus");
    });

    it("clicking the active chip again ends it; another chip moves it", async () => {
        const { r, chip } = await open();
        await userEvent.click(chip(2));
        expect(wraps(r.container)[1]).toHaveClass("is-focus");
        await userEvent.click(chip(1));
        expect(wraps(r.container)[0]).toHaveClass("is-focus");
        expect(wraps(r.container)[1]).toHaveClass("rp-gdim");
        await userEvent.click(chip(1));
        expect(chip(1)).toHaveAttribute("aria-pressed", "false");
        expect(r.container.querySelectorAll(".rp-gdim, .rp-board .is-focus")).toHaveLength(0);
    });

    it("works together with \"Only for me\": the map keeps the highlight, the own blocks stay", async () => {
        const { r, chip } = await open();
        await userEvent.click(chip(2));
        await userEvent.click(screen.getByRole("button", { name: /Nur für mich/ }));
        expect(wraps(r.container)[1]).toHaveClass("is-focus");
        expect(wraps(r.container)[0]).toHaveClass("rp-gdim");
        // the tables of everyone are gone, the own block is there
        expect(r.container.querySelector(".rp-rtable")).toBeNull();
        expect(r.container.querySelector(".rp-personal")).not.toBeNull();
        await userEvent.click(chip(2));
        expect(r.container.querySelectorAll(".rp-gdim")).toHaveLength(0);
    });
});
