// The switch-over checklist from Raid-Helper to the EventHelper's own events
// (#291, Einstellungen → Server → Raid-Helper). Computed on every read,
// nothing stored but the switch itself. Both are per Discord server (#927): the
// checklist looks at that server's categories and synced events, the switch is
// config.serverSettings[guildId].raidhelper.enabled (utils/raidhelper/servers.js).
//
// Every item answers three things: its state (a badge), WHY it matters (one line)
// and WHERE to fix it (a link into the menu, or an action on the card). Two items
// are required before Raid-Helper can be switched off — every event category
// creates its new events in the EventHelper, and no upcoming Raid-Helper event
// would be cut off. The others are recommendations: the switch does not depend
// on them, the raiders' experience does.
//
// `buildChecklist(inputs)` is pure (tests drive it); `loadChecklist()` gathers
// the inputs from the stores, Discord and Raid-Helper, each best-effort.

const { getConfig, saveConfig } = require("../../stores/settingsStore");
const { signupSourceFor } = require("../../services/events/eventSources");
const { raidhelperDisabled, createRaidhelperClient } = require("../../utils/raidhelper/client");
const { raidhelperSettingOf } = require("../../utils/raidhelper/servers");
const { serverSetting } = require("../../services/discord/serverSettings");
const { firstServerId, storedCategoryGuilds } = require("../../services/discord/serverOf");
const { TIMEZONE } = require("../../config/timezone");
const discord = require("../../services/discord/discord");
const guildRoles = require("../../services/discord/guildRoles");
const { listKnownCategories } = require("../../services/categories/categoryNames");
const appEmojis = require("../../services/discord/appEmojis");
const specHistory = require("../../stores/specHistoryStore");

// Statuses: ok (green), mid (open, yellow), bad (red), unknown (cannot be
// checked right now), info (nothing to check — a reminder).
const REQUIRED = new Set(["categories", "upcoming"]);

function fmtDate(seconds) {
    if (!seconds) return "";
    return new Date(Number(seconds) * 1000).toLocaleString("de-DE", {
        timeZone: TIMEZONE, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
}

function categoriesItem({ categories }) {
    const onRh = categories.filter((c) => c.source !== "eventhelper");
    const total = categories.length;
    const done = total - onRh.length;
    return {
        id: "categories",
        label: "Alle Event-Kategorien auf EventHelper",
        status: !total ? "unknown" : onRh.length ? "bad" : "ok",
        value: total ? `${done} / ${total}` : "keine Kategorie",
        why: "Neue Events einer Kategorie auf Raid-Helper würden dort angelegt – nach dem Abschalten ginge das nicht mehr.",
        detail: onRh.map((c) => `${c.name || c.id} – noch Raid-Helper`),
        link: { to: "/settings?section=kategorien", label: "Kategorien" },
    };
}

function upcomingItem({ disabled, upcoming }) {
    if (disabled) {
        return {
            id: "upcoming",
            label: "Keine kommenden Raid-Helper-Events",
            status: "ok",
            value: "nicht mehr abgefragt",
            why: "Raid-Helper ist abgeschaltet; kommende Events dort sieht der EventHelper nicht mehr.",
            detail: [],
            link: { to: "/raids", label: "Raid-Events" },
        };
    }
    if (upcoming.error) {
        return {
            id: "upcoming",
            label: "Keine kommenden Raid-Helper-Events",
            status: "unknown",
            value: "nicht prüfbar",
            why: "Raid-Helper antwortet nicht – ob dort noch Events geplant sind, lässt sich gerade nicht sagen.",
            detail: [upcoming.error],
            link: { to: "/raids", label: "Raid-Events" },
        };
    }
    const list = upcoming.events || [];
    return {
        id: "upcoming",
        label: "Keine kommenden Raid-Helper-Events",
        status: list.length ? "bad" : "ok",
        value: list.length ? `${list.length} geplant` : "keins",
        why: "Ein geplantes Raid-Helper-Event verlöre nach dem Abschalten seine Anmeldungen im Menü. Erst laufen lassen oder als eigenes Event neu anlegen.",
        detail: list.map((e) => [e.title || e.id, fmtDate(e.startTime), e.channelName ? `#${e.channelName}` : ""].filter(Boolean).join(" · ")),
        link: { to: "/raids", label: "Raid-Events" },
    };
}

function historyItem({ history }) {
    const done = history.importedEvents > 0;
    return {
        id: "history",
        label: "Spec-Historie importiert",
        status: done ? "ok" : "mid",
        value: done ? `${history.importedEvents} Events · ${history.users} Raider` : "noch nicht",
        why: "Damit die Ein-Klick-Anmeldung und das Profil die Spec vorschlagen, mit der sich jemand zuletzt bei Raid-Helper angemeldet hat.",
        detail: history.lastRun ? [`Zuletzt: ${new Date(history.lastRun.at).toLocaleString("de-DE", { timeZone: TIMEZONE })}${history.lastRun.byName ? ` von ${history.lastRun.byName}` : ""}`] : [],
        action: "import",
    };
}

function emojisItem({ emojis }) {
    if (!emojis.loaded) {
        return {
            id: "emojis",
            label: "Anmelder-Emojis vorhanden",
            status: "unknown",
            value: "nicht prüfbar",
            why: "Spec-, Rollen- und Status-Icons der Anmelder-Nachricht. Der Bot ist gerade nicht verbunden.",
            detail: [],
            hint: "node scripts/sync-app-emojis.js --dry-run",
        };
    }
    return {
        id: "emojis",
        label: "Anmelder-Emojis vorhanden",
        status: emojis.missing.length ? "mid" : "ok",
        value: `${emojis.total - emojis.missing.length} / ${emojis.total}`,
        why: "Der Bot legt fehlende Icons beim Start selbst an. Fehlen danach noch welche (z. B. Emoji-Limit, Icon-Server nicht erreichbar), zeigt die Anmelder-Nachricht Text statt Icons.",
        detail: emojis.missing.slice(0, 12).concat(emojis.missing.length > 12 ? [`+${emojis.missing.length - 12} weitere`] : []),
        hint: "node scripts/sync-app-emojis.js",
    };
}

/**
 * Discord-Events (#305): Raid-Helper posts one per raid, the EventHelper does
 * too — but only for a category that asked for it, and only with the right
 * "Events verwalten". A guild that uses none is not missing anything, so the
 * item is a recommendation, never a blocker.
 */
function discordEventItem({ discordEvents }) {
    const on = (discordEvents && discordEvents.categories) || [];
    const base = { id: "discordevent", label: "Discord-Events zu den Raids", link: { to: "/settings?section=kategorien", label: "Kategorien" } };
    if (!on.length) {
        return {
            ...base,
            status: "info",
            value: "aus",
            why: "Raid-Helper legt zu jedem Raid ein Discord-Event an. Der EventHelper kann das auch – einzuschalten je Kategorie unter Einstellungen → Kategorien.",
            detail: [],
        };
    }
    const right = discordEvents.canManage;
    const names = on.map((c) => c.name || c.id);
    if (right === null || right === undefined) {
        return {
            ...base,
            status: "unknown",
            value: `${on.length} ${on.length === 1 ? "Kategorie" : "Kategorien"}`,
            why: "Ob der Bot Events anlegen darf, lässt sich gerade nicht sagen – er ist nicht verbunden.",
            detail: names,
        };
    }
    return {
        ...base,
        status: right ? "ok" : "bad",
        value: right ? `${on.length} ${on.length === 1 ? "Kategorie" : "Kategorien"}` : "Recht fehlt",
        why: "Zu jedem Event dieser Kategorien legt der Bot ein Discord-Event an. Dafür braucht er auf dem Raid-Server das Recht „Events verwalten“.",
        detail: right ? names : ["fehlt: Events verwalten", ...names],
    };
}

function commandsItem() {
    return {
        id: "commands",
        label: "Bot-Befehle registriert",
        status: "info",
        value: "npm run register",
        why: "/event, /profil und die Anmeldung per Bot gibt es in Discord erst nach dem Registrieren. Nach jedem Update einmal ausführen.",
        detail: [],
        hint: "npm run register",
        link: { to: "/settings?section=berechtigungen&perm=bot", label: "Bot-Befehle" },
    };
}

function permissionsItem({ permissions }) {
    if (!permissions) {
        return {
            id: "permissions",
            label: "Bot-Rechte für Kanäle und Rollen",
            status: "unknown",
            value: "nicht prüfbar",
            why: "Der Bot legt Event-Kanäle an, postet die Anmelder-Nachricht und liest die Raider-Rollen. Er ist gerade nicht verbunden.",
            detail: [],
            link: { to: "/settings/all?section=discordserver", label: "Discord-Server" },
        };
    }
    const missing = permissions.filter((p) => !p.ok);
    return {
        id: "permissions",
        label: "Bot-Rechte für Kanäle und Rollen",
        status: missing.length ? "bad" : "ok",
        value: `${permissions.length - missing.length} / ${permissions.length}`,
        why: "Der Bot legt Event-Kanäle an, postet die Anmelder-Nachricht und liest die Raider-Rollen – was Raid-Helper bisher selbst gemacht hat.",
        detail: missing.map((p) => `fehlt: ${p.label}`),
        link: { to: "/settings/all?section=discordserver", label: "Discord-Server" },
    };
}

/**
 * The checklist from its inputs.
 * @param {{ disabled, disabledAt, disabledBy, categories: {id,name,source}[],
 *   upcoming: { events?: object[], error?: string|null }, history: { importedEvents, users, lastRun },
 *   emojis: { loaded, total, missing: string[] }, permissions: {key,label,ok}[]|null,
 *   discordEvents: { categories: {id,name}[], canManage: boolean|null } }} inputs
 */
function buildChecklist(inputs) {
    const items = [
        categoriesItem(inputs),
        upcomingItem(inputs),
        historyItem(inputs),
        emojisItem(inputs),
        discordEventItem(inputs),
        commandsItem(inputs),
        permissionsItem(inputs),
    ].map((item) => ({ ...item, required: REQUIRED.has(item.id) }));
    const checkable = items.filter((i) => i.status !== "info");
    const blocking = items.filter((i) => i.required && i.status === "bad")
        // A category list nobody configured cannot be "all on EventHelper".
        .concat(items.filter((i) => i.id === "categories" && i.status === "unknown"));
    return {
        disabled: !!inputs.disabled,
        disabledAt: inputs.disabledAt || 0,
        disabledBy: inputs.disabledBy || "",
        items,
        done: checkable.filter((i) => i.status === "ok").length,
        total: checkable.length,
        // Switching off needs the required items; an upcoming list Raid-Helper
        // cannot deliver does not block it (there is nothing it could still cut off
        // that anyone can see), the item says so.
        ready: !blocking.length,
        blockers: blocking.map((i) => i.id),
    };
}

/** The event categories the checklist looks at: the configured ones plus every one with a stored source. */
function eventCategoryIds(config) {
    const ids = new Set((config.categoryIds || []).map(String));
    if (!ids.size) Object.keys(config.categorySignupSource || {}).forEach((id) => ids.add(String(id)));
    return [...ids].filter(Boolean);
}

/** The event categories of one server: a category of no known server counts for the first one. */
function serverCategoryIds(config, guildId) {
    let index = new Map();
    try {
        index = storedCategoryGuilds();
    } catch {
        index = new Map();
    }
    const first = firstServerId(config);
    return eventCategoryIds(config).filter((id) => (index.get(id) || first) === guildId);
}

/**
 * Gather the inputs and build the checklist of one server (`guildId`, default
 * the first). Never throws, never asks raid-helper.xyz: the upcoming events
 * come from that server's synced list.
 */
async function loadChecklist({ config = getConfig(), guildId } = {}) {
    const eventGuildId = String(guildId || firstServerId(config) || guildRoles.serverIds(config)[0] || "");
    const disabled = raidhelperDisabled(config, eventGuildId);

    let names = new Map();
    try {
        names = new Map((listKnownCategories(eventGuildId) || []).map((c) => [c.id, c.name]));
    } catch {
        // names are cosmetic
    }
    const categories = serverCategoryIds(config, eventGuildId).map((id) => ({ id, name: names.get(id) || "", source: signupSourceFor(id, config, { guildId: eventGuildId }) }));

    let upcoming = { events: [], error: null };
    if (!disabled) {
        try {
            const events = await createRaidhelperClient({ guildId: eventGuildId }).getAllEvents();
            let catMap = {};
            try {
                catMap = discord.getChannelCategoryMap(eventGuildId) || {};
            } catch {
                catMap = {};
            }
            const now = Math.floor(Date.now() / 1000);
            upcoming.events = (events || [])
                .filter((e) => Number(e.startTime) >= now)
                .map((e) => ({ id: String(e.id), title: e.title || "", startTime: Number(e.startTime) || 0, channelName: (catMap[e.channelId] || {}).name || "" }));
        } catch (e) {
            upcoming = { events: [], error: (e && e.message) || "Raid-Helper nicht erreichbar." };
        }
    }

    const catalog = appEmojis.emojiCatalog().map((e) => e.name);
    const have = appEmojis.appEmojiMap() || {};
    const emojis = {
        loaded: typeof appEmojis.appEmojisLoaded === "function" ? appEmojis.appEmojisLoaded() : Object.keys(have).length > 0,
        total: catalog.length,
        missing: catalog.filter((n) => !have[n]),
    };

    let permissions;
    try {
        permissions = eventGuildId ? discord.botPermissionsIn(eventGuildId) : null;
    } catch {
        permissions = null;
    }

    // The categories that want a Discord event per raid, and whether the bot may
    // make one (#305) — both best-effort like everything else here.
    let canManage;
    try {
        canManage = eventGuildId ? discord.botCanManageEvents(eventGuildId) : null;
    } catch {
        canManage = null;
    }
    const discordEvents = {
        categories: Object.keys(config.categoryDiscordEvent || {})
            .filter((id) => (config.categoryDiscordEvent || {})[id] === true)
            .map((id) => ({ id, name: names.get(id) || "" })),
        canManage,
    };

    const setting = raidhelperSettingOf(eventGuildId, config);
    return buildChecklist({
        disabled,
        disabledAt: setting.at || 0,
        disabledBy: setting.byName || "",
        categories,
        upcoming,
        history: specHistory.importStatus(),
        emojis,
        permissions,
        discordEvents,
    });
}

/**
 * Switch one server's Raid-Helper off or back on (#927: `enabled` in its
 * server settings; key and server id stay, old raids stay readable). Off only
 * when the required items are green (`not_ready` names them otherwise); on
 * again always (a server without a key stays inactive until one is entered).
 * @returns {Promise<{ checklist } | { error, code, blockers }>}
 */
async function setRaidhelperDisabled(disabled, { guildId, byName = "", now = Date.now() } = {}) {
    const id = String(guildId || firstServerId(getConfig()) || "");
    if (!id) return { error: "Kein Discord-Server bekannt.", code: "no_server", blockers: [] };
    if (disabled) {
        const checklist = await loadChecklist({ guildId: id });
        if (!checklist.ready) {
            return { error: "Erst die Pflichtpunkte erledigen: alle Kategorien auf EventHelper und keine kommenden Raid-Helper-Events.", code: "not_ready", blockers: checklist.blockers };
        }
    }
    const current = serverSetting(id, "raidhelper") || {};
    const config = saveConfig({ serverSettings: { [id]: { raidhelper: { ...current, enabled: !disabled, at: now, byName } } } });
    return { checklist: await loadChecklist({ config, guildId: id }) };
}

module.exports = { buildChecklist, loadChecklist, setRaidhelperDisabled, eventCategoryIds, serverCategoryIds, REQUIRED };
