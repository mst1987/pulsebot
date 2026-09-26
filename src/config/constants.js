// Fixed facts and tuning values of the bot: ids that belong to someone else
// (the Raid-Helper bot user), colours, timeouts. Unlike config/defaults.js
// nothing here is meant to be changed in the admin menu, and unlike
// config/env.js nothing here depends on the machine the bot runs on.

// The Discord user id of the Raid-Helper bot — its messages are the Raid-Helper
// events in a channel (utils/raidhelper/channelEvents.js, commands/setup/signup.js).
const RAIDHELPER_BOT_ID = "579155972115660803";

// Visual identity: accent used for the colour bar on bot embeds, matching the
// admin web UI's --accent token (violet/cyan redesign, 2026-07).
const EMBED_ACCENT_COLOR = 0x8a7cff;

// How long an ephemeral bot reply stays before it is deleted (utils/discord/reply.js).
const REPLY_DELETE_AFTER_MS = 60000;

// The multi-step /apply flow (utils/applicationState.js): a pending application
// is dropped after 30 minutes — the modal has to be submitted promptly — and a
// sweep looks for such leftovers every 5 minutes.
const APPLICATION_STALE_AFTER_MS = 30 * 60 * 1000;
const APPLICATION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// Hard cap on one raid-helper.xyz request (classes/raidhelper.js): the service
// sometimes accepts the connection and never answers.
const RAIDHELPER_REQUEST_TIMEOUT_MS = 20000;

module.exports = {
    RAIDHELPER_BOT_ID,
    EMBED_ACCENT_COLOR,
    REPLY_DELETE_AFTER_MS,
    APPLICATION_STALE_AFTER_MS,
    APPLICATION_SWEEP_INTERVAL_MS,
    RAIDHELPER_REQUEST_TIMEOUT_MS,
};
