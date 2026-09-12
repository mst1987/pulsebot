// Thresholds behind the player and raid recommendations, in one place so a
// number is never buried in a rule. Percentages are 0–100, times in
// milliseconds unless the name says seconds.
//
// Impact is the rough cost of a finding: "high" is measurable damage or a
// wipe risk, "medium" a habit worth changing, "low" a nice-to-have.
module.exports = {
    consumables: {
        buffedPct: 100,          // flask or both elixirs on fewer boss fights than this is a finding
        foodPct: 100,
        buffedLowPct: 50,        // below this it is a high-impact finding
    },
    debuffs: {
        uptimePct: 90,           // an expected raid debuff below this average is a gap
    },
    raidBuffs: {
        missingFights: 2,        // an expected buff missing or run out on at least this many fights is a finding for the player
        missingHighShare: 0.5,   // ...and a high-impact one from this share of their fights on
        raidMissingPlayers: 3,   // a buff short on at least this many players over the raid is a finding for whoever hands it out
        wrongPlayers: 2,         // a blessing on this many players of the wrong role is a finding for the paladins
    },
    totems: {
        wfUptimePct: 90,
        downtimeMs: 10000,       // total Windfury downtime over the raid worth mentioning
        slotDowntimeMs: 30000,   // an element slot empty for longer than this over the raid
    },
    cooldowns: {
        usedPct: 75,             // used fewer than this share of the possible presses
        missed: 2,
        firstAtMs: 15000,        // first class cooldown later than this into the pull
        unstackedShare: 0.5,     // more than half of the class cooldowns outside a Bloodlust window
    },
    activity: {
        activePct: 85,
        unexplainedMs: 20000,    // unexplained holes over the raid
        longestGapMs: 15000,
    },
    mechanics: {
        hits: 3,
        hitsHigh: 6,
    },
    healers: {
        activePct: 60,           // a healer's activity only counts as low below this (waiting is part of the job)
        overhealPct: 35,         // overheal share over the raid worth a word
        overhealHighPct: 50,
        potionLatePct: 15,       // a mana potion pressed below this mana level came late
        dispelReactionMs: 3000,  // average reaction to a dispellable debuff slower than this
        dispelsMissed: 2,        // dispellable debuffs nobody removed, over the raid
        shieldUptimePct: 80,     // Earth Shield / Lifebloom on the tank below this average uptime
    },
    rpb: {
        lowerRankPct: 50,        // a spell mostly cast below its max rank
    },
    series: {
        dipPct: 25,              // share of the fight time (alive) a DPS's output sat below half their own mean
        dipHighPct: 40,          // ...and from this share on it is a high-impact finding
        minFights: 2,            // one fight of curve is noise: a raider needs at least this many to be judged
    },
    shadowResi: {
        minSr: 365,              // gear shadow resistance for Mother Shahraz
    },
    raid: {
        lustSpreadMs: 10000,     // groups lusted more than this apart
        sunderMaxMs: 20000,      // Sunder took longer than this to reach five stacks
        earlyDeaths: 2,
    },
};
