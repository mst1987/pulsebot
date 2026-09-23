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
//   lines    [{ id, kind, x1, y1, x2, y2, color, width, ... }]   arrows and plain lines
//   texts    [{ id, text, x, y, color, size, ... }]              free text on the board
//   targets  [{ id, title, userIds }]     task rows
//   notes, profileId, mapOpacity          (mapOpacity 0.1..1: how strongly the map shows)
//
// Every object (token, slot, mark, zone, line, text) also carries `opacity`
// (0.1..1; zones start at 0.3, everything else at 1), `lock` (it cannot be moved
// or scaled) and `hidden` (it is not drawn — in the editor's layer list it can be
// switched back on). Colour and opacity are separate fields.
//
// Coordinates are relative to the board (0..1). A save is cleaned, never trusted.
const crypto = require("crypto");

const LIMITS = {
    tokensPerBoss: 60,
    slotsPerBoss: 60,
    marksPerBoss: 40,
    zonesPerBoss: 30,
    linesPerBoss: 40,
    textsPerBoss: 40,
    text: 60,
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
        tokens.push({ userId, x: round4(clamp01(Number(t.x))), y: round4(clamp01(Number(t.y))), ...common(t) });
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
            x: round4(clamp01(Number(o.x))), y: round4(clamp01(Number(o.y))), userId, ...common(o),
        });
    }

    const rawMarks = Array.isArray(input.marks) ? input.marks : [];
    if (rawMarks.length > LIMITS.marksPerBoss) return { code: "invalid", error: `Höchstens ${LIMITS.marksPerBoss} Marker je Boss.` };
    const markIds = new Set();
    const marks = [];
    for (const m of rawMarks) {
        const o = m && typeof m === "object" ? m : {};
        if (!MARKS.includes(o.mark)) { dropped += 1; continue; }
        marks.push({ id: cleanId(o.id, markIds), mark: o.mark, x: round4(clamp01(Number(o.x))), y: round4(clamp01(Number(o.y))), ...common(o) });
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

    const notes = String(input.notes === undefined || input.notes === null ? "" : input.notes).slice(0, LIMITS.notes);
    // The tactic profile the rows were taken from; one that was deleted since is forgotten.
    const profileId = profiles.has(str(input.profileId)) ? str(input.profileId) : "";
    const mapOpacity = cleanOpacity(input.mapOpacity, 1);
    return { board: { tokens, slots, marks, zones, lines, texts, targets, notes, profileId, mapOpacity }, dropped };
}

/** Whether a cleaned board holds anything (an untouched boss is not stored). */
function boardHasContent(b) {
    return !!(b.tokens.length || b.slots.length || b.marks.length || b.zones.length || b.lines.length || b.texts.length
        || b.targets.length || b.notes.trim() || b.profileId || b.mapOpacity < 1);
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
        lines: (board.lines || []).map(fresh),
        texts: (board.texts || []).map(fresh),
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
    LIMITS, SLOT_KINDS, MARKS, LINE_KINDS, ZONE_TYPES, ZONE_SHAPES, ZONE_COLORS, MIN_ZONE,
    cleanBoard, boardHasContent, reidBoard, fillSlots, newId,
};
