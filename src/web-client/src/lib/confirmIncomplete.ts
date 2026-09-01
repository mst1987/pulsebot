import { RAID_INCOMPLETE, type ApiError } from "../api";

// The admin-menu half of the "is this raid actually over?" guard (the rule
// itself lives in src/utils/logcheck/raidProgress.js).
//
// An evaluation of a raid whose final boss is still standing is refused rather
// than silently produced — but it is a question, not a verdict: raids do get
// called off, and then the numbers of the part that happened are what there is.
// So the refusal comes back as an asking error, and this turns it into the
// actual question, then repeats the call with force.

/**
 * Run an evaluation, asking before it goes ahead over a raid that is still
 * running. `run` receives whether to force; everything else is passed through
 * untouched, including any other error.
 */
export async function withIncompleteConfirm<T>(run: (force: boolean) => Promise<T>): Promise<T> {
    try {
        return await run(false);
    } catch (err) {
        if ((err as ApiError).code !== RAID_INCOMPLETE) throw err;
        const message = (err as ApiError).message || "Der Raid sieht noch nicht abgeschlossen aus.";
        if (!confirm(`${message}\n\nTrotzdem auswerten?`)) {
            // Deliberately an error: it ends the job's toast as "abgebrochen"
            // rather than reporting a report that was never built.
            throw { code: "cancelled", message: "Abgebrochen — der Raid läuft noch." } as ApiError;
        }
        return run(true);
    }
}
