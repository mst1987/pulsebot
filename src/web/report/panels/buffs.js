// Raid buffs: a fight's buff topic and the raid-wide player × buff matrix.
const { ribbonChart, fmtTime } = require("../charts");
const { ROLE_LABELS: BUFF_ROLE_LABELS } = require("../../../config/raidBuffs");
const { esc } = require("../layout");
const { pctCell, hicon, classColorOf } = require("../widgets");
const { topicTable } = require("../fightTopics");

// ---- Buffs: the raid buffs on the players of a fight (f.buffs, utils/logcheck/raidBuffs.js) ----
//   paladins, expected[]  · players[] { name, type, role, diedAt, buffs: [{ key, label, icon, status: full|late|partial|none, uptimePct, expected, wrong, bands }], missing[], late[], partial[], wrong[] }
//   (`late` — set after the pull, then kept — and `partial` — not there throughout: ran out or had a hole — were one
//   status before Sept 2026; a stored report may lack `late` and its counters, so every read of them has a fallback;
//   `unknown` is an inferred buff — Fortitude / Mark of the Wild, which the client leaves out of the combatant info —
//   that no event proved present or missing in this fight: never a finding, shown as "?")

const BUFF_STATUS = { full: "da", late: "spät gesetzt", partial: "nicht durchgehend", none: "fehlt", unknown: "nicht nachweisbar" };

function buffTone(c) {
    if (c.wrong) return "high";
    if (!c.expected || c.status === "unknown") return undefined;
    return c.status === "full" ? "good" : c.status === "late" || c.status === "partial" ? "medium" : "high";
}

/** The one-line explanation of an inferred buff, for tooltips and notes. */
const INFERRED_HOW = "Der Client loggt diesen Buff beim Pull nicht. Er gilt als da, wo der Log ihn später entfernt oder erneuert sieht (Tod, Auslaufen, Nachbuffen), und als fehlend, wo ein Tod alle anderen Buffs entfernt, diesen aber nicht. Ohne beides bleibt die Zelle offen (?) und zählt nicht als Fehlen.";

/** The same as a badge with the explanation in its tooltip, for the detail dialogs. */
function inferredBadge(list, unknownCells) {
    if (!list || !list.length) return "";
    const names = list.map((u) => `${u.label}${u.groupLabel ? ` / ${u.groupLabel}` : ""}`).join(", ");
    const open = unknownCells ? ` ${unknownCells} ${unknownCells === 1 ? "Zelle bleibt" : "Zellen bleiben"} ohne Nachweis.` : "";
    return `<span class="badge accent" data-tip="Aus dem Verlauf abgeleitet: ${esc(names)}" data-tip-sub="${esc(INFERRED_HOW + open)}">${list.map((u) => hicon(u.icon, "")).join("")}abgeleitet${unknownCells ? ` · ${esc(unknownCells)} ?` : ""}</span>`;
}

/** The number of things wrong with a player's buffs in a fight: missing, late, not throughout, wrong role. */
function buffIssues(p) {
    return (p.missing || []).length + (p.late || []).length + (p.partial || []).length + (p.wrong || []).length;
}

/** One player's chips: what was missing, what came late, what was not there throughout, what sat on the wrong role. */
function buffChips(p) {
    const byKey = new Map((p.buffs || []).map((c) => [c.key, c]));
    const chip = (key, cls, word) => {
        const c = byKey.get(key) || { label: key, icon: "" };
        return `<span class="tag ${cls}">${hicon(c.icon, "")}${esc(c.label)} ${word}</span>`;
    };
    return [
        ...(p.missing || []).map((k) => chip(k, "tag-high", "fehlt")),
        ...(p.late || []).map((k) => chip(k, "tag-medium", BUFF_STATUS.late)),
        ...(p.partial || []).map((k) => chip(k, "tag-medium", BUFF_STATUS.partial)),
        ...(p.wrong || []).map((k) => chip(k, "tag-medium", "· falsche Rolle")),
    ].join("");
}

/**
 * The Buffs topic of one fight: { count, html }, or null without data. On the
 * raid page a list of who lacked what (a ribbon per player and buff would be
 * two hundred rows); on the player page (`only`) that raider's buffs as
 * ribbons, so a buff that came late or ran out mid-fight is visible as such.
 */
function buffParts(f, only, common) {
    const b = f.buffs;
    if (!b || !(b.players || []).length) return null;
    const expectedLabels = (b.expected || []).map((k) => {
        const c = b.players.flatMap((p) => p.buffs || []).find((x) => x.key === k);
        return c ? c.label : k;
    });
    const inferred = (b.inferred || []).map((k) => {
        const c = b.players.flatMap((p) => p.buffs || []).find((x) => x.key === k);
        return c ? c.label : k;
    });
    const open = b.players.reduce((n, p) => n + (p.buffs || []).filter((c) => c.status === "unknown").length, 0);
    const inferredHint = inferred.length
        ? ` · <span data-tip="${esc(INFERRED_HOW)}">aus dem Verlauf abgeleitet: ${esc(inferred.join(", "))}${open ? ` (${esc(open)} ohne Nachweis)` : ""}</span>`
        : "";
    const head = `<p class="note">${esc(b.paladins || 0)} Paladin${b.paladins === 1 ? "" : "e"} · erwartet: ${expectedLabels.length ? esc(expectedLabels.join(", ")) : "nichts"}${inferredHint}</p>`;
    if (only) {
        const p = b.players.find((x) => x.name === only);
        if (!p) return null;
        const rows = (p.buffs || []).map((c) => ({
            label: `${c.label}${c.wrong ? " (falsche Rolle)" : ""}`, icon: c.icon,
            bands: c.bands || [],
            value: `${c.uptimePct}%`,
            sub: c.expected ? BUFF_STATUS[c.status] : (c.wrong ? "falsche Rolle" : "nicht erwartet"),
            tone: buffTone(c),
        }));
        return { count: buffIssues(p), table: head + topicTable(rows, f.duration, "bands"), chart: ribbonChart({ ...common, rows }) };
    }
    const lacking = b.players.filter((p) => buffIssues(p) > 0);
    if (!lacking.length) return { count: 0, table: `${head}<p class="note">Alle erwarteten Buffs auf allen Spielern.</p>`, chart: null };
    const list = lacking.map((p) =>
        `<li style="--cc:${esc(classColorOf(p.type) || "var(--text)")}"><span class="cn">${esc(p.name)}</span><span class="sritems">${esc(BUFF_ROLE_LABELS[p.role] || p.role)}${p.diedAt !== null && p.diedAt !== undefined ? ` · bis ${fmtTime(p.diedAt)}` : ""}</span><span class="buff-list">${buffChips(p)}</span></li>`).join("");
    return { count: lacking.length, table: `${head}<ul class="fight-deaths buff-lacking">${list}</ul>`, chart: null };
}

/** The Raid-Buffs tab: a player × buff matrix of "share of fights with the buff", the raid's coverage above. */
function renderRaidBuffsPanel(raidBuffs, linkFor) {
    const players = (raidBuffs.players || []).slice().sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name));
    const blindKeys = new Set((raidBuffs.untracked || []).map((u) => u.key));
    // a buff the log cannot show is not a column: a grey column of "fehlt" would read as a raid without Fortitude;
    // an inferred one is, even where every cell is still open
    const cols = (raidBuffs.rows || []).filter((r) => !blindKeys.has(r.key) && (r.expected || r.seenPlayers > 0 || (r.unknown || 0) > 0));
    const blind = (raidBuffs.untracked || []).length
        ? `<span class="badge" data-tip="Im Log nicht nachweisbar: ${esc((raidBuffs.untracked || []).map((u) => `${u.label}${u.groupLabel ? ` / ${u.groupLabel}` : ""}`).join(", "))}" data-tip-sub="Der Client loggt diese Buffs beim Pull nicht (nur beim Nachbuffen), deshalb werden sie nicht bewertet.">${(raidBuffs.untracked || []).map((u) => hicon(u.icon, "")).join("")}nicht nachweisbar</span>`
        : "";
    const inferred = inferredBadge(raidBuffs.inferred, raidBuffs.unknownCells);
    const top = blind || inferred ? `<div class="badges">${blind}${inferred}</div>` : "";
    if (!players.length || !cols.length) return `${top}<div class="empty">Keine Raid-Buffs im Log.</div>`;
    // the group version counts like the single one, and the tooltip says so
    const head = cols.map((r) => `<th class="bh">${hicon(r.icon, `${r.label}${r.groupLabel ? ` / ${r.groupLabel}` : ""} (${r.provider})${r.inferred ? " · aus dem Verlauf abgeleitet" : ""}`)}</th>`).join("");
    const cover = cols.map((r) => `<td class="bc">${r.expected ? pctCell(r.coveragePct) : "<span class=\"pct pct-na\">–</span>"}</td>`).join("");
    const body = players.map((p) => {
        const href = linkFor && linkFor(p.name);
        const name = href ? `<a class="cn" href="${esc(href)}">${esc(p.name)}</a>` : `<span class="cn">${esc(p.name)}</span>`;
        const cells = cols.map((r) => {
            const c = p.buffs && p.buffs[r.key];
            if (!c) return "<td class=\"bc\"><span class=\"pct pct-na\">–</span></td>";
            const open = c.unknown ? `, ${c.unknown}× nicht nachweisbar` : "";
            const tip = `${c.full}× da, ${c.late || 0}× spät gesetzt, ${c.partial}× nicht durchgehend, ${c.none}× gefehlt${open}`;
            if (c.wrong) return `<td class="bc"><span class="pct pct-wrong" data-tip="${esc(r.label)}" data-tip-sub="${esc(`${c.wrong}× auf der falschen Rolle`)}">${esc(c.pct)}%</span></td>`;
            // nothing judged, only open cells: a question mark, not a percentage of nothing
            if (!c.expected && c.unknown) return `<td class="bc"><span class="pct pct-na" data-tip="${esc(r.label)}" data-tip-sub="${esc(`${c.unknown}× nicht nachweisbar`)}">?</span></td>`;
            if (!c.expected) return `<td class="bc"><span class="pct pct-na" data-tip="${esc(r.label)}" data-tip-sub="${esc(`nicht erwartet, ${c.present}× da`)}">${esc(c.pct)}%</span></td>`;
            return `<td class="bc" data-tip="${esc(r.label)}" data-tip-sub="${esc(tip)}">${pctCell(c.pct)}</td>`;
        }).join("");
        return `<tr style="--cc:${esc(classColorOf(p.type) || "var(--text)")}"><td>${name}<div class="sritems">${esc(p.type)} · ${esc(BUFF_ROLE_LABELS[p.role] || p.role)} · ${esc(p.fights)} ${p.fights === 1 ? "Kampf" : "Kämpfe"}</div></td>${cells}</tr>`;
    }).join("");
    const pal = raidBuffs.paladins || 0;
    const how = `Anteil der Bosskämpfe, in denen der Buff die ganze Zeit auf dem Spieler lag (bis zu seinem Tod). Erwartet wird, was die Aufstellung hergibt: ${pal} Paladin${pal === 1 ? "" : "e"} heißt ${pal === 1 ? "ein Segen" : `${pal} Segen`} pro Spieler, Macht auf Tanks und Nahkämpfer, Weisheit auf Heiler und Caster. Gruppenversionen (Große Segen, Gebete, Gabe der Wildnis, Arkane Brillanz) zählen wie die Einzelbuffs. Grau: nicht erwartet; gestrichelt: Segen auf der falschen Rolle. Wer wann was nicht hatte, steht in der Sicht Bosse unter „Buffs“.`;
    return `${top}<div class="tbox" style="overflow-x:auto"><table class="idx heal-table buff-matrix"><tr><th data-tip="Raid-Buffs je Spieler" data-tip-sub="${esc(how)}">Spieler</th>${head}</tr><tr class="cov"><td><b>Abdeckung</b><div class="sritems">Raid</div></td>${cover}</tr>${body}</table></div>`;
}

module.exports = {
    INFERRED_HOW, buffIssues, buffParts, renderRaidBuffsPanel,
};
