// A council pick of another game version (#741/#563). The server answers a
// roster or a category that does not play the menu's version with "Alle
// Raid-Kategorien" of that version and names the pick in `council.dropped`
// (web/loot/councilQuery.js pageCouncilOpts). The page then either follows a
// link into the pick's version - the same rule as every other link to a record
// of another version (hooks/useFollowVersion.ts) - or forgets the pick, so the
// picker shows the first entry the version offers instead of a stale one.
import { useEffect } from "react";
import type { CouncilHead } from "../../../api";
import { useContentVersion } from "../../../hooks/useContentVersion";
import { useFollowVersion } from "../../../hooks/useFollowVersion";

export type DroppedPick = NonNullable<CouncilHead["dropped"]>;

/**
 * What the page does with a dropped pick: "follow" a roster a link just opened
 * (`linked`) when the menu offers its version, else "reset" to "Alle
 * Raid-Kategorien" - a stale pick from before the menu was switched, or a
 * version hidden in the settings. "none" without a dropped pick.
 */
export function droppedPickStep(dropped: DroppedPick | null | undefined, { linked, offered }: { linked: string; offered: string[] }): "follow" | "reset" | "none" {
    if (!dropped) return "none";
    if (dropped.kind === "roster" && linked && dropped.id === linked && offered.includes(dropped.versionId)) return "follow";
    return "reset";
}

/** Follows or forgets a dropped pick (see above); `onReset` clears the pick. */
export function useDroppedPick(dropped: DroppedPick | null | undefined, linked: string, onReset: () => void): void {
    const { versions } = useContentVersion();
    const step = droppedPickStep(dropped, { linked, offered: versions.map((v) => v.id) });
    useFollowVersion(step === "follow" && dropped ? dropped.versionId : "");
    const key = dropped ? `${dropped.kind}:${dropped.id}` : "";
    useEffect(() => {
        if (step === "reset") onReset();
        // Only another dropped pick is a reason to act again.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, key]);
}
