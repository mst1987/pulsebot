// The building blocks of a fight's topics: outcome, deaths, mechanics, the
// debuff line, the compact topic tables and the grouping of fights by boss.
const { fmtTime, bandStats } = require("./charts");
const { esc } = require("./layout");
const { expBtn, tile, badge, hicon, classColorOf, classIconName } = require("./widgets");

function fightOutcome(f) {
    if (f.kill) return "Kill";
    return `Wipe${Number.isFinite(f.fightPercentage) && f.fightPercentage !== null ? ` bei ${Math.round(f.fightPercentage)} %` : ""}`;
}

function deathsList(deaths, linkFor) {
    if (!deaths || deaths.length === 0) return "<div class=\"fc-empty\">Niemand ist gestorben.</div>";
    return `<ul class="fight-deaths">${deaths.map((d) => {
        const href = linkFor && linkFor(d.name);
        const name = href ? `<a class="cn" href="${esc(href)}">${esc(d.name)}</a>` : `<span class="cn">${esc(d.name)}</span>`;
        const why = d.ability ? ` <span class="sritems">· ${d.abilityIcon ? hicon(d.abilityIcon, "") : ""}${esc(d.ability)}</span>` : "";
        const tags = [
            d.avoidable ? "<span class=\"tag tag-high\">vermeidbar</span>" : "",
            d.early ? "<span class=\"tag tag-medium\">früh</span>" : "",
            d.repeat ? "<span class=\"tag tag-medium\">nach Kampfrez</span>" : "",
            d.nearEnd ? "<span class=\"tag\">kurz vor dem Kill</span>" : "",
        ].filter(Boolean).join("");
        return `<li style="--cc:${esc(classColorOf(d.type) || "var(--text)")}"><b>${fmtTime(d.at)}</b>${name}${why}${tags}</li>`;
    }).join("")}</ul>`;
}

/** Avoidable hits as marker rows: one row per mechanic (raid view) or per mechanic the raider took (player view). */
function mechanicRows(mech, only) {
    if (!mech) return [];
    if (only) {
        const p = (mech.players || []).find((x) => x.name === only);
        if (!p) return [];
        return Object.entries(p.byMechanic).map(([mkey, m]) => ({
            label: m.label, icon: m.icon,
            markers: p.hits.filter((h) => h.key === mkey).map((h) => ({ at: h.at, icon: h.icon, label: h.amount ? `${m.label} · ${h.amount.toLocaleString("de-DE")}` : m.label })),
            value: `${m.hits}×`,
            sub: m.amount ? `${Math.round(m.amount / 1000)}k Schaden` : "Debuff",
            tone: m.hits >= 3 ? "high" : m.hits === 2 ? "medium" : undefined,
        })).sort((a, b) => (b.markers.length - a.markers.length));
    }
    return (mech.mechanics || []).map((m) => {
        const hits = (mech.players || []).flatMap((p) => p.hits.filter((h) => h.key === m.key).map((h) => ({ at: h.at, icon: h.icon, label: `${p.name} · ${m.label}${h.amount ? ` · ${h.amount.toLocaleString("de-DE")}` : ""}` })));
        return {
            label: m.label, icon: m.icon,
            markers: hits.sort((a, b) => a.at - b.at),
            value: `${m.hits}×`,
            sub: `${m.players} Spieler${m.amount ? ` · ${Math.round(m.amount / 1000)}k` : ""}`,
            tone: m.players >= 5 ? "high" : m.players >= 2 ? "medium" : undefined,
        };
    });
}

/** One line under a debuff's headline number: when it reached full stacks, or its worst gap. */
function debuffSub(d) {
    if (d.maxStacks && Number.isFinite(d.timeToMax) && d.timeToMax !== null) return `${d.maxStacks}/${d.maxStacks} ab ${fmtTime(d.timeToMax)}`;
    if (d.missing) return "fehlt";
    if (d.longestGap > 3000) return `Lücke ${fmtTime(d.longestGap)}`;
    if (Number.isFinite(d.firstAt) && d.firstAt !== null) return `ab ${fmtTime(d.firstAt)}`;
    return "";
}

// Icon + German label per topic of a fight, for section buttons, dialogs and the raid view.
const TOPIC_META = {
    debuffs: { label: "Debuffs", icon: "spell_shadow_chilltouch" },
    buffs: { label: "Buffs", icon: "spell_magic_greaterblessingofkings" },
    healing: { label: "Heilung", icon: "spell_holy_flashheal" },
    cooldowns: { label: "Cooldowns", icon: "ability_rogue_preparation" },
    totems: { label: "Totems", icon: "spell_nature_windfury" },
    activity: { label: "Aktivität", icon: "inv_misc_pocketwatch_02" },
    mechanics: { label: "Mechaniken", icon: "spell_fire_selfdestruct" },
    deaths: { label: "Tode", icon: "ability_creature_cursed_05" },
    series: { label: "Kampfverlauf", icon: "inv_misc_pocketwatch_01" },
    fight: { label: "Kampf", icon: "inv_misc_pocketwatch_01" },
};

const normBand = (b) => (Array.isArray(b) ? { from: b[0], to: b[1] } : (b && typeof b === "object" ? { from: b.from, to: b.to } : null));

/**
 * The compact table of a topic: one row per chart row, with the icon, the
 * toned headline value and its sub line; band rows add gaps and the longest
 * gap, marker rows the count and the times. This is what a card shows first —
 * the chart with the same rows sits behind "Verlauf öffnen".
 */
function topicTable(rows, duration, kind) {
    const isBands = kind === "bands";
    const head = isBands
        ? "<tr><th>Zeile</th><th>Uptime</th><th>Details</th><th>Lücken</th><th>Längste Lücke</th></tr>"
        : "<tr><th>Zeile</th><th>Anzahl</th><th>Details</th><th>Zeitpunkte</th></tr>";
    const body = rows.map((r) => {
        const name = `${r.icon ? hicon(r.icon, "") : ""}${esc(r.label)}`;
        const value = r.value !== undefined && r.value !== null ? `<span class="tv${r.tone ? ` ${r.tone}` : ""}">${esc(r.value)}</span>` : "–";
        const sub = r.sub ? esc(r.sub) : "–";
        if (isBands) {
            const bands = (r.bands || []).map(normBand).filter((b) => b && b.to > b.from);
            const st = bandStats(bands, duration);
            return `<tr><td>${name}</td><td>${value}</td><td>${sub}</td><td class="mono">${esc(st.gapCount)}</td><td class="mono">${st.longestGap ? fmtTime(st.longestGap) : "–"}</td></tr>`;
        }
        const marks = (r.markers || []).filter((m) => m && Number.isFinite(m.at));
        const times = marks.slice(0, 8).map((m) => fmtTime(m.at)).join(", ") + (marks.length > 8 ? `, … (${marks.length})` : "");
        return `<tr><td>${name}</td><td>${value}</td><td>${sub}</td><td class="mono">${esc(times) || "–"}</td></tr>`;
    }).join("");
    return `<table class="idx fc-table topic-table">${head}${body}</table>`;
}

/**
 * Rows that belong to somebody, under that somebody: one <details> per
 * player (class tile, name in class colour, a badge with their result), the
 * rows as a topic table beneath. Ordered as given (the caller sorts by what
 * needs attention); `open` on a group opens it. A flat list of
 * "Dorn · Bloodlust, Brokk · Shield Wall, Dorn · Mana Tide" is unreadable —
 * the raid lead's words.
 *
 * @param {Array<{ name, type, rows, badge: { text, tone }, open }>} groups
 */
function groupedTable(groups, duration, kind) {
    return `<div class="glist">${groups.map((g) => `<details class="grp" style="--cc:${esc(classColorOf(g.type) || "var(--text)")}"${g.open ? " open" : ""}>
      <summary>${tile(classIconName(g.type), "cls")}<span class="cn">${esc(g.name)}</span><span class="sritems">${esc(g.type || "")}</span>${g.badge ? badge(g.badge.text, g.badge.tone) : ""}${g.extra || ""}${expBtn()}</summary>
      ${topicTable(g.rows, duration, kind)}
    </details>`).join("")}</div>`;
}

/** Fights grouped per boss (by encounter id, else name), in pull order. */
function groupByBoss(fights) {
    const bosses = [];
    const byKey = new Map();
    for (const f of fights) {
        const k = f.encounterId ? `e${f.encounterId}` : `n${f.boss}`;
        if (!byKey.has(k)) {
            const boss = { key: k, name: f.boss, encounterId: f.encounterId, fights: [] };
            byKey.set(k, boss);
            bosses.push(boss);
        }
        byKey.get(k).fights.push(f);
    }
    return bosses;
}

module.exports = {
    fightOutcome, deathsList, mechanicRows, debuffSub, TOPIC_META, topicTable, groupedTable, groupByBoss,
};
