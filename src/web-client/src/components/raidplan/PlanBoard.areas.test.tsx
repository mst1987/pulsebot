// Role group areas in two styles (#559, docs/raidplan/board.md "Role group areas: calm or arc"): calm (light fill, thin line - dashed for
// ranged -, the badge with symbol, label and count on the top edge, names inside) and arc (a ring / arc band drawn as SVG, the badge on
// its outer edge, the names along the band). The editor and the read view /p/<token> draw them with the same board.
import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { RaidplanPlayer, RaidplanPublic, RaidplanPublicBoss, RaidplanZone } from "../../api";
import PlanBoard from "./PlanBoard";
import PlanPublicPage from "../../pages/raidplan/PlanPublicPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRaidplanPublic: vi.fn(),
}));

// jsdom lays nothing out: the board reads its width once (clientWidth) and never hears from a ResizeObserver
class NoResize { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", NoResize);
const widths = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const heights = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 625 });
});
afterAll(() => {
    if (widths) Object.defineProperty(HTMLElement.prototype, "clientWidth", widths);
    if (heights) Object.defineProperty(HTMLElement.prototype, "clientHeight", heights);
});

const zone = (id: string, extra: Partial<RaidplanZone>): RaidplanZone => ({
    id, shape: "ellipse", type: "role", role: "melee", label: "", color: "#f97316", x: 0.3, y: 0.2, w: 0.4, h: 0.5, count: 0, showNames: false,
    rotation: 0, iconScale: 1, labelPos: "in", opacity: 0.35, lock: false, hidden: false, ...extra,
} as RaidplanZone);
const player = (userId: string, character: string, role: string): RaidplanPlayer => ({ userId, character, classId: "Rogue", className: "Rogue", classColor: "", spec: "", specLabel: "", role, iconUrl: "", group: 1 }) as RaidplanPlayer;
const roster = [player("u1", "Kargoth", "melee"), player("u2", "Vexa", "melee"), player("u3", "Liora", "ranged")];

function board(zones: RaidplanZone[]) {
    return render(<PlanBoard bossName="Boss" bossIcon="" mapUrl="" tokens={[]} zones={zones} players={new Map()} roster={roster} />);
}

describe("a role group area, calm (the default)", () => {
    it("an area stored before the style existed is calm: a light area, the badge with symbol, role name and count, the names inside", () => {
        const { container } = board([zone("m", { count: 8, showNames: true })]);
        const area = container.querySelector(".rp-zone[data-zone='m']") as HTMLElement;
        expect(area).toHaveClass("is-calm");
        expect(area).not.toHaveClass("is-dashed");
        expect(area.querySelector(".rp-arc")).toBeNull();
        const up = container.querySelector(".rp-rg-up") as HTMLElement;
        expect(up).toHaveClass("is-calm");
        const badge = up.querySelector(".rp-rg-badge") as HTMLElement;
        expect(badge.querySelector(".rp-rg-bico")).not.toBeNull();
        expect(badge.querySelector(".rp-rg-btext")).toHaveTextContent("Melees");
        expect(badge.querySelector(".rp-rg-bcount")).toHaveTextContent("8");
        expect(up.querySelector(".rp-rg-inner .rp-rg-names")).toHaveTextContent(/Kargoth.*Vexa/);
        // the badge's measures and the zone colour come as custom properties, nothing is set inline besides them
        expect(up.style.getPropertyValue("--rp-bf")).toMatch(/px$/);
        expect(up.style.getPropertyValue("--zc")).toBe("#f97316");
    });

    it("a written label replaces the role's name, no count badge at 0; ranged draws a dashed line", () => {
        const { container } = board([zone("r", { role: "ranged", color: "#a78bfa", label: "Fernkampf" })]);
        expect(container.querySelector(".rp-zone[data-zone='r']")).toHaveClass("is-calm", "is-dashed");
        expect(container.querySelector(".rp-rg-btext")).toHaveTextContent("Fernkampf");
        expect(container.querySelector(".rp-rg-bcount")).toBeNull();
    });

    it("a cluster of symbols stays as it was (no area style, its label place)", () => {
        const { container } = board([zone("c", { shape: "cluster", areaStyle: "arc", label: "Pack", labelPos: "top" })]);
        const area = container.querySelector(".rp-zone[data-zone='c']") as HTMLElement;
        expect(area).not.toHaveClass("is-calm");
        expect(area).not.toHaveClass("is-arc");
        expect(container.querySelector(".rp-rg-badge")).toBeNull();
        expect(container.querySelector(".rp-rg-label.is-out.is-top")).toHaveTextContent("Pack");
    });
});

describe("a role group area as an arc", () => {
    it("melee: a closed ring (two ellipses), the badge at its top, the names along the band", () => {
        const { container } = board([zone("m", { areaStyle: "arc", arcSpan: 360, showNames: true, count: 2 })]);
        const area = container.querySelector(".rp-zone[data-zone='m']") as HTMLElement;
        expect(area).toHaveClass("is-arc");
        const path = area.querySelector("svg.rp-arc path.rp-arc-band") as SVGPathElement;
        expect(path.getAttribute("d")!.match(/M /g)).toHaveLength(2);
        const up = container.querySelector(".rp-rg-up") as HTMLElement;
        expect(up).toHaveClass("is-arc");
        const badge = up.querySelector(".rp-rg-badge") as HTMLElement;
        // the ring's top: straight above the middle
        expect(parseFloat(badge.style.getPropertyValue("--rp-dx"))).toBeCloseTo(0, 0);
        expect(parseFloat(badge.style.getPropertyValue("--rp-dy"))).toBeLessThan(0);
        const chips = up.querySelectorAll(".rp-rg-at");
        expect(Array.from(chips).map((c) => c.textContent)).toEqual(["Kargoth", "Vexa"]);
        for (const c of Array.from(chips)) expect((c as HTMLElement).style.getPropertyValue("--rp-dx")).toMatch(/px$/);
    });

    it("ranged: an arc band (one outline), dashed, its badge in the middle of the arc - below the centre until the area is turned", () => {
        const { container, rerender } = board([zone("r", { role: "ranged", color: "#a78bfa", areaStyle: "arc", arcSpan: 140 })]);
        const area = container.querySelector(".rp-zone[data-zone='r']") as HTMLElement;
        expect(area).toHaveClass("is-arc", "is-dashed");
        expect(area.querySelector("path.rp-arc-band")!.getAttribute("d")!.match(/M /g)).toHaveLength(1);
        const dy = () => parseFloat((container.querySelector(".rp-rg-badge") as HTMLElement).style.getPropertyValue("--rp-dy"));
        expect(dy()).toBeGreaterThan(0);
        rerender(<PlanBoard bossName="Boss" bossIcon="" mapUrl="" tokens={[]} zones={[zone("r", { role: "ranged", areaStyle: "arc", arcSpan: 140, rotation: 180 })]} players={new Map()} roster={roster} />);
        expect(dy()).toBeLessThan(0);
    });
});

describe("the read view draws both styles like the editor", () => {
    beforeEach(() => vi.mocked(api.getRaidplanPublic).mockReset());
    it("calm and arc areas on /p/<token>", async () => {
        const boss: RaidplanPublicBoss = {
            key: "bt/supremus", name: "Supremus", instanceName: "Black Temple", iconUrl: "", mapUrl: "", trash: false, general: false,
            tokens: [], slots: [], marks: [], icons: [], lines: [], texts: [], targets: [], assignments: [],
            zones: [zone("m", { areaStyle: "arc", arcSpan: 360 }), zone("r", { role: "ranged", color: "#a78bfa", y: 0.1, h: 0.2 })],
            notes: "", profileName: "", mapOpacity: 1, objectScale: 1,
        } as unknown as RaidplanPublicBoss;
        const data = { event: { title: "BT", startTime: 0 }, bosses: [boss], roster, me: "", meIds: [], catalog: { mobs: [], spells: [] }, loggedIn: false } as unknown as RaidplanPublic;
        vi.mocked(api.getRaidplanPublic).mockResolvedValue({ data, etag: "" });
        const { container } = render(<PlanPublicPage token="abc" />);
        await screen.findAllByText("Supremus");
        const sheet = container.querySelector(".rp-board") as HTMLElement;
        expect(sheet.querySelector(".rp-zone[data-zone='m']")).toHaveClass("is-arc");
        expect(sheet.querySelector(".rp-zone[data-zone='m'] path.rp-arc-band")).not.toBeNull();
        expect(sheet.querySelector(".rp-zone[data-zone='r']")).toHaveClass("is-calm", "is-dashed");
        expect(sheet.querySelectorAll(".rp-rg-badge")).toHaveLength(2);
        // the same markup as the editor's board for the same zones
        const editor = board(boss.zones as RaidplanZone[]).container;
        expect(sheet.querySelector(".rp-zone[data-zone='m'] path")!.getAttribute("d")).toBe(editor.querySelector(".rp-zone[data-zone='m'] path")!.getAttribute("d"));
    });
});
