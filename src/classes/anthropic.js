const Anthropic = require("@anthropic-ai/sdk");

// The one place an Anthropic client is created (#429). The key comes from the
// settings (Einstellungen → Verbindungen → KI-Formulierung) and is passed in
// by the caller — never from .env. Users today: the recommendation phrasing
// (utils/logcheck/recommendationText.js) and the setup explanation
// (utils/setup/explainText.js). Prompts, model and call shape stay with them.
//
// Not built on classes/httpClient.js: the SDK brings its own transport,
// timeouts and retries (429/5xx), and its errors carry `status` already.

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @returns {Anthropic}
 */
function createAnthropicClient({ apiKey } = {}) {
    if (!apiKey) throw new Error("Kein Anthropic-API-Key hinterlegt.");
    return new Anthropic({ apiKey });
}

module.exports = { createAnthropicClient };
