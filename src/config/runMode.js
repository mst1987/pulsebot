// Is this process the live bot or a test instance?
//
// NODE_ENV=production says "live" — but the server has run without it: pm2
// sets it only on the very first `pm2 start ecosystem.config.js`, and
// deploy.sh's `pm2 restart --update-env` takes the deploy shell's environment,
// which has none (fixed there too, #611). A test instance never sets it
// either, so NODE_ENV alone cannot tell them apart. The second sign is the env
// file bot.js loaded (EVENTHELPER_ENV_FILE): a test instance always runs on
// `.env.dev`, the server on `.env`. Anything else — Jest, a script, an
// explicit NODE_ENV other than production — is not live.
//
// A module of its own, like config/timezone.js: tests replace
// config/variables with small stubs, and this must never fall back silently.

/** Whether `env` describes the live bot. */
function isLiveInstance(env = process.env) {
    const e = env || {};
    if (e.NODE_ENV === "production") return true;
    if (e.NODE_ENV) return false;
    return e.EVENTHELPER_ENV_FILE === ".env";
}

/** "production" or "development", for /health and the start-up line. */
function runMode(env = process.env) {
    return isLiveInstance(env) ? "production" : "development";
}

module.exports = { isLiveInstance, runMode };
