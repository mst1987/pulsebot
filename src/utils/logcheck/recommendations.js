// Recommendations: what each raider — and the raid — should do differently
// next time, derived from the finished report by plain rules.
//
// Every rule reads one part of the report and yields findings with an impact
// (high / medium / low), a one-line title, a sentence of text and the
// evidence it rests on (boss, number), so the page can show the reasoning and
// the raid lead can judge it. Rules whose data is missing from the report (an
// older report, an analyzer that failed) simply yield nothing — never a false
// "alles gut". The thresholds live in config/recommendationRules.js.
//
// The engine is pure: it never talks to an API and never stores anything. What
// the raid lead approves or rewrites is kept beside it (recommendationReview
// on the report) and merged in by the page.
const R = require("../../config/recommendationRules");
const { DEBUFFS } = require("../../config/raidDebuffs");

const IMPACT_ORDER = { high: 0, medium: 1, low: 2 };

function fmt(ms) {
    const s = Math.max(0, Math.round((ms || 0) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function finding(key, impact, title, text, evidence = []) {
    return { key, impact, title, text, evidence };
}

// ---- player rules -------------------------------------------------------

function gearRules(report, name) {
    const p = (report.players || []).find((x) => x.name === name);
    const issues = (p && p.issues) || [];
    if (!issues.length) return [];
    const high = issues.filter((i) => i.severity === "high");
    const list = issues.slice(0, 4).map((i) => `${i.itemName || i.slot || "?"}: ${i.label}`);
    return [finding(
        "gear",
        high.length ? "high" : "medium",
        `${issues.length} Gear-${issues.length === 1 ? "Problem" : "Probleme"}`,
        `Gear vor dem Raid fertig machen: ${list.join(" · ")}${issues.length > 4 ? ` und ${issues.length - 4} weitere` : ""}.`,
        issues.map((i) => ({ label: i.itemName || "", value: i.label })),
    )];
}

function consumableRules(report, name) {
    const c = report.consumables && (report.consumables.players || []).find((x) => x.name === name);
    if (!c) return [];
    const out = [];
    if (Number.isFinite(c.buffed) && c.buffed < R.consumables.buffedPct) {
        out.push(finding(
            "consumables.buffed",
            c.buffed < R.consumables.buffedLowPct ? "high" : "medium",
            `Flask/Elixiere nur in ${c.buffed} % der Bosskämpfe`,
            "Vor jedem Pull prüfen, ob Flask oder beide Elixiere laufen – ein Kampf ohne ist ein spürbarer DPS-/HPS-Verlust.",
            [{ label: "Bosskämpfe mit Flask/Elixieren", value: `${c.buffed} %` }],
        ));
    }
    if (Number.isFinite(c.food) && c.food < R.consumables.foodPct) {
        out.push(finding("consumables.food", "low", `Essensbuff nur in ${c.food} % der Bosskämpfe`, "Nach jedem Tod oder Wipe den Essensbuff erneuern.", [{ label: "Bosskämpfe mit Essen", value: `${c.food} %` }]));
    }
    if (c.weaponOiled === false) {
        out.push(finding("consumables.oil", "low", "Keine Waffenverbesserung", "Öl oder Wetzstein auf die Waffe, hält eine Stunde.", []));
    }
    return out;
}

function debuffRules(report, name, type) {
    const rows = (report.raidDebuffs && report.raidDebuffs.rows) || [];
    const classCount = (report.roster || []).filter((p) => p.type === type).length;
    const out = [];
    for (const row of rows) {
        if (!row.expected) continue;
        const def = DEBUFFS.find((d) => d.key === row.key);
        if (!def || def.provider !== type) continue;
        const short = row.missing > 0 || row.avgUptime < R.debuffs.uptimePct;
        if (!short) continue;
        const who = classCount === 1 ? `Du warst der einzige ${type}` : `Ihr ${type}s`;
        out.push(finding(
            `debuff.${row.key}`,
            row.missing > 0 ? "high" : "medium",
            `${row.label} ${row.missing > 0 ? `fehlte in ${row.missing} ${row.missing === 1 ? "Kampf" : "Kämpfen"}` : `nur ${row.avgUptime} % Uptime`}`,
            `${who}: ${row.label} gehört auf jeden Boss, dauerhaft. Ø Uptime ${row.avgUptime} %${row.missing ? `, in ${row.missing} von ${row.fights} Kämpfen gar nicht` : ""}.`,
            [{ label: "Ø Uptime", value: `${row.avgUptime} %` }, { label: "Kämpfe ohne", value: String(row.missing) }],
        ));
    }
    return out;
}

function totemRules(report, name) {
    const t = report.totems && (report.totems.players || []).find((x) => x.name === name);
    if (!t) return [];
    const out = [];
    if (t.wfFights > 0) {
        if (t.twistingFights < t.wfFights) {
            out.push(finding(
                "totems.twisting",
                t.twistingFights === 0 ? "high" : "medium",
                `Twisting nur in ${t.twistingFights} von ${t.wfFights} Kämpfen`,
                "Windfury und Grace of Air twisten: Windfury setzen, nach einem GCD Grace of Air, alle zehn Sekunden wieder Windfury.",
                [{ label: "Kämpfe mit Twisting", value: `${t.twistingFights}/${t.wfFights}` }],
            ));
        }
        if (Number.isFinite(t.wfUptimeAvg) && t.wfUptimeAvg < R.totems.wfUptimePct && t.downtimeMs >= R.totems.downtimeMs) {
            out.push(finding(
                "totems.windfury",
                "medium",
                `Windfury Ø ${t.wfUptimeAvg} %, ${Math.round(t.downtimeMs / 1000)} s Lücken`,
                `Die Nahkämpfer hatten ${Math.round(t.downtimeMs / 1000)} s lang kein Windfury (${t.gapCount} Lücken). Den Zyklus enger halten.`,
                [{ label: "Windfury-Uptime", value: `${t.wfUptimeAvg} %` }, { label: "Downtime", value: `${Math.round(t.downtimeMs / 1000)} s` }],
            ));
        }
    }
    for (const [slot, ms] of Object.entries(t.slotDowntimeMs || {})) {
        if (ms >= R.totems.slotDowntimeMs) {
            const label = { air: "Luft", earth: "Erde", fire: "Feuer", water: "Wasser" }[slot] || slot;
            out.push(finding(`totems.slot.${slot}`, "low", `${label}-Totem ${Math.round(ms / 1000)} s nicht gestellt`, `Im ${label}-Slot stand über den Raid ${Math.round(ms / 1000)} s lang kein Totem.`, [{ label: `${label}-Slot leer`, value: `${Math.round(ms / 1000)} s` }]));
        }
    }
    return out;
}

function cooldownRules(report, name) {
    const c = report.cooldowns && (report.cooldowns.players || []).find((x) => x.name === name);
    if (!c) return [];
    const out = [];
    if (c.possible > 0 && (c.usedPct < R.cooldowns.usedPct || c.missed >= R.cooldowns.missed)) {
        out.push(finding(
            "cooldowns.missed",
            c.usedPct < 50 ? "high" : "medium",
            `${c.missed} von ${c.possible} möglichen Cooldown-Nutzungen verpasst`,
            `Cooldowns und Tränke auf Cooldown drücken: ${c.usedPct} % der möglichen Nutzungen genutzt.`,
            [{ label: "Genutzt", value: `${c.possible - c.missed}/${c.possible}` }],
        ));
    }
    if (Number.isFinite(c.avgFirstAtMs) && c.avgFirstAtMs !== null && c.avgFirstAtMs > R.cooldowns.firstAtMs) {
        out.push(finding("cooldowns.late", "medium", `Erster Cooldown im Schnitt erst nach ${fmt(c.avgFirstAtMs)}`, "Klassen-Cooldowns gleich am Pull drücken, dann sind sie später ein zweites Mal bereit.", [{ label: "Ø erster Einsatz", value: fmt(c.avgFirstAtMs) }]));
    }
    const total = (c.stacked || 0) + (c.unstacked || 0);
    if (total >= 2 && c.unstacked / total > R.cooldowns.unstackedShare) {
        out.push(finding("cooldowns.stacking", "low", `${c.unstacked} von ${total} Cooldowns außerhalb von Bloodlust`, "Cooldowns möglichst ins Bloodlust-Fenster legen.", [{ label: "Im Bloodlust", value: `${c.stacked}/${total}` }]));
    }
    return out;
}

function activityRules(report, name) {
    const a = report.activity && (report.activity.players || []).find((x) => x.name === name);
    if (!a) return [];
    const out = [];
    if (a.activeAvg < R.activity.activePct) {
        out.push(finding(
            "activity.low",
            a.activeAvg < 70 ? "high" : "medium",
            `Nur ${a.activeAvg} % aktiv`,
            `${a.gaps} Lücken über ${Math.round(a.gapMs / 1000)} s, davon ${Math.round(a.unexplainedMs / 1000)} s ohne erkennbaren Grund, längste ${fmt(a.longestGap)}. Nach Bewegung sofort weitermachen, Ziel im Blick behalten.`,
            [{ label: "Ø aktiv", value: `${a.activeAvg} %` }, { label: "Unerklärt", value: `${Math.round(a.unexplainedMs / 1000)} s` }, { label: "Längste Lücke", value: fmt(a.longestGap) }],
        ));
    } else if (a.unexplainedMs >= R.activity.unexplainedMs || a.longestGap >= R.activity.longestGapMs) {
        out.push(finding("activity.gaps", "low", `${Math.round(a.unexplainedMs / 1000)} s unerklärte Lücken`, `Längste Lücke ${fmt(a.longestGap)}.`, [{ label: "Längste Lücke", value: fmt(a.longestGap) }]));
    }
    return out;
}

function mechanicRules(report, name) {
    const m = report.mechanics && (report.mechanics.players || []).find((x) => x.name === name);
    if (!m) return [];
    const out = [];
    if (m.hits >= R.mechanics.hits && m.topMechanic) {
        out.push(finding(
            "mechanics.hits",
            m.hits >= R.mechanics.hitsHigh ? "high" : "medium",
            `${m.hits}× von vermeidbaren Mechaniken getroffen`,
            `Am häufigsten ${m.topMechanic.label} (${m.topMechanic.hits}×). Auf die Ansage achten und früher rauslaufen.`,
            [{ label: "Treffer", value: String(m.hits) }, { label: "Häufigste", value: m.topMechanic.label }],
        ));
    }
    if (m.avoidableDeaths >= 1) {
        out.push(finding("mechanics.deaths", "high", `${m.avoidableDeaths} vermeidbare${m.avoidableDeaths === 1 ? "r Tod" : " Tode"}`, "Gestorben an einer Mechanik, der man ausweichen kann.", [{ label: "Vermeidbare Tode", value: String(m.avoidableDeaths) }]));
    }
    if (m.earlyDeaths >= 1) {
        out.push(finding("mechanics.early", "medium", `${m.earlyDeaths}× in den ersten 30 Sekunden gestorben`, "Beim Pull Abstand halten und die Aggro erst aufbauen lassen.", [{ label: "Frühe Tode", value: String(m.earlyDeaths) }]));
    }
    return out;
}

function rpbRules(report, name) {
    const a = report.rpb && report.rpb.activity && (report.rpb.activity.players || []).find((x) => x.name === name);
    if (!a) return [];
    const down = [...(a.singleTargetCasts || []), ...(a.aoeCasts || [])].filter((s) => s.mostlyLowerRank);
    if (!down.length) return [];
    return [finding(
        "rpb.downrank",
        "medium",
        `${down.length} ${down.length === 1 ? "Zauber" : "Zauber"} meist in niedrigem Rang`,
        `Max-Rang benutzen: ${down.map((s) => `${s.label} (${s.lowerRankPercent} %)`).join(", ")}.`,
        down.map((s) => ({ label: s.label, value: `${s.lowerRankPercent} % niedriger Rang` })),
    )];
}

function shadowResiRules(report, name) {
    const p = report.shadowResi && (report.shadowResi.players || []).find((x) => x.name === name);
    if (!p || !Number.isFinite(p.sr)) return [];
    if (p.sr >= R.shadowResi.minSr) return [];
    return [finding("shadowResi", "medium", `Nur ${p.sr} Schattenwiderstand für ${report.shadowResi.boss}`, `Ziel sind ${R.shadowResi.minSr} aus Gear (Verzauberungen, Edelsteine, Items).`, [{ label: "Schattenwiderstand", value: String(p.sr) }])];
}

const PLAYER_RULES = [gearRules, consumableRules, debuffRules, totemRules, cooldownRules, activityRules, mechanicRules, rpbRules, shadowResiRules];

// ---- raid rules ---------------------------------------------------------

function raidRules(report) {
    const out = [];
    for (const row of (report.raidDebuffs && report.raidDebuffs.rows) || []) {
        if (!row.expected) continue;
        if (row.missing > 0 || row.avgUptime < R.debuffs.uptimePct) {
            out.push(finding(`raid.debuff.${row.key}`, row.missing > 0 ? "high" : "medium", `${row.label}: Ø ${row.avgUptime} %${row.missing ? `, fehlte in ${row.missing} ${row.missing === 1 ? "Kampf" : "Kämpfen"}` : ""}`, `Wer ${row.label} liefert, hält es dauerhaft auf dem Boss.`, [{ label: "Ø Uptime", value: `${row.avgUptime} %` }]));
        }
        if (row.maxStacks && Number.isFinite(row.avgBelowMax) && row.avgBelowMax !== null && row.avgBelowMax > 25) {
            out.push(finding(`raid.stacks.${row.key}`, "medium", `${row.label} ${row.avgBelowMax} % der Zeit unter ${row.maxStacks} Stacks`, "Zu Beginn schneller hochstacken und die Stacks nicht abfallen lassen.", [{ label: "Unter Max-Stacks", value: `${row.avgBelowMax} %` }]));
        }
    }
    const deaths = report.mechanics && report.mechanics.deaths;
    if (deaths && deaths.early >= R.raid.earlyDeaths) {
        out.push(finding("raid.earlyDeaths", "high", `${deaths.early} Tode in den ersten 30 Sekunden`, "Pull sauberer: Aggro aufbauen lassen, DPS zwei Sekunden warten.", [{ label: "Frühe Tode", value: String(deaths.early) }]));
    }
    if (deaths && deaths.avoidable >= 3) {
        out.push(finding("raid.avoidableDeaths", "high", `${deaths.avoidable} vermeidbare Tode`, "Mechaniken vor dem Pull noch einmal ansagen.", [{ label: "Vermeidbare Tode", value: String(deaths.avoidable) }]));
    }
    const mech = (report.mechanics && report.mechanics.mechanics) || [];
    for (const m of mech.slice(0, 2)) {
        if (m.hits >= 10) {
            out.push(finding(`raid.mechanic.${m.key}`, "medium", `${m.label}: ${m.hits} Treffer in ${m.fights} Kämpfen`, "Die Mechanik, die den Raid am meisten gekostet hat.", [{ label: "Treffer", value: String(m.hits) }]));
        }
    }
    const lustSpreads = ((report.timeline && report.timeline.fights) || []).map((f) => f.cooldowns && f.cooldowns.lust).filter((l) => l && l.casts > 1 && l.spreadMs > R.raid.lustSpreadMs);
    if (lustSpreads.length) {
        out.push(finding("raid.lust", "medium", `Bloodlust in ${lustSpreads.length} Kämpfen ${Math.round(Math.max(...lustSpreads.map((l) => l.spreadMs)) / 1000)} s auseinander`, "Alle Gruppen lusten auf eine Ansage, sonst verpufft die Überlappung mit den Cooldowns.", [{ label: "Kämpfe", value: String(lustSpreads.length) }]));
    }
    const act = (report.activity && report.activity.players) || [];
    if (act.length >= 5) {
        const avg = Math.round(act.reduce((n, p) => n + p.activeAvg, 0) / act.length);
        if (avg < R.activity.activePct) out.push(finding("raid.activity", "medium", `Raid im Schnitt nur ${avg} % aktiv`, "Bewegungsphasen kürzer halten, nach Mechaniken sofort weitermachen.", [{ label: "Ø aktiv", value: `${avg} %` }]));
    }
    return out.sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact]).slice(0, 5);
}

// ---- engine ---------------------------------------------------------------

/**
 * Build the recommendations for a finished report.
 *
 * @returns {{ generatedAt: number, raid: Array, players: Array<{ name, type, items }> }}
 */
function buildRecommendations(report) {
    const players = (report.roster || []).map((p) => {
        const items = [];
        for (const rule of PLAYER_RULES) {
            try {
                items.push(...rule(report, p.name, p.type));
            } catch (e) {
                console.error(`recommendation rule failed for ${p.name}:`, e.message);
            }
        }
        items.sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact] || b.evidence.length - a.evidence.length);
        return { name: p.name, type: p.type, items };
    });
    return { generatedAt: Date.now(), raid: raidRules(report), players };
}

/**
 * Lay the raid lead's review over the generated items: `approved`
 * (true/false/null = not yet decided) and an optional rewritten `text`.
 * The review is keyed by player and item key so it survives a rebuild.
 */
function applyReview(recommendations, review) {
    if (!recommendations) return null;
    const byPlayer = (review && review.players) || {};
    return {
        ...recommendations,
        raid: recommendations.raid.map((item) => ({ ...item, ...reviewOf((review && review.raid) || {}, item.key) })),
        players: recommendations.players.map((p) => ({
            ...p,
            items: p.items.map((item) => ({ ...item, ...reviewOf(byPlayer[p.name] || {}, item.key) })),
        })),
    };
}

function reviewOf(map, key) {
    const r = map[key];
    return { approved: r && typeof r.approved === "boolean" ? r.approved : null, custom: (r && r.text) || "" };
}

module.exports = { buildRecommendations, applyReview, raidRules, PLAYER_RULES, IMPACT_ORDER };
