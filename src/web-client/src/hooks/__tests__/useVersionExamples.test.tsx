import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getLang, setLang } from "../../i18n";
import type { VersionExamples } from "../../lib/app/versionExamples";
import { ContentVersionContext, type ContentVersionState } from "../useContentVersion";
import { useVersionExamples } from "../useVersionExamples";

const CLASSIC: VersionExamples = {
    short: "MC + Ony", tag: "mc-ony",
    de: { raid: "Geschmolzener Kern", raids: "Geschmolzener Kern + Onyxias Hort", item: "Erheblicher Manatrank" },
    en: { raid: "Molten Core", raids: "Molten Core + Onyxia's Lair", item: "Major Mana Potion" },
};
const FOREVER: VersionExamples = {
    short: "Barrow", tag: "barrow",
    de: { raid: "Barrow Deeps", raids: "Barrow Deeps", item: "Manatrank" },
    en: { raid: "Barrow Deeps", raids: "Barrow Deeps", item: "Mana Potion" },
};

function shell(version: string) {
    const state: ContentVersionState = {
        version, mainVersion: "forever", hidden: false,
        versions: [
            { id: "forever", label: "WoW Forever", short: "Forever", examples: FOREVER },
            { id: "classic", label: "Classic Era", short: "Classic", examples: CLASSIC },
        ],
        setVersion: () => undefined,
        refresh: () => Promise.resolve(),
    };
    return ({ children }: { children: ReactNode }) => <ContentVersionContext.Provider value={state}>{children}</ContentVersionContext.Provider>;
}

describe("useVersionExamples", () => {
    const lang = getLang();
    afterEach(() => { act(() => setLang(lang)); });

    it("follows the version the menu shows", () => {
        const { result } = renderHook(() => useVersionExamples(), { wrapper: shell("classic") });
        expect(result.current.short).toBe("MC + Ony");
        expect(result.current.tag).toBe("mc-ony");
    });

    it("prefers the version the form has chosen", () => {
        const { result } = renderHook(() => useVersionExamples({ examples: CLASSIC }), { wrapper: shell("forever") });
        expect(result.current.short).toBe("MC + Ony");
    });

    it("falls back to the main version, first in the list, when none is shown", () => {
        const { result } = renderHook(() => useVersionExamples(null), { wrapper: shell("") });
        expect(result.current.short).toBe("Barrow");
    });

    it("answers in the language of the web admin", async () => {
        const { result } = renderHook(() => useVersionExamples(), { wrapper: shell("classic") });
        act(() => setLang("de"));
        await waitFor(() => expect(result.current.raids).toBe("Geschmolzener Kern + Onyxias Hort"));
        act(() => setLang("en"));
        await waitFor(() => expect(result.current.raids).toBe("Molten Core + Onyxia's Lair"));
    });

    it("stays neutral outside the shell, without any raid of a version", () => {
        const { result } = renderHook(() => useVersionExamples());
        expect(result.current).toEqual({ short: "Raid", tag: "raid", raid: "Raid", raids: "Raid" });
    });
});
