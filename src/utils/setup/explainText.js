// The setup in words (#263): Claude sums up a stored setup for the orga — why
// the groups look the way they do, who sits on the bench and why, what is
// still missing — and reads the raiders' free-text comments ("kommt 20:30") as
// hints worth mentioning.
//
// It only *explains*. The answer is plain text stored next to the setup; it
// never moves a raider, never approves anything, and nothing of it reaches a
// raider. Same client, model setting and call shape as the recommendation
// phrasing (utils/logcheck/recommendationText.js); without an Anthropic key
// (Einstellungen → Verbindungen) the route refuses before this is called.
const Anthropic = require("@anthropic-ai/sdk");
const { DEFAULT_MODEL } = require("../logcheck/recommendationText");
const { ROLE_LABELS } = require("../../config/gameVersions/classes");

const SYSTEM = `Du erklärst der Raidleitung einer World-of-Warcraft-Gilde einen Setup-Vorschlag für einen Raidabend. Du bekommst die Gruppen mit den eingeteilten Raidern (Spec, Rolle und die Gründe, die der Algorithmus genannt hat), die Ersatzbank mit Gründen, die Prüfungen (Rollen, Buffs, Wünsche) und die Kommentare, die Raider bei der Anmeldung geschrieben haben.

Schreibe auf Deutsch eine kurze, sachliche Zusammenfassung in drei bis sechs Absätzen: wie die Gruppen aufgebaut sind und warum (Buffs, Rollen), wer auf der Bank sitzt und warum, was an der Aufstellung noch fehlt oder riskant ist, und welche Kommentare die Raidleitung beachten sollte (zum Beispiel wer später kommt). Nenne Namen. Erfinde nichts, was nicht in den Daten steht, und schlage keine Umstellung als Tatsache vor – höchstens als Frage an die Raidleitung. Keine Überschriften, keine Aufzählungszeichen, kein Markdown, keine Emojis.`;

const roleLabel = (role) => ROLE_LABELS[role] || role || "";

/** The user turn: the setup as the model should read it. */
function buildPrompt(setup, { event = {}, signups = [] } = {}) {
    const bySignup = new Map((signups || []).map((s) => [String(s.userId), s]));
    const lines = [];
    lines.push(`Raid: ${event.title || "Raid"}${event.size ? ` (${event.size} Plätze)` : ""}`);
    const checks = setup.checks || {};
    if (checks.size) lines.push(`Besetzt: ${checks.size.count} von ${checks.size.size}`);
    for (const [role, r] of Object.entries(checks.roles || {})) {
        const target = r.max === null || r.max === undefined ? `mindestens ${r.min}` : (r.min === r.max ? String(r.min) : `${r.min}–${r.max}`);
        lines.push(`${roleLabel(role)}: ${r.count} (Soll ${target})${r.ok ? "" : " – nicht erfüllt"}`);
    }
    const buffs = checks.buffs || {};
    const missingRequired = (buffs.required || []).filter((b) => !b.present).map((b) => b.label);
    if ((buffs.required || []).length) lines.push(`Pflicht-Buffs: ${missingRequired.length ? `fehlt ${missingRequired.join(", ")}` : "alle da"}`);
    const missingRaid = (buffs.raid || []).filter((b) => !b.present).map((b) => b.label);
    if (missingRaid.length) lines.push(`Raid-Buffs, die niemand mitbringt: ${missingRaid.join(", ")}`);
    if (checks.wishes && checks.wishes.total) lines.push(`Wünsche erfüllt: ${checks.wishes.met} von ${checks.wishes.total}`);
    lines.push("");
    const person = (x) => {
        const signup = bySignup.get(String(x.userId));
        const comment = signup && signup.comment ? ` · Kommentar: „${signup.comment}“` : "";
        const reasons = (x.reasons || []).length ? ` · Gründe: ${x.reasons.join("; ")}` : "";
        const flags = [x.locked ? "fixiert" : "", x.main === false ? "Zweitspec" : ""].filter(Boolean).join(", ");
        return `- ${x.character || x.userId} (${x.specLabel || x.spec || "?"}, ${roleLabel(x.role)}${flags ? `, ${flags}` : ""})${reasons}${comment}`;
    };
    for (const g of setup.groups || []) {
        lines.push(`Gruppe ${g.index}:`);
        for (const s of g.slots || []) lines.push(person(s));
    }
    lines.push("", "Ersatzbank:");
    if (!(setup.bench || []).length) lines.push("- niemand");
    for (const b of setup.bench || []) lines.push(person(b));
    const placedIds = new Set([...(setup.groups || []).flatMap((g) => (g.slots || []).map((s) => String(s.userId))), ...(setup.bench || []).map((b) => String(b.userId))]);
    const absent = (signups || []).filter((s) => s.status === "absence" && !placedIds.has(String(s.userId)));
    if (absent.length) {
        lines.push("", "Abgemeldet:");
        for (const s of absent) lines.push(`- ${s.character || s.userId}${s.comment ? ` · Kommentar: „${s.comment}“` : ""}`);
    }
    if ((setup.warnings || []).length) lines.push("", `Hinweise: ${setup.warnings.join(" ")}`);
    return lines.join("\n");
}

function textOf(response) {
    return (response.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

/**
 * Explain one setup.
 * @param {object} setup   the stored setup (groups/bench with reasons, checks)
 * @param {object} ctx     `{ event, signups }`
 * @param {object} opts    `{ apiKey, model?, client? (tests) }`
 * @returns {Promise<{ text: string, model: string }>}
 */
async function explainSetup(setup, ctx = {}, { apiKey, model = DEFAULT_MODEL, client = null } = {}) {
    if (!client && !apiKey) throw new Error("Kein Anthropic-API-Key hinterlegt.");
    const api = client || new Anthropic({ apiKey });
    const response = await api.beta.messages.create({
        model,
        max_tokens: 4096,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: buildPrompt(setup, ctx) }],
    });
    if (response.stop_reason === "refusal") throw new Error("Das Modell hat die Anfrage abgelehnt.");
    if (response.stop_reason === "max_tokens") throw new Error("Antwort abgeschnitten (max_tokens).");
    const text = textOf(response);
    if (!text) throw new Error("Leere Antwort.");
    return { text, model };
}

module.exports = { explainSetup, buildPrompt, SYSTEM };
