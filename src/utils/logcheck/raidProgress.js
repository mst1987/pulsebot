const { content, contentForInstance, contentForBoss, finalBossesFor, normalizeBoss } = require("../../config/tbcContent");

// Is this raid night over yet?
//
// An evaluation of a log whose raid is still running is worth little and worse
// than nothing to the raiders it judges: the consumables of the last two hours
// are missing, half the bosses have no kill to measure against, and the numbers
// change with every further pull. So a report is only built once the raid's
// final boss is down — anything earlier has to be confirmed explicitly.
//
// The guard errs towards letting things through. A raid it cannot identify (an
// unknown zone, an encounter list it has no final boss for) is never blocked:
// being unable to see the end of a raid is not evidence that it has not
// happened, and a guard nobody can get past is worse than one that misses a
// case.

/**
 * Which raids a WCL report covers and whether each one was finished.
 *
 * @param {object} fights  the report/fights response (`fights`, `zoneName`)
 * @returns {{
 *   complete: boolean,      // nothing left to kill (or nothing we can judge)
 *   known: boolean,         // at least one raid was identified
 *   raids: {contentId,label,finalBosses,done,killed,wiped}[],
 *   pending: string[],      // labels of the raids still missing their final boss
 *   bossCount: number, killCount: number,
 *   lastKill: string, lastPull: string,
 * }}
 */
function analyzeRaidProgress(fights) {
    const all = (fights && fights.fights) || [];
    const bossFights = all.filter((f) => f && f.boss > 0 && f.name);

    // Which raids the log touches: every boss that can be placed, plus the
    // report's own zone — a night that only wiped on trash still names its zone.
    const contentIds = [];
    for (const f of bossFights) {
        const id = contentForBoss(f.name);
        if (id && !contentIds.includes(id)) contentIds.push(id);
    }
    const zoneId = contentForInstance((fights && fights.zoneName) || "");
    if (zoneId && !contentIds.includes(zoneId)) contentIds.push(zoneId);

    const killedNames = new Set(bossFights.filter((f) => f.kill).map((f) => normalizeBoss(f.name)));

    const raids = contentIds.map((contentId) => {
        const meta = content(contentId);
        const finalBosses = finalBossesFor(contentId);
        // A raid without a listed final boss cannot be judged — count it as done
        // rather than blocking on a raid this table does not know.
        const done = !finalBosses.length || finalBosses.some((b) => killedNames.has(normalizeBoss(b)));
        return {
            contentId,
            label: (meta && meta.label) || contentId,
            finalBosses,
            done,
            killed: bossFights.filter((f) => f.kill && contentForBoss(f.name) === contentId).length,
            wiped: bossFights.filter((f) => !f.kill && contentForBoss(f.name) === contentId).length,
        };
    });

    const pending = raids.filter((r) => !r.done).map((r) => r.label);
    const kills = bossFights.filter((f) => f.kill);

    return {
        complete: !pending.length,
        known: raids.some((r) => r.finalBosses.length > 0),
        raids,
        pending,
        bossCount: bossFights.length,
        killCount: kills.length,
        lastKill: kills.length ? kills[kills.length - 1].name : "",
        lastPull: bossFights.length ? bossFights[bossFights.length - 1].name : "",
    };
}

/**
 * One line saying why the raid does not look finished — the same wording in
 * Discord and in the admin menu, so nobody has to translate between the two.
 */
function progressSummary(progress) {
    if (!progress || progress.complete) return "";
    const missing = progress.raids.filter((r) => !r.done);
    const parts = missing.map((r) => `**${r.label}** (Endboss: ${r.finalBosses[0] || "?"})`);
    const kills = `${progress.killCount} von ${progress.bossCount} Pulls waren Kills`;
    const last = progress.lastKill
        ? `zuletzt gelegt: ${progress.lastKill}`
        : (progress.lastPull ? `zuletzt versucht: ${progress.lastPull}` : "noch kein Boss gelegt");
    return `Der Endboss fehlt noch: ${parts.join(", ")}. ${kills}, ${last}.`;
}

module.exports = { analyzeRaidProgress, progressSummary };
