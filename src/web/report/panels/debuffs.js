// Debuffs on the boss: the raid summary with its debuff × boss matrix, Sunder
// Armor and the boss uptimes.
const { bossIconUrl } = require("../../../config/bosses");
const { fmtTime } = require("../../charts");
const { esc } = require("../layout");
const { classCell, badge, barPct, yesNo, hicon, toneCell, naCell } = require("../widgets");
const { fightOutcome, groupByBoss } = require("../fightTopics");

// ---- Raid-Debuffs: what the raid put on the boss (report.raidDebuffs, utils/logcheck/raidDebuffs.js) ----
//
// The raid summary (one row per debuff: expected?, mean uptime, on how many
// fights it was missing) comes from `raidDebuffs.rows`; the debuff × boss
// matrix under it is rendered purely from the timeline's per-fight rows
// (`timeline.fights[].debuffs`), nothing is stored for it.

const SUNDER_HOW = "„< 5 Stacks“ sind Sunder, die angewandt wurden, während der Boss noch keine 5 Stacks hatte (Stack-Aufbau).";

const DEBUFFS_HOW = "Debuffs auf dem Boss, gemittelt über alle Boss-Kämpfe. Erwartet wird, was die Aufstellung hergibt: ein Hexenmeister heißt Fluch der Elemente, ein Krieger Rüstung zerreißen; was nur eine Skillung liefert (Elend, Winterkälte), zählt erst, sobald es einmal im Log lag.";

function renderSunderPanel(rows, linkFor) {
    if (!rows || rows.length === 0) return "<div class=\"empty\">Keine Sunder-Armor-Daten gefunden.</div>";
    const body = rows.map((p) => {
        const warn = p.below5 > 0 ? "mid" : "ok";
        return `<tr>
          <td>${classCell(p, linkFor(p.name))}</td>
          <td class="srval">${esc(p.total)}</td>
          <td>${badge(String(p.below5), warn, "", true)}</td>
        </tr>`;
    }).join("");
    return `<div class="tbox"><table class="idx">
      <tr><th>Spieler</th><th>Sunder gesamt</th><th data-tip="Davon bei weniger als 5 Stacks" data-tip-sub="${esc(SUNDER_HOW)}">davon bei &lt; 5 Stacks</th></tr>
      ${body}
    </table></div>`;
}

function uptimeCell(v) {
    return barPct(Number(v) || 0);
}

function renderBossUptimesPanel(data) {
    if (!data || !data.rows || data.rows.length === 0) return "<div class=\"empty\">Keine Boss-Daten gefunden.</div>";
    const head = data.metrics.map((m) => `<th data-tip="${esc(m.label)}" data-tip-sub="Debuff-Uptime pro Boss-Kampf in % der Kampfdauer. Ab 95 % grün, ab 70 % gelb.">${esc(m.label)}</th>`).join("");
    const body = data.rows.map((r) => {
        const cells = data.metrics.map((m) => `<td>${uptimeCell(r[m.key] || 0)}</td>`).join("");
        const boss = r.kill ? esc(r.boss) : `${esc(r.boss)} <span class="sritems">(Wipe)</span>`;
        return `<tr><td>${boss}</td>${cells}</tr>`;
    }).join("");
    return `<div class="tbox scrollx"><table class="idx">
      <tr><th>Boss</th>${head}</tr>
      ${body}
    </table></div>`;
}

/**
 * Debuff × boss: per boss (in pull order, kills and wipes together) the mean
 * uptime over its tries, the tries themselves in the tooltip.
 *
 * The expectation is raid-wide — raidDebuffs.js derives it once from the
 * whole roster and stamps it on every fight's row as `expected` — so a debuff
 * has a row on every fight or on none; the one exception is an exclusive
 * group (Sunder/Expose, the judgements) covered by another member on that
 * pull, whose row is dropped. A boss without any row for the debuff therefore
 * reads "–": nothing was expected there. Expected and absent on every try is
 * "fehlte" (0 % in the high tone), not a blank.
 */
function debuffMatrix(rows, timeline) {
    const fights = (timeline && timeline.fights) || [];
    if (!rows.length || !fights.length) return "";
    const bosses = groupByBoss(fights);
    const head = bosses.map((b) => {
        const icon = bossIconUrl(b.encounterId);
        const kills = b.fights.filter((f) => f.kill).length;
        const state = kills ? `Kill${b.fights.length > 1 ? ` nach ${b.fights.length} Tries` : ""}` : `${b.fights.length} Wipe${b.fights.length === 1 ? "" : "s"}`;
        return `<th class="bh">${icon ? `<img src="${esc(icon)}" alt="">` : ""}<span class="boss-name">${esc(b.name)}</span><span class="sritems">${esc(state)}</span></th>`;
    }).join("");
    const body = rows.map((r) => {
        const cells = bosses.map((b) => {
            const tries = b.fights.map((f, j) => ({ f, no: j + 1, d: (f.debuffs || []).find((d) => d.key === r.key) })).filter((t) => t.d);
            if (!tries.length) return `<td class="bc">${naCell(`${r.label} auf ${b.name}: nicht erwartet`)}</td>`;
            const pct = (t) => (Number.isFinite(t.d.uptimePct) ? t.d.uptimePct : 0);
            const mean = Math.round(tries.reduce((n, t) => n + pct(t), 0) / tries.length);
            const detail = tries.map((t) => `Try ${t.no} (${fightOutcome(t.f)}): ${pct(t)} %`).join(" · ");
            const expected = tries.some((t) => t.d.expected);
            let cell;
            if (expected && tries.every((t) => t.d.missing || pct(t) === 0)) {
                cell = `<span class="pct pct-none" data-tip="${esc(`${r.label} fehlte auf ${b.name} · ${detail}`)}">0%</span>`;
            } else if (!expected) {
                cell = naCell(`${r.label} auf ${b.name}: nicht erwartet · ${detail}`, `${mean}%`);
            } else {
                cell = toneCell(mean, `${r.label} auf ${b.name}: ${detail}`);
            }
            let sub = "";
            if (r.maxStacks) {
                const ttm = tries.map((t) => t.d.timeToMax).filter((v) => Number.isFinite(v) && v !== null);
                if (ttm.length) sub = `<div class="sritems">max ab ${fmtTime(ttm.reduce((n, v) => n + v, 0) / ttm.length)}</div>`;
            }
            return `<td class="bc">${cell}${sub}</td>`;
        }).join("");
        return `<tr><td class="dn">${hicon(r.icon, "")}${esc(r.label)}<div class="sritems">${esc(r.provider)}${r.maxStacks ? ` · ${esc(r.maxStacks)} Stacks` : ""}</div></td>${cells}</tr>`;
    }).join("");
    return `<div class="dsub"><span data-tip="Debuff × Boss" data-tip-sub="Mittlere Uptime über alle Tries eines Bosses (Kills und Wipes zusammen); die einzelnen Tries stehen im Tooltip. „–“: dort nicht erwartet, weil kein Anbieter dabei war oder ein anderer Debuff derselben Gruppe lag. Bei stackenden Debuffs darunter, ab wann im Mittel die vollen Stacks lagen.">Debuff × Boss</span></div>
    <div class="tbox" style="overflow-x:auto"><table class="idx heal-table buff-matrix debuff-matrix"><tr><th>Debuff</th>${head}</tr>${body}</table></div>`;
}

/** The Raid-Debuffs tab: the raid summary per debuff, the debuff × boss matrix under it. */
function renderRaidDebuffsPanel(raidDebuffs, timeline) {
    const rows = (raidDebuffs && raidDebuffs.rows) || [];
    if (!rows.length) return "<div class=\"empty\">Keine Raid-Debuffs im Log.</div>";
    const body = rows.map((r) => {
        const fights = r.fights || 0;
        const stacks = r.maxStacks
            ? (r.avgBelowMax !== null && r.avgBelowMax !== undefined ? `${esc(r.avgBelowMax)}% unter ${esc(r.maxStacks)}` : `bis ${esc(r.maxStacks)}`)
            : "–";
        return `<tr>
          <td class="dn">${hicon(r.icon, "")}${esc(r.label)}<div class="sritems">${esc(r.provider)}</div></td>
          <td>${yesNo(r.expected)}</td>
          <td>${r.expected ? toneCell(r.avgUptime) : naCell("nicht erwartet", `${r.avgUptime}%`)}</td>
          <td>${r.expected ? (r.missing ? `<span class="pct pct-none">${esc(r.missing)}/${esc(fights)}</span>` : `<span class="pct pct-full">0/${esc(fights)}</span>`) : naCell("", "–")}</td>
          <td class="sritems">${stacks}</td>
        </tr>`;
    }).join("");
    return `<div class="tbox"><table class="idx">
      <tr><th>Debuff</th><th data-tip="Erwartet" data-tip-sub="${esc(DEBUFFS_HOW)}">Erwartet</th><th data-tip="Ø Uptime" data-tip-sub="Gemittelt über alle Boss-Kämpfe. Ab 95 % grün, ab 70 % gelb.">Ø Uptime</th><th>Gefehlt</th><th>Stacks</th></tr>
      ${body}
    </table></div>
    ${debuffMatrix(rows, timeline)}`;
}

module.exports = {
    SUNDER_HOW, DEBUFFS_HOW, renderSunderPanel, uptimeCell, renderBossUptimesPanel, renderRaidDebuffsPanel,
};
