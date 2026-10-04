// What happens when the server language (config.botLanguage, Einstellungen)
// changes: every public message the bot keeps up to date is drawn again in the
// new language. Called by PATCH /api/settings after a change, not awaited —
// Discord edits are slow and never hold up the save. Never throws.
const logger = require("../../logger");
const availabilityPanel = require("../signups/availabilityPanel");

async function afterServerLangChange({ config } = {}) {
    const steps = [
        ["panels", () => availabilityPanel.refreshPanels({ config })],
    ];
    const out = {};
    for (const [name, run] of steps) {
        try {
            out[name] = await run();
        } catch (e) {
            out[name] = { error: (e && e.message) || String(e) };
            logger.warn(`[language] ${name}: ${out[name].error}`);
        }
    }
    return out;
}

module.exports = { afterServerLangChange };
