// Putting the recommendations into words with Claude.
//
// The rules (recommendations.js) decide *what* was found — the numbers, the
// boss, the evidence. This asks Claude to say *how*: one short, friendly,
// concrete paragraph per finding, in German, addressed to the raider, with
// the evidence in the sentence. The generated text is kept as `item.ai` next
// to the rule's own `text`; the raid lead's rewrite (`custom`) still wins over
// both, and the approval step is untouched — nothing goes out because a
// model phrased it.
//
// Without an API key (Einstellungen → Verbindungen → KI-Formulierung) this
// module is never called; the page then shows the rule text.
const { createAnthropicClient } = require("../../classes/anthropic");

const DEFAULT_MODEL = "claude-opus-5";
const CONCURRENCY = 4;

const SYSTEM = `Du formulierst Rückmeldungen an Raider einer World-of-Warcraft-Gilde (TBC Classic) nach einem Raidabend. Du bekommst pro Raider eine Liste von Befunden aus der Log-Auswertung, jeder mit Titel, dem technischen Hinweistext und Belegen (Zahlen, Bosse).

Schreibe zu jedem Befund einen eigenen kurzen Absatz (zwei bis vier Sätze) auf Deutsch, in der Du-Form, direkt an den Raider gerichtet. Konkret, freundlich, ohne Vorwurf, ohne Floskeln, ohne Emojis. Nenne die Zahl oder den Boss aus dem Beleg im Satz. Sag, was beim nächsten Mal anders sein soll, nicht nur was falsch war. Erfinde keine Zahlen und keine Ursachen, die nicht in den Belegen stehen. Keine Anrede und keine Grußformel – nur die Absätze.

Antworte ausschließlich mit einem JSON-Array von Objekten { "key": <key des Befunds>, "text": <dein Absatz> }, für jeden Befund genau ein Objekt, in derselben Reihenfolge, ohne Markdown und ohne weitere Zeichen davor oder danach.`;

/** The user turn for one raider: the findings as the model should see them. */
function buildPrompt(report, player) {
    const lines = [
        `Raid: ${report.title || "Raid"}${report.zone ? ` (${report.zone})` : ""}${report.date ? `, ${report.date}` : ""}`,
        `Raider: ${player.name}, Klasse ${player.type || "unbekannt"}`,
        "",
        "Befunde:",
    ];
    for (const item of player.items) {
        const ev = (item.evidence || []).map((e) => `${e.label}: ${e.value}`).join("; ");
        lines.push(`- key: ${item.key}`);
        lines.push(`  Titel: ${item.title}`);
        lines.push(`  Hinweis: ${item.text}`);
        lines.push(`  Gewicht: ${item.impact}`);
        if (ev) lines.push(`  Belege: ${ev}`);
    }
    return lines.join("\n");
}

/** Pull the JSON array out of the answer, tolerating stray prose or a code fence. */
function parseAnswer(text) {
    const raw = String(text || "");
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end <= start) throw new Error("Antwort enthält kein JSON-Array.");
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) throw new Error("Antwort ist kein Array.");
    const out = new Map();
    for (const row of parsed) {
        if (row && typeof row.key === "string" && typeof row.text === "string" && row.text.trim()) out.set(row.key, row.text.trim());
    }
    return out;
}

/** The text of the first text block of a response. */
function textOf(response) {
    return (response.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

/**
 * Phrase one raider's findings. Returns key → text for every finding the
 * model answered; a finding it skipped keeps the rule text.
 *
 * @param {object} client  Anthropic client
 * @param {object} opts    { model }
 */
async function phrasePlayer(client, report, player, { model = DEFAULT_MODEL } = {}) {
    if (!player.items.length) return new Map();
    const response = await client.beta.messages.create({
        model,
        max_tokens: 4096,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: buildPrompt(report, player) }],
    });
    if (response.stop_reason === "refusal") throw new Error("Das Modell hat die Anfrage abgelehnt.");
    if (response.stop_reason === "max_tokens") throw new Error("Antwort abgeschnitten (max_tokens).");
    return parseAnswer(textOf(response));
}

/**
 * Phrase every raider's findings of a report (or the named raiders) and write
 * the texts into `report.recommendations.players[].items[].ai`. Raiders whose
 * request fails keep the rule text and are listed in `errors`.
 *
 * @param {object} report
 * @param {object} opts  { apiKey, model?, only?: string[], client? (for tests), concurrency? }
 * @returns {Promise<{ phrased: number, players: number, errors: Array<{ name, error }>, model: string }>}
 */
async function phraseReport(report, { apiKey, model = DEFAULT_MODEL, only = null, client = null, concurrency = CONCURRENCY } = {}) {
    if (!client && !apiKey) throw new Error("Kein Anthropic-API-Key hinterlegt.");
    const api = client || createAnthropicClient({ apiKey });
    const rec = report.recommendations || { players: [] };
    const players = (rec.players || []).filter((p) => p.items.length && (!only || only.includes(p.name)));
    const errors = [];
    let phrased = 0;
    let done = 0;
    const queue = [...players];
    const worker = async () => {
        while (queue.length) {
            const p = queue.shift();
            try {
                const texts = await phrasePlayer(api, report, p, { model });
                for (const item of p.items) {
                    const text = texts.get(item.key);
                    if (text) { item.ai = text; phrased++; }
                }
                done++;
            } catch (e) {
                errors.push({ name: p.name, error: (e && e.message) || String(e) });
            }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, players.length || 1)) }, worker));
    report.recommendationPhrase = { at: Date.now(), model, phrased, players: done, errors };
    return { phrased, players: done, errors, model };
}

module.exports = { phraseReport, phrasePlayer, buildPrompt, parseAnswer, DEFAULT_MODEL, SYSTEM };
