// What the bot uses which channel for — the "Zwecke" part of the Kanäle page.
//
// The assignments themselves stay where they always were: in the admin config
// (settingsStore), edited in Einstellungen and saved through PATCH /api/settings.
// This module only reads them and resolves them against the live channel list,
// so the page can show each purpose with its channels and a status that says
// whether it actually works (set at all? channel still there? may the bot post?).

/**
 * The five purposes, in page order. `key` is the config path, `need` what the
 * bot has to be allowed in the channel ("send" = post, "read" = see it and
 * answer under a message), `section` the Einstellungen section that edits it.
 */
const PURPOSES = [
    {
        id: "raid",
        label: "Raid-Anmeldung",
        icon: "inv_misc_note_02",
        key: "raidDefaults.channelId",
        kind: "channel",
        multiple: false,
        need: "send",
        section: "raids",
        hint: "Standard-Kanal, in den ein neues Raid-Event gepostet wird, wenn beim Anlegen nichts anderes gewählt ist.",
        missing: "Beim Anlegen eines Raid-Events muss der Kanal jedes Mal gewählt werden.",
    },
    {
        id: "logs",
        label: "Log-Auswertung",
        icon: "inv_misc_pocketwatch_01",
        key: "logChannelIds",
        kind: "channel",
        multiple: true,
        need: "read",
        section: "logs",
        hint: "Postet jemand hier einen Warcraft-Logs-Link, bietet der Bot die Auswertung per Button an. Mehrere Kanäle möglich.",
        missing: "Gepostete Logs werden nirgends erkannt.",
    },
    {
        id: "application",
        label: "Bewerbungen",
        icon: "inv_misc_grouplooking",
        key: "applicationChannelId",
        kind: "channel",
        multiple: false,
        need: "send",
        section: "recruitment",
        hint: "Kanal, in dem neue Bewerbungen als Thread gepostet werden.",
        missing: "Neue Bewerbungen haben keinen Kanal, in dem sie landen.",
    },
    {
        id: "eventCategories",
        label: "Event-Kategorien",
        icon: "achievement_boss_illidan",
        key: "categoryIds",
        kind: "category",
        multiple: true,
        need: null,
        section: "kategorien",
        hint: "Discord-Kategorien, deren Kanäle Raid-Events enthalten. Rollen, Loot-Addon und Sheet je Kategorie stehen in Einstellungen › Kategorien.",
        missing: "Raid-Events werden keiner Kategorie zugeordnet.",
    },
];

function asIds(value) {
    const list = Array.isArray(value) ? value : [value];
    return [...new Set(list.map((v) => String(v || "").trim()).filter(Boolean))];
}

/** The ids a purpose currently holds in the config. */
function idsFor(purpose, config) {
    const cfg = config || {};
    switch (purpose.key) {
        case "raidDefaults.channelId": return asIds((cfg.raidDefaults || {}).channelId);
        default: return asIds(cfg[purpose.key]);
    }
}

/**
 * Whether the bot can do in `channel` what a purpose needs. `connected` false
 * means the rights are unknown (bot offline), which is no warning.
 * @returns {{ tone: "ok"|"mid"|"", label: string, tip: string }}
 */
function channelStatus(channel, need, connected = true) {
    if (!connected) return { tone: "", label: "gesetzt", tip: "Bot nicht verbunden – ob er den Kanal sieht und dort schreiben darf, lässt sich gerade nicht prüfen." };
    if (!channel) {
        return { tone: "mid", label: "Kanal nicht gefunden", tip: "Die gespeicherte ID gehört zu keinem Kanal auf diesem Server – gelöscht, oder er liegt auf einem anderen Server." };
    }
    if (channel.botCanView === false) {
        return { tone: "mid", label: "Bot sieht den Kanal nicht", tip: `Der Bot-Rolle fehlt in #${channel.name} das Recht „Kanal ansehen“. Zuordnen geht, wirken tut es erst, wenn das Recht in Discord gesetzt ist.` };
    }
    if (channel.botCanSend === false) {
        return { tone: "mid", label: "Bot darf nicht schreiben", tip: `Der Bot-Rolle fehlt in #${channel.name} das Recht „Nachrichten senden“.` };
    }
    return need === "read"
        ? { tone: "ok", label: "Bot liest mit", tip: `Der Bot sieht #${channel.name} und kann dort antworten.` }
        : { tone: "ok", label: "Bot schreibt", tip: `Der Bot darf in #${channel.name} posten.` };
}

/**
 * Resolve every purpose against the live channel and category lists.
 * @param {object} config     the admin config (settingsStore.getConfig())
 * @param {Array} channels    discord.listAllChannels() — with botCanView/botCanSend
 * @param {Array} categories  discord.listCategories()
 * @param {boolean} connected whether the channel lists are live (bot connected, guild known)
 */
function resolvePurposes(config, channels = [], categories = [], connected = true) {
    const channelById = new Map((channels || []).map((c) => [c.id, c]));
    const categoryById = new Map((categories || []).map((c) => [c.id, c]));

    return PURPOSES.map((purpose) => {
        const ids = idsFor(purpose, config);
        // `key` goes out with it: the page stores a changed assignment through
        // PATCH /api/settings under exactly that config key.
        const { missing, ...pub } = purpose;
        let items;
        let status;

        if (purpose.kind === "category") {
            items = ids.map((id) => {
                const cat = categoryById.get(id);
                return { id, name: cat ? cat.name : "", found: !!cat, status: cat || !connected
                    ? { tone: connected ? "ok" : "", label: "Event-Kategorie", tip: "" }
                    : { tone: "mid", label: "Kategorie nicht gefunden", tip: "Die gespeicherte ID gehört zu keiner Kategorie auf diesem Server." } };
            });
            const found = items.filter((i) => i.found).length;
            if (!ids.length) status = { tone: "bad", label: "fehlt", tip: `Keine Kategorie gesetzt – ${missing}` };
            else if (connected && found < ids.length) status = { tone: "mid", label: `${ids.length - found} nicht gefunden`, tip: "Mindestens eine gespeicherte Kategorie gibt es auf diesem Server nicht (mehr)." };
            else status = { tone: connected ? "ok" : "", label: `${ids.length} ${ids.length === 1 ? "Kategorie" : "Kategorien"}`, tip: "" };
        } else {
            items = ids.map((id) => {
                const ch = channelById.get(id);
                return { id, name: ch ? ch.name : "", found: !!ch, status: channelStatus(ch, purpose.need, connected) };
            });
            // With several channels, an id this server does not know is usually a
            // channel of another server the bot also runs on — it is listed, but
            // does not turn the purpose yellow as long as one channel here works.
            const judged = purpose.multiple && items.some((i) => i.found) ? items.filter((i) => i.found) : items;
            if (!ids.length) status = { tone: "bad", label: "fehlt", tip: `Kein Kanal gesetzt – ${missing}` };
            else status = judged.find((i) => i.status.tone === "mid")?.status || judged[0].status;
        }
        return { ...pub, ids, items, status };
    });
}

/** Counts for the part head's badges: how many purposes are set, missing, or set but not working. */
function purposeSummary(purposes) {
    const list = purposes || [];
    return {
        set: list.filter((p) => p.ids.length).length,
        missing: list.filter((p) => !p.ids.length).length,
        warnings: list.filter((p) => p.ids.length && p.status.tone === "mid").length,
    };
}

module.exports = { PURPOSES, resolvePurposes, purposeSummary, channelStatus, idsFor };
