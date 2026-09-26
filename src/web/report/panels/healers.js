// Healers: a fight's healing topic (ranked list, mana curves, tank auras) and the
// raid-wide healer table.
const { fmtTime, lineChart, ribbonChart } = require("../../charts");
const { TANK_AURAS } = require("../../../config/healerSpells");
const { esc } = require("../layout");
const { expBtn, badge, LINE, barCell, healBar, HEAL_BAR_HOW, hicon, classColorOf, pctTone, classIconName, fmtK, fmtSecs, num } = require("../widgets");
const { topicTable } = require("../fightTopics");

// ---- Heilung: the healers' topic of a fight (f.healers, utils/logcheck/healers.js) ----
//   healers[]  { name, type, diedAt, healing: { total, overheal, absorbs, overhealPct, spells[] }, mana: { available, step, values, min, minAt, regen[] }, potionMissing, dispels: { count, avgReactionMs } }
//   tank       { name, type } · shields[] { key, label, icon, source, bands | stacks, maxStacks, uptimePct, gapCount, fullStacksPct }
//   dispels    { total, missed: [{ at, ability, icon, target, targetType, durationMs }] }

/**
 * One healer's block, in two halves: `table` (headline chips + the spell
 * table — what the card shows) and `chart` (the mana curve with its
 * regeneration — what the dialog shows).
 */
function healerBlock(x, f, common) {
    const heal = x.healing || { total: 0, overheal: 0, absorbs: 0, overhealPct: 0, spells: [] };
    const mana = x.mana || { available: false };
    const tone = (v, hi, mid) => (v >= hi ? "high" : v >= mid ? "medium" : "good");
    const chips = [
        `<span class="chip" data-tip="Effektive Heilung in diesem Kampf" data-tip-sub="Ohne den Anteil, der über volle Lebenspunkte ging (Overheal)."><b>${fmtK(heal.total)}</b> Heilung</span>`,
        `<span class="chip chip-${tone(heal.overhealPct, 50, 35)}" data-tip="Anteil der Heilung, die über volle Lebenspunkte ging" data-tip-sub="Ab 35 % gelb, ab 50 % rot. Welcher Zauber es war, steht in der Tabelle."><b>${esc(heal.overhealPct)} %</b> Overheal</span>`,
        heal.absorbs ? `<span class="chip" data-tip="Absorbierter Schaden durch Schilde dieses Heilers"><b>${fmtK(heal.absorbs)}</b> Absorb</span>` : "",
        mana.available ? `<span class="chip chip-${mana.min < 10 ? "high" : mana.min < 20 ? "medium" : "good"}" data-tip="Niedrigster Manastand im Kampf und wann er erreicht war" data-tip-sub="Unter 20 % gelb, unter 10 % rot. Die Kurve mit Tränken und Regeneration steht hinter „Verlauf öffnen“."><b>${esc(mana.min)} %</b> Mana-Tiefstand bei ${fmtTime(mana.minAt)}</span>` : "",
        x.dispels && x.dispels.count ? `<span class="chip" data-tip="Dispels dieses Heilers im Kampf" data-tip-sub="Ø: mittlere Zeit vom Anlegen des Debuffs bis zum Dispel."><b>${esc(x.dispels.count)}</b> Dispels${x.dispels.avgReactionMs !== null && x.dispels.avgReactionMs !== undefined ? ` · Ø ${fmtSecs(x.dispels.avgReactionMs)}` : ""}</span>` : "",
        x.potionMissing ? "<span class=\"chip chip-medium\" data-tip=\"Kein Manatrank, obwohl der Kampf lang genug war und das Mana tief genug fiel\"><b>kein</b> Manatrank</span>" : "",
    ].filter(Boolean).join("");
    const manaChart = mana.available
        ? lineChart({
            duration: f.duration, deaths: f.deaths, classColor: common.classColor, step: mana.step, max: 100, unit: "%", markersLabel: "Regeneration",
            series: [{ key: "a", label: `Mana ${x.name}`, values: mana.values }],
            markers: (mana.regen || []).map((r) => ({ at: r.at, icon: r.icon, label: r.label, value: r.pct !== null && r.pct !== undefined ? `bei ${r.pct} %` : undefined })),
        })
        : "<div class=\"fc-empty\">Kein Manaverlauf im Log (keine Ressourcen-Events).</div>";
    // ranked by what landed, the strongest spell first; the bar carries the overheal on top of it
    const spells = (heal.spells || []).slice(0, 6).sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
    const maxRaw = Math.max(1, ...spells.map((s) => (Number(s.total) || 0) + (Number(s.overheal) || 0)));
    const table = spells.length
        ? `<table class="idx fc-table heal-spells"><tr><th></th><th>Zauber</th><th data-tip="Heilung und Overheal des Zaubers in einem Balken" data-tip-sub="${esc(HEAL_BAR_HOW)} Die Zahl rechts ist der Overheal-Anteil: ab 35 % gelb, ab 50 % rot.">Heilung · Overheal</th><th data-tip="Anteil an der gesamten Heilung dieses Heilers im Kampf">Anteil</th></tr>${spells.map((s, i) =>
            `<tr><td class="rank">${i + 1}</td><td>${s.icon ? hicon(s.icon, "") : ""}${esc(s.name)}</td><td>${healBar(s.total, s.overheal, maxRaw, s.overhealPct, `${num(s.total)} effektive Heilung, ${num(s.overheal)} Overheal (${s.overhealPct} %)${s.casts ? ` · ${s.casts} Casts` : ""}`, HEAL_BAR_HOW)}</td><td>${barCell(`${s.share} %`, s.share, "")}</td></tr>`).join("")}</table>`
        : "";
    const died = x.diedAt !== null && x.diedAt !== undefined ? ` · gestorben ${fmtTime(x.diedAt)}` : "";
    const head = `<h4 class="heal-h"><span class="cn">${esc(x.name)}</span><span class="meta">${esc(x.type)}${died}</span></h4>`;
    const style = `style="--cc:${esc(classColorOf(x.type) || "var(--text)")}"`;
    // the list row: rank, who, the one bar, mana and dispels as badges, the rest as hints; the block opens under it
    const row = (rank, maxRaw, dialogId) => {
        const manaBadge = mana.available
            ? badge(`${mana.min} % bei ${fmtTime(mana.minAt)}`, mana.min < 10 ? "bad" : mana.min < 20 ? "mid" : "ok", "inv_potion_137")
            : badge("kein Verlauf", "", "inv_potion_137");
        const dispelBadge = x.dispels && x.dispels.count
            ? badge(`${x.dispels.count}${x.dispels.avgReactionMs !== null && x.dispels.avgReactionMs !== undefined ? ` · Ø ${fmtSecs(x.dispels.avgReactionMs)}` : ""}`, "ok", "spell_holy_dispelmagic")
            : badge("0", "", "spell_holy_dispelmagic");
        const hints = [
            heal.absorbs ? badge(`${fmtK(heal.absorbs)} Absorb`, "", "inv_misc_gem_01") : "",
            x.diedAt !== null && x.diedAt !== undefined ? badge(`gestorben ${fmtTime(x.diedAt)}`, "bad", "ability_creature_cursed_05") : "",
            x.potionMissing ? badge("kein Manatrank", "mid", "inv_potion_137") : "",
        ].filter(Boolean).join("");
        const openChart = dialogId ? `<div style="display:flex;justify-content:flex-end"><button type="button" class="btn btn-ghost btn-sm" data-dialog="dlg-${esc(dialogId)}">${hicon("inv_misc_pocketwatch_01", "")}Manaverlauf öffnen${LINE.expand}</button></div>` : "";
        return `<details class="hrow" ${style}${rank === 1 ? " open" : ""}>
      <summary><span class="rank${rank === 1 ? " top" : ""}">${rank}</span><div class="who">${hicon(classIconName(x.type), "")}<div><span class="cn">${esc(x.name)}</span><span class="sritems">${esc(x.type)}</span></div></div>${healBar(heal.total, heal.overheal, maxRaw, heal.overhealPct, `${num(heal.total)} effektive Heilung, ${num(heal.overheal || 0)} Overheal (${heal.overhealPct} %)`, HEAL_BAR_HOW)}${manaBadge}${dispelBadge}<div class="hints">${hints}</div>${expBtn()}</summary>
      <div class="hrow-body"><div class="heal-chips">${chips}</div>${table}${openChart}</div>
    </details>`;
    };
    return {
        row,
        raw: (Number(heal.total) || 0) + (Number(heal.overheal) || 0),
        total: Number(heal.total) || 0,
        table: `<div class="heal-block" ${style}>${head}<div class="heal-chips">${chips}</div>${table}</div>`,
        chart: `<div class="heal-block" ${style}>${head}${manaChart}</div>`,
    };
}

/**
 * The Heilung topic of one fight: { count, tone, sub, table, chart }, or null
 * without healers. `only` restricts it to one raider. The table half carries
 * the healers' numbers and the never-removed debuffs, the chart half the mana
 * curves and the shields on the tank.
 */
function healingParts(f, only, common, partId) {
    const h = f.healers;
    if (!h || !(h.healers || []).length) return null;
    const healers = h.healers.filter((x) => !only || x.name === only);
    // the tank sees every aura on them, a healer only their own
    const isTank = !!(only && h.tank && h.tank.name === only);
    const shields = (h.shields || []).filter((r) => !only || isTank || r.source === only);
    if (!healers.length && !shields.length) return null;
    const blocks = healers.map((x) => healerBlock(x, f, common));
    // on the raid page: every healer as one row, ranked by what landed, the strongest open; their block under it
    const ranked = blocks.slice().sort((a, b) => b.total - a.total);
    const maxRaw = Math.max(1, ...ranked.map((b) => b.raw));
    const hlist = !only && ranked.length
        ? `<div class="hlist"><div class="hcols"><span class="kicker">#</span><span class="kicker">Heiler</span><span class="kicker" data-tip="Heilung und Overheal in einem Balken" data-tip-sub="${esc(HEAL_BAR_HOW)}">Heilung · Overheal</span><span class="kicker" data-tip="Niedrigster Manastand im Kampf und wann">Mana-Tiefstand</span><span class="kicker" data-tip="Dispels und die mittlere Reaktionszeit">Dispels</span><span class="kicker">Hinweise</span><span></span></div>${ranked.map((b, i) => b.row(i + 1, maxRaw, partId)).join("")}</div>`
        : "";
    let tankTable = "";
    let tankChart = "";
    if (h.tank && shields.length) {
        const rows = shields.map((r) => {
            const def = TANK_AURAS.find((a) => a.key === r.key) || {};
            return {
                label: `${r.label} (${r.source})`, icon: r.icon,
                bands: r.stacks && r.stacks.length ? r.stacks : r.bands, maxStacks: r.maxStacks || 0,
                value: `${r.uptimePct}%`,
                sub: r.maxStacks && r.fullStacksPct !== null && r.fullStacksPct !== undefined ? `${r.maxStacks}/${r.maxStacks}: ${r.fullStacksPct} %` : (r.gapCount ? `${r.gapCount} Lücke${r.gapCount === 1 ? "" : "n"}` : ""),
                tone: def.expectPct ? pctTone(r.uptimePct) : undefined,
            };
        });
        const head = `<h4 class="heal-h">Schilde &amp; HoTs auf ${esc(h.tank.name)}<span class="meta">Tank · ${esc(h.tank.type)}</span></h4>`;
        tankTable = `<div class="heal-block">${head}${topicTable(rows, f.duration, "bands")}</div>`;
        tankChart = `<div class="heal-block">${head}${ribbonChart({ ...common, rows })}</div>`;
    }
    let missed = "";
    const list = (h.dispels && h.dispels.missed) || [];
    if (!only && list.length) {
        missed = `<div class="heal-block"><h4 class="heal-h">Nie entfernte Debuffs<span class="meta">${list.length}</span></h4><ul class="fight-deaths">${list.map((m) =>
            `<li style="--cc:${esc(classColorOf(m.targetType) || "var(--text)")}"><b>${fmtTime(m.at)}</b><span class="cn">${esc(m.target)}</span><span class="sritems">· ${m.icon ? hicon(m.icon, "") : ""}${esc(m.ability)} · ${fmtTime(m.durationMs)} lang</span></li>`).join("")}</ul></div>`;
    }
    const lowMana = healers.filter((x) => x.mana && x.mana.available && x.mana.min < 10).length;
    const tone = lowMana || (!only && list.length >= 3) ? "bad" : healers.some((x) => x.healing && x.healing.overhealPct >= 35) ? "mid" : "ok";
    return {
        count: healers.length, tone,
        sub: only ? "" : `${healers.length} Heiler`,
        table: (hlist || blocks.map((b) => b.table).join("")) + tankTable + missed,
        chart: blocks.map((b) => b.chart).join("") + tankChart,
    };
}

/** The Heiler tab: one row per healer over the raid, the raid's missed dispels above. */
function renderHealersPanel(healers, linkFor) {
    const players = healers.players || [];
    const ranked = players.slice().sort((a, b) => (Number(b.healingTotal) || 0) - (Number(a.healingTotal) || 0));
    const maxRaw = Math.max(1, ...ranked.map((p) => (Number(p.healingTotal) || 0) + (Number(p.overhealTotal) || 0)));
    const rows = ranked.map((p, i) => {
        const href = linkFor && linkFor(p.name);
        const name = href ? `<a class="cn" href="${esc(href)}">${esc(p.name)}</a>` : `<span class="cn">${esc(p.name)}</span>`;
        const top = p.topOverheal ? `${p.topOverheal.icon ? hicon(p.topOverheal.icon, "") : ""}${esc(p.topOverheal.name)} <span class="sritems">${esc(p.topOverheal.overhealPct)} %</span>` : "–";
        const late = (p.potionPcts || []).filter((x) => x <= 15).length;
        const potions = `${esc(p.potions)}${late ? ` <span class="tag tag-medium">${late}× spät</span>` : ""}${p.potionMissingFights ? ` <span class="tag tag-medium">${esc(p.potionMissingFights)}× keiner</span>` : ""}`;
        const shields = (p.shields || []).map((s) => `<span class="sh" data-tip="${esc(s.label)}" data-tip-sub="${esc(`Ø ${s.uptimeAvg} % Uptime auf dem aktiven Tank in ${s.fights} Kämpfen`)}">${hicon(s.icon, "")}${esc(s.uptimeAvg)} %</span>`).join("") || "–";
        const mana = p.manaMinAvg === null || p.manaMinAvg === undefined ? "–" : `${esc(p.manaMinAvg)} %`;
        return `<tr style="--cc:${esc(classColorOf(p.type) || "var(--text)")}"><td class="rank">${i + 1}</td><td>${name}<div class="sritems">${esc(p.type)} · ${esc(p.fights)} ${p.fights === 1 ? "Kampf" : "Kämpfe"}</div></td><td>${healBar(p.healingTotal, p.overhealTotal, maxRaw, p.overhealPct, `${num(p.healingTotal)} effektive Heilung, ${num(p.overhealTotal || 0)} Overheal (${p.overhealPct} %) über ${p.fights} ${p.fights === 1 ? "Kampf" : "Kämpfe"}`, HEAL_BAR_HOW)}</td><td>${top}</td><td>${mana}${p.manaLowFights ? ` <span class="tag tag-high">${esc(p.manaLowFights)}× &lt; 10 %</span>` : ""}</td><td>${potions}</td><td>${esc(p.dispels)}${p.avgReactionMs !== null && p.avgReactionMs !== undefined ? ` <span class="sritems">Ø ${fmtSecs(p.avgReactionMs)}</span>` : ""}</td><td>${shields}</td></tr>`;
    }).join("");
    const raid = healers.raid || {};
    const missed = raid.dispelsMissed
        ? `<span class="badge mid" data-tip="${esc(`${raid.dispelsMissed} dispelbare Debuffs hat niemand entfernt`)}" data-tip-sub="${esc((raid.missedByAbility || []).slice(0, 4).map((m) => `${m.ability} (${m.count}×)`).join(", "))}">${hicon("spell_holy_dispelmagic", "")}${esc(raid.dispelsMissed)} nie dispellt</span>`
        : "";
    const tanks = (raid.tanks || []).length ? `<span class="badge" data-tip="Schild- und HoT-Uptimes gemessen auf dem aktiven Tank" data-tip-sub="Manaverlauf und Zauber pro Kampf stehen in der Sicht Bosse unter „Heilung“.">${hicon("inv_shield_06", "")}Tank: ${esc(raid.tanks.join(", "))}</span>` : "";
    return `${tanks || missed ? `<div class="badges">${tanks}${missed}</div>` : ""}<div class="tbox scrollx"><table class="idx heal-table"><tr><th></th><th>Heiler</th><th data-tip="Heilung und Overheal über alle Boss-Kämpfe in einem Balken, der stärkste Heiler zuerst" data-tip-sub="${esc(HEAL_BAR_HOW)} Die Zahl rechts ist der Overheal-Anteil: ab 35 % gelb, ab 50 % rot.">Heilung · Overheal</th><th data-tip="Der Zauber mit dem höchsten Overheal-Anteil">Größter Overheal</th><th data-tip="Niedrigster Manastand je Kampf, im Mittel" data-tip-sub="Dahinter: in wie vielen Kämpfen es unter 10 % fiel.">Ø Mana-Tiefstand</th><th data-tip="Manatränke über alle Kämpfe" data-tip-sub="Spät: erst unter 15 % Mana getrunken. Keiner: kein Trank in einem Kampf, der ihn hergegeben hätte.">Manatränke</th><th data-tip="Entfernte Debuffs und die mittlere Reaktionszeit">Dispels</th><th data-tip="Uptime der Schilde und HoTs auf dem aktiven Tank">Auf dem Tank</th></tr>${rows}</table></div>`;
}

module.exports = {
    healingParts, renderHealersPanel,
};
