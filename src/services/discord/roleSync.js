// Role sync between pairs of servers (#264; any two servers since #896).
//
// `config.roleSync = [{ fromGuildId, fromRoleId, toGuildId, toRoleId, direction }]`
// pairs a role on one configured server with a role on another. direction:
//
//   toTarget — whoever holds the from role gets the to role
//   toSource — whoever holds the to role gets the from role
//   both     — either way
//
// configSchema.normalizeRoleSync keeps only pairs of two different configured
// servers and migrates the old event/talk entries; this file works on pairs only
// and never asks which server is "event" or "talk".
//
// ⚠️ The sync only ever ADDS a role (`member.roles.add`). It never removes one
// — decided in #250/#264: a role taken away on one server stays on the other,
// and roleSyncDrift() lists those members as a hint in the admin menu, where a
// person decides and removes it in Discord. test/services/discord/roleSync.test.js holds
// that line, including a scan of this file for a remove call.
//
// Runs on guildMemberUpdate/guildMemberAdd (bot.js) for the one member, and
// every 10 minutes over everyone (startRoleSync, server.js). Without "Rollen
// verwalten" on a target server it adds nothing there and says so.
const discord = require("./discord");
const guildRoles = require("./guildRoles");
const { getConfig } = require("../../stores/settingsStore");

const REASON = "EventHelper Rollen-Abgleich";

/** The flows of one pair: from which server's role to which server's role. */
function flows(rule) {
    const toTarget = { fromGuildId: rule.fromGuildId, toGuildId: rule.toGuildId, fromRoleId: rule.fromRoleId, toRoleId: rule.toRoleId };
    const toSource = { fromGuildId: rule.toGuildId, toGuildId: rule.fromGuildId, fromRoleId: rule.toRoleId, toRoleId: rule.fromRoleId };
    if (rule.direction === "toSource") return [toSource];
    if (rule.direction === "both") return [toTarget, toSource];
    return [toTarget];
}

/** A member reduced to what the planner reads: id, name, bot flag and role ids. */
function liteMember(member) {
    if (!member) return null;
    const roles = member.roles && member.roles.cache ? [...member.roles.cache.keys()] : (member.roleIds || []);
    return {
        id: String(member.id),
        name: member.displayName || (member.user && (member.user.globalName || member.user.username)) || String(member.id),
        bot: !!(member.user && member.user.bot),
        roleIds: new Set(roles.map(String)),
    };
}

const byId = (list) => new Map((list || []).filter(Boolean).map((m) => [m.id, m]));
const byGuild = (members) => {
    const out = new Map();
    for (const [guildId, list] of Object.entries(members || {})) out.set(String(guildId), byId(list));
    return out;
};
const EMPTY = new Map();

/** Every server a pair names, in the order the pairs name them. */
function pairGuildIds(mapping) {
    return [...new Set((mapping || []).flatMap((r) => [r.fromGuildId, r.toGuildId]).filter(Boolean).map(String))];
}

/**
 * Which roles to add. Pure: `members = { [guildId]: lite[] }`. Only members on
 * both servers of a pair take part — a role on a server one is not on cannot
 * be given. A server without a list counts as nobody there.
 * @returns {{ guildId, userId, roleId, name }[]}
 */
function planRoleSync(mapping, members) {
    const maps = byGuild(members);
    const adds = [];
    const seen = new Set();
    for (const rule of mapping || []) {
        for (const flow of flows(rule)) {
            const source = maps.get(String(flow.fromGuildId)) || EMPTY;
            const target = maps.get(String(flow.toGuildId)) || EMPTY;
            for (const m of source.values()) {
                if (m.bot || !m.roleIds.has(flow.fromRoleId)) continue;
                const there = target.get(m.id);
                if (!there || there.roleIds.has(flow.toRoleId)) continue;
                const key = `${flow.toGuildId}:${m.id}:${flow.toRoleId}`;
                if (seen.has(key)) continue;
                seen.add(key);
                adds.push({ guildId: String(flow.toGuildId), userId: m.id, roleId: flow.toRoleId, name: m.name });
            }
        }
    }
    return adds;
}

/**
 * Who holds a synced role on the target server but no longer the role it came
 * from — the case the sync deliberately leaves alone. Only one-way pairs: with
 * "both" the sync gives the lost role straight back, so nothing drifts. A pair
 * whose member lists are missing is left out. Pure; computed on every read.
 * @returns {{ ruleIndex, guildId, sourceGuildId, roleId, sourceRoleId, members: { userId, name, notOnSource }[] }[]}
 */
function roleSyncDrift(mapping, members) {
    const maps = byGuild(members);
    const groups = [];
    (mapping || []).forEach((rule, ruleIndex) => {
        if (rule.direction === "both") return;
        const [flow] = flows(rule);
        const target = maps.get(String(flow.toGuildId));
        const source = maps.get(String(flow.fromGuildId));
        if (!target || !source) return;
        const list = [];
        for (const m of target.values()) {
            if (m.bot || !m.roleIds.has(flow.toRoleId)) continue;
            const there = source.get(m.id);
            if (there && there.roleIds.has(flow.fromRoleId)) continue;
            list.push({ userId: m.id, name: m.name, notOnSource: !there });
        }
        if (list.length) {
            list.sort((a, b) => a.name.localeCompare(b.name));
            groups.push({
                ruleIndex, guildId: String(flow.toGuildId), sourceGuildId: String(flow.fromGuildId),
                roleId: flow.toRoleId, sourceRoleId: flow.fromRoleId, members: list,
            });
        }
    });
    return groups;
}

/** Whether the bot may manage roles on that server; false when unknowable too — then it does nothing. */
function canManageRoles(guildId) {
    const perms = guildId ? discord.botPermissionsIn(guildId) : null;
    const entry = perms ? perms.find((p) => p.key === "ManageRoles") : null;
    return !!(entry && entry.ok);
}

/** A server's name for a message: its label, else its Discord name, else the id. */
function guildName(guildId, config, guild) {
    return guildRoles.serverLabel(guildId, config) || (guild && guild.name) || String(guildId);
}

/**
 * The servers the pairs need, as `{ guilds: Map<id, Guild>, rules, errors, error }`:
 * `rules` are the pairs whose two servers the bot is on (the others are skipped
 * and named in `errors`), `error` a German reason when no pair can run at all.
 */
function resolvePairs(config, mapping) {
    const guilds = new Map();
    const errors = [];
    for (const id of pairGuildIds(mapping)) {
        const guild = discord.getGuild(id);
        if (guild) guilds.set(id, guild);
        else errors.push(`Der Bot ist nicht auf ${guildName(id, config)}.`);
    }
    const rules = (mapping || []).filter((r) => guilds.has(String(r.fromGuildId)) && guilds.has(String(r.toGuildId)));
    const error = mapping.length && !rules.length ? (errors[0] || "Kein gültiges Rollen-Paar.") : null;
    return { guilds, rules, errors, error };
}

/**
 * Apply planned adds. `memberObjects = Map<guildId, Map<userId, GuildMember>>`.
 * A server without "Rollen verwalten" is skipped as a whole and reported (its id
 * in `missingPermission`).
 */
async function applyAdds(adds, { guilds, memberObjects }) {
    const out = { added: 0, failed: 0, missingPermission: [], errors: [] };
    const allowed = new Map();
    for (const id of [...new Set(adds.map((a) => a.guildId))]) {
        allowed.set(id, canManageRoles(id));
        if (!allowed.get(id)) out.missingPermission.push(id);
    }
    for (const add of adds) {
        if (!allowed.get(add.guildId)) continue;
        const members = memberObjects.get(add.guildId);
        const member = members ? members.get(add.userId) : null;
        const guild = guilds.get(add.guildId);
        const role = guild && guild.roles && guild.roles.cache ? guild.roles.cache.get(add.roleId) : null;
        if (!member || !role) { out.failed += 1; continue; }
        // A role above the bot's highest one cannot be given, whatever the permission says.
        if (role.editable === false) {
            out.failed += 1;
            out.errors.push(`@${role.name} liegt über der Rolle des Bots.`);
            continue;
        }
        try {
            await member.roles.add(add.roleId, REASON);
            out.added += 1;
        } catch (e) {
            out.failed += 1;
            out.errors.push((e && e.message) || "Rolle konnte nicht vergeben werden.");
        }
    }
    out.errors = [...new Set(out.errors)].slice(0, 5);
    return out;
}

/**
 * The member lists of the servers the rules need, one fetch per server.
 * A server whose list fails drops out (its pairs with it), the reason in
 * `errors`. `fresh`: the sweep gives roles from the list; a page reads the cached one.
 */
async function loadMembers(rules, guilds, config, { fresh }) {
    const ids = pairGuildIds(rules);
    const lists = new Map();
    const errors = [];
    await Promise.all(ids.map(async (id) => {
        try {
            const list = fresh
                ? await discord.fetchGuildMembersCached(id, guilds.get(id), { fresh: true })
                : await discord.fetchGuildMembersCached(id, guilds.get(id));
            lists.set(id, list || []);
        } catch (e) {
            errors.push(`${guildName(id, config, guilds.get(id))}: ${(e && e.message) || "Mitglieder konnten nicht geladen werden."}`);
        }
    }));
    const lite = {};
    for (const [id, list] of lists) lite[id] = list.map(liteMember);
    return { lists, lite, errors };
}

let lastRun = null;
let running = false;

const noRun = (extra = {}) => ({ added: 0, failed: 0, missingPermission: [], errors: [], error: null, ...extra });

/** One sweep over every member of every server in a pair. Never throws. */
async function runRoleSync({ config = getConfig(), now = Date.now() } = {}) {
    const mapping = config.roleSync || [];
    if (!mapping.length) return noRun();
    if (running) return noRun({ error: "läuft bereits" });
    const pairs = resolvePairs(config, mapping);
    if (pairs.error) {
        lastRun = { at: now, ...noRun({ errors: pairs.errors, error: pairs.error }) };
        return lastRun;
    }
    running = true;
    try {
        const loaded = await loadMembers(pairs.rules, pairs.guilds, config, { fresh: true });
        if (!loaded.lists.size) throw new Error(loaded.errors[0] || "Mitglieder konnten nicht geladen werden.");
        const memberObjects = new Map([...loaded.lists].map(([id, list]) => [id, new Map(list.map((m) => [String(m.id), m]))]));
        const adds = planRoleSync(pairs.rules, loaded.lite);
        const result = await applyAdds(adds, { guilds: pairs.guilds, memberObjects });
        const errors = [...new Set([...pairs.errors, ...loaded.errors, ...result.errors])].slice(0, 5);
        lastRun = { at: now, ...result, errors, error: null };
    } catch (e) {
        lastRun = { at: now, ...noRun({ errors: pairs.errors, error: (e && e.message) || "Mitglieder konnten nicht geladen werden." }) };
    } finally {
        running = false;
    }
    return lastRun;
}

/**
 * The sync for one member whose roles changed or who just joined a server:
 * fetches the same person on every partner server of the pairs that name this
 * server and plans only for them.
 */
async function syncMember(member, { config = getConfig() } = {}) {
    if (!member || !member.guild || !(config.roleSync || []).length) return null;
    if (member.user && member.user.bot) return null;
    const guildId = String(member.guild.id);
    const mine = config.roleSync.filter((r) => String(r.fromGuildId) === guildId || String(r.toGuildId) === guildId);
    if (!mine.length) return null;
    const pairs = resolvePairs(config, mine);
    if (pairs.error) return null;
    const userId = String(member.id);
    const lists = { [guildId]: [liteMember(member)] };
    const memberObjects = new Map([[guildId, new Map([[userId, member]])]]);
    for (const otherId of pairGuildIds(pairs.rules).filter((id) => id !== guildId)) {
        let other;
        try {
            other = await pairs.guilds.get(otherId).members.fetch(userId);
        } catch {
            other = null; // not on that server: nothing to give there or from there
        }
        if (!other) continue;
        lists[otherId] = [liteMember(other)];
        memberObjects.set(otherId, new Map([[userId, other]]));
    }
    if (memberObjects.size < 2) return null;
    const adds = planRoleSync(pairs.rules, lists);
    if (!adds.length) return noRun({ error: undefined });
    const result = await applyAdds(adds, { guilds: pairs.guilds, memberObjects });
    if (result.missingPermission.length) console.warn("[roleSync] Rollen verwalten fehlt auf:", result.missingPermission.join(", "));
    return result;
}

/** guildMemberUpdate: only when the roles actually changed. */
async function handleMemberUpdate(oldMember, newMember) {
    const before = oldMember && oldMember.roles && oldMember.roles.cache ? [...oldMember.roles.cache.keys()].sort().join(",") : null;
    const after = newMember && newMember.roles && newMember.roles.cache ? [...newMember.roles.cache.keys()].sort().join(",") : "";
    if (before !== null && before === after) return null;
    return syncMember(newMember);
}

/** guildMemberAdd: a new member may bring roles from another server. */
async function handleMemberAdd(member) {
    return syncMember(member);
}

/** Role names of a server as a map, for labelling the drift list. */
function roleNames(guildId) {
    return new Map((discord.listRoles(guildId) || []).map((r) => [r.id, r.name]));
}

/**
 * Everything the settings section shows: the pairs, every configured server
 * with its roles and whether the bot may manage roles there, the member overlap
 * per pair of servers, the drift list and the last sweep. Drift and overlap need
 * member lists; a failure comes back as `driftError` / the overlap's `error`,
 * never thrown.
 */
async function roleSyncView(config = getConfig()) {
    const mapping = config.roleSync || [];
    const servers = guildRoles.serverIds(config).map((id) => {
        const guild = discord.getGuild(id);
        return {
            guildId: id,
            label: guildRoles.serverLabel(id, config),
            name: guild ? guild.name || "" : "",
            connected: !!guild,
            canManage: canManageRoles(id),
            roles: discord.listRoles(id) || [],
        };
    });
    const overlapKeys = new Map();
    for (const r of mapping) {
        const [a, b] = [String(r.fromGuildId), String(r.toGuildId)].sort();
        overlapKeys.set(`${a}:${b}`, [a, b]);
    }
    const overlaps = [];
    for (const [a, b] of overlapKeys.values()) {
        const overlap = await guildRoles.guildOverlap(a, b);
        if (overlap) overlaps.push({ fromGuildId: a, toGuildId: b, ...overlap });
    }
    const drift = await loadDrift(config);
    return {
        roleSync: mapping,
        servers,
        overlaps,
        drift: drift.groups,
        driftTotal: drift.total,
        driftError: drift.error,
        lastRun,
    };
}

/** The drift groups with names, plus the member total. `{ groups, total, error }`. */
async function loadDrift(config = getConfig()) {
    const mapping = (config.roleSync || []).filter((r) => r.direction !== "both");
    const empty = { groups: [], total: 0, error: null };
    if (!mapping.length) return empty;
    const pairs = resolvePairs(config, mapping);
    if (pairs.error) return { ...empty, error: pairs.error };
    try {
        const loaded = await loadMembers(pairs.rules, pairs.guilds, config, { fresh: false });
        const names = new Map();
        const namesOf = (id) => {
            if (!names.has(id)) names.set(id, roleNames(id));
            return names.get(id);
        };
        // ruleIndex points into the full mapping, not the one-way subset.
        const all = config.roleSync || [];
        const groups = roleSyncDrift(pairs.rules, loaded.lite).map((g) => ({
            ...g,
            ruleIndex: all.indexOf(pairs.rules[g.ruleIndex]),
            roleName: namesOf(g.guildId).get(g.roleId) || g.roleId,
            sourceRoleName: namesOf(g.sourceGuildId).get(g.sourceRoleId) || g.sourceRoleId,
            guildName: guildName(g.guildId, config, pairs.guilds.get(g.guildId)),
            sourceGuildName: guildName(g.sourceGuildId, config, pairs.guilds.get(g.sourceGuildId)),
            members: g.members.map((m) => ({ ...m, profileUrl: `https://discord.com/users/${m.userId}` })),
        }));
        const total = new Set(groups.flatMap((g) => g.members.map((m) => m.userId))).size;
        const errors = [...pairs.errors, ...loaded.errors];
        return { groups, total, error: errors.length ? errors.join(" ") : null };
    } catch (e) {
        return { ...empty, error: (e && e.message) || "Mitglieder konnten nicht geladen werden." };
    }
}

let timer = null;
let firstTimer = null;

/** Start the periodic full sync (idempotent, unref'd), every 10 minutes. */
function startRoleSync({ intervalMs = 10 * 60 * 1000, firstRunMs = 60 * 1000 } = {}) {
    if (timer) return timer;
    const run = () => runRoleSync().catch((e) => console.error("[roleSync]", e.message));
    // Not at boot: the gateway is not ready yet, so every server would read as
    // "bot not there". A minute later the member lists can be fetched.
    firstTimer = setTimeout(run, firstRunMs);
    if (firstTimer.unref) firstTimer.unref();
    timer = setInterval(run, intervalMs);
    if (timer.unref) timer.unref();
    return timer;
}

/** Stop the periodic sync, the first run included (idempotent). */
function stopRoleSync() {
    if (timer) clearInterval(timer);
    if (firstTimer) clearTimeout(firstTimer);
    timer = null;
    firstTimer = null;
}

/** Test-only: forget timer and last run. */
function _resetForTests() {
    stopRoleSync();
    lastRun = null;
    running = false;
}

module.exports = {
    flows, liteMember, planRoleSync, roleSyncDrift, canManageRoles, applyAdds, pairGuildIds,
    runRoleSync, syncMember, handleMemberUpdate, handleMemberAdd,
    roleSyncView, loadDrift, startRoleSync, stopRoleSync, _resetForTests,
};
