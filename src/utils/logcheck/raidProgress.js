const {
    content, contentForInstance, contentForBoss, finalBossesFor, normalizeBoss, BOSS_ORDER,
} = require("../../config/tbcContent");

// Encounters that are not a boss of their own on the count a raid lead keeps
// ("Kara 11/11"): Karazhan's opera bosses are one encounter — only one of them
// is up on a night — and its three rare trash spawns are no encounter at all.
const OPERA = ["The Wizard of Oz", "The Big Bad Wolf", "Romulo and Julianne", "Opera Hall"];
const NOT_COUNTED = new Set(["Hyakiss the Lurker", "Shadikith the Glider", "Rokad the Ravager", ...OPERA].map(normalizeBoss));

/** The encounters a raid is counted by, in the order they are met. */
function encountersFor(contentId) {
    return (BOSS_ORDER[contentId] || []).filter((name) => !NOT_COUNTED.has(normalizeBoss(name)));
}

/** A boss name folded onto the encounter it counts as (an opera boss → "Opera Event"). */
function encounterKey(name) {
    const key = normalizeBoss(name);
    return OPERA.map(normalizeBoss).includes(key) ? normalizeBoss("Opera Event") : key;
}

/**
 * Per encounter of a raid: its name and whether the log has a kill of it. A
 * final boss that was killed under a name the list does not carry (a German
 * client) still marks it as down.
 */
function bossGrid(contentId, killedKeys, finalKilled) {
    const finals = new Set(finalBossesFor(contentId).map(normalizeBoss));
    return encountersFor(contentId).map((name) => ({
        name,
        killed: killedKeys.has(encounterKey(name)) || (finalKilled && finals.has(normalizeBoss(name))),
    }));
}

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
    const killedKeys = new Set(bossFights.filter((f) => f.kill).map((f) => encounterKey(f.name)));

    const raids = contentIds.map((contentId) => {
        const meta = content(contentId);
        const finalBosses = finalBossesFor(contentId);
        const finalKilled = finalBosses.some((b) => killedNames.has(normalizeBoss(b)));
        // A raid without a listed final boss cannot be judged — count it as done
        // rather than blocking on a raid this table does not know.
        const done = !finalBosses.length || finalKilled;
        return {
            contentId,
            label: (meta && meta.label) || contentId,
            short: (meta && meta.short) || contentId,
            finalBosses,
            done,
            // The encounter list with what lies — the "Raid nicht abgeschlossen"
            // dialog draws it as a grid, the log list as "Hyjal 3/5".
            bosses: bossGrid(contentId, killedKeys, finalKilled),
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

/**
 * The compact per-raid state a list row carries: "Hyjal 3/5", whether the final
 * boss lies, and which encounters are still standing. Also reads a progress
 * stored before the encounter grid existed: the count then comes from `killed`
 * and only the final boss can be named as missing.
 * @param {object|null} progress  analyzeRaidProgress() output, or a report's stored raidProgress
 * @returns {{contentId,label,killed,total,finalKilled,finalBoss,missing:string[],bosses:{name,killed}[]}[]}
 */
function raidSummary(progress) {
    const raids = (progress && Array.isArray(progress.raids)) ? progress.raids : [];
    return raids.map((r) => {
        const contentId = String(r.contentId || "");
        const meta = content(contentId);
        const finalBosses = Array.isArray(r.finalBosses) ? r.finalBosses : finalBossesFor(contentId);
        const finalBoss = finalBosses[0] || "";
        const hasGrid = Array.isArray(r.bosses);
        const total = hasGrid ? r.bosses.length : encountersFor(contentId).length;
        const killed = hasGrid
            ? r.bosses.filter((b) => b.killed).length
            : Math.min(total || Number(r.killed) || 0, Number(r.killed) || 0);
        return {
            contentId,
            label: r.short || (meta && meta.short) || r.label || contentId,
            killed,
            total,
            // "done" is also true for a raid nobody can judge; that is no reason to warn.
            finalKilled: !!r.done,
            finalBoss,
            missing: hasGrid
                ? r.bosses.filter((b) => !b.killed).map((b) => b.name)
                : (r.done || !finalBoss ? [] : [finalBoss]),
            // every encounter with its state; [] when the stored progress has no grid
            bosses: hasGrid ? r.bosses.map((b) => ({ name: b.name, killed: !!b.killed })) : [],
        };
    });
}

module.exports = { analyzeRaidProgress, progressSummary, raidSummary, encountersFor };
