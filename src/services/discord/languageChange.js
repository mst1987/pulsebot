// What happens when the server language (config.botLanguage, Einstellungen)
// changes: every public message the bot keeps up to date is drawn again in the
// new language. Called by PATCH /api/settings after a change, not awaited —
// Discord edits are slow and never hold up the save. Never throws.
//
//   panels         the absence/attendance panels (availabilityPanel)
//   eventMessages  the signup messages of the last two days and the coming
//                  ones: their stored hash carries the language, so the sweep
//                  redraws each one (eventMessage.sweepEventMessages)
//   talkOverview   the raid overview of every event server (talkOverview.syncOverview,
//                  queued behind a running sync; its hash carries the language too)
//   setupMessages  the posted setup messages of those events (setupMessage.refreshSetupMessages)
const logger = require("../../logger");
const availabilityPanel = require("../signups/availabilityPanel");
const eventMessage = require("../events/eventMessage");
const talkOverview = require("../talk/talkOverview");
const setupMessage = require("../setup/setupMessage");

async function afterServerLangChange({ config } = {}) {
    const steps = [
        ["panels", () => availabilityPanel.refreshPanels({ config })],
        ["eventMessages", () => eventMessage.sweepEventMessages()],
        ["talkOverview", () => talkOverview.syncOverview(config ? { config } : {})],
        ["setupMessages", () => setupMessage.refreshSetupMessages()],
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
