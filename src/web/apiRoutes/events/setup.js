// JSON API of the setup editor (#263) — Raid-Detail › Setup of an own event.
//
//   GET  /api/raids/setup?event=<id>          area raids (read): the orga gets the draft,
//                                              everyone else only the approved lineup - and
//                                              only of a raid they may see (eventVisibility.js)
//   every write below (`orgaScoped`, #725): the global orga (permissions.userIsOrga) with raids
//                                              write, or the orga of the raid's category (a manager
//                                              of its roster, categoryOrga.canOrgaEvent) - only for
//                                              that category's raids, else 403 "not_category_orga";
//                                              move-raid names both raids. "raids write" below means this.
//   POST /api/raids/setup/presence            raids write: the open editor's heartbeat — who else
//                                              is in it, the stored version, what changed
//   POST /api/raids/setup/propose             raids write: new proposal, locked places kept
//   PUT  /api/raids/setup                     raids write: the orga's own lineup — once the
//                                              setup is posted, live into its message
//   POST /api/raids/setup/approve             raids write: approve the shown version — and
//                                              post it into the channel / DM it (#290)
//   POST /api/raids/setup/post                raids write: post or edit the setup (a draft is
//                                              approved first), send the DMs still outstanding
//   POST /api/raids/setup/ping                raids write: "Alle pingen" — everybody in the posted
//                                              setup, in the event channel ({ dryRun } previews)
//   POST /api/raids/setup/confirm             raids write: set or clear a raider's Confirm/Cancel
//   POST /api/raids/setup/confirm-all         raids write: the check for everybody without an answer
//   POST /api/raids/setup/explain             raids write: Claude explains it (background job)
//   GET  /api/raids/setup/explain?event=<id>  raids write (checked here): job state
//   GET  /api/raids/setup/signup?event=&user=  raids write (checked here): one raider's signup
//                                              and what the orga may change it to (#521)
//   PUT  /api/raids/setup/signup              raids write: change it — status, character,
//                                              spec — as the orga; the setup follows
//   POST /api/raids/setup/move-raid           raids write: a raider into another raid of the
//                                              event's raid group (#811)
//   POST /api/raids/setup/raid-add            raids write: "Weiteren Raid hinzufügen" — a further
//                                              raid of the group, same evening, shared signup (#811);
//                                              `count` adds several at once (#1035)
//   POST /api/raids/setup/raid-remove         raids write: dissolve a further raid without an
//                                              approved setup; its raiders fall back into the pool
//
// The area gate (apiAccess.js) decides read vs. write by method; the GET of the
// editor additionally asks whether the caller may write, because a draft is
// never handed to someone who could not approve it.
const { ok, error } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const { sendFailure, sendResult } = require("../../http/apiResult");
const { userSeesEvent } = require("../../../services/signups/eventVisibility");
// who may edit a raid's setup - the rule of the `orgaScoped` gate, per event (#725)
const { canWriteSetup } = require("../../setup/setupAccess");
const categoryOrga = require("../../../services/roster/categoryOrga");
const { getConfig } = require("../../../stores/settings/settingsStore");
const { getEvent, isOwnEventId, setEventExtraRole, EXTRA_ROLES } = require("../../../stores/events/eventStore");
const { listSignups } = require("../../../stores/events/signupStore");
const discord = require("../../../services/discord/discord");
const setupEditor = require("../../../services/setup/setupEditor");
const profiles = require("../../../stores/roster/raiderProfileStore");
const { refreshEventMessage } = require("../../../services/events/eventMessage");
const setupMessage = require("../../../services/setup/setupMessage");
const { saveSetupPingText, setupPingPlan } = require("../../../services/setup/setupPing");
const { activeGuildFor } = require("../../http/activeGuild");
const { setupAttendance } = require("../../setup/setupAttendance");
const { postSearch, textForNeeds } = require("../../../services/setup/raidSearch");
const { startJob, getJob } = require("../../logcheck/evalJobs");
const { explainSetup } = require("../../../utils/setup/explainText");
const setupSignup = require("../../../services/setup/setupSignup");
const setupConfirm = require("../../../services/setup/setupConfirm");
const setupPresence = require("../../../services/setup/setupPresence");
const { approvedSetupOf, confirmationsFor } = require("../../../services/setup/setupCore");
const raidGroup = require("../../../services/events/raidGroup");
const { signupEventIdOf } = require("../../../utils/raidGroup");
const { shortFor, shadowbannedAmong } = require("../../../services/vermerke/vermerkeShort");
const { maySeeShort } = require("../../../services/vermerke/vermerkeAccess");

// The event a write names: an archived event (a hidden game version, #563) is read only, and the orga
// of a category (#725, `orgaScoped`) may change only the setups of their own category's raids.
const BY_EVENT = (body) => body.event;
// a GET of the editor names its event in the query
const BY_QUERY = (body, query) => query.get("event");
// a move between two raids of a group (#811): the category orga must be the orga of both
const SOURCE_AND_TARGET = (body) => [body.event, body.target];

const EXPLAIN_SECTION = "setup-explain";


/** The signups that count for an event: a raid of a group (#811) reads its first raid's. */
const signupsOf = (event) => listSignups(signupEventIdOf(event));

async function namesFor(event) {
    const ids = signupsOf(event).map((s) => s.userId);
    if (!ids.length) return {};
    try {
        return await discord.resolveUserNames(event.guildId, ids);
    } catch {
        return {};
    }
}

/** Attendance of everybody who signed up; a failing read never costs the page. */
function safeAttendance(event) {
    try {
        return setupAttendance([event]);
    } catch {
        return null;
    }
}

/**
 * The editor's payload. Discord names are resolved for the page load only: a
 * member fetch per raider is slow where Discord does not know them yet, and a
 * move must answer at once — the page keeps the names it already has.
 */
async function view(event, user, { names = true, req = null } = {}) {
    const write = await canWriteSetup(user, event, req);
    const signups = write ? signupsOf(event) : [];
    // Re-read: posting and the DM run write to the event while the request runs.
    const fresh = getEvent(event.id) || event;
    const out = setupEditor.editorView(fresh, {
        canWrite: write,
        names: write && names ? await namesFor(fresh) : {},
        signups,
        hasApiKey: write && !!((getConfig().anthropic || {}).apiKey),
        job: write ? getJob(fresh.id, EXPLAIN_SECTION) : null,
        avoidPairs: write ? setupEditor.avoidPairCount(signups, profiles.listProfiles()) : 0,
        // reads reports and logs — only on the page load, a move must answer at once
        attendance: write && names ? safeAttendance(fresh) : null,
        // no setup stored yet: the empty start (every signup under "Angemeldet") instead of "no setup"
        blank: true,
    });
    if (write) {
        out.publish = setupMessage.publishView(fresh, { config: getConfig(), channelName: channelNameOf(fresh) });
        // the short form only through the one rule (vermerkeAccess.js) - the setup's own write right is not enough
        if (await maySeeShort(user, fresh.guildId, { req })) Object.assign(out, await vermerkeOf(fresh, signups, out.setup));
    }
    // "Mehr → Raidgröße" changes the event itself (PATCH /api/raids): `orgaScoped` by the event since
    // #728, the same rule as the setup's own (the orga of the raid, raidOrgaAccess.canOrgaRaid)
    out.canEditEvent = write;
    return out;
}

/** Everybody the editor shows: the signups, and who stands in a group, on the bench or in the pool. */
function personIdsOf(signups, setup) {
    const ids = new Set(signups.map((s) => String(s.userId)));
    const parts = setup ? [setup, ...(Array.isArray(setup.events) ? setup.events : [])] : [];
    for (const part of parts) {
        for (const g of part.groups || []) for (const slot of (g && g.slots) || []) if (slot && slot.userId) ids.add(String(slot.userId));
        for (const p of [...(part.bench || []), ...(part.pool || [])]) if (p && p.userId) ids.add(String(p.userId));
    }
    ids.delete("");
    return [...ids];
}

/**
 * The orga's part of the Vermerke (#981), one store read: `vermerke` the short form
 * `{ [userId]: { level, reasons } }` of the persons on the page, and `shadowbanInPool`
 * `[{ userId, name }]` - everybody with a shadowban who stands in the pool of the
 * stored setup (proposal.js never places them by itself; one placed by hand is out
 * of the pool). Only once a setup is stored. The name is the same on every answer:
 * the Discord name from the member cache (the page load filled it, `namesFor`),
 * else the character, else the id - a write answers at once, so no member fetch.
 * Never in a raider's answer (vermerkeNeverToPerson.test.js).
 */
async function vermerkeOf(event, signups, setup) {
    const vermerke = shortFor(event.guildId, personIdsOf(signups, setup));
    const banned = event.setup && setup
        ? (setup.pool || []).filter((p) => p && vermerke[String(p.userId)] && vermerke[String(p.userId)].level === "shadowban")
        : [];
    const names = banned.length ? await cachedNames(event.guildId, banned.map((p) => String(p.userId))) : {};
    const shadowbanInPool = banned.map((p) => {
        const userId = String(p.userId);
        return { userId, name: names[userId] || p.character || p.name || userId };
    });
    return { vermerke, shadowbanInPool };
}

/** Discord names already in the member cache - never waits for a fetch. */
async function cachedNames(guildId, ids) {
    try {
        return (await discord.resolveUserNames(guildId, ids, { waitMs: 0 })) || {};
    } catch {
        return {};
    }
}

/** The event channel's current name, else the stored one. */
function channelNameOf(event) {
    try {
        const hit = (discord.listAllChannels(event.guildId) || []).find((c) => String(c.id) === String(event.channelId));
        if (hit && hit.name) return hit.name;
    } catch {
        // offline — the stored name stands in
    }
    return event.channelName || "";
}

/** The event of a request, or a sent error. */
function eventOf(res, id) {
    const eventId = String(id || "").trim();
    if (!isOwnEventId(eventId)) {
        error(res, 409, "raidhelper", "Das Setup dieses Events liegt bei Raid-Helper.");
        return null;
    }
    const event = getEvent(eventId);
    if (!event) {
        error(res, 404, "not_found", "Event nicht gefunden.");
        return null;
    }
    return event;
}

/**
 * GET /api/raids/setup?event=<id>[&light=1] — `light`: what an open editor fetches
 * when somebody else changed the setup: no Discord names, no attendance (the page
 * keeps the ones it has), so it answers at once.
 */
const getSetup = withUser({ onServer: BY_QUERY }, async ({ user, req, res, url }) => {
    const event = eventOf(res, url.searchParams.get("event"));
    if (!event) return;
    // a raid of a category the raider may not see: the same 404 as an unknown one (eventVisibility.js) - the
    // orga of the raid's category edits it, whether or not they could sign up for it (#729)
    const cache = categoryOrga.requestCache(req);
    if (!(await userSeesEvent(user, { guildId: event.guildId, eventId: event.id, categoryId: event.categoryId || "", cache }))
        && !(await canWriteSetup(user, event, req))) {
        return error(res, 404, "not_found", "Event nicht gefunden.");
    }
    ok(res, await view(event, user, { names: url.searchParams.get("light") !== "1", req }));
});

/** The characters of an event's signups, by user id — names a raider who left the lineup in the activity. */
function charactersOf(event) {
    return Object.fromEntries(signupsOf(event).map((s) => [String(s.userId), s.character || ""]));
}

/** Who did it, for the other editors' activity line. */
const actor = (user) => ({ by: user.id, byName: user.name || "" });

/** Placed in a group, for "Freie Plätze gefüllt (n)". */
const placedCount = (setup) => ((setup && setup.groups) || []).reduce((n, g) => n + ((g && g.slots) || []).length, 0);

/**
 * POST /api/raids/setup/presence — body `{ event, action?, since?, leave? }`: the
 * open editor's heartbeat (every few seconds). `action` = `{ kind: "drag"|"edit",
 * userId }`, what the caller holds right now. Answers who else is in the editor,
 * the stored version (newer than the page's = somebody else changed it: fetch it
 * `light`), the Confirm/Cancel marks (a raider's click in Discord changes no
 * version) and what the others did after `since`. `leave: true` when the editor closes.
 */
const postPresence = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true }, async ({ user, body, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    if (body.leave === true) {
        setupPresence.leave(event.id, user.id);
        return ok(res, { left: true });
    }
    setupPresence.beat(event.id, user, { action: body.action });
    ok(res, {
        // each with their Discord picture ("" = the editor shows the initial)
        editors: setupPresence.editorsOf(event.id, { exceptUserId: user.id }).map((e) => ({ ...e, avatarUrl: discord.avatarUrlFor(event.guildId, e.userId) })),
        version: (event.setup && Number(event.setup.version)) || 0,
        confirmations: confirmationsFor(event, approvedSetupOf(event)),
        // only what the others did: one's own moves are on the page already
        activity: setupPresence.activityOf(event.id, { since: body.since }).filter((e) => e.by !== String(user.id)),
    });
});

/** The editor payload after a write; `ctx` is the handler's `{ res, user, req }`. */
async function answer({ res, user, req }, result, extra = {}) {
    if (result.error) return sendFailure(res, result);
    ok(res, { ...(await view(result.event, user, { names: false, req })), ...extra });
}

/**
 * A change of a posted setup went live (setupEditor.storeSetup): the setup
 * message follows — awaited, so the answer's `publish` already shows the edit
 * — and the event message like after an approval. A failed edit never fails
 * the change: its text comes back for the answer's message, "" when all went well.
 */
async function followLive(result, user) {
    if (!result || result.error || !result.live) return "";
    const post = await setupMessage.refreshLiveSetup(result.event.id, { userId: user.id });
    if (result.event.message) {
        refreshEventMessage(result.event.id).catch((e) => console.error(`[setup] event message ${result.event.id}:`, e.message));
    }
    return post.code ? `Setup-Nachricht nicht aktualisiert: ${post.error}` : "";
}

/** POST /api/raids/setup/propose — body `{ event, weights?, fairness?, wishes?, keep? }` (`keep: "placed"` = "Freie Plätze füllen") */
const postPropose = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, req, res }) => {
    const before = eventOf(res, body.event);
    if (!before) return;
    // a shadowban on the raid's server (Vermerke, #981) keeps the raider in the pool
    const result = setupEditor.proposeEventSetup(String(body.event).trim(), body, { userId: user.id, shadowbannedOf: shadowbannedAmong });
    if (!result.error) {
        const count = placedCount(result.setup) - (body.keep === "placed" ? placedCount(before.setup) : 0);
        setupPresence.recordNote(before.id, body.keep === "placed" ? "fill" : "propose", { ...actor(user), count: Math.max(0, count) });
    }
    let failed = await followLive(result, user);
    // a raid group (#811): the proposal ran over every raid — each posted one follows
    for (const other of (result && result.others) || []) failed = (await followLive(other, user)) || failed;
    const done = body.keep === "placed" ? "Freie Plätze gefüllt." : "Neuer Vorschlag erstellt.";
    const message = result.live ? `${done} Die gepostete Setup-Nachricht zeigt es schon.` : done;
    await answer({ res, user, req }, result, { message: failed ? `${done} ${failed}` : message });
});

/** PUT /api/raids/setup — body `{ event, version, groups, bench, weights?, fairness?, wishes? }` */
const putSetup = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, req, res }) => {
    const before = eventOf(res, body.event);
    if (!before) return;
    const result = setupEditor.saveEventSetup(String(body.event).trim(), body, { userId: user.id });
    // the other editors see who moved whom
    if (!result.error) setupPresence.recordMoves(before.id, before.setup, result.setup, { ...actor(user), names: charactersOf(before) });
    // a move answers quietly; only a failed edit of the posted message is said
    const failed = await followLive(result, user);
    await answer({ res, user, req }, result, failed ? { message: failed } : {});
});

/** "Bench mitposten" (#517): true/false from the body, undefined = keep the event's last choice. */
const benchChoice = (body) => (typeof body.bench === "boolean" ? body.bench : undefined);
/** "DMs an Spieler": true/false from the body, undefined = keep the event's last choice (else the category's). */
const dmsChoice = (body) => (typeof body.dms === "boolean" ? body.dms : undefined);

/** POST /api/raids/setup/approve — body `{ event, version, bench?, dms? }` */
const postApprove = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, req, res }) => {
    if (!eventOf(res, body.event)) return;
    const result = setupEditor.approveEventSetup(String(body.event).trim(), { version: body.version, userId: user.id });
    if (result.error) return sendFailure(res, result);
    // The event message shows the approved lineup; a bot that is offline only
    // delays that, it never fails the approval.
    if (!result.already && result.event.message) {
        refreshEventMessage(result.event.id).catch((e) => console.error(`[setup] event message ${result.event.id}:`, e.message));
    }
    let message = result.already ? "Setup war schon gepostet." : "Setup gepostet – Raider sehen es jetzt.";
    if (!result.already) {
        // The setup's own message (#290): awaited, so the answer says where it went;
        // the DMs run on in the background and the editor polls their outcome.
        const { post } = await setupMessage.publishSetup(result.event.id, { userId: user.id, bench: benchChoice(body), dms: dmsChoice(body) });
        if (post.code) message = `${message} Setup-Nachricht nicht gepostet: ${post.error}`;
        else setupPresence.recordNote(result.event.id, "post", actor(user));
    }
    await answer({ res, user, req }, result, { message });
});

/**
 * POST /api/raids/setup/post — body `{ event, version?, bench?, dms? }`: post/edit the
 * setup and send outstanding DMs. Posting is approving: a draft is approved
 * first (only the `version` the editor showed, when one is sent), so there is
 * no separate approval step for the orga.
 */
const postPublish = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, req, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    if (event.setup && event.setup.status !== "approved") {
        const approved = setupEditor.approveEventSetup(event.id, { version: body.version, userId: user.id });
        if (approved.error) return sendFailure(res, approved);
        if (approved.event.message) {
            refreshEventMessage(event.id).catch((e) => console.error(`[setup] event message ${event.id}:`, e.message));
        }
    }
    const { post } = await setupMessage.publishSetup(event.id, { userId: user.id, bench: benchChoice(body), dms: dmsChoice(body) });
    if (post.code) return sendFailure(res, post);
    setupPresence.recordNote(event.id, "post", actor(user));
    const text = post.action === "edited" ? "Setup-Nachricht aktualisiert." : "Setup gepostet.";
    await answer({ res, user, req }, { event }, { message: text });
});

/**
 * POST /api/raids/setup/confirm — body `{ event, userId, status: "confirmed"|"declined"|"" }`:
 * the orga sets (or clears) a raider's Confirm/Cancel, as if they had clicked it.
 * Answers at once with only `{ confirmations }` — the Discord message is edited
 * a moment later, once for a run of quick clicks (setupConfirm.js).
 */
const postConfirm = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    const result = await setupConfirm.setConfirmation(event.id, body.userId, typeof body.status === "string" ? body.status : "", { by: user.id, edit: "later" });
    if (result.code) return error(res, result.code === "invalid" ? 400 : 409, result.code, result.error);
    ok(res, { confirmations: result.confirmations });
});

/** POST /api/raids/setup/confirm-all — body `{ event }`: everybody in a group without an answer gets the check (a "Cancel" stays). */
const postConfirmAll = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    const result = await setupConfirm.confirmAll(event.id, { by: user.id });
    if (result.code) return error(res, 409, result.code, result.error);
    ok(res, { confirmations: result.confirmations, count: result.count });
});

/** POST /api/raids/setup/ping-text — body `{ event, text }`: what "Ping everyone" (and the first post's own ping) sends. */
const postPingText = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, req, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    saveSetupPingText(event.id, body.text);
    await answer({ res, user, req }, { event }, { message: "Ping-Nachricht gespeichert." });
});

/**
 * POST /api/raids/setup/ping — body `{ event, dryRun? }`: the editor's "Alle pingen", the web's twin of the
 * "Ping everyone" button under the setup message (setupPing.js, one service for both). Everybody in the groups
 * of the approved setup is pinged in the event channel with the stored ping text, the caller left out.
 * `dryRun` only answers how many and with what, for the question asked before.
 */
const postPing = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, req, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    const guildId = activeGuildFor(req);
    if (guildId && event.guildId && event.guildId !== String(guildId)) return error(res, 404, "not_found", "Event nicht gefunden.");
    if (body.dryRun) {
        const plan = setupPingPlan(event, user.id);
        if (plan.error) return sendResult(res, plan);
        return ok(res, { count: plan.userIds.length, text: plan.text });
    }
    const result = await setupMessage.callSetupPing({ guildId, eventId: event.id, userId: user.id, byName: user.name || "" });
    if (result.error) return sendResult(res, result);
    ok(res, { message: result.message, count: result.count, url: result.url || "" });
});

/** POST /api/raids/setup/extra-role — body `{ event, userId, role: "tank"|"healer", on }`: mark a raider as an extra tank / healer, or not any more. */
const postExtraRole = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, req, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    const userId = String(body.userId || "").trim();
    if (!EXTRA_ROLES.includes(body.role)) return error(res, 400, "bad_role", "Nur Tank oder Heiler.");
    // only somebody who signed up (or is in the setup) can be marked
    const known = signupsOf(event).some((x) => x.userId === userId) || JSON.stringify(event.setup || {}).includes(`"userId":"${userId}"`);
    if (!userId || !known) return error(res, 404, "unknown_raider", "Dieser Raider ist nicht angemeldet.");
    const updated = setEventExtraRole(event.id, userId, body.role, body.on === true);
    await answer({ res, user, req }, { event: updated });
});

/** GET /api/raids/setup/signup?event=<id>&user=<userId> — the signup and the characters/specs the dialog offers. */
const getSignupEdit = withUser({ orgaScoped: BY_QUERY, write: "raids" }, async ({ res, url }) => {
    if (!eventOf(res, url.searchParams.get("event"))) return;
    const { view: out, failed } = setupSignup.signupEditView(url.searchParams.get("event"), url.searchParams.get("user"));
    if (failed) return error(res, failed.status, failed.code, failed.error);
    ok(res, out);
});

/** PUT /api/raids/setup/signup — body `{ event, userId, status, character?, spec?, className?, from? }`: the orga changes a raider's signup (#521; `className` with a name outside the profile). */
const putSignupEdit = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, req, res }) => {
    if (!eventOf(res, body.event)) return;
    const result = await setupSignup.changeSignupFromSetup(String(body.event).trim(), body.userId, body, { user });
    if (result.error) return error(res, result.status || 400, result.code || "failed", result.error);
    const failed = await followLive(result, user);
    await answer({ res, user, req }, { event: result.event }, { message: failed ? `${result.message} ${failed}` : result.message, warning: result.warning || "" });
});

/** POST /api/raids/setup/search/text — body `{ event, roles, buffs }`: the message for needs the orga edited (nothing is posted). */
const postSearchText = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true }, async ({ body, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    const result = textForNeeds(event, body);
    if (result.error) return sendResult(res, result);
    ok(res, result);
});

/** POST /api/raids/setup/search — body `{ event, text? }`: post the "we are looking for …" message into the event channel. */
const postSearchMessage = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true }, async ({ user, body, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    const result = await postSearch({ guildId: event.guildId, eventId: event.id, userId: user.id, byName: user.username || user.name || "", text: body.text });
    if (result.error) return sendResult(res, result);
    ok(res, result);
});

/** POST /api/raids/setup/explain — body `{ event }`. Needs the Anthropic key. */
const postExplain = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true }, async ({ body, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    const settings = getConfig().anthropic || {};
    if (!settings.apiKey) return error(res, 400, "no_api_key", "Kein Anthropic-API-Key hinterlegt (Einstellungen → Verbindungen → KI-Formulierung).");
    if (!event.setup) return error(res, 400, "no_setup", "Es gibt noch kein Setup zum Erklären.");
    const started = startJob(event.id, EXPLAIN_SECTION, async () => {
        const fresh = getEvent(event.id);
        if (!fresh || !fresh.setup) return { ok: false, error: "Setup nicht mehr vorhanden." };
        const signups = signupsOf(fresh);
        const decorated = setupEditor.editorView(fresh, { canWrite: true, signups }).setup;
        const { text, model } = await explainSetup(decorated, { event: fresh, signups }, { apiKey: settings.apiKey, model: settings.model || undefined });
        setupEditor.storeExplanation(fresh.id, { text, model, version: fresh.setup.version });
        return { ok: true, id: fresh.id };
    });
    ok(res, { eventId: event.id, status: started.status, alreadyRunning: started.alreadyRunning }, started.alreadyRunning ? 200 : 202);
});

/** GET /api/raids/setup/explain?event=<id> — the job state plus the stored explanation. */
const getExplain = withUser({ orgaScoped: BY_QUERY, write: "raids" }, async ({ res, url }) => {
    const event = eventOf(res, url.searchParams.get("event"));
    if (!event) return;
    ok(res, {
        eventId: event.id,
        job: getJob(event.id, EXPLAIN_SECTION),
        explanation: (event.setup && event.setup.explanation) || null,
        version: (event.setup && event.setup.version) || 0,
    });
});

/** The event message of a raid group's first raid: its counts ("2 Raids · 20 Plätze") follow a new or dissolved raid. */
function refreshGroupMessage(primary) {
    if (!primary || !primary.message) return;
    refreshEventMessage(primary.id).catch((e) => console.error(`[setup] event message ${primary.id}:`, e.message));
}

/**
 * POST /api/raids/setup/move-raid — body `{ event, target, userId, character? }`: a raider of
 * this raid (group place, bench or the shared pool) into the first free place of another raid of
 * its raid group (#811). Answers this raid's editor payload; both raids follow live when posted.
 */
const postMoveRaid = withUser({ orgaScoped: SOURCE_AND_TARGET, write: "raids", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, req, res }) => {
    const before = eventOf(res, body.event);
    if (!before) return;
    const result = setupEditor.moveToRaid(before.id, { target: body.target, userId: body.userId, character: body.character }, { userId: user.id });
    if (result.error) return sendFailure(res, result);
    setupPresence.recordMoves(before.id, before.setup, result.setup, { ...actor(user), names: charactersOf(before) });
    let failed = await followLive(result, user);
    failed = (await followLive(result.target, user)) || failed;
    const moved = result.moved;
    const text = `${moved.character || "Raider"} → ${moved.title} (Gruppe ${moved.group}).`;
    await answer({ res, user, req }, result, { message: failed ? `${text} ${failed}` : text });
});

/**
 * POST /api/raids/setup/raid-add — body `{ event, title?, count? }`: "Weiteren Raid hinzufügen" (#811),
 * with `count` > 1 several at once ("5 Raids anlegen", #1035, titled "<Titel> <n>"; the
 * group stays at most 8 raids — 400 too_many beyond). Answers `{ event: <first new raid id>,
 * events: [ids], title, raidGroup, message }`; the signup message is redrawn once.
 */
const postRaidAdd = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, req, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    const guildId = activeGuildFor(req);
    if (guildId && event.guildId && event.guildId !== String(guildId)) return error(res, 404, "not_found", "Event nicht gefunden.");
    const count = body.count === undefined || body.count === null ? 1 : Number(body.count);
    if (!Number.isInteger(count) || count < 1) return error(res, 400, "invalid", "Anzahl der Raids ist ungültig.");
    const result = raidGroup.addRaids(event.id, { count, titles: typeof body.title === "string" ? [body.title] : [], user });
    if (result.error) return error(res, result.status || 400, result.code || "failed", result.error);
    refreshGroupMessage(result.primary);
    const first = result.events[0];
    const message = result.events.length > 1
        ? `${result.events.length} Raids angelegt (${result.events.map((e) => e.title).join(", ")}).`
        : `${first.title} angelegt – zieh Angemeldete hinüber oder lass „Freie Plätze füllen“ verteilen.`;
    ok(res, { event: first.id, events: result.events.map((e) => e.id), title: first.title, raidGroup: raidGroup.groupSummary(first), message });
});

/**
 * POST /api/raids/setup/raid-remove — body `{ event }` (the further raid): dissolve it (#811) —
 * only without an approved setup; its raiders fall back into the shared pool "Angemeldet".
 * Answers `{ event: <primary id>, raidGroup, message }`.
 */
const postRaidRemove = withUser({ orgaScoped: BY_EVENT, write: "raids", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    const result = raidGroup.dissolveRaid(event.id, { user });
    if (result.error) return error(res, result.status || 400, result.code || "failed", result.error);
    refreshGroupMessage(result.primary);
    const back = result.placed ? ` ${result.placed} zurück in „Angemeldet“.` : "";
    ok(res, { event: result.primary.id, raidGroup: raidGroup.groupSummary(result.primary), message: `${result.removed.title} aufgelöst.${back}` });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/raids/setup", handler: getSetup, area: "raids" },
    { method: "PUT", path: "/api/raids/setup", handler: putSetup, area: "raids" },
    { method: "POST", path: "/api/raids/setup/presence", handler: postPresence, area: "raids" },
    { method: "POST", path: "/api/raids/setup/propose", handler: postPropose, area: "raids" },
    { method: "POST", path: "/api/raids/setup/approve", handler: postApprove, area: "raids" },
    { method: "POST", path: "/api/raids/setup/post", handler: postPublish, area: "raids" },
    { method: "POST", path: "/api/raids/setup/ping-text", handler: postPingText, area: "raids" },
    { method: "POST", path: "/api/raids/setup/ping", handler: postPing, area: "raids" },
    { method: "POST", path: "/api/raids/setup/confirm", handler: postConfirm, area: "raids" },
    { method: "POST", path: "/api/raids/setup/confirm-all", handler: postConfirmAll, area: "raids" },
    { method: "POST", path: "/api/raids/setup/extra-role", handler: postExtraRole, area: "raids" },
    { method: "GET", path: "/api/raids/setup/signup", handler: getSignupEdit, area: "raids" },
    { method: "PUT", path: "/api/raids/setup/signup", handler: putSignupEdit, area: "raids" },
    { method: "POST", path: "/api/raids/setup/search/text", handler: postSearchText, area: "raids" },
    { method: "POST", path: "/api/raids/setup/search", handler: postSearchMessage, area: "raids" },
    { method: "POST", path: "/api/raids/setup/explain", handler: postExplain, area: "raids" },
    { method: "GET", path: "/api/raids/setup/explain", handler: getExplain, area: "raids" },
    { method: "POST", path: "/api/raids/setup/move-raid", handler: postMoveRaid, area: "raids" },
    { method: "POST", path: "/api/raids/setup/raid-add", handler: postRaidAdd, area: "raids" },
    { method: "POST", path: "/api/raids/setup/raid-remove", handler: postRaidRemove, area: "raids" },
];

module.exports = { getSetup, postPresence, postPropose, putSetup, postApprove, postPublish, postPingText, postPing, postConfirm, postConfirmAll, postExtraRole, getSignupEdit, putSignupEdit, postSearchMessage, postSearchText, postExplain, getExplain, postMoveRaid, postRaidAdd, postRaidRemove, EXPLAIN_SECTION, routes };
