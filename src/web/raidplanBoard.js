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
const crypto = require("crypto");
const assign = require("./raidplanAssign");
const steps = require("./raidplanSteps");
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
const ICON_KEY = /^((?:boss|mob):\d{1,6}|wow:[a-z0-9_'\-]{2,64}|enemy|bosspos)$/;
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
            // a group as a whole (ring radius, spacing of the tokens, member tokens, tag, badges, names), its ring spacing and its member tokens on their own: 25 % .. 400 %
            groupScale: o.kind === "group" ? cleanFactor(o.groupScale) : 1, ringSpread: o.kind === "group" ? cleanFactor(o.ringSpread) : 1, tokenScale: o.kind === "group" ? cleanFactor(o.tokenScale) : 1,
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
            mobId: MOB_ID.test(str(o.mobId)) ? str(o.mobId) : "", autoFace: o.autoFace !== false, ...common(o), ...cleanArrow(o),
        });
    }

    const rawZones = Array.isArray(input.zones) ? input.zones : [];
    if (rawZones.length > LIMITS.zonesPerBoss) return { code: "invalid", error: `Höchstens ${LIMITS.zonesPerBoss} Zonen je Boss.` };
    const zoneIds = new Set();
    const zones = rawZones.map((z) => {
        const o = z && typeof z === "object" ? z : {};
        const type = ZONE_TYPES.includes(o.type) ? o.type : "neutral";
        const role = ZONE_ROLES.includes(o.role) ? o.role : "melee";
        const w = Math.max(MIN_ZONE, Math.min(1, Number(o.w) || MIN_ZONE));
        const h = Math.max(MIN_ZONE, Math.min(1, Number(o.h) || MIN_ZONE));
        return {
            id: cleanId(o.id, zoneIds),
            // a role group may also be a cluster of role icons instead of an area
            shape: ZONE_SHAPES.includes(o.shape) || (type === "role" && o.shape === "cluster") ? o.shape : type === "role" ? "ellipse" : "rect",
            type,
            label: str(o.label).slice(0, LIMITS.label),
            color: cleanColor(o.color, type === "role" ? ROLE_COLORS[role] : ZONE_COLORS[type]),
            // a role group: which role, an optional count badge (0 = none), whether the event shows the setup's players of that role
            ...(type === "role" ? { role, count: Math.max(0, Math.min(40, Math.floor(Number(o.count)) || 0)), showNames: o.showNames === true, rotation: normAngle(o.rotation) } : {}),
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
            width: Math.max(1, Math.min(16, Math.round(Number(o.width)) || 4)),
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
            size: Math.max(5, Math.min(72, Math.round(Number(o.size)) || 16)),
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

    // the tactic: ordered steps (who does what, when and how); a player outside the lineup is dropped like everywhere
    const cleanedSteps = steps.cleanSteps(input.steps, allowed);
    if (cleanedSteps.error) return cleanedSteps;
    dropped += cleanedSteps.dropped;

    const notes = String(input.notes === undefined || input.notes === null ? "" : input.notes).slice(0, LIMITS.notes);
    // The tactic profile the rows were taken from; one that was deleted since is forgotten.
    const profileId = profiles.has(str(input.profileId)) ? str(input.profileId) : "";
    const mapOpacity = cleanOpacity(input.mapOpacity, 1);
    const objectScale = Number.isFinite(Number(input.objectScale)) && input.objectScale !== "" && input.objectScale !== null ? Math.max(0.4, Math.min(2, Math.round(Number(input.objectScale) * 100) / 100)) : 1;
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
    const view = cleanView(input.view);
    // false = this section (boss, trash, Allgemein) is left out of the shared sheet; it stays fully editable
    const inSheet = input.inSheet !== false;
    // false = the section is shown without its map (the objects are kept); missing = shown (old boards keep their map)
    const showMap = input.showMap !== false;
    // the tank rows put their mobs and tanks on the map by themselves (off = only what was placed by hand)
    const autoPlace = input.autoPlace !== false;
    const autoPos = cleanAutoPos(input.autoPos);
    const autoStyle = cleanAutoStyle(input.autoStyle);
    const autoScale = Number.isFinite(Number(input.autoScale)) && input.autoScale !== "" && input.autoScale !== null ? Math.max(0.4, Math.min(2, Math.round(Number(input.autoScale) * 100) / 100)) : 1;
    const showNames = input.showNames !== false;
    const showBadges = input.showBadges !== false;
    const showRoleRings = input.showRoleRings !== false;
    // the default rows of the template this boss does not inherit (it deviated from them or switched them off)
    const inheritOff = [...new Set((Array.isArray(input.inheritOff) ? input.inheritOff : []).map(str))].filter((x) => /^[\w-]{1,24}$/.test(x)).slice(0, LIMITS.perBoard || 60);
    return { board: { tokens, slots, marks, icons, zones, lines, texts, targets, assignments: cleanedAssign.assignments, steps: cleanedSteps.steps, showMap, autoPlace, autoPos, autoStyle, autoScale, hiddenCards, inheritOff, showRings, inSheet, groupColors, groupMarks, showNames, showBadges, showRoleRings, view, mobs, counts, roles, notes, profileId, mapOpacity, objectScale }, dropped };
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
    const fresh = (o) => ({ ...o, id: newId() });
    const rows = assign.reidAssignments(board.assignments);
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
        icons: (board.icons || []).map(fresh),
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
    cleanFactor, cleanView,
    LIMITS, SIZES, SLOT_KINDS, MARKS, cleanGroupStyles, LINE_KINDS, ZONE_TYPES, ZONE_SHAPES, ZONE_COLORS, ZONE_ROLES, ROLE_COLORS, cleanArrow, MIN_ZONE,
    cleanBoard, boardHasContent, reidBoard, fillSlots, newId, cleanAutoPos, cleanAutoStyle, rowKey, AUTO_KEY,
};
