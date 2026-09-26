// The findings (report.recommendations): one row per finding with the verdict
// buttons, the raid's list and the "Alle senden" box.
const { applyReview } = require("../../utils/logcheck/recommendations");
const { esc } = require("./layout");
const { expBtn, badge, LINE, ibtn, hicon } = require("./widgets");
const { formatGermanDateTime } = require("../../utils/time");

// ---- Empfehlungen: what each raider and the raid should do differently (report.recommendations) ----
//
// The rules (utils/logcheck/recommendations.js) produce the findings; the raid
// lead approves, rejects or rewrites each one here before anything goes out to
// a raider. A visitor without review rights sees only what was approved.

const IMPACT_LABEL = { high: "hoch", medium: "mittel", low: "gering" };

/** Whether this visitor may review: full admins and anyone with write access to the CLA area. */
function canReview(user) {
    if (!user) return false;
    if (user.isAdmin) return true;
    const cla = user.access && user.access.cla;
    return !!(cla && cla.write);
}

function reviewedRecommendations(report) {
    return applyReview(report.recommendations, report.recommendationReview);
}

const IMPACT_TONE = { high: "bad", medium: "mid", low: "" };

const STATE_LABEL = { approved: "freigegeben", rejected: "nicht senden", open: "offen" };

const STATE_TONE = { approved: "ok", rejected: "bad", open: "mid" };

/** Up to `max` evidence badges of a finding: the label muted, the value in text colour. */
function evidenceBadges(item, max = 2) {
    return (item.evidence || []).slice(0, max).map((e) =>
        `<span class="badge ev-b" data-tip="${esc(e.label)}" data-tip-sub="${esc(e.value)}">${esc(e.label)} <b>${esc(e.value)}</b></span>`).join("");
}

/**
 * One finding as one row (Befundzeile): impact badge, title, up to two
 * evidence badges, the status badge and — for a reviewer — the three verdict
 * icon buttons (approve, reject, edit). The text sits in the foldable body,
 * with "Eigenen Text schreiben" and "Regeltext zeigen" for a reviewer.
 * Clicking the active verdict again takes it back.
 */
function recItem(item, scope, player, reviewer, opts = {}) {
    const state = item.approved === true ? "approved" : item.approved === false ? "rejected" : "open";
    // the raid lead's own words first, then Claude's phrasing, then the rule's text
    const text = item.custom || item.ai || item.text;
    const source = item.custom ? "" : item.ai ? "<span class=\"rec-source\" data-tip=\"Von Claude formuliert\" data-tip-sub=\"Der Regeltext dahinter steht im Tooltip des Textes.\">KI</span>" : "";
    const status = reviewer || state !== "open" ? `<span class="badge rec-state ${STATE_TONE[state]}">${STATE_LABEL[state]}</span>` : "";
    const acts = reviewer
        ? `<span class="acts rec-review" data-scope="${esc(scope)}" data-player="${esc(player || "")}" data-key="${esc(item.key)}">${
            ibtn(LINE.check, "Freigeben", "Geht erst nach der Freigabe an den Raider. Ein zweiter Klick nimmt die Entscheidung zurück.", "data-review=\"approve\"", state === "approved" ? "ok" : "")}${
            ibtn(LINE.ban, "Nicht senden", "Der Punkt bleibt im Report, geht aber nicht raus. Ein zweiter Klick nimmt die Entscheidung zurück.", "data-review=\"reject\"", state === "rejected" ? "bad" : "")}${
            ibtn(LINE.pencil, "Text bearbeiten", "Eine eigene Formulierung geht vor dem KI- und dem Regeltext.", "data-review=\"edit\"")}</span>`
        : `<span class="acts">${expBtn()}</span>`;
    const hasRule = !!(item.ai || item.custom) && item.text;
    const tools = reviewer
        ? `<div class="row-btns"><button type="button" class="btn btn-ghost btn-sm" data-review="edit">${LINE.pencil}Eigenen Text schreiben</button>${hasRule ? `<button type="button" class="btn btn-ghost btn-sm" data-review="rule">${LINE.undo}Regeltext zeigen</button>` : ""}<span class="rec-status"></span></div>
        <div class="rec-edit" hidden><textarea class="rec-text" rows="3" placeholder="Eigene Formulierung (leer = Vorschlag so lassen)">${esc(item.custom || "")}</textarea><div class="row-btns"><button type="button" class="btn btn-sm" data-review="save">Text speichern</button></div></div>`
        : "";
    return `<details class="rec rrow-d rec-${esc(item.impact)} rec-state-${state}" data-key="${esc(item.key)}"${opts.open ? " open" : ""}>
      <summary class="rrow"><span>${badge(IMPACT_LABEL[item.impact] || item.impact, IMPACT_TONE[item.impact] || "")}</span><span class="t rec-title" data-tip="${esc(item.title)}">${esc(item.title)}</span><span class="ev">${evidenceBadges(item)}</span><span class="st">${status}</span>${acts}</summary>
      <div class="rbody">
        <p class="rec-body"${item.ai && !item.custom ? ` data-tip="Regeltext" data-tip-sub="${esc(item.text)}"` : ""}>${source}${esc(text)}</p>
        ${reviewer && hasRule ? `<p class="rec-rule" hidden><span class="rec-source">Regel</span>${esc(item.text)}</p>` : ""}
        ${(item.evidence || []).length > 2 ? `<div class="badges">${(item.evidence || []).slice(2, 6).map((e) => `<span class="badge ev-b">${esc(e.label)} <b>${esc(e.value)}</b></span>`).join("")}</div>` : ""}
        ${tools}
      </div>
    </details>`;
}

/** The raid's findings (Sicht Raid): every finding with verdict controls for a reviewer, the approved ones for everyone else. */
function renderRaidRecommendations(rec, reviewer) {
    const raid = reviewer ? (rec.raid || []) : (rec.raid || []).filter((i) => i.approved === true);
    if (!raid.length) return "<div class=\"rlist rec-list\"><div class=\"rec-empty\">Nichts, was den ganzen Raid gekostet hätte.</div></div>";
    return `<div class="rlist rec-list">${raid.map((i) => recItem(i, "raid", "", reviewer)).join("")}</div>`;
}

/**
 * The body of the "Alle senden" dialog for reviewers: how many raiders have
 * approved points, who was already written to, the mapping check, the
 * phrasing job and the button that sends the rest as Discord DMs. The
 * per-raider mapping state is loaded from /api/cla/recommendations/send on
 * demand, so the page itself needs no store access.
 */
function renderSendBox(report) {
    const rec = reviewedRecommendations(report);
    const approved = (rec.players || []).filter((p) => p.items.some((i) => i.approved === true));
    const sent = report.recommendationSent || {};
    const sentNames = approved.filter((p) => sent[p.name]);
    const phrase = report.recommendationPhrase;
    const phraseBadge = phrase
        ? `<span class="badge accent rec-phrase-meta" data-tip="${esc(`KI-Formulierung vom ${formatGermanDateTime(phrase.at)}`)}" data-tip-sub="${esc(`${phrase.model}: ${phrase.phrased} Texte für ${phrase.players} Raider${(phrase.errors || []).length ? `, ${phrase.errors.length} Fehler` : ""}`)}">${hicon("inv_scroll_03", "")}${esc(phrase.phrased)} KI-Texte</span>`
        : "";
    return `<div class="rec-send" data-report="${esc(report.id)}">
      <div class="badges rec-send-meta">${badge(`${approved.length} Raider mit freigegebenen Punkten`, approved.length ? "ok" : "", "inv_misc_note_01")}${badge(`${sentNames.length} bereits angeschrieben`, "", "inv_letter_15")}${phraseBadge}</div>
      <div class="dtools">
        <button type="button" class="btn btn-ghost btn-sm" data-send="status">${LINE.search}Zuordnung prüfen</button>
        <button type="button" class="btn btn-run btn-sm" data-phrase="all" data-tip="Claude formuliert jeden Befund in Klartext" data-tip-sub="Deine Freigabe bleibt nötig; der Regeltext bleibt erhalten.">${hicon("inv_scroll_03", "")}KI-Formulierung</button>
        <span class="grow"></span>
        <button type="button" class="btn btn-sm" data-send="all"${approved.length ? "" : " disabled"}>${hicon("inv_letter_15", "")}Freigegebenes per DM senden</button>
      </div>
      <div class="rec-send-result" hidden></div>
    </div>`;
}

module.exports = {
    IMPACT_LABEL, canReview, IMPACT_TONE, recItem, renderRaidRecommendations, renderSendBox,
};
