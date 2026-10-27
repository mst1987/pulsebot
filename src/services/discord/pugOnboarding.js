// Roles and onboarding of a PuG server (#906, docs/discord-servers.md "Rollen & Onboarding").
// New members set themselves up through Discord's own onboarding: "Which versions do you
// play?" hands out a version role, which unlocks the PuG categories of that version;
// "Which classes do you play?" a class role in the class colour. Nothing here runs on its
// own: the web shows the difference (`overview`) and the orga applies it (`apply`).
//
//   desiredState(config, categories)  pure: the roles, the two questions, the category rights
//   readActual(guild, desired, saved) the roles (by saved id, else by name), the onboarding, the rights
//   diff(desired, actual)             every item with its status new / changed / same / lost
//   prerequisites(guild, actual)      Community, Manage Roles, Manage Server, roles below the bot
//   overview(guildId)                 all of it for the web
//   apply(guildId, { actor })         roles first, then the category rights, the onboarding last
//
// The PuG categories are the configured raid categories on this server that every member
// may sign up for (signupAccess.openToAll: no raider role, no roster-only); a raid
// category with a raider role or a roster is listed as left out. The role ids live in the
// settings store, `config.pugRoles[guildId] = { versions: { <versionId>: roleId },
// classes: { <classId>: roleId }, appliedAt, appliedBy }`.
//
// Discord keeps the onboarding only as a whole (PUT): apply replaces the questions with
// the two of the bot (a question the orga added by hand is "lost", the preview says so)
// and sends back the default channels, `enabled` and `mode` as they are - those stay the
// orga's in Discord. Discord is only called for what differs.
const { PermissionsBitField, SnowflakeUtil } = require("discord.js");
const discord = require("./discord");
const { getConfig, saveConfig } = require("../../stores/configStore");
const { VERSIONS, rulesFor } = require("../../config/gameVersions");
const { CLASSES } = require("../../config/gameVersions/classes");
const { configuredRaidCategories } = require("./botCheck");
const { accessRule } = require("../signups/signupAccess");
const { mainVersionFor } = require("../events/mainVersion");
const { roleBelowBot } = require("./memberRoles");
const { discordErrorText } = require("./discordChannels");

const Flags = PermissionsBitField.Flags;
const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const lower = (v) => str(v).toLowerCase();

// The onboarding is read by new members from anywhere, so its texts are English (#906).
const VERSION_PROMPT = "Which versions do you play?";
const CLASS_PROMPT = "Which classes do you play?";
const MULTIPLE_CHOICE = 0; // GuildOnboardingPromptType.MultipleChoice

/** An error the route answers with `status` and `code`; `message` is German, for the orga. */
class PugOnboardingError extends Error {
    constructor(status, code, message, extra = {}) {
        super(message);
        this.status = status;
        this.code = code;
        Object.assign(this, extra);
    }
}

/** The stored role ids of one server (empty maps when nothing is stored yet). */
function savedFor(guildId, config = getConfig()) {
    const all = config && config.pugRoles && typeof config.pugRoles === "object" ? config.pugRoles : {};
    const entry = all[str(guildId)] || {};
    const map = (m) => (m && typeof m === "object" && !Array.isArray(m) ? m : {});
    return {
        versions: map(entry.versions),
        classes: map(entry.classes),
        appliedAt: str(entry.appliedAt),
        appliedBy: str(entry.appliedBy),
    };
}

/** Saves the role ids (and, when given, who applied when) of one server; other servers stay. */
function saveFor(guildId, entry) {
    const config = getConfig();
    const all = config.pugRoles && typeof config.pugRoles === "object" ? config.pugRoles : {};
    saveConfig({ pugRoles: { ...all, [str(guildId)]: entry } });
}

/**
 * The raid categories of the settings that lie on this server: `pug` those open to all
 * (with the version they play), `other` the rest with their rule ("roles" | "roster").
 * @returns {{ pug: { id, name, versionId }[], other: { id, name, rule }[] }}
 */
function serverCategories(guild, config) {
    const cache = guild && guild.channels && guild.channels.cache;
    const pug = [];
    const other = [];
    if (!cache) return { pug, other };
    for (const id of configuredRaidCategories(config)) {
        const channel = cache.get(id);
        if (!channel) continue;
        const name = str(channel.name) || id;
        const rule = accessRule(id, { config }).rule;
        if (rule === "open") pug.push({ id, name, versionId: mainVersionFor({ categoryId: id, config }) });
        else other.push({ id, name, rule });
    }
    const byName = (a, b) => a.name.localeCompare(b.name);
    return { pug: pug.sort(byName), other: other.sort(byName) };
}

/**
 * What the server should look like (pure, no Discord): a version role per version that
 * has a PuG category here, a class role per class of those versions (in the class colour),
 * the two onboarding questions and the rights of each PuG category. Without a PuG category
 * everything is empty - there is nothing to set up.
 * @param {{ id, name, versionId }[]} categories the PuG categories of the server
 */
function desiredState(categories) {
    const list = Array.isArray(categories) ? categories : [];
    const versionIds = VERSIONS.map((v) => v.id).filter((id) => list.some((c) => c.versionId === id));
    const versions = versionIds.map((versionId) => ({
        key: `version:${versionId}`,
        kind: "version",
        id: versionId,
        name: (rulesFor(versionId) && rulesFor(versionId).label) || versionId,
        color: "",
        categoryIds: list.filter((c) => c.versionId === versionId).map((c) => c.id),
    }));
    const classIds = new Set();
    for (const versionId of versionIds) for (const c of (rulesFor(versionId) || {}).classes || []) classIds.add(c.id);
    const classes = CLASSES.filter((c) => classIds.has(c.id)).map((c) => ({
        key: `class:${c.id}`,
        kind: "class",
        id: c.id,
        name: c.labelEn || c.id,
        color: lower(c.color),
    }));
    const prompts = versions.length ? [
        { key: "versions", title: VERSION_PROMPT, required: true, singleSelect: false, options: versions.map((v) => ({ title: v.name, roleKey: v.key })) },
        { key: "classes", title: CLASS_PROMPT, required: false, singleSelect: false, options: classes.map((c) => ({ title: c.name, roleKey: c.key })) },
    ] : [];
    const cats = list.map((c) => ({ id: c.id, name: c.name, versionId: c.versionId, roleKey: `version:${c.versionId}` }));
    return { versions, classes, prompts, categories: cats };
}

const roleView = (guild, role) => ({
    id: str(role.id),
    name: str(role.name),
    color: role.hexColor && role.hexColor !== "#000000" ? lower(role.hexColor) : "",
    belowBot: roleBelowBot(guild, role),
});

/** The role a desired role is: the saved id first, else one of the same name (not managed, not @everyone). */
function findRole(guild, item, savedId) {
    const cache = guild.roles && guild.roles.cache;
    if (!cache) return null;
    const byId = savedId ? cache.get(savedId) : null;
    if (byId) return byId;
    const everyone = guild.roles.everyone ? str(guild.roles.everyone.id) : str(guild.id);
    return [...cache.values()].find((r) => r && !r.managed && str(r.id) !== everyone && lower(r.name) === lower(item.name)) || null;
}

const idsOf = (coll) => {
    if (!coll) return [];
    if (typeof coll.keys === "function") return [...coll.keys()].map(str);
    return Array.isArray(coll) ? coll.map((x) => str(x && x.id ? x.id : x)) : [];
};

/** The onboarding as plain data, so diff and apply never touch discord.js objects. */
function plainOnboarding(ob) {
    const prompts = ob && ob.prompts && typeof ob.prompts.values === "function" ? [...ob.prompts.values()] : [];
    return {
        enabled: !!(ob && ob.enabled),
        mode: ob && typeof ob.mode === "number" ? ob.mode : 0,
        defaultChannelIds: idsOf(ob && ob.defaultChannels),
        prompts: prompts.map((p) => ({
            id: str(p.id),
            title: str(p.title),
            required: !!p.required,
            singleSelect: !!p.singleSelect,
            inOnboarding: p.inOnboarding !== false,
            type: typeof p.type === "number" ? p.type : MULTIPLE_CHOICE,
            options: (p.options && typeof p.options.values === "function" ? [...p.options.values()] : []).map((o) => ({
                id: str(o.id),
                title: str(o.title),
                description: o.description || null,
                emoji: o._emoji && (o._emoji.id || o._emoji.name) ? { id: o._emoji.id || null, name: o._emoji.name || null, animated: !!o._emoji.animated } : null,
                roleIds: idsOf(o.roles),
                channelIds: idsOf(o.channels),
            })),
        })),
    };
}

/** Does the overwrite of `id` on the category allow (or deny) View Channel? */
function viewOf(category, id) {
    const cache = category && category.permissionOverwrites && category.permissionOverwrites.cache;
    const ow = cache && typeof cache.get === "function" ? cache.get(id) : null;
    if (!ow) return null;
    if (ow.deny && ow.deny.has(Flags.ViewChannel)) return "deny";
    if (ow.allow && ow.allow.has(Flags.ViewChannel)) return "allow";
    return null;
}

/**
 * What the server is now: per desired role the Discord role (or null), the onboarding
 * (null and `onboardingError` when it cannot be read) and per PuG category the View
 * Channel overwrites of @everyone, the bot and the version role.
 */
async function readActual(guild, desired, saved) {
    const roles = {};
    for (const item of [...desired.versions, ...desired.classes]) {
        const savedId = str((item.kind === "version" ? saved.versions : saved.classes)[item.id]);
        const role = findRole(guild, item, savedId);
        roles[item.key] = role ? roleView(guild, role) : null;
    }
    let onboarding = null;
    let onboardingError = "";
    try {
        onboarding = plainOnboarding(await guild.fetchOnboarding());
    } catch (e) {
        onboardingError = discordErrorText(e);
    }
    const everyoneId = guild.roles && guild.roles.everyone ? str(guild.roles.everyone.id) : str(guild.id);
    const botId = guild.members && guild.members.me ? str(guild.members.me.id) : "";
    const categories = {};
    for (const c of desired.categories) {
        const channel = guild.channels.cache.get(c.id);
        const role = roles[c.roleKey];
        categories[c.id] = {
            everyone: viewOf(channel, everyoneId),
            bot: botId ? viewOf(channel, botId) : null,
            version: role ? viewOf(channel, role.id) : null,
        };
    }
    return { roles, onboarding, onboardingError, categories, everyoneId, botId };
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** Role items: new (none), changed (another name or colour), same. */
function diffRoles(desired, actual) {
    return [...desired.versions, ...desired.classes].map((item) => {
        const cur = actual.roles[item.key];
        let status = "same";
        if (!cur) status = "new";
        else if (cur.name !== item.name || (item.color && cur.color !== item.color)) status = "changed";
        return {
            key: item.key, kind: item.kind, id: item.id, name: item.name, color: item.color, status,
            roleId: cur ? cur.id : "", current: cur ? { name: cur.name, color: cur.color } : null,
            categoryIds: item.categoryIds || [],
        };
    });
}

/** Question items: the bot's two (new / changed / same, with their options) and every other one (lost). */
function diffPrompts(desired, actual) {
    const current = actual.onboarding ? actual.onboarding.prompts : [];
    const used = new Set();
    const out = desired.prompts.map((p) => {
        const cur = current.find((c) => !used.has(c.id) && lower(c.title) === lower(p.title)) || null;
        if (cur) used.add(cur.id);
        const curOptions = cur ? cur.options : [];
        const usedOptions = new Set();
        const options = p.options.map((o) => {
            const role = actual.roles[o.roleKey];
            const co = curOptions.find((x) => !usedOptions.has(x.id) && lower(x.title) === lower(o.title)) || null;
            if (co) usedOptions.add(co.id);
            let status = "same";
            if (!co) status = "new";
            else if (!role || !sameSet(co.roleIds, [role.id]) || co.channelIds.length || co.title !== o.title) status = "changed";
            return { title: o.title, roleKey: o.roleKey, status, id: co ? co.id : "" };
        });
        for (const co of curOptions) if (!usedOptions.has(co.id)) options.push({ title: co.title, roleKey: "", status: "lost", id: co.id });
        let status = "same";
        if (!cur) status = "new";
        else if (cur.title !== p.title || cur.required !== p.required || cur.singleSelect !== p.singleSelect
            || !cur.inOnboarding || cur.type !== MULTIPLE_CHOICE || options.some((o) => o.status !== "same")) status = "changed";
        return { key: p.key, title: p.title, required: p.required, status, id: cur ? cur.id : "", options };
    });
    for (const c of current) {
        if (used.has(c.id)) continue;
        out.push({ key: "", title: c.title, required: c.required, status: "lost", id: c.id, options: c.options.map((o) => ({ title: o.title, roleKey: "", status: "lost", id: o.id })) });
    }
    return out;
}

/** Category items: what is missing of "hidden for @everyone, visible for the version role and the bot". */
function diffCategories(desired, actual) {
    return desired.categories.map((c) => {
        const cur = actual.categories[c.id] || {};
        const missing = [];
        if (cur.everyone !== "deny") missing.push("everyone");
        if (cur.version !== "allow") missing.push("version");
        if (cur.bot !== "allow") missing.push("bot");
        return { id: c.id, name: c.name, versionId: c.versionId, roleKey: c.roleKey, status: missing.length ? "changed" : "same", missing };
    });
}

/**
 * The difference between what should be and what is. `changes` counts every item that
 * is not "same" (a lost question counts once); an unreadable onboarding counts its two
 * questions as new.
 */
function diff(desired, actual) {
    const roles = diffRoles(desired, actual);
    const prompts = diffPrompts(desired, actual);
    const categories = diffCategories(desired, actual);
    const changes = [...roles, ...prompts, ...categories].filter((x) => x.status !== "same").length;
    return { roles, prompts, categories, changes };
}

/**
 * What the bot needs (docs/discord-servers.md): Community (no onboarding without it),
 * Manage Roles (roles, rights, onboarding), Manage Server (onboarding) and every existing
 * role of the set below its own highest role. `ok` null = unknown (no bot member).
 */
function prerequisites(guild, actual) {
    const me = guild.members && guild.members.me;
    const perms = me && me.permissions ? me.permissions : null;
    const has = (flag) => (perms ? perms.has(flag) : null);
    const above = Object.values(actual.roles).filter((r) => r && !r.belowBot).map((r) => r.name);
    return [
        { key: "community", ok: Array.isArray(guild.features) ? guild.features.includes("COMMUNITY") : null },
        { key: "manageRoles", ok: has(Flags.ManageRoles) },
        { key: "manageGuild", ok: has(Flags.ManageGuild) },
        { key: "roleOrder", ok: above.length === 0, roles: above },
    ];
}

/** Everything the web shows for one server; `online` false when the bot does not see it. */
async function overview(guildId, config = getConfig()) {
    const gid = str(guildId);
    const saved = savedFor(gid, config);
    const applied = saved.appliedAt ? { at: saved.appliedAt, by: saved.appliedBy } : null;
    const guild = discord.isOnline() ? discord.getGuild(gid) : null;
    if (!guild) return { guildId: gid, guildName: "", online: false, applied };
    const { pug, other } = serverCategories(guild, config);
    const desired = desiredState(pug);
    const actual = await readActual(guild, desired, saved);
    const d = diff(desired, actual);
    return {
        guildId: gid,
        guildName: str(guild.name),
        online: true,
        applied,
        pugCategories: pug,
        otherCategories: other,
        roles: d.roles,
        prompts: d.prompts,
        categories: d.categories,
        changes: d.changes,
        onboarding: actual.onboarding ? { enabled: actual.onboarding.enabled, mode: actual.onboarding.mode, defaultChannels: actual.onboarding.defaultChannelIds.length } : null,
        onboardingError: actual.onboardingError,
        prerequisites: prerequisites(guild, actual),
    };
}

/** Wraps one Discord write: a refusal becomes a 502 naming the step, with what was done before it. */
async function step(name, done, fn) {
    try {
        return await fn();
    } catch (e) {
        throw new PugOnboardingError(502, "discord_failed", `Discord hat abgelehnt (${name}): ${discordErrorText(e)}`, { step: name, done: { ...done } });
    }
}

/** The questions as editOnboarding wants them: the ids, emojis and descriptions of the current ones kept. */
function promptsPayload(desired, actual, prompts, roleIds) {
    const current = actual.onboarding ? actual.onboarding.prompts : [];
    return desired.prompts.map((p) => {
        const item = prompts.find((x) => x.key === p.key);
        const cur = item && item.id ? current.find((c) => c.id === item.id) : null;
        return {
            id: cur ? cur.id : SnowflakeUtil.generate().toString(),
            title: p.title,
            singleSelect: p.singleSelect,
            required: p.required,
            inOnboarding: true,
            type: MULTIPLE_CHOICE,
            options: p.options.map((o) => {
                const opt = item ? item.options.find((x) => x.roleKey === o.roleKey) : null;
                const co = cur && opt && opt.id ? cur.options.find((x) => x.id === opt.id) : null;
                return {
                    id: co ? co.id : SnowflakeUtil.generate().toString(),
                    title: o.title,
                    description: co ? co.description : null,
                    emoji: co && co.emoji ? co.emoji : undefined,
                    roles: [roleIds[o.roleKey]],
                    channels: [],
                };
            }),
        };
    });
}

/**
 * Brings the server to the desired state: roles (create / rename / recolour), then the
 * rights of the PuG categories, last the onboarding. Every check runs before the first
 * write, so a missing prerequisite writes nothing. Throws PugOnboardingError; answers the
 * new overview and `done` = { roles, categories, onboarding } (what was written).
 */
async function apply(guildId, { actor = "" } = {}) {
    const gid = str(guildId);
    const config = getConfig();
    const guild = discord.isOnline() ? discord.getGuild(gid) : null;
    if (!guild) throw new PugOnboardingError(409, "offline", "Der Bot ist nicht online oder nicht auf diesem Server.");
    const saved = savedFor(gid, config);
    const desired = desiredState(serverCategories(guild, config).pug);
    if (!desired.versions.length) throw new PugOnboardingError(409, "no_pug_category", "Auf diesem Server gibt es keine Raid-Kategorie, für die sich alle anmelden dürfen.");
    const actual = await readActual(guild, desired, saved);
    const pre = prerequisites(guild, actual);
    const failed = (key) => pre.find((p) => p.key === key).ok !== true;
    if (failed("community")) throw new PugOnboardingError(409, "no_community", "Der Server ist kein Community-Server; Discord erlaubt ein Onboarding nur dort. Nichts wurde geändert.");
    if (failed("manageRoles") || failed("manageGuild")) throw new PugOnboardingError(409, "missing_permissions", "Dem Bot fehlen „Rollen verwalten“ oder „Server verwalten“. Nichts wurde geändert.");
    if (failed("roleOrder")) throw new PugOnboardingError(409, "role_above_bot", `Diese Rollen stehen über der Rolle des Bots: ${pre.find((p) => p.key === "roleOrder").roles.join(", ")}. Nichts wurde geändert.`);
    if (actual.onboardingError) throw new PugOnboardingError(502, "onboarding_unreadable", `Das Onboarding ließ sich nicht lesen: ${actual.onboardingError}. Nichts wurde geändert.`);

    const d = diff(desired, actual);
    const reason = `EventHelper: PuG-Onboarding${actor ? ` (${actor})` : ""}`;
    const done = { roles: 0, categories: 0, onboarding: false };
    const roleIds = {};
    const entry = { ...saved, versions: { ...saved.versions }, classes: { ...saved.classes } };
    for (const item of d.roles) {
        let id = item.roleId;
        if (item.status === "new") {
            const role = await step(`Rolle ${item.name} anlegen`, done, () => guild.roles.create({
                name: item.name, colors: { primaryColor: item.color || 0 }, permissions: [], mentionable: false, reason,
            }));
            id = str(role.id);
            done.roles += 1;
        } else if (item.status === "changed") {
            const role = guild.roles.cache.get(item.roleId);
            const patch = { name: item.name, reason };
            if (item.color) patch.colors = { primaryColor: item.color };
            await step(`Rolle ${item.name} anpassen`, done, () => role.edit(patch));
            done.roles += 1;
        }
        roleIds[item.key] = id;
        if (item.kind === "version") entry.versions[item.id] = id;
        else entry.classes[item.id] = id;
    }
    // The ids first, so a refusal further down never leaves a created role unknown.
    if (done.roles) saveFor(gid, entry);

    for (const c of d.categories) {
        if (c.status === "same") continue;
        const channel = guild.channels.cache.get(c.id);
        const edit = (id, view) => step(`Rechte ${c.name}`, done, () => channel.permissionOverwrites.edit(id, { ViewChannel: view }, { reason }));
        // The bot first: hiding the category from @everyone must never lock the bot out.
        if (c.missing.includes("bot") && actual.botId) await edit(actual.botId, true);
        if (c.missing.includes("version")) await edit(roleIds[c.roleKey], true);
        if (c.missing.includes("everyone")) await edit(actual.everyoneId, false);
        done.categories += 1;
    }

    if (d.prompts.some((p) => p.status !== "same")) {
        const ob = actual.onboarding;
        await step("Onboarding", done, () => guild.editOnboarding({
            prompts: promptsPayload(desired, actual, d.prompts, roleIds),
            defaultChannels: ob.defaultChannelIds,
            enabled: ob.enabled,
            mode: ob.mode,
            reason,
        }));
        done.onboarding = true;
    }

    saveFor(gid, { ...entry, appliedAt: new Date().toISOString(), appliedBy: str(actor) });
    return { done, overview: await overview(gid) };
}

module.exports = {
    desiredState, readActual, diff, prerequisites, overview, apply, serverCategories, savedFor,
    PugOnboardingError, VERSION_PROMPT, CLASS_PROMPT,
};
