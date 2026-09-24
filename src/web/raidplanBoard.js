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
//                                          neutral or a custom one
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
//   notes, profileId, mapOpacity          (mapOpacity 0.1..1: how strongly the map shows)
//   objectScale                           (0.5..2: the default size of tokens, slots, marks and icons)
//
// Every object (token, slot, mark, zone, line, text) also carries `opacity`
// (0.1..1; zones start at 0.3, everything else at 1), `lock` (it cannot be moved
// or scaled) and `hidden` (it is not drawn — in the editor's layer list it can be
// switched back on). Colour and opacity are separate fields.
//
// Coordinates are relative to the board (0..1). A save is cleaned, never trusted.
const crypto = require("crypto");
const assign = require("./raidplanAssign");
const besetzung = require("./raidplanBesetzung");

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
const SIZES = { token: [38, 24, 96], mark: [34, 16, 96], icon: [48, 20, 200] };
// an icon is the encounter's boss icon (boss:<WCL encounter id>), a mob's portrait (mob:<NPC id>), a spell / ability icon of the icon CDN (wow:<icon name>) or one of the two built in symbols
const MOB_ID = /^[dcb]:[\w\-/']{1,70}$/;
const ICON_KEY = /^((?:boss|mob):\d{1,6}|wow:[a-z0-9_'\-]{2,64}|enemy|bosspos)$/;
/** The colour and the raid mark of the groups (group n -> "#rrggbb" / a mark id): only groups 1..20, only valid colours, a mark once (the first group keeps it). Empty = the defaults. */
function cleanGroupStyles(colors, marks) {
    const okKey = (k) => /^(?:[1-9]|1d|20)$/.test(k);
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
const ZONE_TYPES = ["danger", "healthy", "neutral", "custom"];
const ZONE_SHAPES = ["rect", "ellipse"];
// Preset colours per zone type: what a new zone starts with, free to be overridden.
const ZONE_COLORS = { danger: "#ef4444", healthy: "#22c55e", neutral: "#60a5fa", custom: "#a78bfa" };
const MIN_ZONE = 0.03;
const LINE_KINDS = ["arrow", "line"];
const DEFAULT_LINE_COLOR = "#f8fafc";
const DEFAULT_TEXT_COLOR = "#f8fafc";

const str = (v) => String(v === null || v === undefined ? "" : v).trim();
const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const round4 = (n) => Math.round(n * 10000) / 10000;
const newId = () => crypto.randomBytes(5).toString("hex");

/** 0.1..1 in steps of 0.01; `fallback` for anything that is no number. */
function cleanOpacity(v, fallback) {
    if (v === "" || v === null || v === undefined || !Number.isFinite(Number(v))) return fallback;
    return Math.max(0.1, Math.min(1, Math.round(Number(v) * 100) / 100));
}

/** What every board object shares: its opacity, whether it is locked and whether it is hidden. */
function common(o, defaultOpacity = 1) {
    return { opacity: cleanOpacity(o.opacity, defaultOpacity), lock: o.lock === true, hidden: o.hidden === true };
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
    if (!id || seen.has(id)) id = newId();
    seen.add(id);
    return id;
}

/**
 * Cleans one board. `allowedUserIds` are the players that may stand on it (empty
 * for a template); anyone else is dropped and counted. Returns `{ board, dropped }`
 * or `{ code: "invalid", error }` for something over a limit.
 */
function cleanBoard(raw, { allowedUserIds = [], profileIds = [], allowTokens = true } = {}) {
    const input = raw && typeof raw === "object" ? raw : {};
    const allowed = new Set([...allowedUserIds].map(str));
    const profiles = new Set([...profileIds].map(str));
    let dropped = 0;

    const tokens = [];
    const seenTokens = new Set();
    for (const t of allowTokens && Array.isArray(input.tokens) ? input.tokens : []) {
        const userId = str(t && t.userId);
        if (!userId || seenTokens.has(userId) || !allowed.has(userId)) { dropped += 1; continue; }
        if (tokens.length >= LIMITS.tokensPerBoss) return { code: "invalid", error: `Höchstens ${LIMITS.tokensPerBoss} Spieler je Boss.` };
        seenTokens.add(userId);
        tokens.push({ userId, x: round4(clamp01(Number(t.x))), y: round4(clamp01(Number(t.y))), size: cleanSize(t.size, "token"), ...common(t) });
    }

    const rawSlots = Array.isArray(input.slots) ? input.slots : [];
    if (rawSlots.length > LIMITS.slotsPerBoss) return { code: "invalid", error: `Höchstens ${LIMITS.slotsPerBoss} Slots je Boss.` };
    const slotIds = new Set();
    const usedInSlots = new Set();
    const slots = [];
    for (const s of rawSlots) {
        const o = s && typeof s === "object" ? s : {};
        if (!SLOT_KINDS.includes(o.kind)) { dropped += 1; continue; }
        const label = str(o.label).slice(0, LIMITS.label);
        if (o.kind === "label" && !label) { dropped += 1; continue; }
        let userId = str(o.userId);
        // a player takes one place on a board; a stranger or a second place is an open slot instead
        if (o.kind === "group") userId = "";
        const offsets = {};
        if (o.kind === "group" && o.offsets && typeof o.offsets === "object") {
            for (const [uid, off] of Object.entries(o.offsets).slice(0, LIMITS.offsetsPerGroup)) {
                if (!allowed.has(uid) || !off || typeof off !== "object") { dropped += 1; continue; }
                offsets[uid] = { dx: round4(Math.max(-1, Math.min(1, Number(off.dx) || 0))), dy: round4(Math.max(-1, Math.min(1, Number(off.dy) || 0))), size: cleanSize(off.size, "token") };
            }
        }
        if (userId && (!allowed.has(userId) || usedInSlots.has(userId))) { userId = ""; dropped += 1; }
        if (userId) usedInSlots.add(userId);
        const n = Math.max(1, Math.min(99, Math.floor(Number(o.n)) || 1));
        slots.push({
            id: cleanId(o.id, slotIds), kind: o.kind, n, label,
            x: round4(clamp01(Number(o.x))), y: round4(clamp01(Number(o.y))), userId, size: cleanSize(o.size, "token"), ...common(o),
            // a role slot of the Besetzung that was not put on the map yet has no place there (placed = false)
            placed: o.placed !== false,
            hideMembers: o.kind === "group" && o.hideMembers === true, split: o.kind === "group" && o.split === true, offsets,
            // the ring round a split group: shown (default), its colour ("" = the accent) and its opacity
            showRing: o.kind !== "group" || o.showRing !== false,
            ringColor: o.kind === "group" ? cleanColor(o.ringColor, "") : "",
            ringOpacity: o.kind === "group" ? cleanOpacity(o.ringOpacity, 0.55) : 0.55,
            // a role slot can ask for a class (priority = order): a template fills it from the setup's players of that class only;
            // byClass = it was filled that way (shown as a small class badge in the event)
            preferredClasses: assign.SLOT_ROLES.includes(o.kind) ? assign.cleanClasses(o.preferredClasses) : [],
            byClass: assign.SLOT_ROLES.includes(o.kind) && o.byClass === true,
        });
    }

    const rawMarks = Array.isArray(input.marks) ? input.marks : [];
    if (rawMarks.length > LIMITS.marksPerBoss) return { code: "invalid", error: `Höchstens ${LIMITS.marksPerBoss} Marker je Boss.` };
    const markIds = new Set();
    const marks = [];
    for (const m of rawMarks) {
        const o = m && typeof m === "object" ? m : {};
        if (!MARKS.includes(o.mark)) { dropped += 1; continue; }
        marks.push({ id: cleanId(o.id, markIds), mark: o.mark, x: round4(clamp01(Number(o.x))), y: round4(clamp01(Number(o.y))), size: cleanSize(o.size, "mark"), ...common(o) });
    }

    const rawIcons = Array.isArray(input.icons) ? input.icons : [];
    if (rawIcons.length > LIMITS.iconsPerBoss) return { code: "invalid", error: `Höchstens ${LIMITS.iconsPerBoss} Icons je Boss.` };
    const iconIds = new Set();
    const icons = [];
    for (const ic of rawIcons) {
        const o = ic && typeof ic === "object" ? ic : {};
        if (!ICON_KEY.test(str(o.iconKey))) { dropped += 1; continue; }
        icons.push({
            id: cleanId(o.id, iconIds), iconKey: str(o.iconKey), label: str(o.label).slice(0, LIMITS.label),
            x: round4(clamp01(Number(o.x))), y: round4(clamp01(Number(o.y))), size: cleanSize(o.size, "icon"),
            rotation: normAngle(o.rotation), showLabel: o.showLabel === true,
            // the mob this icon stands for (b:<boss key>, d:<catalog id>, c:<custom id>) and whether it turns to the tank of that mob by itself
            mobId: MOB_ID.test(str(o.mobId)) ? str(o.mobId) : "", autoFace: o.autoFace !== false, ...common(o),
        });
    }

    const rawZones = Array.isArray(input.zones) ? input.zones : [];
    if (rawZones.length > LIMITS.zonesPerBoss) return { code: "invalid", error: `Höchstens ${LIMITS.zonesPerBoss} Zonen je Boss.` };
    const zoneIds = new Set();
    const zones = rawZones.map((z) => {
        const o = z && typeof z === "object" ? z : {};
        const type = ZONE_TYPES.includes(o.type) ? o.type : "neutral";
        const w = Math.max(MIN_ZONE, Math.min(1, Number(o.w) || MIN_ZONE));
        const h = Math.max(MIN_ZONE, Math.min(1, Number(o.h) || MIN_ZONE));
        return {
            id: cleanId(o.id, zoneIds),
            shape: ZONE_SHAPES.includes(o.shape) ? o.shape : "rect",
            type,
            label: str(o.label).slice(0, LIMITS.label),
            color: cleanColor(o.color, ZONE_COLORS[type]),
            ...common(o, 0.3),
            w: round4(w), h: round4(h),
            x: round4(Math.min(clamp01(Number(o.x)), 1 - w)),
            y: round4(Math.min(clamp01(Number(o.y)), 1 - h)),
        };
    });

    const rawLines = Array.isArray(input.lines) ? input.lines : [];
    if (rawLines.length > LIMITS.linesPerBoss) return { code: "invalid", error: `Höchstens ${LIMITS.linesPerBoss} Linien je Boss.` };
    const lineIds = new Set();
    const lines = rawLines.map((l) => {
        const o = l && typeof l === "object" ? l : {};
        return {
            id: cleanId(o.id, lineIds),
            kind: LINE_KINDS.includes(o.kind) ? o.kind : "line",
            x1: round4(clamp01(Number(o.x1))), y1: round4(clamp01(Number(o.y1))),
            x2: round4(clamp01(Number(o.x2))), y2: round4(clamp01(Number(o.y2))),
            color: cleanColor(o.color, DEFAULT_LINE_COLOR),
            width: Math.max(1, Math.min(12, Math.round(Number(o.width)) || 4)),
            ...common(o),
        };
    });

    const rawTexts = Array.isArray(input.texts) ? input.texts : [];
    if (rawTexts.length > LIMITS.textsPerBoss) return { code: "invalid", error: `Höchstens ${LIMITS.textsPerBoss} Texte je Boss.` };
    const textIds = new Set();
    const texts = [];
    for (const tx of rawTexts) {
        const o = tx && typeof tx === "object" ? tx : {};
        const text = str(o.text).slice(0, LIMITS.text);
        if (!text) { dropped += 1; continue; }
        texts.push({
            id: cleanId(o.id, textIds), text,
            x: round4(clamp01(Number(o.x))), y: round4(clamp01(Number(o.y))),
            color: cleanColor(o.color, DEFAULT_TEXT_COLOR),
            size: Math.max(10, Math.min(48, Math.round(Number(o.size)) || 16)),
            ...common(o),
        });
    }

    const rawTargets = Array.isArray(input.targets) ? input.targets : [];
    if (rawTargets.length > LIMITS.targetsPerBoss) return { code: "invalid", error: `Höchstens ${LIMITS.targetsPerBoss} Aufgabenzeilen je Boss.` };
    const targetIds = new Set();
    const targets = rawTargets.map((tg) => {
        const t = tg && typeof tg === "object" ? tg : {};
        const users = [];
        for (const u of Array.isArray(t.userIds) ? t.userIds : []) {
            const userId = str(u);
            if (!allowed.has(userId) || users.includes(userId)) { dropped += 1; continue; }
            if (users.length >= LIMITS.usersPerTarget) break;
            users.push(userId);
        }
        return { id: cleanId(t.id, targetIds), title: str(t.title).slice(0, LIMITS.title), userIds: users };
    });

    const cleanedAssign = assign.cleanAssignments(input.assignments, allowed);
    if (cleanedAssign.error) return cleanedAssign;
    dropped += cleanedAssign.dropped;

    const notes = String(input.notes === undefined || input.notes === null ? "" : input.notes).slice(0, LIMITS.notes);
    // The tactic profile the rows were taken from; one that was deleted since is forgotten.
    const profileId = profiles.has(str(input.profileId)) ? str(input.profileId) : "";
    const mapOpacity = cleanOpacity(input.mapOpacity, 1);
    const objectScale = Number.isFinite(Number(input.objectScale)) && input.objectScale !== "" && input.objectScale !== null ? Math.max(0.5, Math.min(2, Math.round(Number(input.objectScale) * 100) / 100)) : 1;
    // who plays another role on this boss than in the setup ("Heiler 5 spielt hier DPS"): only players of the lineup
    const roles = {};
    for (const [uid, role] of Object.entries(input.roles && typeof input.roles === "object" && !Array.isArray(input.roles) ? input.roles : {})) {
        if (!allowed.has(str(uid)) || !FLEX_ROLES.includes(role) || Object.keys(roles).length >= LIMITS.tokensPerBoss) { dropped += 1; continue; }
        roles[str(uid)] = role;
    }
    // the mobs added to this section (a boss's adds, trash mobs): they are always there as tank targets; the entry is
    // a snapshot of the catalog's (name and icon) so it still shows when the catalog entry is gone
    const mobs = [];
    for (const m of Array.isArray(input.mobs) ? input.mobs : []) {
        const o = m && typeof m === "object" ? m : {};
        const id = str(o.id);
        if (!/^[dcb]:[\w\-/']{1,70}$/.test(id) || !str(o.name) || mobs.some((x) => x.id === id)) { dropped += 1; continue; }
        if (mobs.length >= LIMITS.mobsPerBoss) break;
        mobs.push({ id, name: str(o.name).slice(0, LIMITS.label), icon: /^([a-z0-9_'\-]{2,64}|(?:boss|mob):\d{1,6})$/.test(str(o.icon)) ? str(o.icon) : "" });
    }
    // default assignment cards the orga hid (they come back through "Karte hinzufügen"); only known types, once each
    const hiddenCards = [...new Set((Array.isArray(input.hiddenCards) ? input.hiddenCards : []).map(str))].filter((x) => assign.ASSIGN_TYPES.includes(x));
    const counts = besetzung.cleanCounts(input.counts);
    // all group rings of the board at once (default: shown)
    const showRings = input.showRings !== false;
    const { groupColors, groupMarks } = cleanGroupStyles(input.groupColors, input.groupMarks);
    // the default rows of the template this boss does not inherit (it deviated from them or switched them off)
    const inheritOff = [...new Set((Array.isArray(input.inheritOff) ? input.inheritOff : []).map(str))].filter((x) => /^[\w-]{1,24}$/.test(x)).slice(0, LIMITS.perBoard || 60);
    return { board: { tokens, slots, marks, icons, zones, lines, texts, targets, assignments: cleanedAssign.assignments, hiddenCards, inheritOff, showRings, groupColors, groupMarks, mobs, counts, roles, notes, profileId, mapOpacity, objectScale }, dropped };
}

/** Whether a cleaned board holds anything (an untouched boss is not stored). */
function boardHasContent(b) {
    return !!(b.tokens.length || b.slots.length || b.marks.length || b.icons.length || b.zones.length || b.lines.length || b.texts.length
        || b.targets.length || b.assignments.length || Object.keys(b.roles || {}).length || (b.mobs || []).length || (b.hiddenCards || []).length || (b.inheritOff || []).length || b.showRings === false || Object.keys(b.groupColors || {}).length || Object.keys(b.groupMarks || {}).length || b.notes.trim() || b.profileId || b.mapOpacity < 1 || b.objectScale !== 1);
}

/** The same board with every object under a new id — a template copied into a plan. */
function reidBoard(board) {
    const fresh = (o) => ({ ...o, id: newId() });
    return {
        ...board,
        tokens: [],
        slots: (board.slots || []).map(fresh),
        marks: (board.marks || []).map(fresh),
        icons: (board.icons || []).map(fresh),
        zones: (board.zones || []).map(fresh),
        lines: (board.lines || []).map(fresh),
        texts: (board.texts || []).map(fresh),
        targets: (board.targets || []).map((t) => ({ ...fresh(t), userIds: [] })),
        assignments: assign.reidAssignments(board.assignments),
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
    LIMITS, SIZES, SLOT_KINDS, MARKS, cleanGroupStyles, LINE_KINDS, ZONE_TYPES, ZONE_SHAPES, ZONE_COLORS, MIN_ZONE,
    cleanBoard, boardHasContent, reidBoard, fillSlots, newId,
};
