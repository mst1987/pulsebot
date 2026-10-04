// The loading scene (RaidLoader.tsx): one scene per wait — the loading states a
// page passes through in a row (shell code, page code, page data, a tab) keep
// party, boss and rhythm instead of reshuffling, and only the first loader of a
// wait fades in late.
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import RaidLoader, { CHAIN_MS, resetLoaderScene } from "./RaidLoader";

/** The party and boss a loader draws, as one line of names. */
const sceneOf = (el: HTMLElement) => [...el.querySelectorAll(".rl-name")].map((n) => n.textContent).join(",");
const loaderIn = (container: HTMLElement) => container.querySelector<HTMLElement>(".rl")!;

beforeEach(() => {
    resetLoaderScene();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); });

describe("RaidLoader", () => {
    it("keeps the scene when one loading state hands over to the next", () => {
        // a run of reshuffles would almost surely differ at least once
        const first = render(<RaidLoader text="Menü wird geladen" />);
        const scene = sceneOf(loaderIn(first.container));
        expect(loaderIn(first.container)).toHaveClass("rl-fresh");
        for (let i = 0; i < 12; i++) {
            const next = render(<RaidLoader compact={i % 2 === 1} />);
            expect(sceneOf(loaderIn(next.container))).toBe(scene);
            // only the first of a wait fades in late
            expect(loaderIn(next.container)).not.toHaveClass("rl-fresh");
            next.unmount();
        }
        first.unmount();
        // the page's data loader comes a moment after the code loader left: still the same wait
        vi.setSystemTime(Date.now() + CHAIN_MS - 100);
        const data = render(<RaidLoader text="Raid wird geladen" />);
        expect(sceneOf(loaderIn(data.container))).toBe(scene);
        expect(loaderIn(data.container)).not.toHaveClass("rl-fresh");
    });

    it("starts a new wait — and may draw a new scene — once no loader was up for a while", () => {
        const first = render(<RaidLoader />);
        first.unmount();
        vi.setSystemTime(Date.now() + CHAIN_MS + 500);
        const later = render(<RaidLoader />);
        expect(loaderIn(later.container)).toHaveClass("rl-fresh");
    });

    it("keeps the wait's line where a loader has none of its own — a new wait says the default", () => {
        const menu = render(<RaidLoader text="Menü wird geladen" />);
        menu.unmount();
        const chunk = render(<RaidLoader />);
        expect(chunk.container.querySelector(".rl-caption")).toHaveTextContent("Menü wird geladen");
        chunk.unmount();
        const data = render(<RaidLoader text="Raid wird geladen" />);
        expect(data.container.querySelector(".rl-caption")).toHaveTextContent("Raid wird geladen");
        data.unmount();

        vi.setSystemTime(Date.now() + CHAIN_MS + 500);
        const fresh = render(<RaidLoader />);
        expect(fresh.container.querySelector(".rl-caption")).toHaveTextContent(t("common.loading"));
    });

    it("takes the animation's phase from the clock, so a replacing loader runs on", () => {
        const now = Date.now();
        const { container } = render(<RaidLoader />);
        expect(loaderIn(container).style.getPropertyValue("--rl-phase")).toBe(`${-(now % 15400)}ms`);
    });
});
