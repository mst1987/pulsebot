// "Einteilungen posten" (#502): the raid plan's read link (/p/<token>,
// docs/raidplan/sharing.md) as one message in the event's channel — like
// "Sheet posten", posting again edits the message it wrote before.
//
// The route (POST /api/raids/post-raidplan) resolves the event server-side and
// hands it in; this module decides whether there is anything to post, publishes
// the plan when it is not yet (the link would lead nowhere), posts or edits the
// message and records where it went (raidplanPostStore.js). The raid detail's
// payload reads `raidplanPostState()` for the cockpit step and the dialog.
const { fail } = require("../../web/http/apiResult");
const raidplanStore = require("../../stores/raidplanStore");
const { getRaidplanPost, markRaidplanPosted } = require("../../stores/raidplanPostStore");
const discord = require("../discord/discord");
const linkCheck = require("../discord/linkCheck");
const { serverLang } = require("../discord/botLanguage");
const { embedColor } = require("../events/embedLook");
const { tr } = require("../../utils/i18n/botText");

// What the post says while the plan is not shared (#537): the link would lead nowhere, so it goes.
const NOT_SHARED = "The raid assignments are not shared right now.";

/** Whether an event (as loadEventGroups lists it) has a raid plan: an own event always, a Raid-Helper event once switched on. */
function eventHasPlan(event, plan) {
    if (!event) return false;
    if (event.source === "eventhelper") return true;
    return !!(plan && plan.link && plan.link.enabled);
}

/** Whether a stored plan was ever saved with anything in it. */
function planFilled(plan) {
    return !!(plan && plan.version > 0 && plan.bosses && Object.keys(plan.bosses).length > 0);
}

/**
 * What the raider reads in Discord, in the server language (a public message, CLAUDE.md "Language"): the raid's name small
 * over the heading, the orga's optional line, the start SHORT as Discord timestamps (date + time + "in 3 hours" — the long
 * `:F` form read like a sentence nobody reads), in the event's colour (discord.buildLinkMessage makes the card).
 */
function linkMessage({ url, title, startTime, message, color, lang = serverLang() }) {
    const start = Number(startTime) || 0;
    return {
        url,
        kicker: String(title || "").trim(),
        title: tr(lang, "Raid assignments"),
        message: String(message || "").trim(),
        facts: start ? [[tr(lang, "Start"), `<t:${start}:d> <t:${start}:t> · <t:${start}:R>`]] : [],
        color,
        label: tr(lang, "Open assignments"),
    };
}

/** The card's colour: the event's own, its instance's, or the accent colour (services/events/embedLook). */
function colorOf(event) {
    try { return embedColor(event); } catch { return undefined; }
}

/**
 * Post (or update) the read link of `event`'s plan in the event's channel.
 * `message` undefined keeps the text of the last post, "" clears it.
 * @param {{ event: object, message?: string, userId?: string }} input the event as loadEventGroups lists it
 * @returns {Promise<{ body: object } | { error: object }>} for apiResult.sendResult
 */
async function postRaidplanLink({ event, message, userId = "" }) {
    const plan = raidplanStore.getPlan(event.id);
    if (!eventHasPlan(event, plan)) {
        return fail(409, "no_plan", "Für dieses Event ist kein Raidplan aktiviert.");
    }
    if (!planFilled(plan)) {
        return fail(400, "empty_plan", "Der Raidplan ist noch leer – erst im Tab „Raidplan“ einteilen und speichern.");
    }
    const base = linkCheck.webBase();
    if (!base) {
        return fail(400, "no_public_url", "PUBLIC_BASE_URL ist nicht gesetzt – ohne sie gibt es keinen Link, den Raider öffnen können.");
    }
    if (!event.channelId) return fail(400, "no_channel", "Das Event hat keinen Kanal.");
    // A deleted channel (#537): nothing to post into — the dashboard offers "Kanal neu anlegen".
    if (await linkCheck.checkChannel(event.guildId || "", event.channelId) === "missing") {
        return fail(409, "channel_missing", "Der Kanal des Events existiert nicht mehr – erst über die Übersicht „Kanal neu anlegen“.");
    }

    const before = getRaidplanPost(event.id);
    const text = message !== undefined ? String(message || "") : ((before && before.message) || "");
    // The link must lead somewhere: a plan that is not published yet is published now (its token minted on the way).
    const wasPublished = plan.status === "published" && !!plan.publicToken;
    const current = wasPublished ? plan : raidplanStore.setPublished(event.id, true, { userId }).plan;
    const url = `${base}/p/${current.publicToken}`;
    const opts = linkMessage({ url, title: event.title, startTime: event.startTime, message: text, color: colorOf(event) });

    const hadPost = !!(before && before.channelId && before.messageId);
    let posted;
    let updated = false;
    try {
        if (hadPost) {
            try {
                posted = await discord.editLink(before.channelId, before.messageId, opts);
                updated = true;
            } catch {
                // deleted by hand, or the channel moved: a fresh message instead
                posted = await discord.postLink(event.channelId, opts);
            }
        } else {
            posted = await discord.postLink(event.channelId, opts);
        }
    } catch (e) {
        return fail(500, "post_failed", (e && e.message) || "Posten fehlgeschlagen.");
    }
    const saved = markRaidplanPosted(event.id, { channelId: posted.channelId, messageId: posted.messageId, message: text, userId });
    const what = updated ? "Einteilungs-Nachricht aktualisiert." : "Einteilungen in den Kanal gepostet.";
    return {
        body: {
            message: wasPublished ? what : `${what} Der Raidplan ist dafür freigegeben worden.`,
            updated, url, published: !wasPublished, post: saved,
        },
    };
}

/**
 * The raid detail's view of it (cockpit step, dialog, tab button), or null for
 * an event without a plan. Carries the read path only once the plan is
 * published — the editor hands the same path to every reader of "Raids".
 */
function raidplanPostState(event) {
    const plan = raidplanStore.getPlan(event && event.id);
    if (!eventHasPlan(event, plan)) return null;
    const published = !!(plan && plan.status === "published" && plan.publicToken);
    const stored = getRaidplanPost(event.id);
    // A post whose message or channel is gone is no post to link to (#537).
    const post = stored && stored.messageId && linkCheck.messageState(event.guildId || "", stored.channelId, stored.messageId) === "missing" ? null : stored;
    return {
        filled: planFilled(plan),
        published,
        publicPath: published ? `/p/${plan.publicToken}` : "",
        channelId: (post && post.channelId) || "",
        messageId: (post && post.messageId) || "",
        message: (post && post.message) || "",
        postedAt: (post && post.postedAt) || 0,
    };
}

/**
 * Keep a posted read link true after the plan's sharing changed (#537): a new
 * token puts the new link in, a withdrawn share takes the link out (the message
 * says the assignments are not shared). Best-effort, never throws.
 * @returns {Promise<"none"|"linked"|"unlinked"|"failed">}
 */
async function syncRaidplanPost(event) {
    const post = getRaidplanPost(event && event.id);
    if (!post || !post.channelId || !post.messageId) return "none";
    const url = linkCheck.webTarget("raidplan", event.id);
    const base = { title: event.title, startTime: event.startTime, color: colorOf(event) };
    const opts = url
        ? linkMessage({ ...base, url, message: post.message })
        : linkMessage({ ...base, url: "", message: tr(serverLang(), NOT_SHARED) });
    try {
        await discord.editLink(post.channelId, post.messageId, opts);
        return url ? "linked" : "unlinked";
    } catch {
        return "failed";
    }
}

module.exports = { postRaidplanLink, raidplanPostState, syncRaidplanPost, linkMessage, eventHasPlan, planFilled, NOT_SHARED };
