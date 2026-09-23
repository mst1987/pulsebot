// The board of one boss — shared by the event plan (raidplanStore.js) and the
// raid plan templates (raidplanTemplateStore.js), so the two can never disagree
// about what a board is or how it is validated.
//
//   tokens   [{ userId, x, y }]          free player tokens (event plans only)
//   slots    [{ id, kind, n, label, x, y, userId }]
//                                          placeholders: tank 1..n, healer 1..n, dps, a
//                                          group marker (n = the setup's group), or a free
//                                          label. `userId` is the player standing in it ("" =
//                                          open); a template never has one.
//   marks    [{ id, mark, x, y }]         the eight raid target marks
//   zones    [{ id, shape, type, label, color, opacity, x, y, w, h }]
//                                          rectangle / ellipse areas: danger, healthy,
//                                          neutral or a custom one
//   targets  [{ id, title, userIds }]     task rows
//   notes, profileId
//
// Coordinates are relative to the board (0..1). A save is cleaned, never trusted.
const crypto = require("crypto");

const LIMITS = {
    tokensPerBoss: 60,
    slotsPerBoss: 60,
    marksPerBoss: 40,
    zonesPerBoss: 30,
    targetsPerBoss: 30,
    usersPerTarget: 25,
    title: 80,
    label: 40,
    notes: 1000,
};

const SLOT_KINDS = ["tank", "healer", "dps", "group", "label"];
const MARKS = ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"];
const ZONE_TYPES = ["danger", "healthy", "neutral", "custom"];
const ZONE_SHAPES = ["rect", "ellipse"];
// Preset colours per zone type: what a new zone starts with, free to be overridden.
const ZONE_COLORS = { danger: "#ef4444", healthy: "#22c55e", neutral: "#60a5fa", custom: "#a78bfa" };
const MIN_ZONE = 0.03;

const str = (v) => String(v === null || v === undefined ? "" : v).trim();
const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const round4 = (n) => Math.round(n * 10000) / 10000;
const newId = () => crypto.randomBytes(5).toString("hex");

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
        tokens.push({ userId, x: round4(clamp01(Number(t.x))), y: round4(clamp01(Number(t.y))) });
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
        if (userId && (!allowed.has(userId) || usedInSlots.has(userId))) { userId = ""; dropped += 1; }
        if (userId) usedInSlots.add(userId);
        const n = Math.max(1, Math.min(99, Math.floor(Number(o.n)) || 1));
        slots.push({
            id: cleanId(o.id, slotIds), kind: o.kind, n, label,
            x: round4(clamp01(Number(o.x))), y: round4(clamp01(Number(o.y))), userId,
        });
    }

    const rawMarks = Array.isArray(input.marks) ? input.marks : [];
    if (rawMarks.length > LIMITS.marksPerBoss) return { code: "invalid", error: `Höchstens ${LIMITS.marksPerBoss} Marker je Boss.` };
    const markIds = new Set();
    const marks = [];
    for (const m of rawMarks) {
        const o = m && typeof m === "object" ? m : {};
        if (!MARKS.includes(o.mark)) { dropped += 1; continue; }
        marks.push({ id: cleanId(o.id, markIds), mark: o.mark, x: round4(clamp01(Number(o.x))), y: round4(clamp01(Number(o.y))) });
    }

    const rawZones = Array.isArray(input.zones) ? input.zones : [];
    if (rawZones.length > LIMITS.zonesPerBoss) return { code: "invalid", error: `Höchstens ${LIMITS.zonesPerBoss} Zonen je Boss.` };
    const zoneIds = new Set();
    const zones = rawZones.map((z) => {
        const o = z && typeof z === "object" ? z : {};
        const type = ZONE_TYPES.includes(o.type) ? o.type : "neutral";
        const w = Math.max(MIN_ZONE, Math.min(1, Number(o.w) || MIN_ZONE));
        const h = Math.max(MIN_ZONE, Math.min(1, Number(o.h) || MIN_ZONE));
        const opacity = Number.isFinite(Number(o.opacity)) && o.opacity !== "" && o.opacity !== null
            ? Math.max(0.1, Math.min(0.6, Math.round(Number(o.opacity) * 100) / 100)) : 0.3;
        return {
            id: cleanId(o.id, zoneIds),
            shape: ZONE_SHAPES.includes(o.shape) ? o.shape : "rect",
            type,
            label: str(o.label).slice(0, LIMITS.label),
            color: /^#[0-9a-fA-F]{6}$/.test(str(o.color)) ? str(o.color).toLowerCase() : ZONE_COLORS[type],
            opacity,
            w: round4(w), h: round4(h),
            x: round4(Math.min(clamp01(Number(o.x)), 1 - w)),
            y: round4(Math.min(clamp01(Number(o.y)), 1 - h)),
        };
    });

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

    const notes = String(input.notes === undefined || input.notes === null ? "" : input.notes).slice(0, LIMITS.notes);
    // The tactic profile the rows were taken from; one that was deleted since is forgotten.
    const profileId = profiles.has(str(input.profileId)) ? str(input.profileId) : "";
    return { board: { tokens, slots, marks, zones, targets, notes, profileId }, dropped };
}

/** Whether a cleaned board holds anything (an untouched boss is not stored). */
function boardHasContent(b) {
    return !!(b.tokens.length || b.slots.length || b.marks.length || b.zones.length || b.targets.length || b.notes.trim() || b.profileId);
}

/** The same board with every object under a new id — a template copied into a plan. */
function reidBoard(board) {
    const fresh = (o) => ({ ...o, id: newId() });
    return {
        ...board,
        tokens: [],
        slots: (board.slots || []).map(fresh),
        marks: (board.marks || []).map(fresh),
        zones: (board.zones || []).map(fresh),
        targets: (board.targets || []).map((t) => ({ ...fresh(t), userIds: [] })),
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
    const pick = (kind) => {
        const fits = kind === "dps" ? isDamage : (p) => p.role === kind;
        return roster.find((p) => fits(p) && !taken.has(p.userId)) || null;
    };
    const order = (kind) => slots.map((s, i) => ({ s, i })).filter((x) => x.s.kind === kind && !x.s.userId)
        .sort((a, b) => a.s.n - b.s.n || a.i - b.i);
    const out = slots.map((s) => ({ ...s }));
    for (const kind of ["tank", "healer", "dps"]) {
        for (const { i } of order(kind)) {
            const p = pick(kind);
            if (!p) break;
            taken.add(p.userId);
            out[i].userId = p.userId;
        }
    }
    return out;
}

module.exports = {
    LIMITS, SLOT_KINDS, MARKS, ZONE_TYPES, ZONE_SHAPES, ZONE_COLORS, MIN_ZONE,
    cleanBoard, boardHasContent, reidBoard, fillSlots, newId,
};
