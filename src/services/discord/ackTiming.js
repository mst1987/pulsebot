// Where the time goes before Discord hears from us (#797): "Interaction failed" flashes
// when the acknowledgement (defer / reply / update / showModal) reaches Discord after its
// three seconds. bot.js starts a timer for every command, button, select and modal; it
// notes how long the interaction already travelled when we got it (`entryMs`), how long
// the access guard took (`guardMs`) and how long the handler needed until it had
// acknowledged (`handlerMs`), and logs a warning above ACK_WARN_MS with those phases —
// the server's log then shows whether it is the gateway lag, the guard or the handler.
//
// It only *watches* `interaction.deferred` / `.replied` (discord.js sets one of them as
// soon as the answer has gone out) on a short poll, and never wraps the interaction's
// methods, so handlers and their tests see the very same object.

const logger = require("../../logger").child("ack");

/** From this on an acknowledgement counts as slow (Discord gives up at 3000 ms). */
const ACK_WARN_MS = 2000;
const POLL_MS = 20;

const acknowledged = (interaction) => !!(interaction && (interaction.deferred || interaction.replied));

/**
 * Starts watching one interaction. `now` is injectable for the tests.
 * Returns `{ guardDone(), finish() }`: call `guardDone()` when the access guard has
 * answered, `finish()` when the handler has returned (or thrown) — it stops the poll
 * and logs when the acknowledgement was slow. Returns the phases it logged, or null.
 */
function trackAck(interaction, { name = "", now = Date.now, pollMs = POLL_MS, warnMs = ACK_WARN_MS } = {}) {
    const startedAt = now();
    const created = Number(interaction && interaction.createdTimestamp);
    // A clock difference between us and Discord can make this negative: it is only a hint.
    const entryMs = Number.isFinite(created) && created > 0 ? Math.max(0, startedAt - created) : 0;
    let guardAt = null;
    let ackAt = acknowledged(interaction) ? startedAt : null;

    const timer = ackAt === null ? setInterval(() => {
        if (acknowledged(interaction)) {
            ackAt = now();
            clearInterval(timer);
        }
    }, pollMs) : null;
    if (timer && typeof timer.unref === "function") timer.unref();

    return {
        guardDone() {
            if (guardAt === null) guardAt = now();
        },
        finish() {
            if (timer) clearInterval(timer);
            // The poll can miss an answer that went out right before the handler returned.
            if (ackAt === null && acknowledged(interaction)) ackAt = now();
            if (ackAt === null) return null; // never acknowledged here (answered elsewhere, or not at all)
            const guardMs = guardAt === null ? 0 : guardAt - startedAt;
            const handlerMs = Math.max(0, ackAt - (guardAt === null ? startedAt : guardAt));
            const totalMs = entryMs + (ackAt - startedAt);
            const phases = { name, totalMs, entryMs, guardMs, handlerMs };
            if (totalMs > warnMs) {
                logger.warn(`Slow acknowledgement of ${name || "interaction"}: ${totalMs} ms since Discord created it `
                    + `(arrival ${entryMs} ms, access guard ${guardMs} ms, handler until acknowledged ${handlerMs} ms)`);
            }
            return phases;
        },
    };
}

module.exports = { trackAck, ACK_WARN_MS };
