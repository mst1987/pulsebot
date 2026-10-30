// Roles and onboarding of a PuG server (#906, docs/discord-servers.md "Rollen & Onboarding").
// New members set themselves up through Discord's own onboarding: "Which versions do you
// play?" hands out a version role, which unlocks the PuG categories of that version;
// "Which classes do you play?" a class role in the class colour. Nothing here runs on its
// own: the web shows the difference (`overview`) and the orga applies it (`apply`).
//
//   desiredState(categories)                  pure: the roles, the two questions, the category rights
//   readActual(guild, desired, saved, ctx)    the roles (by saved id, else by name), the onboarding, the rights
//   diff(desired, actual)                     every item with its status new / changed / same / lost
//   prerequisites(guild, actual, categories)  Community, rights, roles below the bot, no privileged role
//   overview(guildId, config, { categoryIds }) all of it for the web, with the `fingerprint` of the diff
//   apply(guildId, { actor, categoryIds, fingerprint })  roles, then the category rights, the onboarding last
//
// The PuG categories are the configured raid categories on this server that every member
// may sign up for (signupAccess.openToAll: no raider role, no roster-only); a raid
// category with a raider role or a roster is listed as left out. The orga switches single
// ones off in the preview (`categoryIds`, none given = all). The role ids live in the
// settings store, `config.pugRoles[guildId] = { versions: { <versionId>: roleId },
// classes: { <classId>: roleId }, appliedAt, appliedBy }`.
//
// A role the onboarding hands out is self-assigned, so it must grant nothing else (the
// rule of selfRole.privilegedReason): a found role with bot rights, Discord permissions or
// a channel it unlocks blocks the apply (409 role_privileged) - except the version role's
// own View Channel on the PuG categories of its version and their channels.
//
// Discord keeps the onboarding only as a whole (PUT): apply replaces the questions with
// the two of the bot (a question the orga added by hand is "lost", the preview says so)
// and sends back the default channels, `enabled` and `mode` as they are - those stay the
// orga's in Discord. Discord is only called for what differs. The preview and the apply
// agree through `fingerprint`: the apply refuses (409 changed) when Discord or the
// settings moved in between. One apply per server at a time (409 busy).
const crypto = require("crypto");
const { PermissionsBitField, SnowflakeUtil } = require("discord.js");
const discord = require("../discord");
const { getConfig, saveConfig } = require("../../../stores/settings/configStore");
const { VERSIONS, rulesFor } = require("../../../config/gameVersions");
const { CLASSES } = require("../../../config/gameVersions/classes");
const { configuredRaidCategories } = require("../botCheck");
const { accessRule } = require("../../signups/signupAccess");
const { mainVersionFor } = require("../../versions/mainVersion");
const { roleBelowBot } = require("../roles/memberRoles");
const { discordErrorText } = require("../discordChannels");
const { grantsOf } = require("./pugRoleGuard");
const { accessSettings, fullAdminRoleIds } = require("../servers/serverAccess");
const rosterStore = require("../../../stores/roster/rosterStore");

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

/** The servers an apply runs on right now: a second click waits for the first (409 busy). */
const inFlight = new Set();

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
 * Does the category play the built-in default only because neither it nor the guild names
 * a known version (mainVersionFor falls back to "tbc")? The page says so.
 */
function versionIsFallback(categoryId, config) {
    const map = config && config.categoryVersion && typeof config.categoryVersion === "object" ? config.categoryVersion : {};
    return !rulesFor(str(map[categoryId])) && !rulesFor(str(config && config.mainVersion));
}

/**
 * The raid categories of the settings that lie on this server: `pug` those open to all
 * (with the version they play, `fallback` when that is only the default), `other` the
 * rest with their rule ("roles" | "roster").
 * @returns {{ pug: { id, name, versionId, fallback }[], other: { id, name, rule }[] }}
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
        if (rule === "open") pug.push({ id, name, versionId: mainVersionFor({ categoryId: id, config }), fallback: versionIsFallback(id, config) });
        else other.push({ id, name, rule });
    }
    const byName = (a, b) => a.name.localeCompare(b.name);
    return { pug: pug.sort(byName), other: other.sort(byName) };
}

/** The servers with the switch "PuG-Server" (`pug: true` in discordServers.servers), in list order. */
function pugServerIds(config = getConfig()) {
    const servers = (config && config.discordServers && config.discordServers.servers) || [];
    return servers.filter((s) => s && s.pug === true).map((s) => str(s.guildId)).filter(Boolean);
}

/** Whether a server has the switch "PuG-Server": only those get roles & onboarding. */
function isPugServer(guildId, config = getConfig()) {
    return pugServerIds(config).includes(str(guildId));
}

/**
 * The server the part opens with: among the servers marked "PuG-Server" the first with a
 * PuG category, else the first marked one (also while the bot is offline); "" when no
 * server is marked - the caller then takes the first server, which answers `notPugServer`.
 */
function firstPugServer(config = getConfig()) {
    const marked = pugServerIds(config);
    if (!marked.length) return "";
    if (discord.isOnline()) {
        for (const gid of marked) {
            const guild = discord.getGuild(gid);
            if (guild && serverCategories(guild, config).pug.length) return gid;
        }
    }
    return marked[0];
}

/** The PuG categories the orga left switched on: `categoryIds` undefined = all of them. */
function selectedOf(pug, categoryIds) {
    if (categoryIds === undefined || categoryIds === null) return pug;
    const wanted = new Set((Array.isArray(categoryIds) ? categoryIds : []).map(str));
    return pug.filter((c) => wanted.has(c.id));
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

const bitsOf = (perms) => {
    const b = perms ? perms.bitfield : undefined;
    return b === undefined || b === null ? null : BigInt(b);
};

/**
 * Why the found role must not be handed out by the onboarding, null when it may (the rule of
 * selfRole.privilegedReason, Projektfalle "Selbstzuweisung"): a bot right from the config
 * or a roster (`code` of selfRole.roleUses), Discord permissions beyond @everyone
 * ("permissions") or a channel it unlocks ("channel", `detail` its name). Allowed is the
 * role's own purpose: a version role being the PuG version role of its version, with
 * exactly View Channel on the PuG categories of that version (`ownCatIds`) and their channels.
 */
function privilegeOf(guild, config, item, role, ownCatIds) {
    const id = str(role.id);
    const uses = grantsOf(config, id, { item });
    if (uses.length) return { code: uses[0].code, detail: uses[0].code === "roster" ? str(uses[0].name || uses[0].rosterId) : "" };
    const bits = bitsOf(role.permissions);
    if (bits !== null) {
        const everyone = guild.roles && guild.roles.everyone ? bitsOf(guild.roles.everyone.permissions) : null;
        if ((bits & ~(everyone === null ? 0n : everyone)) !== 0n) return { code: "permissions", detail: "" };
    }
    const channels = guild.channels && guild.channels.cache;
    const view = BigInt(Flags.ViewChannel);
    for (const channel of channels && typeof channels.values === "function" ? channels.values() : []) {
        const overwrites = channel && channel.permissionOverwrites && channel.permissionOverwrites.cache;
        const own = overwrites && typeof overwrites.get === "function" ? overwrites.get(id) : null;
        const allow = own ? bitsOf(own.allow) : null;
        if (allow === null || allow === 0n) continue;
        const ownPlace = ownCatIds.has(str(channel.id)) || ownCatIds.has(str(channel.parentId));
        if (item.kind === "version" && allow === view && ownPlace) continue;
        return { code: "channel", detail: str(channel.name) || str(channel.id) };
    }
    return null;
}

const roleView = (guild, role, privileged) => ({
    id: str(role.id),
    name: str(role.name),
    color: role.hexColor && role.hexColor !== "#000000" ? lower(role.hexColor) : "",
    belowBot: roleBelowBot(guild, role),
    privileged,
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

/** Does the overwrite of `id` on the channel allow (or deny) View Channel? */
function viewOf(channel, id) {
    const cache = channel && channel.permissionOverwrites && channel.permissionOverwrites.cache;
    const ow = cache && typeof cache.get === "function" ? cache.get(id) : null;
    if (!ow) return null;
    if (ow.deny && ow.deny.has(Flags.ViewChannel)) return "deny";
    if (ow.allow && ow.allow.has(Flags.ViewChannel)) return "allow";
    return null;
}

/**
 * The orga roles that keep seeing a hidden PuG category (as the Kader takeover gives them,
 * rosterTakeover.orgaRoleIdsOf): the full-admin and orga roles of the settings and the
 * managers of a roster of the category - only roles of this server.
 */
function orgaRoleIdsOf(guild, config, category) {
    let roster;
    try {
        roster = rosterStore.rosterForCategory(category.id, category.versionId);
    } catch {
        roster = null;
    }
    const ids = [
        // the full-admin roles and the orga roles of THIS server (#925)
        ...fullAdminRoleIds(config), ...accessSettings(guild.id, config).orgaRoleIds,
        ...((roster && roster.managers && roster.managers.roleIds) || []),
    ].map(str).filter(Boolean);
    const cache = guild.roles && guild.roles.cache;
    return [...new Set(ids)].filter((id) => id !== str(guild.id) && (!cache || cache.has(id)));
}

/** May the bot change the rights of this category (View Channel and Manage Roles in it)? null = unknown. */
function botAccessOf(channel, me) {
    if (!channel || !me || typeof channel.permissionsFor !== "function") return null;
    const perms = channel.permissionsFor(me);
    if (!perms) return null;
    return perms.has(Flags.ViewChannel) && perms.has(Flags.ManageRoles);
}

/**
 * What the server is now: per desired role the Discord role (or null, with `privileged`),
 * the onboarding (null and `onboardingError` when it cannot be read) and per selected PuG
 * category the View Channel overwrites of @everyone, the bot, the version role and the orga
 * roles, the bot's access and the channels in it (`synced` with the category or not).
 * @param {{ config?: object, pug?: object[] }} [ctx] the settings and every PuG category of the
 *   server (the version role may unlock all of its version, not only the selected ones)
 */
async function readActual(guild, desired, saved, { config = {}, pug = desired.categories } = {}) {
    const roles = {};
    for (const item of [...desired.versions, ...desired.classes]) {
        const savedId = str((item.kind === "version" ? saved.versions : saved.classes)[item.id]);
        const role = findRole(guild, item, savedId);
        const own = new Set(item.kind === "version" ? pug.filter((c) => c.versionId === item.id).map((c) => c.id) : []);
        roles[item.key] = role ? roleView(guild, role, privilegeOf(guild, config, item, role, own)) : null;
    }
    let onboarding = null;
    let onboardingError = "";
    try {
        onboarding = plainOnboarding(await guild.fetchOnboarding());
    } catch (e) {
        onboardingError = discordErrorText(e);
    }
    const everyoneId = guild.roles && guild.roles.everyone ? str(guild.roles.everyone.id) : str(guild.id);
    const me = guild.members && guild.members.me ? guild.members.me : null;
    const botId = me ? str(me.id) : "";
    const all = guild.channels && guild.channels.cache && typeof guild.channels.cache.values === "function" ? [...guild.channels.cache.values()] : [];
    const roleName = (id) => {
        const r = guild.roles && guild.roles.cache ? guild.roles.cache.get(id) : null;
        return r ? str(r.name) : id;
    };
    const categories = {};
    for (const c of desired.categories) {
        const channel = guild.channels.cache.get(c.id);
        const role = roles[c.roleKey];
        const orga = {};
        for (const id of orgaRoleIdsOf(guild, config, c)) orga[id] = { name: roleName(id), view: viewOf(channel, id) };
        categories[c.id] = {
            everyone: viewOf(channel, everyoneId),
            bot: botId ? viewOf(channel, botId) : null,
            version: role ? viewOf(channel, role.id) : null,
            orga,
            botAccess: botAccessOf(channel, me),
            children: all.filter((ch) => ch && str(ch.parentId) === c.id).map((ch) => ({
                id: str(ch.id),
                name: str(ch.name),
                synced: typeof ch.permissionsLocked === "boolean" ? ch.permissionsLocked : null,
                visible: viewOf(ch, everyoneId) !== "deny",
            })),
        };
    }
    return { roles, onboarding, onboardingError, categories, everyoneId, botId };
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** Role items: new (none), changed (another name or colour), same; `privileged` from readActual. */
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
            privileged: cur && cur.privileged ? cur.privileged : null,
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

/**
 * Category items: what is missing of "hidden for @everyone, visible for the version role,
 * the orga roles (`orga`: the ones still without) and the bot". `synced` are the channels
 * that follow the category (the apply re-syncs them after its edit), `unsynced` those with
 * own rights that @everyone still sees afterwards - the apply leaves them alone.
 */
function diffCategories(desired, actual) {
    return desired.categories.map((c) => {
        const cur = actual.categories[c.id] || {};
        const orga = Object.entries(cur.orga || {}).filter(([, o]) => o.view !== "allow").map(([id, o]) => ({ id, name: o.name }));
        const missing = [];
        if (cur.everyone !== "deny") missing.push("everyone");
        if (cur.version !== "allow") missing.push("version");
        if (orga.length) missing.push("orga");
        if (cur.bot !== "allow") missing.push("bot");
        const children = cur.children || [];
        return {
            id: c.id, name: c.name, versionId: c.versionId, roleKey: c.roleKey, status: missing.length ? "changed" : "same", missing, orga,
            synced: children.filter((ch) => ch.synced === true).map((ch) => ({ id: ch.id, name: ch.name })),
            unsynced: children.filter((ch) => ch.synced === false && ch.visible).map((ch) => ({ id: ch.id, name: ch.name })),
        };
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
 * A short hash of everything the apply would do (the selected categories, the roles, the
 * questions, the overwrites, the channels it re-syncs): the preview hands it out, the
 * apply compares it with what it reads itself (the `baseRev` idea of the Kader takeover).
 */
function fingerprintOf(selectedIds, d) {
    const compact = {
        categories: [...selectedIds].sort(),
        roles: d.roles.map((r) => [r.key, r.status, r.roleId, r.name, r.color, r.current, r.privileged && r.privileged.code]),
        prompts: d.prompts.map((p) => [p.key, p.id, p.status, p.title, p.options.map((o) => [o.roleKey, o.id, o.status, o.title])]),
        rights: d.categories.map((c) => [c.id, c.versionId, c.missing, c.orga.map((o) => o.id), c.synced.map((x) => x.id), c.unsynced.map((x) => x.id)]),
    };
    return crypto.createHash("sha256").update(JSON.stringify(compact)).digest("hex").slice(0, 16);
}

/**
 * What the bot needs (docs/discord-servers.md): Community (no onboarding without it),
 * Manage Roles (roles, rights, onboarding), Manage Server (onboarding), every existing
 * role of the set below its own highest role (unknown while Manage Roles is missing), View
 * Channel and Manage Roles in every selected category (`categoryAccess`) and no found role
 * that grants more than its purpose (`selfAssign`), no default channel of the onboarding the
 * apply would hide from @everyone (`defaultChannels`: Discord then refuses the onboarding with
 * the rights already changed). `ok` null = unknown.
 */
function prerequisites(guild, actual, categories = []) {
    const me = guild.members && guild.members.me;
    const perms = me && me.permissions ? me.permissions : null;
    const has = (flag) => (perms ? perms.has(flag) : null);
    const manageRoles = has(Flags.ManageRoles);
    const found = Object.values(actual.roles).filter(Boolean);
    const above = manageRoles === true ? found.filter((r) => !r.belowBot).map((r) => r.name) : [];
    const access = Object.values(actual.categories || {});
    const blocked = categories.filter((c) => actual.categories[c.id] && actual.categories[c.id].botAccess === false).map((c) => c.name);
    const privileged = found.filter((r) => r.privileged).map((r) => r.name);
    const hiddenDefaults = hiddenDefaultChannels(actual, categories);
    return [
        { key: "community", ok: Array.isArray(guild.features) ? guild.features.includes("COMMUNITY") : null },
        { key: "manageRoles", ok: manageRoles },
        { key: "manageGuild", ok: has(Flags.ManageGuild) },
        { key: "roleOrder", ok: manageRoles === true ? above.length === 0 : null, roles: above },
        { key: "categoryAccess", ok: blocked.length ? false : (access.some((a) => a.botAccess === null) ? null : true), categories: blocked },
        { key: "selfAssign", ok: privileged.length === 0, roles: privileged },
        { key: "defaultChannels", ok: actual.onboarding ? hiddenDefaults.length === 0 : null, channels: hiddenDefaults },
    ];
}

/**
 * The default channels of the onboarding the apply hides from @everyone: a selected PuG
 * category itself or a channel in it that follows its rights (synced). Discord wants every
 * default channel visible to @everyone (DEFAULT_CHANNEL_REQUIRES_EVERYONE_ACCESS).
 */
function hiddenDefaultChannels(actual, categories) {
    const defaults = actual.onboarding ? actual.onboarding.defaultChannelIds : [];
    const hidden = new Map();
    for (const c of categories) {
        const cur = actual.categories[c.id];
        if (!cur) continue;
        hidden.set(c.id, c.name);
        for (const ch of cur.children || []) if (ch.synced === true) hidden.set(ch.id, ch.name);
    }
    return defaults.filter((id) => hidden.has(id)).map((id) => hidden.get(id));
}

/** Reads the server once: the categories, the selection, the desired and the actual state, the diff. */
async function snapshot(guild, config, saved, categoryIds) {
    const { pug, other } = serverCategories(guild, config);
    const selected = selectedOf(pug, categoryIds);
    const desired = desiredState(selected);
    const actual = await readActual(guild, desired, saved, { config, pug });
    const d = diff(desired, actual);
    const selectedIds = selected.map((c) => c.id);
    return { pug, other, selected, selectedIds, desired, actual, d, fingerprint: fingerprintOf(selectedIds, d) };
}

/**
 * Everything the web shows for one server; `online` false when the bot does not see it.
 * A server without the switch "PuG-Server" gets no comparison, only `notPugServer: true`.
 * @param {{ categoryIds?: string[] }} [opts] the switched-on PuG categories (none given = all)
 */
async function overview(guildId, config = getConfig(), { categoryIds } = {}) {
    const gid = str(guildId);
    const saved = savedFor(gid, config);
    const applied = saved.appliedAt ? { at: saved.appliedAt, by: saved.appliedBy } : null;
    const guild = discord.isOnline() ? discord.getGuild(gid) : null;
    if (!isPugServer(gid, config)) {
        return { guildId: gid, guildName: guild ? str(guild.name) : "", online: !!guild, applied, notPugServer: true };
    }
    if (!guild) return { guildId: gid, guildName: "", online: false, applied };
    const snap = await snapshot(guild, config, saved, categoryIds);
    const selected = new Set(snap.selectedIds);
    return {
        guildId: gid,
        guildName: str(guild.name),
        online: true,
        applied,
        pugCategories: snap.pug.map((c) => ({ ...c, selected: selected.has(c.id) })),
        otherCategories: snap.other,
        roles: snap.d.roles,
        prompts: snap.d.prompts,
        categories: snap.d.categories,
        changes: snap.d.changes,
        onboarding: snap.actual.onboarding ? { enabled: snap.actual.onboarding.enabled, mode: snap.actual.onboarding.mode, defaultChannels: snap.actual.onboarding.defaultChannelIds.length } : null,
        onboardingError: snap.actual.onboardingError,
        prerequisites: prerequisites(guild, snap.actual, snap.selected),
        fingerprint: snap.fingerprint,
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

/** Every check before the first write: a failing one throws and nothing was written. */
function checkBeforeWrite(snap, guild, fingerprint) {
    if (!snap.pug.length) throw new PugOnboardingError(409, "no_pug_category", "Auf diesem Server gibt es keine Raid-Kategorie, für die sich alle anmelden dürfen.");
    if (!snap.desired.versions.length) throw new PugOnboardingError(400, "no_category_selected", "Keine PuG-Kategorie ist eingeschaltet. Nichts wurde geändert.");
    const pre = prerequisites(guild, snap.actual, snap.selected);
    const of = (key) => pre.find((p) => p.key === key);
    const failed = (key) => of(key).ok !== true;
    if (failed("community")) throw new PugOnboardingError(409, "no_community", "Der Server ist kein Community-Server; Discord erlaubt ein Onboarding nur dort. Nichts wurde geändert.");
    if (failed("manageRoles") || failed("manageGuild")) throw new PugOnboardingError(409, "missing_permissions", "Dem Bot fehlen „Rollen verwalten“ oder „Server verwalten“. Nichts wurde geändert.");
    if (failed("roleOrder")) throw new PugOnboardingError(409, "role_above_bot", `Diese Rollen stehen über der Rolle des Bots: ${of("roleOrder").roles.join(", ")}. Nichts wurde geändert.`);
    if (of("categoryAccess").ok === false) throw new PugOnboardingError(409, "category_access", `In diesen Kategorien darf der Bot die Rechte nicht ändern (Kanal sehen + Rollen verwalten): ${of("categoryAccess").categories.join(", ")}. Nichts wurde geändert.`);
    if (failed("selfAssign")) throw new PugOnboardingError(409, "role_privileged", `Diese Rollen geben mehr frei als ihren Zweck und dürfen nicht per Onboarding vergeben werden: ${of("selfAssign").roles.join(", ")}. Nichts wurde geändert.`);
    if (of("defaultChannels").ok === false) throw new PugOnboardingError(409, "default_channel_hidden", `Diese Standard-Kanäle des Onboardings würden für @everyone unsichtbar, das lehnt Discord ab: ${of("defaultChannels").channels.join(", ")}. Nimm sie in Discord aus den Standard-Kanälen oder schalte ihre Kategorie ab. Nichts wurde geändert.`);
    if (snap.actual.onboardingError) throw new PugOnboardingError(502, "onboarding_unreadable", `Das Onboarding ließ sich nicht lesen: ${snap.actual.onboardingError}. Nichts wurde geändert.`);
    if (fingerprint !== snap.fingerprint) throw new PugOnboardingError(409, "changed", "Inzwischen geändert – bitte neu laden. Nichts wurde geändert.");
}

/** Creates, renames and recolours the roles; the ids are saved even when a later one fails. */
async function applyRoles(guild, gid, snap, entry, done, reason) {
    const roleIds = {};
    let edited = false;
    try {
        for (const item of snap.d.roles) {
            let id = item.roleId;
            if (item.status === "new") {
                // A version role gets its own group in the member list; class roles stay under "Online".
                const role = await step(`Rolle ${item.name} anlegen`, done, () => guild.roles.create({
                    name: item.name, colors: { primaryColor: item.color || 0 }, permissions: [], mentionable: false,
                    hoist: item.kind === "version", reason,
                }));
                id = str(role.id);
                done.roles += 1;
            } else if (item.status === "changed") {
                const role = guild.roles.cache.get(item.roleId);
                const patch = { name: item.name, reason };
                if (item.color) patch.colors = { primaryColor: item.color };
                await step(`Rolle ${item.name} anpassen`, done, () => role.edit(patch));
                done.roles += 1;
                edited = true;
            }
            roleIds[item.key] = id;
            if (item.kind === "version") entry.versions[item.id] = id;
            else entry.classes[item.id] = id;
        }
    } finally {
        // The ids first, so a refusal further down never leaves a created role unknown.
        if (done.roles) saveFor(gid, entry);
    }
    // role.edit answers a copy and leaves the cache to the gateway: read the roles again,
    // so the overview after the apply already sees the new names and colours.
    if (edited && typeof guild.roles.fetch === "function") await guild.roles.fetch().catch(() => null);
    return roleIds;
}

/**
 * The rights of the PuG categories: bot, orga roles, version role visible, @everyone hidden.
 * The channels that followed the category before are synced to it again afterwards
 * (the category is read fresh first: the edits leave the cache to the gateway, and
 * lockPermissions copies the cached overwrites); channels with own rights stay as they are.
 */
async function applyRights(guild, snap, roleIds, done, reason) {
    const { actual } = snap;
    for (const c of snap.d.categories) {
        if (c.status === "same") continue;
        const channel = guild.channels.cache.get(c.id);
        const edit = (id, view) => step(`Rechte ${c.name}`, done, () => channel.permissionOverwrites.edit(id, { ViewChannel: view }, { reason }));
        // The bot first: hiding the category from @everyone must never lock the bot out.
        if (c.missing.includes("bot") && actual.botId) await edit(actual.botId, true);
        for (const o of c.orga) await edit(o.id, true);
        if (c.missing.includes("version")) await edit(roleIds[c.roleKey], true);
        if (c.missing.includes("everyone")) await edit(actual.everyoneId, false);
        done.categories += 1;
        if (!c.synced.length) continue;
        if (typeof guild.channels.fetch === "function") await step(`Rechte ${c.name} lesen`, done, () => guild.channels.fetch(c.id, { force: true }));
        for (const child of c.synced) {
            const ch = guild.channels.cache.get(child.id);
            if (!ch || typeof ch.lockPermissions !== "function") continue;
            await step(`Kanal ${child.name} angleichen`, done, () => ch.lockPermissions());
            done.channels += 1;
        }
    }
}

/**
 * Brings the server to the desired state: roles (create / rename / recolour), then the
 * rights of the selected PuG categories, last the onboarding. Every check runs before the
 * first write, so a missing prerequisite or a changed state writes nothing. Throws
 * PugOnboardingError; answers the new overview and `done` = { roles, categories,
 * channels, onboarding } (what was written).
 * @param {{ actor?: string, categoryIds?: string[], fingerprint: string }} opts
 */
async function apply(guildId, { actor = "", categoryIds, fingerprint } = {}) {
    const gid = str(guildId);
    if (!str(fingerprint)) throw new PugOnboardingError(400, "fingerprint_required", "Die Vorschau fehlt - bitte neu laden.");
    if (inFlight.has(gid)) throw new PugOnboardingError(409, "busy", "Für diesen Server läuft die Übernahme gerade schon.");
    inFlight.add(gid);
    try {
        const config = getConfig();
        if (!isPugServer(gid, config)) {
            throw new PugOnboardingError(409, "not_pug_server",
                "Dieser Server ist kein PuG-Server - setze in den Server-Einstellungen den Schalter „PuG-Server“. Nichts wurde geändert.");
        }
        const guild = discord.isOnline() ? discord.getGuild(gid) : null;
        if (!guild) throw new PugOnboardingError(409, "offline", "Der Bot ist nicht online oder nicht auf diesem Server.");
        const saved = savedFor(gid, config);
        const snap = await snapshot(guild, config, saved, categoryIds);
        checkBeforeWrite(snap, guild, str(fingerprint));

        const reason = `EventHelper: PuG-Onboarding${actor ? ` (${actor})` : ""}`;
        const done = { roles: 0, categories: 0, channels: 0, onboarding: false };
        const entry = { ...saved, versions: { ...saved.versions }, classes: { ...saved.classes } };
        const roleIds = await applyRoles(guild, gid, snap, entry, done, reason);
        await applyRights(guild, snap, roleIds, done, reason);

        if (snap.d.prompts.some((p) => p.status !== "same")) {
            const ob = snap.actual.onboarding;
            await step("Onboarding", done, () => guild.editOnboarding({
                prompts: promptsPayload(snap.desired, snap.actual, snap.d.prompts, roleIds),
                defaultChannels: ob.defaultChannelIds,
                enabled: ob.enabled,
                mode: ob.mode,
                reason,
            }));
            done.onboarding = true;
        }

        saveFor(gid, { ...entry, appliedAt: new Date().toISOString(), appliedBy: str(actor) });
        return { done, overview: await overview(gid, getConfig(), { categoryIds: snap.selectedIds }) };
    } finally {
        inFlight.delete(gid);
    }
}

module.exports = {
    desiredState, readActual, diff, prerequisites, overview, apply, serverCategories, savedFor, firstPugServer,
    isPugServer, pugServerIds, PugOnboardingError, VERSION_PROMPT, CLASS_PROMPT,
};
