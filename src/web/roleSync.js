// Role sync between the event server and the talk server (#264).
//
// `config.roleSync = [{ eventRoleId, talkRoleId, direction }]` pairs a role on
// the event server with one on the talk server. direction:
//
//   toTalk  — whoever holds the event role gets the talk role
//   toEvent — whoever holds the talk role gets the event role
//   both    — either way
//
// ⚠️ The sync only ever ADDS a role (`member.roles.add`). It never removes one
// — decided in #250/#264: a role taken away on one server stays on the other,
// and roleSyncDrift() lists those members as a hint in the admin menu, where a
// person decides and removes it in Discord. test/web/roleSync.test.js holds
// that line, including a scan of this file for a remove call.
//
// Runs on guildMemberUpdate/guildMemberAdd (bot.js) for the one member, and
// every 10 minutes over everyone (startRoleSync, server.js). Without "Rollen
// verwalten" on a target server it adds nothing there and says so.
const discord = require("./discord");
const guildRoles = require("./guildRoles");
const { getConfig } = require("./settingsStore");

const REASON = "EventHelper Rollen-Abgleich";
const SIDES = ["event", "talk"];

/** The flows of one mapping entry: from which side's role to which side's role. */
function flows(rule) {
    const toTalk = { from: "event", to: "talk", fromRoleId: rule.eventRoleId, toRoleId: rule.talkRoleId };
    const toEvent = { from: "talk", to: "event", fromRoleId: rule.talkRoleId, toRoleId: rule.eventRoleId };
    if (rule.direction === "toEvent") return [toEvent];
    if (rule.direction === "both") return [toTalk, toEvent];
    return [toTalk];
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

/**
 * Which roles to add. Pure: `members = { event: lite[], talk: lite[] }`.
 * Only members on both servers take part — a role on a server one is not on
 * cannot be given.
 * @returns {{ side, userId, roleId, name }[]}
 */
function planRoleSync(mapping, members) {
    const maps = { event: byId(members.event), talk: byId(members.talk) };
    const adds = [];
    const seen = new Set();
    for (const rule of mapping || []) {
        for (const flow of flows(rule)) {
            for (const m of maps[flow.from].values()) {
                if (m.bot || !m.roleIds.has(flow.fromRoleId)) continue;
                const target = maps[flow.to].get(m.id);
                if (!target || target.roleIds.has(flow.toRoleId)) continue;
                const key = `${flow.to}:${m.id}:${flow.toRoleId}`;
                if (seen.has(key)) continue;
                seen.add(key);
                adds.push({ side: flow.to, userId: m.id, roleId: flow.toRoleId, name: m.name });
            }
        }
    }
    return adds;
}

/**
 * Who holds a synced role on the target side but no longer the role it came
 * from — the case the sync deliberately leaves alone. Only one-way entries:
 * with "both" the sync gives the lost role straight back, so nothing drifts.
 * Pure; computed on every read, nothing stored.
 * @returns {{ ruleIndex, side, roleId, sourceRoleId, members: { userId, name, notOnSource }[] }[]}
 */
function roleSyncDrift(mapping, members) {
    const maps = { event: byId(members.event), talk: byId(members.talk) };
    const groups = [];
    (mapping || []).forEach((rule, ruleIndex) => {
        if (rule.direction === "both") return;
        const [flow] = flows(rule);
        const list = [];
        for (const m of maps[flow.to].values()) {
            if (m.bot || !m.roleIds.has(flow.toRoleId)) continue;
            const source = maps[flow.from].get(m.id);
            if (source && source.roleIds.has(flow.fromRoleId)) continue;
            list.push({ userId: m.id, name: m.name, notOnSource: !source });
        }
        if (list.length) {
            list.sort((a, b) => a.name.localeCompare(b.name));
            groups.push({ ruleIndex, side: flow.to, roleId: flow.toRoleId, sourceRoleId: flow.fromRoleId, members: list });
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

/** The two servers of a config, or a German reason why the sync cannot run. */
function servers(config) {
    const ids = { event: guildRoles.eventGuildId(config), talk: guildRoles.talkGuildId(config) };
    if (!ids.event || !ids.talk) return { error: "Kein zweiter Server eingestellt." };
    const guilds = { event: discord.getGuild(ids.event), talk: discord.getGuild(ids.talk) };
    if (!guilds.event || !guilds.talk) return { error: "Der Bot ist nicht auf beiden Servern." };
    return { ids, guilds };
}

/**
 * Apply planned adds. `memberObjects = { event: Map<id, GuildMember>, talk }`.
 * A side without "Rollen verwalten" is skipped as a whole and reported.
 */
async function applyAdds(adds, { ids, guilds, memberObjects }) {
    const out = { added: 0, failed: 0, missingPermission: [], errors: [] };
    const allowed = {};
    for (const side of SIDES) {
        allowed[side] = canManageRoles(ids[side]);
        if (!allowed[side] && adds.some((a) => a.side === side)) out.missingPermission.push(side);
    }
    for (const add of adds) {
        if (!allowed[add.side]) continue;
        const member = memberObjects[add.side].get(add.userId);
        const role = guilds[add.side].roles && guilds[add.side].roles.cache ? guilds[add.side].roles.cache.get(add.roleId) : null;
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

let lastRun = null;
let running = false;

/** One sweep over every member of both servers. Never throws. */
async function runRoleSync({ config = getConfig(), now = Date.now() } = {}) {
    const mapping = config.roleSync || [];
    if (!mapping.length) return { added: 0, failed: 0, missingPermission: [], errors: [], error: null };
    if (running) return { added: 0, failed: 0, missingPermission: [], errors: [], error: "läuft bereits" };
    const srv = servers(config);
    if (srv.error) {
        lastRun = { at: now, added: 0, failed: 0, missingPermission: [], errors: [], error: srv.error };
        return lastRun;
    }
    running = true;
    try {
        const [eventList, talkList] = await Promise.all([
            discord.fetchGuildMembersCached(srv.ids.event, srv.guilds.event),
            discord.fetchGuildMembersCached(srv.ids.talk, srv.guilds.talk),
        ]);
        const memberObjects = {
            event: new Map(eventList.map((m) => [String(m.id), m])),
            talk: new Map(talkList.map((m) => [String(m.id), m])),
        };
        const adds = planRoleSync(mapping, { event: eventList.map(liteMember), talk: talkList.map(liteMember) });
        const result = await applyAdds(adds, { ...srv, memberObjects });
        lastRun = { at: now, ...result, error: null };
    } catch (e) {
        lastRun = { at: now, added: 0, failed: 0, missingPermission: [], errors: [], error: (e && e.message) || "Mitglieder konnten nicht geladen werden." };
    } finally {
        running = false;
    }
    return lastRun;
}

/**
 * The sync for one member whose roles changed or who just joined one server:
 * fetches the same person on the other server and plans only for them.
 */
async function syncMember(member, { config = getConfig() } = {}) {
    if (!member || !member.guild || !(config.roleSync || []).length) return null;
    if (member.user && member.user.bot) return null;
    const side = guildRoles.guildRole(member.guild.id, config);
    if (!SIDES.includes(side)) return null;
    const srv = servers(config);
    if (srv.error) return null;
    const other = side === "event" ? "talk" : "event";
    let otherMember = null;
    try {
        otherMember = await srv.guilds[other].members.fetch(String(member.id));
    } catch {
        return null; // not on the other server: nothing to give on either side
    }
    if (!otherMember) return null;
    const lists = { [side]: [liteMember(member)], [other]: [liteMember(otherMember)] };
    const adds = planRoleSync(config.roleSync, lists);
    if (!adds.length) return { added: 0, failed: 0, missingPermission: [], errors: [] };
    const memberObjects = {
        [side]: new Map([[String(member.id), member]]),
        [other]: new Map([[String(otherMember.id), otherMember]]),
    };
    const result = await applyAdds(adds, { ...srv, memberObjects });
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

/** guildMemberAdd: a new member may bring roles from the other server. */
async function handleMemberAdd(member) {
    return syncMember(member);
}

/** Role names of a server as a map, for labelling the drift list. */
function roleNames(guildId) {
    return new Map((discord.listRoles(guildId) || []).map((r) => [r.id, r.name]));
}

/**
 * Everything the settings section shows: the mapping, both servers' roles, the
 * permission state, the drift list and the last sweep. Drift needs both member
 * lists; a failure comes back as `driftError`, never thrown.
 */
async function roleSyncView(config = getConfig()) {
    const ids = { event: guildRoles.eventGuildId(config), talk: guildRoles.talkGuildId(config) };
    const mapping = config.roleSync || [];
    const view = {
        roleSync: mapping,
        eventRoles: ids.event ? discord.listRoles(ids.event) : [],
        talkRoles: ids.talk ? discord.listRoles(ids.talk) : [],
        canManage: { event: canManageRoles(ids.event), talk: canManageRoles(ids.talk) },
        drift: [],
        driftTotal: 0,
        driftError: null,
        lastRun,
    };
    const drift = await loadDrift(config);
    view.drift = drift.groups;
    view.driftTotal = drift.total;
    view.driftError = drift.error;
    return view;
}

/** The drift groups with names, plus the member total. `{ groups, total, error }`. */
async function loadDrift(config = getConfig()) {
    const mapping = config.roleSync || [];
    const empty = { groups: [], total: 0, error: null };
    if (!mapping.some((r) => r.direction !== "both")) return empty;
    const srv = servers(config);
    if (srv.error) return { ...empty, error: srv.error };
    try {
        const [eventList, talkList] = await Promise.all([
            discord.fetchGuildMembersCached(srv.ids.event, srv.guilds.event),
            discord.fetchGuildMembersCached(srv.ids.talk, srv.guilds.talk),
        ]);
        const names = { event: roleNames(srv.ids.event), talk: roleNames(srv.ids.talk) };
        const groups = roleSyncDrift(mapping, { event: eventList.map(liteMember), talk: talkList.map(liteMember) })
            .map((g) => {
                const from = g.side === "talk" ? "event" : "talk";
                return {
                    ...g,
                    roleName: names[g.side].get(g.roleId) || g.roleId,
                    sourceRoleName: names[from].get(g.sourceRoleId) || g.sourceRoleId,
                    guildName: srv.guilds[g.side].name || "",
                    members: g.members.map((m) => ({ ...m, profileUrl: `https://discord.com/users/${m.userId}` })),
                };
            });
        const total = new Set(groups.flatMap((g) => g.members.map((m) => m.userId))).size;
        return { groups, total, error: null };
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
    // Not at boot: the gateway is not ready yet, so both servers would read as
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
    flows, liteMember, planRoleSync, roleSyncDrift, canManageRoles, applyAdds,
    runRoleSync, syncMember, handleMemberUpdate, handleMemberAdd,
    roleSyncView, loadDrift, startRoleSync, stopRoleSync, _resetForTests,
};
