// The loading scene (RaidLoader.tsx): one scene per wait — the loading states a
// page passes through in a row (shell code, page code, page data, a tab) keep
// party, boss and rhythm instead of reshuffling, and only the first loader of a
// wait fades in late.
import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../../i18n";
import RaidLoader, { CHAIN_MS, resetLoaderScene } from "../RaidLoader";
import { bossesFor } from "../../../../lib/wow/loaderBosses";
import { ContentVersionContext, type ContentVersionState } from "../../../../hooks/useContentVersion";
import { LAST_VERSION_KEY } from "../../../../lib/app/contentVersion";

/** The party and boss a loader draws, as one line of names. */
const sceneOf = (el: HTMLElement) => [...el.querySelectorAll(".rl-name")].map((n) => n.textContent).join(",");
const loaderIn = (container: HTMLElement) => container.querySelector<HTMLElement>(".rl")!;
/** The boss a loader draws: the last name of the scene. */
const bossOf = (container: HTMLElement) => [...container.querySelectorAll(".rl-name")].pop()!.textContent;
const partyOf = (container: HTMLElement) => [...container.querySelectorAll(".rl-name")].slice(0, -1).map((n) => n.textContent).join(",");

/** A loader inside the shell, showing `version`. */
function inVersion(version: string, ui: ReactNode) {
    const value: ContentVersionState = {
        version, mainVersion: version, hidden: false, versions: [],
        setVersion: () => undefined, refresh: () => Promise.resolve(),
    };
    return <ContentVersionContext.Provider value={value}>{ui}</ContentVersionContext.Provider>;
}

beforeEach(() => {
    resetLoaderScene();
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); });

describe("RaidLoader per version", () => {
    it("draws a boss of the version the menu shows", () => {
        const forever = bossesFor("forever").map((b) => b.label);
        for (let i = 0; i < 30; i++) {
            resetLoaderScene();
            const { container, unmount } = render(inVersion("forever", <RaidLoader />));
            expect(forever).toContain(bossOf(container));
            unmount();
        }
    });

    it("before the shell knows the version, takes the one shown last in this browser", () => {
        localStorage.setItem(LAST_VERSION_KEY, "forever");
        const forever = bossesFor("forever").map((b) => b.label);
        for (let i = 0; i < 30; i++) {
            resetLoaderScene();
            const { container, unmount } = render(<RaidLoader />);
            expect(forever).toContain(bossOf(container));
            unmount();
        }
    });

    it("keeps the party but draws a boss of the new version when the wait turns to another version", () => {
        const first = render(inVersion("tbc", <RaidLoader />));
        const party = partyOf(first.container);
        expect(bossesFor("tbc").map((b) => b.label)).toContain(bossOf(first.container));
        const next = render(inVersion("forever", <RaidLoader />));
        expect(partyOf(next.container)).toBe(party);
        expect(bossesFor("forever").map((b) => b.label)).toContain(bossOf(next.container));
        expect(loaderIn(next.container)).not.toHaveClass("rl-fresh");
    });
});

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
