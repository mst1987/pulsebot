// Sicht Raider: one card per raider with four sections, the paperdoll, the send
// dialog, and the role filter above the cards.
const { CLASS_COLORS } = require("../../utils/setupView");
const { itemLink: wowheadItemLink } = require("../../utils/wowhead");
const { plural } = require("../../utils/text");
const { fmtTime, PX_PER_SEC } = require("../charts");
const { ICONS } = require("../adminChrome");
const { esc } = require("./layout");
const { iconUrl, classIconUrl, expBtn, tile, badge, LINE, ibtn, armoryButton, dlgClose, detailDialog, barCell, barPct, hicon, iconTile, iconRow, classColorOf, fmtK, fmtSecs, naCell, num } = require("./widgets");
const { CONS_HOW } = require("./panels/consumables");
const { potionCells } = require("./panels/potions");
const { INFERRED_HOW } = require("./panels/buffs");
const { playerFights, renderPlayerTimeline } = require("./bossView");
const { IMPACT_LABEL, IMPACT_TONE, recItem } = require("./recommendations");
const { abilityIcon } = require("./panels/damage");
const { RPB_ACTIVITY_HOW, spellTiles } = require("./panels/rpb");
const { ROLE_LABEL } = require("./context");

// ---- Sicht Raider: one card per raider ------------------------------------------

/** The armory paperdoll (character-sheet layout) with the mean item level, or a note without one. */
function paperdoll(p) {
    const color = CLASS_COLORS[p.type] || "#ddd";
    if (!(p.armory || []).length) return "<div class=\"empty\">Keine Ausrüstung im Log.</div>";
    const bySlot = {};
    for (const it of p.armory || []) bySlot[it.slot] = it;
    const avgIlvl = meanItemLevel(p);
    const LEFT = [0, 1, 2, 14, 4, 8];
    const RIGHT = [9, 5, 6, 7, 10, 11, 12, 13];
    const BOTTOM = [15, 16, 17];
    return `<div class="doll" style="--cc:${color}">
        <div class="pd-col pd-col-left">${LEFT.map((s) => paperdollSlot(bySlot[s], "left")).join("")}</div>
        <div class="pd-center">
          <div class="portrait" style="--cc:${color}"><img src="${esc(classIconUrl(p.type))}" alt=""></div>
          <div class="ilvl-badge"><b>${avgIlvl}</b><span>Ø iLvl</span></div>
        </div>
        <div class="pd-col pd-col-right">${RIGHT.map((s) => paperdollSlot(bySlot[s], "right")).join("")}</div>
      </div>
      <div class="doll-bottom">${BOTTOM.map((s) => paperdollSlot(bySlot[s], "bottom")).join("")}</div>`;
}

function meanItemLevel(p) {
    const ilvls = (p.armory || []).map((i) => i.itemLevel).filter((n) => n > 0);
    return ilvls.length ? Math.round(ilvls.reduce((a, b) => a + b, 0) / ilvls.length) : 0;
}

/** One key/value line of a box. */
function kv(icon, label, right, attrs = "") {
    return `<div class="kv"${attrs}><span class="k">${icon ? hicon(icon, "") : ""}<span>${label}</span></span>${right}</div>`;
}

/** A box of the raider sections: head with icon, title and one badge, then its lines. */
function infoBox(icon, title, headBadge, rows) {
    return `<div class="box"><div class="box-head">${hicon(icon, "")}<b>${esc(title)}</b>${headBadge || ""}</div>${rows || "<div class=\"kv mute\">Keine Daten.</div>"}</div>`;
}

/** Vorbereitung of one raider: gear problems, consumables, buffs as three boxes. { count, tone, badge, html, dialogs } */
function raiderPrep(ctx, p, i) {
    const { report } = ctx;
    const name = p.name;
    const issues = ((ctx.gearByName.get(name) || {}).issues || p.issues || []);
    const high = issues.some((x) => x.severity === "high");
    const boxes = [];
    let dialogs = "";

    // Gear: only the problem items, the paperdoll behind "Ausrüstung"
    const gearRows = issues.map((it) => {
        const inner = `${it.icon ? hicon(it.icon, "") : ""}<span>${esc(it.itemName)}</span>`;
        const label = it.itemId ? `<a class="item" href="${esc(wowheadItemLink(it.itemId))}" target="_blank" rel="noopener">${inner}</a>` : inner;
        return `<div class="kv"><span class="k">${label}</span>${badge(it.label, it.severity === "high" ? "bad" : "mid")}</div>`;
    }).join("");
    const armory = (p.armory || []).length;
    const gearFoot = armory
        ? `<div class="kv"><span class="k mute"><span>Ø Itemlevel ${meanItemLevel(p)} · ${armory} Slots</span></span><button type="button" class="btn btn-ghost btn-sm" data-dialog="dlg-pd-${i}">${hicon("inv_shield_06", "")}Ausrüstung</button></div>`
        : "<div class=\"kv mute\"><span class=\"k\"><span>Keine Ausrüstung im Log.</span></span></div>";
    boxes.push(infoBox("inv_shield_06", "Gear", issues.length ? badge(plural(issues.length, "Problem", "Probleme"), high ? "bad" : "mid") : badge("ok", "ok"), gearRows + gearFoot));
    if (armory) {
        dialogs += detailDialog(`pd-${i}`, "inv_shield_06", "", `Ausrüstung · <span class="cn" style="--cc:${esc(classColorOf(p.type) || "var(--text)")}">${esc(name)}</span>`, `${name} › Vorbereitung › Ausrüstung · beim Pull gesehen`, paperdoll(p));
    }

    // Consumables
    const cons = ctx.consByName.get(name);
    const pot = ctx.potByName.get(name) || p.potions || {};
    const ic = report.icons || {};
    const consIcons = (report.consumables && report.consumables.icons) || ic;
    let consRows = "";
    if (cons) {
        consRows += kv(consIcons.flask || "inv_alchemy_endlessflask_05", "Flask / Elixiere", barPct(cons.buffed, "Flask oder beide Elixiere", CONS_HOW));
        consRows += kv(consIcons.food, "Food", barPct(cons.food));
        consRows += kv("", "Waffe geölt", cons.weaponOiled ? badge("ja", "ok") : badge("nein", "mid"));
    }
    const hasPotionData = !!(report.potions && report.potions.players && report.potions.players.length);
    if (hasPotionData) {
        const byType = pot.byType || {};
        const types = ((report.potions && report.potions.types) || []).filter((t) => byType[t.key]).sort((a, b) => byType[b.key] - byType[a.key]);
        const total = pot.total || (pot.destruction || 0) + (pot.haste || 0) + (pot.mana || 0);
        consRows += `<div class="kv"><span class="k">${hicon(ic.mana || "inv_potion_137", "")}<span>Tränke</span></span><span class="mono" data-tip="Tränke" data-tip-sub="${esc(`Zerstörung ${pot.destruction || 0} · Hast ${pot.haste || 0} · Mana ${pot.mana || 0}`)}"><span class="potions">${potionCells(ic, pot)}</span></span>${types.length ? badge(`${types[0].label} ${byType[types[0].key]}`, "") : badge(String(total), "", "", true)}</div>`;
    } else {
        consRows += kv("inv_potion_137", "Tränke", "<span class=\"mute\" data-tip=\"Noch keine CLA-Auswertung für diesen Log\">nicht ausgewertet</span>");
    }
    const drums = ctx.drumsByName.get(name);
    if (drums) consRows += kv(report.drums && report.drums.icon, "Drums", `<span class="mono" data-tip="Drums" data-tip-sub="${esc(Object.entries(drums.byType || {}).map(([k, v]) => `${k}: ${v}`).join(", "))}">${esc(drums.total)}</span>`);
    const sr = ctx.srByName.get(name);
    if (sr) consRows += kv("spell_shadow_antishadow", "Shadow-Resi", `<span class="mono" data-tip="Schattenwiderstand aus Gear" data-tip-sub="${esc((sr.items || []).map((it) => `${it.itemName} (+${it.sr})`).join(", ") || "–")}">${esc(sr.sr)}</span>`);
    boxes.push(infoBox("inv_alchemy_endlessflask_05", "Consumables", cons ? (cons.buffed >= 90 ? badge("ok", "ok") : badge(`${cons.buffed} %`, cons.buffed < 50 ? "bad" : "mid")) : "", consRows));

    // Buffs: one line per buff with its bar, "?" for a buff the log cannot prove
    const b = ctx.buffsByName.get(name);
    let buffIssuesN = 0;
    if (b) {
        const cols = ((report.raidBuffs && report.raidBuffs.rows) || []).filter((r) => r.expected || r.seenPlayers > 0 || (r.unknown || 0) > 0);
        const rows = cols.map((r) => {
            const c = b.buffs && b.buffs[r.key];
            if (!c) return "";
            const counts = `${c.full}× da, ${c.late || 0}× spät gesetzt, ${c.partial}× nicht durchgehend, ${c.none}× gefehlt${c.unknown ? `, ${c.unknown}× nicht nachweisbar` : ""}`;
            let right;
            if (c.wrong) right = badge(`${c.wrong}× falsche Rolle`, "mid");
            else if (!c.expected && c.unknown) right = `<span class="badge count" data-tip="${esc(r.label)}: nicht nachweisbar" data-tip-sub="${esc(INFERRED_HOW)}">?</span><span class="mute">nicht nachweisbar</span>`;
            else if (!c.expected) right = badge("nicht erwartet", "");
            else right = `${barPct(c.pct, r.label, counts)}${c.unknown ? `<span class="badge count" data-tip="${esc(`${c.unknown}× nicht nachweisbar`)}" data-tip-sub="${esc(INFERRED_HOW)}">?</span>` : ""}`;
            return kv(r.icon, esc(r.label), right, ` data-tip="${esc(r.label)}" data-tip-sub="${esc(`${r.provider}. ${counts}`)}"`);
        }).join("");
        buffIssuesN = (b.missing || 0) + (b.partial || 0) + (b.late || 0) + (b.wrong || 0);
        boxes.push(infoBox("spell_magic_greaterblessingofkings", "Buffs", buffIssuesN ? badge(`${buffIssuesN} lückenhaft`, (b.missing || 0) >= 2 ? "bad" : "mid") : badge("alle da", "ok"), rows));
    }

    const problems = issues.length + (b ? (b.missing || 0) : 0) + (cons && cons.buffed < 90 ? 1 : 0);
    const tone = high || (b && b.missing >= 2) || (cons && cons.buffed < 50) ? "bad" : problems ? "mid" : "ok";
    const headBadge = issues.length ? badge(plural(issues.length, "Gear-Problem", "Gear-Probleme"), high ? "bad" : "mid") : b && b.missing ? badge(`Buff fehlte ${b.missing}×`, "mid") : badge("vorbereitet", "ok");
    return { count: problems ? String(problems) : "ok", tone, badge: headBadge, html: `<div class="cols3">${boxes.join("")}</div>`, dialogs };
}

/** Leistung of one raider: activity & cooldowns, totems, healing & mana, the RPB's spells and cooldowns. */
function raiderPerf(ctx, p) {
    const name = p.name;
    const act = ctx.actByName.get(name);
    const cd = ctx.cdByName.get(name);
    const tot = ctx.totByName.get(name);
    const h = ctx.healByName.get(name);
    const rAct = ctx.rpbActByName.get(name);
    const use = ctx.rpbUseByName.get(name);
    const boxes = [];
    if (act || cd) {
        let rows = "";
        if (act) {
            rows += kv("inv_misc_pocketwatch_02", "Aktivität", barPct(act.activeAvg, "Anteil der Kampfzeit mit laufenden Zaubern oder Angriffen", "Im Mittel über die Kämpfe, bis zum eigenen Tod."));
            rows += kv("", "Lücken", `<span class="mono" data-tip="Lücken" data-tip-sub="${esc(`unerklärt ${fmtTime(act.unexplainedMs)}${act.mechanicMs ? ` · durch Mechanik ${fmtTime(act.mechanicMs)}` : ""}`)}">${esc(act.gaps)} · längste ${fmtTime(act.longestGap)}</span>`);
        }
        if (cd) {
            rows += kv("ability_rogue_preparation", "Cooldowns", cd.usedPct === null || cd.usedPct === undefined ? naCell("", "–") : barPct(cd.usedPct, "Genutzte Cooldowns gegen die möglichen", `${cd.uses} von ${cd.possible} möglichen Einsätzen`));
            rows += kv("spell_nature_bloodlust", "Ø erster Einsatz", `<span class="mono">${cd.avgFirstAtMs === null || cd.avgFirstAtMs === undefined ? "–" : fmtTime(cd.avgFirstAtMs)}</span>${badge(`${cd.stacked} im Lust`, "")}`);
        }
        const low = act && act.activeAvg < 85;
        boxes.push(infoBox("inv_misc_pocketwatch_02", "Aktivität & Cooldowns", act ? badge(`${act.activeAvg} %`, act.activeAvg >= 95 ? "ok" : low ? "mid" : "") : "", rows));
    }
    if (tot) {
        const rows = kv("spell_nature_windfury", "Windfury Ø", tot.wfUptimeAvg === null || tot.wfUptimeAvg === undefined ? naCell("", "–") : barPct(tot.wfUptimeAvg))
            + kv("", "Twisting", `<span class="mono">${esc(tot.twistingFights)} von ${esc(tot.wfFights)} Kämpfen</span>`)
            + kv("", "Downtime", `<span class="mono">${fmtTime(tot.downtimeMs)} · ${esc(tot.gapCount)} Lücken</span>`);
        boxes.push(infoBox("spell_nature_windfury", "Totems", tot.gapCount ? badge(`${tot.gapCount} Lücken`, tot.gapCount >= 3 ? "mid" : "") : badge("ok", "ok"), rows));
    }
    if (h) {
        const late = (h.potionPcts || []).filter((x) => x <= 15).length;
        let rows = kv("spell_holy_flashheal", "Heilung", `<span class="mono">${fmtK(h.healingTotal)}</span><span class="mute">in ${plural(h.fights, "Kampf", "Kämpfen")}</span>`)
            + kv("", "Overheal", barCell(`${h.overhealPct} %`, h.overhealPct, h.overhealPct >= 50 ? "high" : h.overhealPct >= 35 ? "medium" : "", "Anteil der Heilung über volle Lebenspunkte", `Ab 35 % gelb, ab 50 % rot.${h.topOverheal ? ` Am meisten: ${h.topOverheal.name} (${h.topOverheal.overhealPct} %).` : ""}`));
        if (h.manaMinAvg !== null && h.manaMinAvg !== undefined) rows += kv("inv_potion_137", "Ø Mana-Tiefstand", `<span class="mono">${esc(h.manaMinAvg)} %</span>${h.manaLowFights ? badge(`${h.manaLowFights}× unter 10 %`, "bad") : ""}`);
        rows += kv("", "Manatränke", `<span class="mono">${esc(h.potions)}</span>${late ? badge(`${late}× spät`, "mid") : ""}${h.potionMissingFights ? badge(`${h.potionMissingFights}× keiner`, "mid") : ""}`);
        rows += kv("spell_holy_dispelmagic", "Dispels", `<span class="mono">${esc(h.dispels)}${h.avgReactionMs !== null && h.avgReactionMs !== undefined ? ` · Ø ${fmtSecs(h.avgReactionMs)}` : ""}</span>`);
        rows += (h.shields || []).map((s) => kv(s.icon, `${esc(s.label)} auf dem Tank`, barPct(s.uptimeAvg))).join("");
        boxes.push(infoBox("spell_holy_flashheal", "Heilung & Mana", h.manaLowFights ? badge(`${h.manaLowFights}× unter 10 % Mana`, "bad") : badge(`Overheal ${h.overhealPct} %`, h.overhealPct >= 35 ? "mid" : ""), rows));
    }
    if (rAct || use) {
        let rows = "";
        if (rAct) {
            rows += kv("inv_misc_pocketwatch_02", "Aktiv (RPB)", barPct(rAct.relativeTotal, "Anteil Raidzeit", RPB_ACTIVITY_HOW));
            const spells = spellTiles([...(rAct.singleTargetCasts || []), ...(rAct.aoeCasts || [])]);
            if (spells.length) rows += `<div class="kv stack">${iconRow(spells)}</div>`;
        }
        if (use) {
            const tiles = [
                ...(use.classCooldowns || []).map((c) => iconTile({ icon: c.icon, name: c.name, spellId: c.spellId, label: c.label, count: c.total, note: c.possibleUses ? `${c.total} von ~${c.possibleUses} möglichen` : "", tone: c.possibleUses && c.total < c.possibleUses / 2 ? "warn" : "good" })),
                ...(use.trinketsAndRacials || []).map((t) => iconTile({ icon: t.icon, name: t.name, spellId: t.spellId, label: t.label, count: t.total })),
                ...[...(use.engineering || []), ...(use.absorbs || [])].map((t) => iconTile({ icon: t.icon, name: t.name, spellId: t.spellId, label: t.label, count: t.total })),
            ];
            if (tiles.length) rows += `<div class="kv stack"><span class="kicker">Cooldowns &amp; Schmuckstücke</span>${iconRow(tiles)}</div>`;
        }
        const down = rAct ? [...(rAct.singleTargetCasts || []), ...(rAct.aoeCasts || [])].filter((r) => r.mostlyLowerRank).length : 0;
        boxes.push(infoBox("inv_misc_book_11", "Zauber & Cooldowns", `${down ? badge(`${down} Rang-Warnung${down === 1 ? "" : "en"}`, "mid") : ""}${badge("RPB", "accent")}`, rows));
    }
    if (!boxes.length) return null;
    const dips = ctx.report.fightSeries && (ctx.report.fightSeries.players || []).find((x) => x && x.name === name);
    const count = act ? `${act.activeAvg} %` : h ? `${h.overhealPct} % Overheal` : cd && cd.usedPct !== null && cd.usedPct !== undefined ? `${cd.usedPct} %` : "";
    const tone = (act && act.activeAvg < 85) || (h && h.manaLowFights) ? (h && h.manaLowFights ? "bad" : "mid") : (cd && cd.usedPct !== null && cd.usedPct < 80) || (dips && dips.dipPct >= 25) ? "mid" : "ok";
    const headBadge = cd && cd.usedPct !== null && cd.usedPct !== undefined ? badge(`Cooldowns ${cd.usedPct} %`, cd.usedPct < 80 ? "mid" : "") : act ? badge(`${act.activeAvg} % aktiv`, act.activeAvg < 85 ? "mid" : "") : h ? badge(`Overheal ${h.overhealPct} %`, h.overhealPct >= 35 ? "mid" : "") : badge("RPB", "accent");
    return { count, tone, badge: headBadge, html: `<div class="cols3">${boxes.join("")}</div>` };
}

/** Fehler of one raider: mechanics, deaths with the boss and the killing blow, the RPB's avoidable damage, interrupts and sunders. */
function raiderErr(ctx, p) {
    const { report } = ctx;
    const name = p.name;
    const mech = ctx.mechByName.get(name);
    const dmg = ctx.rpbDmgByName.get(name);
    const kicks = ctx.rpbIntByName.get(name);
    const sunder = ctx.sunderByName.get(name);
    const deaths = [];
    for (const f of ctx.fights) for (const d of f.deaths || []) if (d.name === name) deaths.push({ ...d, boss: f.boss });
    if (!mech && !dmg && !kicks && !sunder && !deaths.length) return null;
    const boxes = [];
    if (mech) {
        const rows = Object.values(mech.byMechanic || {}).sort((a, b) => b.hits - a.hits).map((m) => kv(m.icon, esc(m.label), `${badge(`${m.hits}×`, m.hits >= 3 ? "bad" : m.hits === 2 ? "mid" : "", "", true)}${m.amount ? `<span class="mono mute">${fmtK(m.amount)}</span>` : ""}`)).join("");
        boxes.push(infoBox("spell_fire_selfdestruct", "Mechaniken", badge(`${mech.hits} Treffer`, mech.hits >= 3 ? "bad" : mech.hits ? "mid" : "ok"), rows || kv("", "Keine vermeidbaren Treffer", "")));
    }
    const nDeaths = mech ? mech.deaths || 0 : deaths.length || (dmg ? dmg.deaths || 0 : 0);
    const avoidable = mech ? mech.avoidableDeaths || 0 : deaths.filter((d) => d.avoidable).length;
    if (deaths.length || mech) {
        const rows = deaths.map((d) => kv(d.abilityIcon || "ability_creature_cursed_05", `${esc(d.boss)} <span class="mono mute">${fmtTime(d.at)}</span>`, `${d.ability ? `<span class="mute">${esc(d.ability)}</span>` : ""}${d.avoidable ? badge("vermeidbar", "bad") : d.early ? badge("früh", "mid") : d.nearEnd ? badge("kurz vor dem Kill", "") : ""}`)).join("");
        boxes.push(infoBox("ability_creature_cursed_05", "Tode", badge(`${nDeaths}${avoidable ? ` · ${avoidable} vermeidbar` : ""}`, avoidable ? "bad" : nDeaths ? "mid" : "ok"), rows || kv("", "Nicht gestorben", badge("0", "ok", "", true))));
    }
    if (dmg || kicks || sunder) {
        let rows = "";
        if (dmg) {
            const abilities = (report.rpb.damage.abilities || []).map((a, i) => ({ a, v: dmg.perAbility[i] || 0 })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
            rows += abilities.map((x) => `<div class="kv"><span class="k">${abilityIcon(x.a)}<span data-tip="${esc(x.a.label)}" data-tip-sub="${esc((x.a.sources || []).join(", "))}">${esc(x.a.label)}</span></span><span class="mono">${num(x.v)}</span></div>`).join("");
            rows += kv("", "<b>Summe vermeidbar</b>", `<span class="mono">${num(dmg.avoidableTotal)}</span>`);
        }
        if (kicks) rows += kv("spell_frost_iceshock", "Unterbrechungen", `<span class="mono">${esc(kicks.count)}</span>${iconRow((kicks.spells || []).map((s) => iconTile({ icon: s.icon, spellId: s.spellId, label: s.name, count: s.count })))}`);
        if (sunder) rows += kv("ability_warrior_sunder", "Sunder Armor", `<span class="mono">${esc(sunder.total)}</span>${badge(`${sunder.below5} bei < 5 Stacks`, "")}`);
        boxes.push(infoBox("spell_shadow_shadowwordpain", dmg ? "Vermeidbarer Schaden" : "Weitere", badge("RPB", "accent"), rows));
    }
    return {
        count: plural(nDeaths, "Tod", "Tode"), tone: avoidable ? "bad" : nDeaths ? "mid" : "ok",
        badge: avoidable ? badge(`${avoidable} vermeidbare${avoidable === 1 ? "r Tod" : " Tode"}`, "bad") : nDeaths ? badge(plural(nDeaths, "Tod", "Tode"), "mid") : badge("keine Tode", "ok"),
        html: `<div class="cols3">${boxes.join("")}</div>`,
    };
}

/**
 * The send dialog of one raider (SendeFenster): head badges, the approved
 * points with their text choice (KI / Regel / Eigener), the DM preview in the
 * Discord look with the mapping state, save and send.
 */
function sendDialog(ctx, p, i, items) {
    const { report } = ctx;
    const approved = items.filter((it) => it.approved === true);
    const open = items.filter((it) => it.approved === null).length;
    const sent = ctx.sent[p.name];
    const idx = (report.roster || []).findIndex((x) => x.name === p.name);
    const PRECEDENCE = "Der eigene Text geht vor dem KI-Text, der KI-Text vor dem Regeltext. Die Wahl wird im Report gespeichert.";
    const blocks = approved.map((it, j) => {
        const mode = it.custom ? "custom" : it.ai ? "ai" : "rule";
        const text = it.custom || it.ai || it.text || "";
        const segBtn = (m, label) => `<button type="button" class="seg-btn${mode === m ? " active" : ""}" data-txt="${m}">${label}</button>`;
        return `<div class="send-item${j === 0 ? " on" : ""}" data-key="${esc(it.key)}" data-title="${esc(it.title)}" data-ai="${esc(it.ai || "")}" data-rule="${esc(it.text || "")}" data-custom="${esc(it.custom || "")}" data-mode="${mode}">
          <div class="send-item-head">${badge(IMPACT_LABEL[it.impact] || it.impact, IMPACT_TONE[it.impact] || "")}<b>${esc(it.title)}</b><nav class="seg sm" data-tip="Welcher Text geht raus?" data-tip-sub="${esc(PRECEDENCE)}">${it.ai ? segBtn("ai", `${hicon("inv_scroll_03", "")}KI`) : ""}${segBtn("rule", "Regel")}${segBtn("custom", `${LINE.pencil}Eigener`)}</nav></div>
          <textarea class="send-text" rows="3"${mode === "custom" ? "" : " readonly"}>${esc(text)}</textarea>
        </div>`;
    }).join("");
    const preview = approved.map((it) => {
        const text = it.custom || it.ai || it.text || "";
        return `<div><b>${esc(it.title)}</b><br>${esc(text.length > 160 ? `${text.slice(0, 160)} …` : text)}</div>`;
    }).join("");
    const link = `/r/${esc(report.id)}${idx >= 0 ? `/p/${idx}` : ""}`;
    const color = classColorOf(p.type) || "var(--text)";
    return `<dialog class="dlg send" id="send-${i}" data-report="${esc(report.id)}" data-player="${esc(p.name)}">
      <div class="dlg-head">${tile("inv_letter_15", "")}<div class="dlg-main"><div class="dlg-title">An <span class="cn" style="--cc:${esc(color)}">${esc(p.name)}</span> senden</div><div class="kicker">${esc(p.name)} › Empfehlungen › Versand · Discord-DM</div></div>${badge(`${approved.length} freigegeben`, approved.length ? "ok" : "")}${open ? `<span class="badge mid" data-tip="${esc(open === 1 ? "Der noch offene Punkt wird nicht gesendet." : `Die ${open} noch offenen Punkte werden nicht gesendet.`)}">${open} offen · wird nicht gesendet</span>` : ""}${dlgClose()}</div>
      <div class="send-grid">
        <div class="send-items">${blocks || "<div class=\"rec-empty\">Noch nichts freigegeben.</div>"}</div>
        <div class="send-preview"><div class="kicker">So kommt es an</div><div class="dm"><div class="dm-head"><span class="crest">${ICONS.crest}</span><b>EventHelper</b>${badge("BOT", "accent")}</div><b>${esc(report.title || "Raid")} · Deine Auswertung</b><span class="mute">${approved.length} Punkt${approved.length === 1 ? "" : "e"} von der Raidleitung geprüft</span><div class="dm-items">${preview}</div><a href="${link}" target="_blank" rel="noopener">Report ansehen${LINE.external}</a></div>
        <div class="badges"><span class="badge map-badge">Zuordnung wird geprüft …</span>${sent ? badge(`gesendet ${new Date(sent.at).toLocaleString("de-DE")}`, "") : badge("noch nie gesendet", "")}</div></div>
      </div>
      <div class="dlg-foot"><span class="note send-out">Ein unveränderter Satz wird nie zweimal geschickt.</span><div class="btns"><button type="button" class="btn btn-ghost btn-sm" data-close>Abbrechen</button><button type="button" class="btn btn-ghost btn-sm" data-sendact="save">Nur speichern</button><button type="button" class="btn btn-sm" data-sendact="send"${approved.length ? "" : " disabled"}>${hicon("inv_letter_15", "")}Per Bot senden</button></div></div>
    </dialog>`;
}

/** What stands out about a raider, worst first, at most three badges; one in `ok` when nothing does. */
function raiderBadges(ctx, p) {
    const name = p.name;
    const issues = ((ctx.gearByName.get(name) || {}).issues || p.issues || []);
    const cons = ctx.consByName.get(name);
    const buffs = ctx.buffsByName.get(name);
    const heal = ctx.healByName.get(name);
    const act = ctx.actByName.get(name);
    const cd = ctx.cdByName.get(name);
    const mech = ctx.mechByName.get(name);
    const recP = ctx.recByName.get(name);
    const items = recP ? (ctx.reviewer ? recP.items : recP.items.filter((x) => x.approved === true)) : [];
    const open = items.filter((x) => x.approved === null).length;
    const out = [];
    const add = (tone, text, icon, tip, sub) => out.push({ tone, html: `<span class="badge ${tone}"${tip ? ` data-tip="${esc(tip)}"` : ""}${sub ? ` data-tip-sub="${esc(sub)}"` : ""}>${hicon(icon, "")}${esc(text)}</span>` });
    if (mech && mech.avoidableDeaths) add("bad", `${mech.avoidableDeaths} vermeidbare${mech.avoidableDeaths === 1 ? "r Tod" : " Tode"}`, "ability_creature_cursed_05", "Tode durch eine Mechanik, der man ausweichen kann");
    if (issues.length) add(issues.some((x) => x.severity === "high") ? "bad" : "mid", plural(issues.length, "Gear-Problem", "Gear-Probleme"), "inv_shield_06", "Gear-Probleme: Verzauberungen, Sockel, Meta-Gem", "Aus der Ausrüstung, die das Log beim Pull gesehen hat.");
    if (heal && heal.manaLowFights) add("bad", `${heal.manaLowFights}× unter 10 % Mana`, "inv_potion_137", "Kämpfe, in denen das Mana unter 10 % fiel");
    if (cons && cons.buffed < 90) add(cons.buffed < 50 ? "bad" : "mid", `Consumables ${cons.buffed} %`, "inv_alchemy_endlessflask_05", "Anteil der Boss-Kämpfe mit Flask oder beiden Elixieren", "Ab 90 % grün, unter 50 % rot.");
    if (buffs && buffs.missing) add(buffs.missing >= 2 ? "bad" : "mid", `Buff fehlte ${buffs.missing}×`, "spell_magic_greaterblessingofkings", "Kämpfe, in denen ein erwarteter Raid-Buff gar nicht auf dem Raider lag");
    if (heal && heal.overhealPct >= 35) add(heal.overhealPct >= 50 ? "bad" : "mid", `Overheal ${heal.overhealPct} %`, "spell_holy_flashheal", "Anteil der Heilung über volle Lebenspunkte", "Ab 35 % gelb, ab 50 % rot.");
    if (!heal && act && act.activeAvg < 85) add("mid", `${act.activeAvg} % aktiv`, "inv_misc_pocketwatch_02", "Anteil der Kampfzeit mit laufenden Zaubern oder Angriffen", "Bis zum eigenen Tod. Unter 85 % gelb.");
    if (cd && cd.usedPct !== null && cd.usedPct !== undefined && cd.usedPct < 80) add("mid", `Cooldowns ${cd.usedPct} %`, "ability_rogue_preparation", "Genutzte Cooldowns gegen die möglichen");
    const dips = ctx.report.fightSeries && (ctx.report.fightSeries.players || []).find((x) => x && x.name === name);
    if (dips && Number.isFinite(dips.dipPct) && dips.dipPct >= 25) add(dips.dipPct >= 40 ? "bad" : "mid", `${dips.dipPct} % Einbrüche`, "spell_nature_bloodlust", `Anteil der Kampfzeit, in der ${dips.measure === "hps" ? "HPS" : "DPS"} unter der Hälfte des eigenen Schnitts lag`, `Bis zum eigenen Tod, über ${plural(dips.fights || 0, "Kampf", "Kämpfe")}. Ab 25 % gelb, ab 40 % rot.`);
    if (open) add("mid", `${open} offen`, "inv_misc_note_01", "Befunde, die noch niemand freigegeben oder verworfen hat");
    if (!ctx.reviewer && items.length) add("accent", plural(items.length, "Empfehlung", "Empfehlungen"), "inv_misc_note_01", "Freigegebene Empfehlungen für diesen Raider");
    const rank = { bad: 0, mid: 1, accent: 2 };
    const shown = out.map((b, j) => ({ ...b, j })).sort((a, b) => rank[a.tone] - rank[b.tone] || a.j - b.j).slice(0, 3);
    if (shown.length) return shown.map((b) => b.html).join("");
    if (act) return badge(`${act.activeAvg} % aktiv`, "ok", "inv_misc_pocketwatch_02");
    if (heal) return badge(`Overheal ${heal.overhealPct} %`, "ok", "spell_holy_flashheal");
    if (cons) return badge(`Consumables ${cons.buffed} %`, "ok", "inv_alchemy_endlessflask_05");
    return badge("Gear ok", "ok", "inv_shield_06");
}

/** The four sections of a raider (Empfehlungen · Vorbereitung · Leistung · Fehler), only those with data: [{ key, label, icon, count, tone, badge, html }] plus their dialogs. */
function raiderSections(ctx, p, i, items, opts = {}) {
    const name = p.name;
    const recP = ctx.recByName.get(name);
    const open = items.filter((x) => x.approved === null).length;
    const secs = [];
    if (recP && (items.length || ctx.reviewer)) {
        secs.push({ key: "recs", label: "Empfehlungen", icon: "inv_misc_note_01", count: `${items.length}${open ? ` · ${open} offen` : ""}`, tone: open ? "mid" : "ok",
            html: items.length ? `<div class="rlist rec-list">${items.map((it, j) => recItem(it, "player", name, ctx.reviewer, { open: opts.openFirst && j === 0 })).join("")}</div>` : "<div class=\"rlist\"><div class=\"rec-empty\">Nichts auszusetzen – weiter so.</div></div>" });
    }
    const prep = raiderPrep(ctx, p, i);
    secs.push({ key: "prep", label: "Vorbereitung", icon: "trade_alchemy", crumb: "Gear · Consumables · Buffs", ...prep });
    const perf = raiderPerf(ctx, p);
    if (perf) secs.push({ key: "perf", label: "Leistung", icon: "spell_nature_bloodlust", crumb: ctx.healByName.get(name) ? "Heilung · Mana · Cooldowns" : "Aktivität · Cooldowns · Zauber", ...perf });
    const err = raiderErr(ctx, p);
    if (err) secs.push({ key: "err", label: "Fehler", icon: "spell_fire_selfdestruct", crumb: "Mechaniken · Tode · vermeidbarer Schaden", ...err });
    return { secs, dialogs: prep.dialogs };
}

/**
 * One raider card (Sicht Raider): class icon, name, role and fight count, at
 * most three badges, the Kampfverlauf and the Spielerseite as icon buttons in
 * the head; four sections behind buttons; for a reviewer the footer with the
 * phrasing job and the send dialog. The dialogs sit after the card, so they
 * open from a closed card too.
 */
function raiderCard(ctx, p, i, opts = {}) {
    const { report, reviewer } = ctx;
    const name = p.name;
    const color = classColorOf(p.type) || "var(--text)";
    const role = ctx.roleOf(name);
    const recP = ctx.recByName.get(name);
    const items = recP ? (reviewer ? recP.items : recP.items.filter((x) => x.approved === true)) : [];
    const open = items.filter((x) => x.approved === null).length;
    const approved = items.filter((x) => x.approved === true).length;
    const fights = playerFights(report.timeline, name);
    const { secs, dialogs } = raiderSections(ctx, p, i, items);

    let timelineDialog = "";
    if (fights.length) {
        const ns = `r${i}-`;
        timelineDialog = `<dialog class="dlg chart" id="dlg-rt-${i}">
          <div class="dlg-head"><img class="vcard-icon" src="${esc(classIconUrl(p.type))}" alt=""><div class="dlg-main"><div class="dlg-title">${hicon("inv_misc_pocketwatch_01", "")}Kampfverlauf · ${esc(name)}</div><div class="vcard-meta">${plural(fights.length, "Kampf", "Kämpfe")} · ${PX_PER_SEC} px pro Sekunde, seitlich scrollen</div></div>${dlgClose()}</div>
          <div class="dlg-body">${renderPlayerTimeline(report.timeline, name, ns)}</div>
          <div class="dlg-foot"><span class="note">Tode als senkrechte Striche in Klassenfarbe · Tabellenansicht unter jeder Grafik aufklappbar</span><div class="btns">${ctx.linkFor(name) ? `<a class="btn btn-ghost btn-sm" href="${esc(ctx.linkFor(name))}">Spielerseite${LINE.external}</a>` : ""}<button type="button" class="btn btn-sm" data-close>Schließen</button></div></div>
        </dialog>`;
    }
    const secId = (k) => `rc${i}-${k}`;
    const buttons = secs.map((s, j) => `<button type="button" class="sec${j === 0 ? " active" : ""}" data-show="${secId(s.key)}">${hicon(s.icon, "")}${esc(s.label)}${s.count !== "" ? `<span class="n${s.tone === "bad" ? " bad" : s.tone === "mid" ? " mid" : ""}">${esc(s.count)}</span>` : ""}</button>`).join("");
    const panels = secs.map((s, j) => `<div id="${secId(s.key)}" class="part"${j === 0 ? "" : " hidden"}>${s.html}</div>`).join("");

    let foot = "";
    let sendDlg = "";
    if (reviewer && recP) {
        const sent = ctx.sent[name];
        foot = `<div class="raider-foot"><span class="note">${approved} freigegeben · ${open} offen · zuletzt gesendet: ${sent ? esc(new Date(sent.at).toLocaleString("de-DE")) : "nie"}</span><span class="rec-send-result" hidden></span><div class="btns"><button type="button" class="btn btn-run btn-sm" data-phrase="player" data-tip="Claude formuliert die Befunde dieses Raiders in Klartext" data-tip-sub="Deine Freigabe bleibt nötig; der Regeltext bleibt erhalten.">${hicon("inv_scroll_03", "")}KI-Formulierung</button><button type="button" class="btn btn-sm" data-dialog="send-${i}"${approved ? "" : " disabled"}>${hicon("inv_letter_15", "")}Vorschau &amp; senden</button></div></div>`;
        sendDlg = sendDialog(ctx, p, i, items);
    }
    const roleIcon = { tank: "inv_shield_06", healer: "spell_holy_flashheal", dps: "ability_dualwield" }[role];
    const meta = [
        badge(p.type, ""),
        ROLE_LABEL[role] ? badge(ROLE_LABEL[role], "accent", roleIcon) : "",
        fights.length ? badge(plural(fights.length, "Kampf", "Kämpfe"), "", "", true) : "",
    ].filter(Boolean).join("");
    const tlBtn = fights.length ? ibtn(hicon("inv_misc_pocketwatch_01", ""), "Kampfverlauf öffnen", `${plural(fights.length, "Kampf", "Kämpfe")} mit eigenen Zeilen: DPS gegen den Raid-Schnitt, Aktivität, Cooldowns, Buffs, Tode.`, `data-dialog="dlg-rt-${i}"`) : "";
    const href = ctx.linkFor(name);
    const pageBtn = href ? `<a class="ibtn" href="${esc(href)}" data-tip="Spielerseite öffnen" data-tip-sub="Die freigegebenen Punkte zuerst, dann die Kämpfe je Boss." aria-label="Spielerseite öffnen">${LINE.external}</a>` : "";
    const armoryBtn = armoryButton(name);
    return `<details class="vcard raider-card" id="raider-${esc(name)}" data-name="${esc(name)}" data-role="${role}" data-open="${reviewer ? open : approved}" data-report="${esc(report.id)}" style="--cc:${esc(color)}"${opts.open ? " open" : ""}>
      <summary><img class="vcard-icon" src="${esc(classIconUrl(p.type))}" alt="${esc(p.type)}"><div class="vcard-main"><div class="vcard-title cn">${esc(name)}</div><div class="vcard-meta">${meta}</div></div><div class="vcard-chips">${raiderBadges(ctx, p)}</div>${tlBtn}${armoryBtn}${pageBtn}${expBtn()}</summary>
      <div class="vcard-body"><nav class="secs">${buttons}</nav>${panels}${foot}</div>
    </details>${timelineDialog}${dialogs}${sendDlg}`;
}

/** Sicht Raider: search, role filter with WoW icons, one icon button for all cards, one card per roster entry. `openName` opens that raider's card. */
function renderRaiderView(ctx, openName) {
    const roster = ctx.report.roster || [];
    if (!roster.length) return "<div class=\"empty\">Keine Raider gefunden.</div>";
    const withOpen = roster.filter((p) => {
        const r = ctx.recByName.get(p.name);
        return r && r.items.some((it) => (ctx.reviewer ? it.approved === null : it.approved === true));
    }).length;
    const cards = roster.map((p, i) => raiderCard(ctx, p, i, { open: openName === p.name })).join("");
    const btn = (key, label, icon, extra, active) => `<button type="button" class="seg-btn${active ? " active" : ""}" data-rolefilter="${key}">${icon ? hicon(icon, "") : ""}${label}${extra || ""}</button>`;
    return `<div class="view-bar"><div class="raider-tools"><label class="field">${LINE.search}<input type="search" id="raiderSearch" placeholder="Raider suchen…" aria-label="Raider suchen"></label><nav class="seg sm">${btn("all", "Alle", "", "", true)}${btn("tank", "Tank", "inv_shield_06")}${btn("healer", "Heiler", "spell_holy_flashheal")}${btn("dps", "DPS", "ability_dualwield")}${btn("open", ctx.reviewer ? "Offen" : "Empfehlungen", "inv_misc_note_01", ` <span class="n${withOpen ? " mid" : ""}">${withOpen}</span>`)}</nav></div>${ibtn(LINE.expandAll, "Alle auf- oder zuklappen", "Betrifft die Karten, die Suche und Filter gerade zeigen.", "data-cards=\"toggle\"")}</div>
    ${cards}<div class="raider-empty" id="raiderEmpty" hidden>Kein Raider passt zu Suche und Filter.</div>`;
}

const QUALITY_COLOR = { 0: "#9d9d9d", 1: "#ffffff", 2: "#1eff00", 3: "#0070dd", 4: "#a335ee", 5: "#ff8000" };

// Wowhead item link with enchant + gems so the tooltip shows the authoritative TBC data.
function wowheadItemUrl(it) {
    const params = [];
    if (it.enchant && it.enchant.enchantId) params.push(`ench=${encodeURIComponent(it.enchant.enchantId)}`);
    const gemIds = (it.gems || []).map((g) => g.id).filter(Boolean);
    if (gemIds.length) params.push(`gems=${gemIds.join(":")}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    return `${esc(wowheadItemLink(it.itemId))}${qs}`;
}

// one equipment slot in the paperdoll (side = "left"/"right"/"bottom" controls alignment)
function paperdollSlot(it, side) {
    if (!it) return `<div class="slot empty-slot slot-${side}"><div class="slot-ph"></div></div>`;
    const q = QUALITY_COLOR[it.quality] !== undefined ? QUALITY_COLOR[it.quality] : "#2c313b";
    const href = wowheadItemUrl(it);
    const img = `<img src="${esc(iconUrl(it.icon))}" loading="lazy" alt="">`;
    // enchant badge + status line (value comes from the Wowhead tooltip, not WCL)
    let badge = "";
    let ench = "";
    if (it.enchant.status === "missing") {
        badge = `<span class="slot-badge b-miss" data-tip="keine Verzauberung">${LINE.close}</span>`;
        ench = "<div class=\"slot-ench miss\">keine Verzauberung</div>";
    } else if (it.enchant.status === "bad") {
        badge = `<span class="slot-badge b-bad" data-tip="${esc(it.enchant.reason || "suboptimale Verzauberung")}">!</span>`;
        ench = `<div class="slot-ench bad">suboptimale Verzauberung${it.enchant.reason ? ` · ${esc(it.enchant.reason)}` : ""}</div>`;
    } else if (it.enchant.status === "ok") {
        badge = `<span class="slot-badge b-ok" data-tip="verzaubert" data-tip-sub="Details im Tooltip des Gegenstands">${LINE.check}</span>`;
        ench = "<div class=\"slot-ench ok\">verzaubert</div>";
    }
    // real gem icons + empty sockets
    let gems = (it.gems || []).map((g) =>
        `<a class="gemicon ${g.bad ? "gem-bad" : ""}" href="${esc(wowheadItemLink(g.id))}" target="_blank" rel="noopener" data-tip="${g.bad ? "suboptimaler Edelstein" : "Edelstein"}"><img src="${esc(iconUrl(g.icon))}" alt=""></a>`).join("");
    for (let i = 0; i < (it.emptySockets || 0); i++) gems += "<span class=\"gemicon gem-empty\" data-tip=\"leerer Sockel\"></span>";
    const gemsRow = gems ? `<div class="slot-gems">${gems}</div>` : "";
    return `<div class="slot slot-${side}">
      <a class="slot-icon" style="border-color:${q}" href="${href}" target="_blank" rel="noopener" data-tip="${esc(it.itemName)}">${img}${badge}</a>
      <div class="slot-info">
        <a class="slot-name" style="color:${q}" href="${href}" target="_blank" rel="noopener">${esc(it.itemName)}</a>
        ${ench}
        ${gemsRow}
      </div>
    </div>`;
}

module.exports = {
    sendDialog, raiderSections, renderRaiderView,
};
