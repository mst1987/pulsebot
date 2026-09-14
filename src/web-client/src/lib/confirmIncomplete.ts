import { createElement } from "react";
import { RAID_INCOMPLETE, type IncompleteRaidError } from "../api";
import type { ConfirmFn } from "../components/ui/Modal";
import IncompleteRaid from "../components/IncompleteRaid";
import { raidIcon } from "./logRaids";

// The admin-menu half of the "is this raid actually over?" guard (the rule
// itself lives in src/utils/logcheck/raidProgress.js).
//
// An evaluation of a raid whose final boss is still standing is refused rather
// than silently produced — but it is a question, not a verdict: raids do get
// called off, and then the numbers of the part that happened are what there is.
// So the refusal comes back as an asking error carrying the raids and their
// bosses, and this turns it into the actual question — the "Raid noch nicht
// abgeschlossen" dialog with the boss grid — then repeats the call with force.

/**
 * Run an evaluation, asking before it goes ahead over a raid that is still
 * running. `ask` is the caller's useConfirm(); `run` receives whether to force;
 * everything else is passed through untouched, including any other error.
 */
export async function withIncompleteConfirm<T>(ask: ConfirmFn, run: (force: boolean) => Promise<T>): Promise<T> {
    try {
        return await run(false);
    } catch (err) {
        const refusal = err as IncompleteRaidError;
        if (refusal.code !== RAID_INCOMPLETE) throw err;
        const message = refusal.message || "Der Raid sieht noch nicht abgeschlossen aus.";
        const pending = (refusal.raids || []).find((r) => !r.finalKilled);
        const go = await ask({
            title: "Raid noch nicht abgeschlossen",
            text: createElement(IncompleteRaid, { raids: refusal.raids, message }),
            action: "Trotzdem auswerten",
            tone: "run",
            icon: pending ? raidIcon(pending.contentId) : "inv_misc_pocketwatch_01",
        });
        if (!go) {
            // Deliberately an error: it ends the job's toast as "abgebrochen"
            // rather than reporting a report that was never built.
            throw { code: "cancelled", message: "Abgebrochen — der Raid läuft noch." } as IncompleteRaidError;
        }
        return run(true);
    }
}
