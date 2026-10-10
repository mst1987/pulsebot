// The animated scenes of a raid plan section (docs/raidplan/animation.md): a scene explains a task in motion — "group 1 gets
// Bloodboil, runs to the front, group 2 falls back" — and is played in the editor and the sheet. One board holds `scenes`:
//
//   { id, title, loop, length, stepId, frames: [frame], loops: [loop] }
//   frame  { id, at, caption, changes: [change] }       a "Takt": its START TIME in seconds (the first one at 0) and what changes
//   change { obj, x?, y?, rotation?, opacity?, scale?, hidden?, badge?, pulse?, delay, dur, ease, path? }
//   loop   { id, obj, path: [[x, y]], closed, period, from, to, trail }   a movement of its own, independent of the frames (kiting)
//
//   obj       the board object it moves: "token:<userId>", "slot:<id>", "icon:<id>", "mark:<id>", "zone:<id>", "line:<id>", "text:<id>"
//             or "auto:<key>" (an object the tank rows put on the map, see autoPos); a line's x / y is its middle
//   x, y      where it goes (0..1, like every board point); rotation 0..359; opacity 0.1..1; scale 0.25..4 (of its own size)
//   hidden    true = it fades out, false = it fades in; badge = a WoW icon name shown on it ("" takes it off); pulse = it pulses
//   delay     seconds after the frame's start the change begins; dur = how long it takes; ease = inout | linear | in | out
//   path      the points a movement passes on its way (a curve through them) instead of the straight line
//
// The model is a TIMELINE already: a frame is a moment (`at`), every change starts at `at + delay` and ends `dur` later, and a
// change that starts before the one before it ended simply takes over from where the object is. The editor shows frames ("Takte");
// a later timeline view would edit the same data. Only references to board objects are stored; a reference to an object the board
// no longer has is dropped on every save. Pure and tested (test/services/raidplan/raidplanScenes.test.js).
const { str } = require("../../utils/text");
const { newId } = require("../../utils/ids");

const LIMITS = { scenes: 8, frames: 24, changes: 60, loops: 12, path: 16, loopPath: 24, title: 60, caption: 120, seconds: 600, step: 60 };
const EASES = ["inout", "linear", "in", "out"];
const OBJ_KINDS = ["token", "slot", "icon", "mark", "zone", "line", "text"];
const OBJ_REF = /^(token|slot|icon|mark|zone|line|text):([\w-]{1,40})$/;
// the key of an object the tank rows put on the map (raidplanBoard.js AUTO_KEY)
const AUTO_REF = /^auto:(t:[\w-]{1,24}:\d{1,2}|m:[dcb]:[\w\-/']{1,70}#\d{1,2})$/;
const ICON_NAME = /^[a-z0-9_'-]{2,64}$/;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isNum = (v) => v !== "" && v !== null && v !== undefined && typeof v !== "boolean" && Number.isFinite(Number(v));
const round4 = (n) => Math.round(n * 10000) / 10000;
/** Seconds as stored: tenths, within lo..hi; `fallback` when it is not a number. */
const secs = (v, lo, hi, fallback) => (isNum(v) ? clamp(Math.round(Number(v) * 10) / 10, lo, hi) : fallback);
const point = (p) => (Array.isArray(p) && isNum(p[0]) && isNum(p[1]) ? [round4(clamp(Number(p[0]), 0, 1)), round4(clamp(Number(p[1]), 0, 1))] : null);
const cleanPath = (raw, max) => (Array.isArray(raw) ? raw.map(point).filter(Boolean).slice(0, max) : []);
function cleanId(raw, seen) {
    let id = str(raw).replace(/[^\w-]/g, "").slice(0, 24);
    if (!id || seen.has(id)) id = newId(5);
    seen.add(id);
    return id;
}

/** The object references a board offers to its scenes: its objects by kind and id (players by their userId). */
function boardRefs(board) {
    const b = board || {};
    const refs = new Set();
    for (const t of b.tokens || []) refs.add(`token:${t.userId}`);
    for (const kind of OBJ_KINDS.slice(1)) for (const o of b[`${kind}s`] || []) refs.add(`${kind}:${o.id}`);
    return refs;
}
/** Whether a reference means an object of the board (an auto object cannot be checked here: the tank rows derive it). */
const knownRef = (ref, refs) => (OBJ_REF.test(ref) ? refs.has(ref) : AUTO_REF.test(ref));

/** One change of a frame; null when it means no object of the board or changes nothing. */
function cleanChange(raw, refs) {
    const o = raw && typeof raw === "object" ? raw : {};
    const obj = str(o.obj);
    if (!knownRef(obj, refs)) return null;
    const out = { obj };
    if (isNum(o.x) && isNum(o.y)) {
        out.x = round4(clamp(Number(o.x), 0, 1));
        out.y = round4(clamp(Number(o.y), 0, 1));
        const path = cleanPath(o.path, LIMITS.path);
        if (path.length) out.path = path;
    }
    if (isNum(o.rotation)) out.rotation = ((Math.round(Number(o.rotation)) % 360) + 360) % 360;
    if (isNum(o.opacity)) out.opacity = Math.round(clamp(Number(o.opacity), 0.1, 1) * 100) / 100;
    if (isNum(o.scale)) out.scale = Math.round(clamp(Number(o.scale), 0.25, 4) * 100) / 100;
    if (typeof o.hidden === "boolean") out.hidden = o.hidden;
    if (typeof o.pulse === "boolean") out.pulse = o.pulse;
    if (o.badge !== undefined && o.badge !== null) {
        const badge = str(o.badge).toLowerCase();
        if (badge === "" || ICON_NAME.test(badge)) out.badge = badge;
    }
    if (Object.keys(out).length === 1) return null;
    out.delay = secs(o.delay, 0, LIMITS.step, 0);
    out.dur = secs(o.dur, 0, LIMITS.step, 1);
    out.ease = EASES.includes(str(o.ease)) ? str(o.ease) : "inout";
    return out;
}

/** The frames of a scene in time order: the first starts at 0, each later one at least a tenth after the one before. */
function cleanFrames(raw, refs) {
    const seen = new Set();
    const frames = (Array.isArray(raw) ? raw : []).slice(0, LIMITS.frames).map((f, i) => {
        const o = f && typeof f === "object" ? f : {};
        const changes = [];
        const objs = new Set();
        for (const c of Array.isArray(o.changes) ? o.changes : []) {
            const ch = cleanChange(c, refs);
            // an object changes once per frame (the first entry wins)
            if (!ch || objs.has(ch.obj)) continue;
            if (changes.length >= LIMITS.changes) break;
            objs.add(ch.obj);
            changes.push(ch);
        }
        return { id: cleanId(o.id, seen), at: secs(o.at, 0, LIMITS.seconds, i * 2), caption: str(o.caption).replace(/\s+/g, " ").slice(0, LIMITS.caption), changes };
    });
    frames.sort((a, b) => a.at - b.at);
    let last = -0.1;
    for (const [i, f] of frames.entries()) {
        f.at = i === 0 ? 0 : Math.min(LIMITS.seconds, Math.max(f.at, Math.round((last + 0.1) * 10) / 10));
        last = f.at;
    }
    return frames;
}

/** The movements of their own: an object, a path of at least two points, the time of one round and when it runs. */
function cleanLoops(raw, refs) {
    const seen = new Set();
    const out = [];
    for (const l of Array.isArray(raw) ? raw : []) {
        const o = l && typeof l === "object" ? l : {};
        const obj = str(o.obj);
        const path = cleanPath(o.path, LIMITS.loopPath);
        if (!knownRef(obj, refs) || path.length < 2) continue;
        if (out.length >= LIMITS.loops) break;
        const from = secs(o.from, 0, LIMITS.seconds, 0);
        const to = secs(o.to, 0, LIMITS.seconds, 0);
        out.push({ id: cleanId(o.id, seen), obj, path, closed: o.closed !== false, period: secs(o.period, 1, LIMITS.seconds, 10), from, to: to > from ? to : 0, trail: o.trail === true });
    }
    return out;
}

/**
 * Cleans the scenes of one board. `board` is the board as cleaned so far (its objects decide which references stay), `stepIds` the
 * ids of its tactic steps (a scene may stand at one). Returns `{ scenes }` or `{ code, error }` for too many scenes.
 */
function cleanScenes(raw, board, stepIds = []) {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length > LIMITS.scenes) return { code: "invalid", error: `Höchstens ${LIMITS.scenes} Animationen je Abschnitt.` };
    const refs = boardRefs(board);
    const steps = new Set([...stepIds].map(str));
    const seen = new Set();
    const scenes = list.map((s, i) => {
        const o = s && typeof s === "object" ? s : {};
        const frames = cleanFrames(o.frames, refs);
        const lastAt = frames.length ? frames[frames.length - 1].at : 0;
        // the scene ends after its last frame (at least a tenth later); missing = two seconds after it
        const length = Math.max(Math.round((lastAt + 0.1) * 10) / 10, secs(o.length, 0.1, LIMITS.seconds, lastAt + 2));
        return {
            id: cleanId(o.id, seen),
            title: str(o.title).replace(/\s+/g, " ").slice(0, LIMITS.title) || `Animation ${i + 1}`,
            loop: o.loop === true,
            length: Math.min(LIMITS.seconds, length),
            stepId: steps.has(str(o.stepId)) ? str(o.stepId) : "",
            frames,
            loops: cleanLoops(o.loops, refs),
        };
    });
    return { scenes };
}

/** The scenes with every object reference renamed by `rename(ref)` (a board copied under new ids); a reference it returns "" for is dropped. */
function renameRefs(scenes, rename) {
    return (Array.isArray(scenes) ? scenes : []).map((s) => ({
        ...s,
        frames: (s.frames || []).map((f) => ({ ...f, changes: (f.changes || []).map((c) => ({ ...c, obj: rename(c.obj) })).filter((c) => c.obj) })),
        loops: (s.loops || []).map((l) => ({ ...l, obj: rename(l.obj) })).filter((l) => l.obj),
    }));
}

/** The same scenes under new ids (scenes, frames, loops), with the references and the step a scene stands at renamed. */
function reidScenes(scenes, rename = (r) => r, stepIds = new Map()) {
    return renameRefs(scenes, rename).map((s) => ({
        ...s,
        id: newId(5),
        stepId: stepIds.get(s.stepId) || "",
        frames: s.frames.map((f) => ({ ...f, id: newId(5) })),
        loops: s.loops.map((l) => ({ ...l, id: newId(5) })),
    }));
}

module.exports = { LIMITS, EASES, OBJ_REF, AUTO_REF, cleanScenes, renameRefs, reidScenes, boardRefs };
