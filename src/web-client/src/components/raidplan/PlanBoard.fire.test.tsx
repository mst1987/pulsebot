// Fire zones, entrances and turned zones on the board
import { render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RaidplanZone } from "../../api";
import PlanBoard from "./PlanBoard";

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
    id, shape: "rect", type: "fire", label: "", color: "#4fa82a", x: 0.3, y: 0.2, w: 0.4, h: 0.1,
    rotation: 0, opacity: 0.35, lock: false, hidden: false, ...extra,
} as RaidplanZone);
const board = (zones: RaidplanZone[], edit = false) => render(
    <PlanBoard bossName="Boss" bossIcon="" mapUrl="" tokens={[]} zones={zones} players={new Map()}
        {...(edit ? { selected: { kind: "zone" as const, id: zones[0].id }, onObjectDown: vi.fn() } : {})} />,
);
const at = (c: HTMLElement, id: string) => c.querySelector(`.rp-zone[data-zone='${id}']`) as HTMLElement;

describe("a fire zone", () => {
    it("draws in its own colour with the fire class, without a glyph badge when it has no name", () => {
        const { container } = board([zone("f", { color: "#3b82f6" })]);
        const f = at(container, "f");
        expect(f).toHaveClass("rp-zone-fire");
        expect(f.style.getPropertyValue("--zc")).toBe("#3b82f6");
        expect(f.querySelector(".rp-zone-label")).toBeNull();
    });
    it("shows its name when it has one", () => {
        const { container } = board([zone("f", { label: "Fel Fire" })]);
        expect(at(container, "f").querySelector(".rp-zone-label")).toHaveTextContent("Fel Fire");
    });
    it("any other zone still gets its glyph badge", () => {
        const { container } = board([zone("d", { type: "danger", color: "#e5484d" })]);
        expect(at(container, "d").querySelector(".rp-zone-label.is-glyph")).not.toBeNull();
    });
});

describe("turning and revealing a zone", () => {
    it("turns any zone, not only a role group", () => {
        const { container } = board([zone("f", { rotation: 30 })]);
        expect(at(container, "f").style.transform).toBe("rotate(30deg)");
    });
    it("clips a zone that is still coming in from its side", () => {
        const { container } = board([zone("f", { enter: "w", reveal: 0.25 })]);
        expect(at(container, "f").style.clipPath).toBe("inset(0 75% 0 0)");
    });
    it("does not clip a zone that is all there", () => {
        const { container } = board([zone("f", { enter: "w", reveal: 1 }), zone("g", { enter: "w" })]);
        expect(at(container, "f").style.clipPath).toBe("");
        expect(at(container, "g").style.clipPath).toBe("");
    });
    it("a selected zone of any type gets the turning grip in the editor", () => {
        const { container } = board([zone("f", {})], true);
        expect(at(container, "f").querySelector(".rp-h-zrot")).not.toBeNull();
    });
});
