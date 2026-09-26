// The board of one boss — shared by the event plan (raidplanStore.js) and the
// raid plan templates (raidplanTemplateStore.js), so the two can never disagree
// about what a board is or how it is validated.
//
//   tokens   [{ userId, x, y }]          free player tokens (event plans only)
//   slots    [{ id, kind, n, label, x, y, userId, size, ... }]
//                                          placeholders: tank n, healer n, melee n, ranged n,
//                                          dps n ("DPS (egal)"), a group marker (n = the setup's
//                                          group), or a free label. `userId` is the player
//                                          standing in it ("" = open); a template never has one.
//                                          A group marker also has hideMembers (only its tag is
//                                          shown), split (its raiders stand around the tag as
//                                          tokens) and offsets { [userId]: { dx, dy, size } } (a
//                                          raider moved or scaled on his own, relative to the tag).
//   icons    [{ id, iconKey, label, showLabel, x, y, size, rotation, ... }]  boss / enemy / spell icons
//   marks    [{ id, mark, x, y }]         the eight raid target marks
//   zones    [{ id, shape, type, label, color, opacity, x, y, w, h }]
//                                          rectangle / ellipse areas: danger, healthy,
//                                          neutral or a custom one; type "role" = a placeholder for a whole role
//                                          group ("Melees", "Ranged" ...: role, count, showNames; shape also "cluster"),
//                                          never resolved into players
//   icons also carry arrowScale (0.25..3, the facing wedge), arrowHidden, arrowColor, arrowOpacity - only when set
//   lines    [{ id, kind, x1, y1, x2, y2, color, width, ... }]   arrows and plain lines
//   texts    [{ id, text, x, y, color, size, ... }]              free text on the board
//   targets  [{ id, title, userIds }]     task rows
//   counts   { tank, healer, dps, melee, ranged } | null   how many role slots the Besetzung has on this board (null = the raid type's)
//   hiddenCards [type]   default assignment cards that are hidden on this board
//   inheritOff  [id]     rows of the template's Standard this boss does not inherit (raidplanInherit.js)
//   mobs     [{ id, name, icon }]   mobs added to this section (tank targets, optionally also icons on the map)
//   roles    { [userId]: role }   who plays another role on this boss than in the setup (flex)
//   slots may carry placed:false = in the Besetzung, not on the map
//   assignments [{ id, type, title, assignees, targets, note, suggested }]  who heals whom, kicks, curses ... (raidplanAssign.js)
//   autoPlace   false = the tank rows do not put their mobs and tanks on the map (default: they do, docs/raidplan.md)
//   autoPos     { [key]: { x, y } }   where an object the tank rows put on the map was moved to by hand; key = "t:<row>:<n>"
//               (the n-th tank of a row) or "m:<mob>#<n>" (the n-th mob of a kind). The objects themselves are never stored.
//   autoStyle   { [key]: { size, opacity, ring, showName, label, showLabel, rotation, autoFace, hidden, lock, z } }  how one of them looks
//               (only what differs from the default is kept; size in reference px like a token / an icon)
//   autoScale   0.4..2: all objects of the tank rows together (on top of objectScale)
//   notes, profileId, mapOpacity          (mapOpacity 0.1..1: how strongly the map shows)
//   objectScale                           (0.4..2: the default size of tokens, slots, marks and icons)
//
// Every object (token, slot, mark, zone, line, text) also carries `opacity`
// (0.1..1; zones start at 0.3, everything else at 1), `lock` (it cannot be moved
// or scaled) and `hidden` (it is not drawn — in the editor's layer list it can be
// switched back on). Colour and opacity are separate fields.
//
// Coordinates are relative to the board (0..1). A save is cleaned, never trusted.
const assign = require("./raidplanAssign");
const steps = require("./raidplanSteps");
const besetzung = require("./raidplanBesetzung");
const { str } = require("../../utils/text");
const { newId } = require("../../utils/ids");

// cleanBoard's llowedUserIds value that keeps every well-formed player id
const ANY_PLAYER = "*";

const LIMITS = {
    tokensPerBoss: 60,
    slotsPerBoss: 60,
    marksPerBoss: 40,
    zonesPerBoss: 30,
    linesPerBoss: 40,
    textsPerBoss: 40,
    iconsPerBoss: 60,
    offsetsPerGroup: 30,
    mobsPerBoss: 40,
    autoPos: 80,
    text: 60,
    targetsPerBoss: 30,
    usersPerTarget: 25,
    title: 80,
    label: 40,
    notes: 1000,
};

const FLEX_ROLES = ["tank", "healer", "dps", "melee", "ranged"];
const SLOT_KINDS = ["tank", "healer", "melee", "ranged", "dps", "group", "label"];
// sizes in px: the default and the range of what can be set
// def, min, max: 25 % .. 400 % of the default (sizes are in reference units, see docs/raidplan.md)
const SIZES = { token: [38, 10, 152], mark: [34, 9, 136], icon: [48, 12, 192] };
/** A scale factor as stored: 0.25 .. 4 (25 % .. 400 %), two decimals, 1 when it is not a number. */
function cleanFactor(v) {
    const n = Number(v);
    return v !== "" && v !== null && v !== undefined && Number.isFinite(n) ? Math.max(0.25, Math.min(4, Math.round(n * 100) / 100)) : 1;
}
// an icon is the encounter's boss icon (boss:<WCL encounter id>), a mob's portrait (mob:<NPC id>), a spell / ability icon of the icon CDN (wow:<icon name>) or one of the two built in symbols
const MOB_ID = /^[dcb]:[\w\-/']{1,70}$/;
const ICON_KEY = /^((?:boss|mob):\d{1,6}|wow:[a-z0-9_'-]{2,64}|enemy|bosspos)$/;
/** The saved default view of a board: zoom above 100 % (at most 400 %) and the board point in the middle of the frame; null for the whole picture. */
function cleanView(v) {
    const o = v && typeof v === "object" ? v : {};
    const zoom = Number(o.zoom);
    const cx = Number(o.cx);
    const cy = Number(o.cy);
    if (!(zoom > 1.001) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    return { zoom: Math.round(Math.min(4, zoom) * 100) / 100, cx: round4(clamp01(cx)), cy: round4(clamp01(cy)) };
}

/** The colour and the raid mark of the groups (group n -> "#rrggbb" / a mark id): only groups 1..20, only valid colours, a mark once (the first group keeps it). Empty = the defaults. */
function cleanGroupStyles(colors, marks) {
    const okKey = (k) => /^(?:[1-9]|1\d|20)$/.test(k);
    const outColors = {};
    for (const k of Object.keys(colors && typeof colors === "object" ? colors : {})) if (okKey(k) && /^#[0-9a-fA-F]{6}$/.test(String(colors[k]))) outColors[k] = String(colors[k]).toLowerCase();
    const outMarks = {};
    const seen = new Set();
    for (const k of Object.keys(marks && typeof marks === "object" ? marks : {}).sort((a, b) => Number(a) - Number(b))) {
        const m = String(marks[k]);
        if (okKey(k) && MARKS.includes(m) && !seen.has(m)) { outMarks[k] = m; seen.add(m); }
    }
    return { groupColors: outColors, groupMarks: outMarks };
}

const MARKS = ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"];
const ZONE_TYPES = ["danger", "healthy", "neutral", "custom", "role"];
const ZONE_SHAPES = ["rect", "ellipse"];
// Preset colours per zone type: what a new zone starts with, free to be overridden.
const ZONE_COLORS = { danger: "#ef4444", healthy: "#22c55e", neutral: "#60a5fa", custom: "#a78bfa", role: "#f97316" };
// where a role group's label stands: inside it, or outside on one side
const ROLE_LABEL_POS = ["in", "top", "bottom", "left", "right"];
// a role group placeholder: which role and its colour (the role colours of the board: melee orange, ranged violet ...)
const ZONE_ROLES = ["melee", "ranged", "healer", "tank", "dps"];
const ROLE_COLORS = { melee: "#f97316", ranged: "#a78bfa", healer: "#35d6c4", tank: "#60a5fa", dps: "#f5c542" };

/** The facing wedge of an icon, only what differs from the default: size 25 % .. 300 %, hidden, colour, opacity. */
function cleanArrow(o) {
    const out = {};
    const n = Number(o.arrowScale);
    if (o.arrowScale !== undefined && o.arrowScale !== null && o.arrowScale !== "" && Number.isFinite(n)) {
        const v = Math.max(0.25, Math.min(3, Math.round(n * 100) / 100));
        if (v !== 1) out.arrowScale = v;
    }
    if (o.arrowHidden === true) out.arrowHidden = true;
    if (/^#[0-9a-fA-F]{6}$/.test(String(o.arrowColor || "")) && String(o.arrowColor).toLowerCase() !== "#ffb020") out.arrowColor = String(o.arrowColor).toLowerCase();
    if (o.arrowOpacity !== undefined && o.arrowOpacity !== null && o.arrowOpacity !== "" && Number.isFinite(Number(o.arrowOpacity))) {
        const v = Math.max(0.1, Math.min(1, Math.round(Number(o.arrowOpacity) * 100) / 100));
        if (v !== 1) out.arrowOpacity = v;
    }
    return out;
}
const MIN_ZONE = 0.03;
const LINE_KINDS = ["arrow", "line"];
const DEFAULT_LINE_COLOR = "#f8fafc";
const DEFAULT_TEXT_COLOR = "#f8fafc";

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const round4 = (n) => Math.round(n * 10000) / 10000;

/** 0.1..1 in steps of 0.01; `fallback` for anything that is no number. */
function cleanOpacity(v, fallback) {
    if (v === "" || v === null || v === undefined || !Number.isFinite(Number(v))) return fallback;
    return Math.max(0.1, Math.min(1, Math.round(Number(v) * 100) / 100));
}

/** What every board object shares: its opacity, whether it is locked and whether it is hidden. */
function common(o, defaultOpacity = 1) {
    // `ring: false` = no ring / border round this object (default shown; only stored when off)
    return { opacity: cleanOpacity(o.opacity, defaultOpacity), lock: o.lock === true, hidden: o.hidden === true, ...(o.ring === false ? { ring: false } : {}), ...(o.showName === false ? { showName: false } : {}) };
}

/** A size in px inside the range of its kind, the default for anything that is no number. */
/** An angle in degrees as a whole number 0..359 (0 = up / north, clockwise); anything else = 0. */
function normAngle(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 0;
    return ((n % 360) + 360) % 360;
}

function cleanSize(v, kind) {
    const [def, min, max] = SIZES[kind];
    const n = Math.round(Number(v));
    return Number.isFinite(n) && v !== "" && v !== null && v !== undefined ? Math.max(min, Math.min(max, n)) : def;
}

const cleanColor = (v, fallback) => (/^#[0-9a-fA-F]{6}$/.test(str(v)) ? str(v).toLowerCase() : fallback);

/** A usable id: what the client sent when it is clean and not yet used, else a new one. */
function cleanId(raw, seen) {
    let id = str(raw).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
    if (!id || seen.has(id)) id = newId(5);
    seen.add(id);
    return id;
}

/** The refusal of a board with too many objects of one kind. */
const tooMany = (max, what) => ({ code: "invalid", error: `Höchstens ${max} ${what} je Boss.` });
const isRefusal = (x) => !!(x && x.code);
const objectOf = (x) => (x && typeof x === "object" ? x : {});
const listOf = (x) => (Array.isArray(x) ? x : []);
/** A scale 0.4 .. 2 in steps of 0.01, 1 when it is not given or no number (objectScale, autoScale). */
const cleanScale = (v) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Math.max(0.4, Math.min(2, Math.round(Number(v) * 100) / 100)) : 1);

// Every clean* below takes the raw list and `ctx` — `{ allowed, dropped }`:
// who may stand on the board, and the running count of what was dropped
// (a stranger, a duplicate, an unknown kind). Each returns the cleaned list,
// or a refusal `{ code: "invalid", error }` for a list over its limit.

/** The players placed on the map by hand: once each, only players of the lineup. */
function cleanTokens(raw, ctx) {
    const tokens = [];
    const seen = new Set();
    for (const t of raw) {
        const userId = str(t && t.userId);
        if (!userId || seen.has(userId) || !ctx.allowed.has(userId)) { ctx.dropped += 1; continue; }
        if (tokens.length >= LIMITS.tokensPerBoss) return tooMany(LIMITS.tokensPerBoss, "Spieler");
        seen.add(userId);
        tokens.push({ userId, x: round4(clamp01(Number(t.x))), y: round4(clamp01(Number(t.y))), size: cleanSize(t.size, "token"), ...common(t) });
    }
    return tokens;
}

/** A group's hand-moved member tokens: players of the lineup only, at most LIMITS.offsetsPerGroup. */
function cleanOffsets(raw, ctx) {
    const offsets = {};
    for (const [uid, off] of Object.entries(raw).slice(0, LIMITS.offsetsPerGroup)) {
        if (!ctx.allowed.has(uid) || !off || typeof off !== "object") { ctx.dropped += 1; continue; }
        offsets[uid] = { dx: round4(Math.max(-1, Math.min(1, Number(off.dx) || 0))), dy: round4(Math.max(-1, Math.min(1, Number(off.dy) || 0))), size: cleanSize(off.size, "token") };
    }
    return offsets;
}

/** One slot; `used` = the players already standing in a slot of this board. Null = dropped. */
function cleanSlot(raw, ids, used, ctx) {
    const o = objectOf(raw);
    if (!SLOT_KINDS.includes(o.kind)) { ctx.dropped += 1; return null; }
    const label = str(o.label).slice(0, LIMITS.label);
    if (o.kind === "label" && !label) { ctx.dropped += 1; return null; }
    const isGroup = o.kind === "group";
    // a player takes one place on a board; a stranger or a second place is an open slot instead
    let userId = isGroup ? "" : str(o.userId);
    const offsets = isGroup && o.offsets && typeof o.offsets === "object" ? cleanOffsets(o.offsets, ctx) : {};
    if (userId && (!ctx.allowed.has(userId) || used.has(userId))) { userId = ""; ctx.dropped += 1; }
    if (userId) used.add(userId);
    const n = Math.max(1, Math.min(99, Math.floor(Number(o.n)) || 1));
    const isRole = assign.SLOT_ROLES.includes(o.kind);
    return {
        id: cleanId(o.id, ids), kind: o.kind, n, label,
        x: round4(clamp01(Number(o.x))), y: round4(clamp01(Number(o.y))), userId, size: cleanSize(o.size, "token"), ...common(o),
        // a role slot of the Besetzung that was not put on the map yet has no place there (placed = false)
        placed: o.placed !== false,
        hideMembers: isGroup && o.hideMembers === true, split: isGroup && o.split === true, offsets,
        // a group as a whole (ring radius, spacing of the tokens, member tokens, tag, badges, names), its ring spacing and its member tokens on their own: 25 % .. 400 %
        groupScale: isGroup ? cleanFactor(o.groupScale) : 1, ringSpread: isGroup ? cleanFactor(o.ringSpread) : 1, tokenScale: isGroup ? cleanFactor(o.tokenScale) : 1,
        // the ring round a split group: shown (default), its colour ("" = the accent) and its opacity
        showRing: !isGroup || o.showRing !== false,
        ringColor: isGroup ? cleanColor(o.ringColor, "") : "",
        ringOpacity: isGroup ? cleanOpacity(o.ringOpacity, 0.55) : 0.55,
        // the width of a group's chip with its name list (reference px, 60 .. 400); 0 = as wide as its longest name needs (up to 220)
        chipWidth: isGroup && Number.isFinite(Number(o.chipWidth)) && Number(o.chipWidth) > 0 ? Math.max(60, Math.min(400, Math.round(Number(o.chipWidth)))) : 0,
        // a role slot can ask for a class (priority = order): a template fills it from the setup's players of that class only;
        // byClass = it was filled that way (shown as a small class badge in the event)
        preferredClasses: isRole ? assign.cleanClasses(o.preferredClasses) : [],
        byClass: isRole && o.byClass === true,
    };
}

/** The slots of the Besetzung and the groups, labels on the map. */
function cleanSlots(raw, ctx) {
    if (raw.length > LIMITS.slotsPerBoss) return tooMany(LIMITS.slotsPerBoss, "Slots");
    const ids = new Set();
    const used = new Set();
    return raw.map((s) => cleanSlot(s, ids, used, ctx)).filter(Boolean);
}

/** The raid marks on the map. */
function cleanMarks(raw, ctx) {
    if (raw.length > LIMITS.marksPerBoss) return tooMany(LIMITS.marksPerBoss, "Marker");
    const ids = new Set();
    const marks = [];
    for (const m of raw) {
        const o = objectOf(m);
        if (!MARKS.includes(o.mark)) { ctx.dropped += 1; continue; }
        marks.push({ id: cleanId(o.id, ids), mark: o.mark, x: round4(clamp01(Number(o.x))), y: round4(clamp01(Number(o.y))), size: cleanSize(o.size, "mark"), ...common(o) });
    }
    return marks;
}

/** The icons on the map: a boss, a mob's portrait, a WoW icon, the enemy or the boss position. */
function cleanIcons(raw, ctx) {
    if (raw.length > LIMITS.iconsPerBoss) return tooMany(LIMITS.iconsPerBoss, "Icons");
    const ids = new Set();
    const icons = [];
    for (const ic of raw) {
        const o = objectOf(ic);
        if (!ICON_KEY.test(str(o.iconKey))) { ctx.dropped += 1; continue; }
        icons.push({
            id: cleanId(o.id, ids), iconKey: str(o.iconKey), label: str(o.label).slice(0, LIMITS.label),
            x: round4(clamp01(Number(o.x))), y: round4(clamp01(Number(o.y))), size: cleanSize(o.size, "icon"),
            rotation: normAngle(o.rotation), showLabel: o.showLabel === true,
            // the mob this icon stands for (b:<boss key>, d:<catalog id>, c:<custom id>) and whether it turns to the tank of that mob by itself
            mobId: MOB_ID.test(str(o.mobId)) ? str(o.mobId) : "", autoFace: o.autoFace !== false, ...common(o), ...cleanArrow(o),
        });
    }
    return icons;
}

/** One zone: an area (danger, healthy, ...) or a role group; it always stays inside the board. */
function cleanZone(z, ids) {
    const o = objectOf(z);
    const type = ZONE_TYPES.includes(o.type) ? o.type : "neutral";
    const role = ZONE_ROLES.includes(o.role) ? o.role : "melee";
    const w = Math.max(MIN_ZONE, Math.min(1, Number(o.w) || MIN_ZONE));
    const h = Math.max(MIN_ZONE, Math.min(1, Number(o.h) || MIN_ZONE));
    return {
        id: cleanId(o.id, ids),
        // a role group may also be a cluster of role icons instead of an area
        shape: ZONE_SHAPES.includes(o.shape) || (type === "role" && o.shape === "cluster") ? o.shape : type === "role" ? "ellipse" : "rect",
        type,
        label: str(o.label).slice(0, LIMITS.label),
        color: cleanColor(o.color, type === "role" ? ROLE_COLORS[role] : ZONE_COLORS[type]),
        // a role group: which role, an optional count badge (0 = none), whether the event shows the setup's players of that role
        ...(type === "role" ? { role, count: Math.max(0, Math.min(40, Math.floor(Number(o.count)) || 0)), showNames: o.showNames === true, rotation: normAngle(o.rotation),
            // its symbol's own scale on top of the automatic size (0.25 .. 3, 1 = automatic) and where its label stands: inside, or outside
            // above / below / left / right of the zone (upright also when the zone is turned) - docs/raidplan.md, "Role groups"
            iconScale: Number.isFinite(Number(o.iconScale)) && Number(o.iconScale) > 0 ? Math.max(0.25, Math.min(3, Math.round(Number(o.iconScale) * 100) / 100)) : 1,
            labelPos: ROLE_LABEL_POS.includes(o.labelPos) ? o.labelPos : "in" } : {}),
        ...common(o, 0.3),
        w: round4(w), h: round4(h),
        x: round4(Math.min(clamp01(Number(o.x)), 1 - w)),
        y: round4(Math.min(clamp01(Number(o.y)), 1 - h)),
    };
}

/** The zones on the map. */
function cleanZones(raw) {
    if (raw.length > LIMITS.zonesPerBoss) return tooMany(LIMITS.zonesPerBoss, "Zonen");
    const ids = new Set();
    return raw.map((z) => cleanZone(z, ids));
}

/** The lines and arrows on the map. */
function cleanLines(raw) {
    if (raw.length > LIMITS.linesPerBoss) return tooMany(LIMITS.linesPerBoss, "Linien");
    const ids = new Set();
    return raw.map((l) => {
        const o = objectOf(l);
        return {
            id: cleanId(o.id, ids),
            kind: LINE_KINDS.includes(o.kind) ? o.kind : "line",
            x1: round4(clamp01(Number(o.x1))), y1: round4(clamp01(Number(o.y1))),
            x2: round4(clamp01(Number(o.x2))), y2: round4(clamp01(Number(o.y2))),
            color: cleanColor(o.color, DEFAULT_LINE_COLOR),
            width: Math.max(1, Math.min(16, Math.round(Number(o.width)) || 4)),
            ...common(o),
        };
    });
}

/** The free texts on the map; an empty one is dropped. */
function cleanTexts(raw, ctx) {
    if (raw.length > LIMITS.textsPerBoss) return tooMany(LIMITS.textsPerBoss, "Texte");
    const ids = new Set();
    const texts = [];
    for (const tx of raw) {
        const o = objectOf(tx);
        const text = str(o.text).slice(0, LIMITS.text);
        if (!text) { ctx.dropped += 1; continue; }
        texts.push({
            id: cleanId(o.id, ids), text,
            x: round4(clamp01(Number(o.x))), y: round4(clamp01(Number(o.y))),
            color: cleanColor(o.color, DEFAULT_TEXT_COLOR),
            size: Math.max(5, Math.min(72, Math.round(Number(o.size)) || 16)),
            ...common(o),
        });
    }
    return texts;
}

/** The task rows under the map ("Adds: Anna, Bert"): players of the lineup, once each, at most LIMITS.usersPerTarget. */
function cleanTargets(raw, ctx) {
    if (raw.length > LIMITS.targetsPerBoss) return tooMany(LIMITS.targetsPerBoss, "Aufgabenzeilen");
    const ids = new Set();
    return raw.map((tg) => {
        const t = objectOf(tg);
        const users = [];
        for (const u of listOf(t.userIds)) {
            const userId = str(u);
            if (!ctx.allowed.has(userId) || users.includes(userId)) { ctx.dropped += 1; continue; }
            if (users.length >= LIMITS.usersPerTarget) break;
            users.push(userId);
        }
        return { id: cleanId(t.id, ids), title: str(t.title).slice(0, LIMITS.title), userIds: users };
    });
}

/** The assignments (raidplanAssign.js); a mob target whose placed icon is gone falls back to the kind of mob. */
function cleanBoardAssignments(raw, icons, ctx) {
    const cleaned = assign.cleanAssignments(raw, ctx.allowed);
    if (cleaned.error) return cleaned;
    ctx.dropped += cleaned.dropped;
    // a target of one placed mob icon (`oid`) whose icon is gone (or stands for another mob) falls back to the kind of mob: nothing is lost
    for (const a of cleaned.assignments) {
        a.targets = a.targets.map((tg) => (tg.kind === "mob" && tg.oid && !icons.some((ic) => ic.id === tg.oid && ic.mobId === tg.ref) ? withoutOid(tg) : tg));
    }
    return cleaned.assignments;
}

/** Who plays another role on this boss than in the setup ("Heiler 5 spielt hier DPS"): only players of the lineup. */
function cleanRoles(raw, ctx) {
    const roles = {};
    for (const [uid, role] of Object.entries(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {})) {
        if (!ctx.allowed.has(str(uid)) || !FLEX_ROLES.includes(role) || Object.keys(roles).length >= LIMITS.tokensPerBoss) { ctx.dropped += 1; continue; }
        roles[str(uid)] = role;
    }
    return roles;
}

/**
 * The mobs added to this section (a boss's adds, trash mobs): they are always there as tank targets; the entry is
 * a snapshot of the catalog's (name and icon) so it still shows when the catalog entry is gone.
 */
function cleanMobs(raw, ctx) {
    const mobs = [];
    for (const m of raw) {
        const o = objectOf(m);
        const id = str(o.id);
        if (!/^[dcb]:[\w\-/']{1,70}$/.test(id) || !str(o.name) || mobs.some((x) => x.id === id)) { ctx.dropped += 1; continue; }
        if (mobs.length >= LIMITS.mobsPerBoss) break;
        mobs.push({ id, name: str(o.name).slice(0, LIMITS.label), icon: /^([a-z0-9_'-]{2,64}|(?:boss|mob):\d{1,6})$/.test(str(o.icon)) ? str(o.icon) : "" });
    }
    return mobs;
}

/** The board-wide settings: notes, the tactic profile, what is shown, the auto placement, the Besetzung. */
function cleanSettings(input, profiles) {
    const { groupColors, groupMarks } = cleanGroupStyles(input.groupColors, input.groupMarks);
    return {
        // false = the section is shown without its map (the objects are kept); missing = shown (old boards keep their map)
        showMap: input.showMap !== false,
        // the tank rows put their mobs and tanks on the map by themselves (off = only what was placed by hand)
        autoPlace: input.autoPlace !== false,
        autoPos: cleanAutoPos(input.autoPos),
        autoStyle: cleanAutoStyle(input.autoStyle),
        autoScale: cleanScale(input.autoScale),
        // default assignment cards the orga hid (they come back through "Karte hinzufügen"); only known types, once each
        hiddenCards: [...new Set(listOf(input.hiddenCards).map(str))].filter((x) => assign.ASSIGN_TYPES.includes(x)),
        // the default rows of the template this boss does not inherit (it deviated from them or switched them off)
        inheritOff: [...new Set(listOf(input.inheritOff).map(str))].filter((x) => /^[\w-]{1,24}$/.test(x)).slice(0, LIMITS.perBoard || 60),
        // all group rings of the board at once (default: shown)
        showRings: input.showRings !== false,
        // false = this section (boss, trash, Allgemein) is left out of the shared sheet; it stays fully editable
        inSheet: input.inSheet !== false,
        groupColors, groupMarks,
        showNames: input.showNames !== false,
        showBadges: input.showBadges !== false,
        showRoleRings: input.showRoleRings !== false,
        view: cleanView(input.view),
        counts: besetzung.cleanCounts(input.counts),
        notes: String(input.notes === undefined || input.notes === null ? "" : input.notes).slice(0, LIMITS.notes),
        // The tactic profile the rows were taken from; one that was deleted since is forgotten.
        profileId: profiles.has(str(input.profileId)) ? str(input.profileId) : "",
        mapOpacity: cleanOpacity(input.mapOpacity, 1),
        objectScale: cleanScale(input.objectScale),
    };
}

/**
 * Cleans one board. `allowedUserIds` are the players that may stand on it (empty
 * for a template); anyone else is dropped and counted. `ANY_PLAYER` ("*") keeps every
 * well-formed id: a Raid-Helper event whose line-up could not be loaded must not lose
 * its players on a save (docs/raidplan.md, "Raid-Helper-Events"). Returns `{ board, dropped }`
 * or `{ code: "invalid", error }` for something over a limit — the first section over
 * its limit, in the order below.
 */
function cleanBoard(raw, { allowedUserIds = [], profileIds = [], allowTokens = true } = {}) {
    const input = objectOf(raw);
    const allowed = allowedUserIds === ANY_PLAYER ? { has: (u) => /^[\w-]{1,40}$/.test(str(u)) } : new Set([...allowedUserIds].map(str));
    const ctx = { allowed, dropped: 0 };

    const tokens = cleanTokens(allowTokens ? listOf(input.tokens) : [], ctx);
    if (isRefusal(tokens)) return tokens;
    const slots = cleanSlots(listOf(input.slots), ctx);
    if (isRefusal(slots)) return slots;
    const marks = cleanMarks(listOf(input.marks), ctx);
    if (isRefusal(marks)) return marks;
    const icons = cleanIcons(listOf(input.icons), ctx);
    if (isRefusal(icons)) return icons;
    const zones = cleanZones(listOf(input.zones));
    if (isRefusal(zones)) return zones;
    const lines = cleanLines(listOf(input.lines));
    if (isRefusal(lines)) return lines;
    const texts = cleanTexts(listOf(input.texts), ctx);
    if (isRefusal(texts)) return texts;
    const targets = cleanTargets(listOf(input.targets), ctx);
    if (isRefusal(targets)) return targets;
    const assignments = cleanBoardAssignments(input.assignments, icons, ctx);
    if (isRefusal(assignments)) return assignments;
    // the tactic: ordered steps (who does what, when and how); a player outside the lineup is dropped like everywhere
    const cleanedSteps = steps.cleanSteps(input.steps, allowed);
    if (cleanedSteps.error) return cleanedSteps;
    ctx.dropped += cleanedSteps.dropped;

    const roles = cleanRoles(input.roles, ctx);
    const mobs = cleanMobs(listOf(input.mobs), ctx);
    const s = cleanSettings(input, new Set([...profileIds].map(str)));
    return {
        board: {
            tokens, slots, marks, icons, zones, lines, texts, targets, assignments, steps: cleanedSteps.steps,
            showMap: s.showMap, autoPlace: s.autoPlace, autoPos: s.autoPos, autoStyle: s.autoStyle, autoScale: s.autoScale,
            hiddenCards: s.hiddenCards, inheritOff: s.inheritOff, showRings: s.showRings, inSheet: s.inSheet,
            groupColors: s.groupColors, groupMarks: s.groupMarks, showNames: s.showNames, showBadges: s.showBadges, showRoleRings: s.showRoleRings,
            view: s.view, mobs, counts: s.counts, roles, notes: s.notes, profileId: s.profileId, mapOpacity: s.mapOpacity, objectScale: s.objectScale,
        },
        dropped: ctx.dropped,
    };
}

/** A mob target without its placed-icon reference (the kind of mob again; its number, if any, stays). */
function withoutOid(tg) {
    const out = { ...tg };
    delete out.oid;
    return out;
}

// the key of an object the tank rows put on the map: the n-th tank of a row, or the n-th mob of a kind
const AUTO_KEY = /^(t:[\w-]{1,24}:\d{1,2}|m:[dcb]:[\w\-/']{1,70}#\d{1,2})$/;

/** The positions of auto-placed objects moved by hand: known keys only, a point on the board, at most LIMITS.autoPos. */
function cleanAutoPos(raw) {
    const out = {};
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    for (const key of Object.keys(src)) {
        const p = src[key];
        if (!AUTO_KEY.test(key) || !p || typeof p !== "object") continue;
        const x = Number(p.x);
        const y = Number(p.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (Object.keys(out).length >= LIMITS.autoPos) break;
        out[key] = { x: round4(clamp01(x)), y: round4(clamp01(y)) };
    }
    return out;
}

/**
 * How the auto-placed objects look where the orga changed it: known keys only; size in the range of a token (a tank) or an icon (a mob),
 * opacity 0.1..1, a label of at most 40 characters, a facing 0..359, the flags only when they differ from the default. An empty entry is dropped.
 */
function cleanAutoStyle(raw) {
    const out = {};
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    for (const key of Object.keys(src)) {
        const s = src[key];
        if (!AUTO_KEY.test(key) || !s || typeof s !== "object") continue;
        if (Object.keys(out).length >= LIMITS.autoPos) break;
        const o = {};
        if (s.size !== undefined && s.size !== null && s.size !== "" && Number.isFinite(Number(s.size))) o.size = cleanSize(s.size, key.startsWith("t:") ? "token" : "icon");
        if (s.opacity !== undefined && s.opacity !== null && s.opacity !== "" && Number.isFinite(Number(s.opacity))) o.opacity = cleanOpacity(s.opacity, 1);
        if (s.ring === false) o.ring = false;
        if (s.showName === false) o.showName = false;
        if (str(s.label)) o.label = str(s.label).slice(0, LIMITS.label);
        if (s.showLabel === true) o.showLabel = true;
        if (s.rotation !== undefined && s.rotation !== null && s.rotation !== "") o.rotation = normAngle(s.rotation);
        if (s.autoFace === false) o.autoFace = false;
        if (s.hidden === true) o.hidden = true;
        if (s.lock === true) o.lock = true;
        Object.assign(o, cleanArrow(s));
        if (Number.isFinite(Number(s.z)) && Number(s.z) !== 0) o.z = Math.max(-999, Math.min(999, Math.round(Number(s.z))));
        if (Object.keys(o).length > 0) out[key] = o;
    }
    return out;
}

/** The key a row's tanks are stored under: a copy of a default row keeps the default's id (its moved tanks stay where they are). */
function rowKey(a) {
    return a && a.origin && a.origin !== "default" ? a.origin : a ? a.id : "";
}

/** Whether a cleaned board holds anything (an untouched boss is not stored). */
function boardHasContent(b) {
    return !!(b.tokens.length || b.slots.length || b.marks.length || b.icons.length || b.zones.length || b.lines.length || b.texts.length
        || b.targets.length || b.assignments.length || (b.steps || []).length || Object.keys(b.roles || {}).length || (b.mobs || []).length || (b.hiddenCards || []).length || (b.inheritOff || []).length || b.view || b.showRings === false || b.inSheet === false || b.showMap === false || b.autoPlace === false || Object.keys(b.autoPos || {}).length || Object.keys(b.autoStyle || {}).length || (b.autoScale !== undefined && b.autoScale !== 1) || b.showNames === false || b.showBadges === false || b.showRoleRings === false || Object.keys(b.groupColors || {}).length || Object.keys(b.groupMarks || {}).length || b.notes.trim() || b.profileId || b.mapOpacity < 1 || b.objectScale !== 1);
}

/** The same board with every object under a new id — a template copied into a plan. */
function reidBoard(board) {
    const fresh = (o) => ({ ...o, id: newId(5) });
    // the icons get new ids: a row that means one of them (a mob target's `oid`) follows it
    const icons = (board.icons || []).map(fresh);
    const iconIds = new Map((board.icons || []).map((ic, i) => [ic.id, icons[i].id]));
    const rows = assign.reidAssignments(board.assignments).map((a) => ({
        ...a,
        targets: (a.targets || []).map((tg) => (tg.kind === "mob" && tg.oid ? (iconIds.has(tg.oid) ? { ...tg, oid: iconIds.get(tg.oid) } : withoutOid(tg)) : tg)),
    }));
    // the moved tanks of a row follow it to its new id (`_key` = the id a default row had in the template)
    const moved = new Map();
    (board.assignments || []).forEach((a, i) => { const from = a._key || rowKey(a); const to = rowKey(rows[i]); if (from && to && from !== to) moved.set(from, to); });
    const rekey = (map) => {
        const out = {};
        for (const [key, p] of Object.entries(map || {})) {
            const m = key.match(/^t:([\w-]+):(\d+)$/);
            out[m && moved.has(m[1]) ? `t:${moved.get(m[1])}:${m[2]}` : key] = p;
        }
        return out;
    };
    return {
        ...board,
        autoPos: rekey(board.autoPos),
        autoStyle: rekey(board.autoStyle),
        tokens: [],
        slots: (board.slots || []).map(fresh),
        marks: (board.marks || []).map(fresh),
        icons,
        zones: (board.zones || []).map(fresh),
        lines: (board.lines || []).map(fresh),
        texts: (board.texts || []).map(fresh),
        targets: (board.targets || []).map((t) => ({ ...fresh(t), userIds: [] })),
        assignments: rows,
        steps: steps.reidSteps(board.steps),
    };
}

/**
 * Puts players into a board's open tank / healer / dps slots from the roster
 * (the setup's lineup, in its order): tank 1..n get the tanks, healer 1..n the
 * healers, dps the remaining damage dealers. A slot that already has a player, a
 * group marker and a free label are left alone; a slot nobody fits stays open.
 */
function fillSlots(slots, roster) {
    const taken = new Set(slots.map((s) => s.userId).filter(Boolean));
    const isDamage = (p) => p.role !== "tank" && p.role !== "healer";
    const fitsRole = (kind) => (kind === "dps" ? isDamage : (p) => p.role === kind);
    const pick = (kind) => roster.find((p) => fitsRole(kind)(p) && !taken.has(p.userId)) || null;
    const order = (kind) => slots.map((s, i) => ({ s, i })).filter((x) => x.s.kind === kind && !x.s.userId)
        .sort((a, b) => a.s.n - b.s.n || a.i - b.i);
    const out = slots.map((s) => ({ ...s }));
    const kinds = ["tank", "healer", "melee", "ranged", "dps"];
    // 1. the slots that ask for a class come first, so the ones without a wish never eat their players: the first free player of the
    //    slot's role in the order of its classes (setup order among the same class), each player once; nobody of that class = the slot
    //    stays open (a stranger never takes it)
    const bound = new Set();
    for (const kind of kinds) {
        for (const { s, i } of order(kind)) {
            const wish = Array.isArray(s.preferredClasses) ? s.preferredClasses : [];
            if (wish.length === 0) continue;
            bound.add(i);
            let found = null;
            for (const cls of wish) {
                found = roster.find((p) => fitsRole(kind)(p) && !taken.has(p.userId) && p.classId === cls) || null;
                if (found) break;
            }
            if (!found) continue;
            taken.add(found.userId);
            out[i].userId = found.userId;
            out[i].byClass = true;
        }
    }
    // 2. the slots without a wish, the exact roles first, so a generic "DPS (egal)" slot never takes a melee or ranged player away
    //    from a slot that asks for him
    for (const kind of kinds) {
        for (const { i } of order(kind)) {
            if (bound.has(i)) continue;
            const p = pick(kind);
            if (!p) break;
            taken.add(p.userId);
            out[i].userId = p.userId;
        }
    }
    return out;
}

module.exports = {
    LIMITS, cleanBoard, boardHasContent, reidBoard, fillSlots, newId, ANY_PLAYER,
    // only for the tests (#424): not part of the module's API
    _internal: {
        cleanFactor, cleanView, MARKS, cleanGroupStyles, ZONE_ROLES, MIN_ZONE,
    },
};
