// Auto placement from the tank rows (docs/raidplan.md, "Auto placement"): every tank row of a section ("Tank(s) -> mob(s)") puts its
// mobs and its tanks on the map by itself. Nothing of it is stored - the objects are DERIVED from the rows each time; only where one
// was moved by hand is kept (board.autoPos, by a stable key) and whether the section wants it at all (board.autoPlace).
//
//   a mob      one icon per instance: the boss is one, a mob of the catalog is one per row that names it without a number ("Tank 2 ->
//              Flame", "Tank 3 -> Flame" = two Flames), a numbered target is that one ("Flame of Azzinoth 2"). An icon placed by hand
//              for that mob (mobId, a boss portrait without one) plays the instance instead: nothing is doubled. A target that names ONE
//              placed icon (`oid`, "Flame 2" of two Flames on the map) is exactly that icon; a target of the kind alone (older plans, a row
//              that does not care which) takes the next icon nobody named.
//   a tank     one token per assignee of the row: the n-th tank of a row goes to the n-th mob of the row (a row with one mob: all of them).
//              A player who already stands on the map (a free token, a role slot, the ring of his group, an earlier row) is used as he
//              is - a player is on the map once. A class reference is a placeholder in a template ("rule") and, when nobody of that
//              class is in the raid, a dimmed "missing" place in an event (never another class).
//
// Keys: "t:<row>:<n>" (the row's id, a copy of a default row keeps the default's) and "m:<mob>#<n>". The layout works on a nominal
// board (LAYOUT_W x LAYOUT_H reference px), so the editor, the template and the sheet put everything at the same place.
//
// Written to be strippable (src/web-client/src/lib/autoPlace.test.ts runs it): imports, `export type`, tables and one-line signatures only.
import type { RaidplanAssignment, RaidplanAssignTarget, RaidplanAssignType, RaidplanAutoStyle, RaidplanBoard, RaidplanIcon, RaidplanPlayer } from "../../api";

export const AUTO_TANK_TYPES = ["tank", "trashtank", "special"];
export const LAYOUT_W = 1000;
export const LAYOUT_H = 625;
// half the size of an icon / a token in reference px, the air between two objects, how far a tank stands from its mob and apart from another tank of it
export const AUTO_SIZES = { icon: 24, token: 19, mark: 17, gap: 6, tankDist: 105, tankSpread: 62, mobSide: 200, mobRow: 125, trashCol: 140, trashRow: 150, looseCol: 70, looseRow: 215 };

export type AutoMob = { key: string; ref: string; inst: number; count: number; name: string; icon: string; iconKey: string; iconId: string; x: number; y: number; moved: boolean; boss: boolean; /** the size in reference px (its own size x the section's autoScale; objectScale comes on top) */ size: number; /** what the orga changed about its look */ style: RaidplanAutoStyle };
export type AutoTank = { key: string; rowId: string; rowKey: string; type: string; j: number; ref: string; state: string; userId: string; classId: string; role: string; slotKind: string; slotN: number; mobKey: string; existing: string; x: number; y: number; moved: boolean; size: number; style: RaidplanAutoStyle };
export type AutoPlan = { mobs: AutoMob[]; tanks: AutoTank[]; users: string[] };
export type AutoPoint = { x: number; y: number };
export type AutoOptions = { template: boolean; roster: RaidplanPlayer[] };

/** The key a row's tanks go by: a copy of a default row keeps the default's id, so a tank moved by hand stays where it is. */
export function rowKeyOf(a: RaidplanAssignment): string {
    return a.origin && a.origin !== "default" ? a.origin : a.id;
}

/** The icon key a mob target's snapshot icon makes on the map (boss:N / mob:N as they are, a WoW icon by name, else the enemy symbol). */
export function autoIconKey(icon: string): string {
    return icon.indexOf("boss:") === 0 || icon.indexOf("mob:") === 0 ? icon : icon ? `wow:${icon}` : "enemy";
}

/** The icons placed by hand for one mob, in the board's order (hidden ones left out): "Flame 1", "Flame 2" are the first and the second. */
export function mobIconsOf(board: RaidplanBoard, ref: string): RaidplanIcon[] {
    return (board.icons || []).filter((ic) => !ic.hidden && !!ic.mobId && ic.mobId === ref);
}

/** The number an icon carries among the placed icons of its mob (1, 2 ...); 0 = the only one of its mob, or no mob at all. */
export function mobIconNo(board: RaidplanBoard, id: string): number {
    const ic = (board.icons || []).find((x) => x.id === id);
    if (!ic || !ic.mobId || ic.hidden) return 0;
    const list = mobIconsOf(board, ic.mobId);
    return list.length > 1 ? list.findIndex((x) => x.id === id) + 1 : 0;
}

/** The icon a mob target means, when it names one that stands on the board for that mob; null = the target means the kind. */
export function targetIcon(board: RaidplanBoard, tg: RaidplanAssignTarget): RaidplanIcon | null {
    if (tg.kind !== "mob" || !tg.oid) return null;
    return mobIconsOf(board, tg.ref).find((ic) => ic.id === tg.oid) || null;
}

/** A target of one placed icon of a mob ("Flame 2"): the mob's snapshot, the icon's id and its number (for the label where the map is not at hand). */
export function iconTarget(board: RaidplanBoard, base: RaidplanAssignTarget, oid: string): RaidplanAssignTarget {
    const n = mobIconNo(board, oid);
    return n > 0 ? { kind: "mob", ref: base.ref, name: base.name, icon: base.icon, n, oid } : { kind: "mob", ref: base.ref, name: base.name, icon: base.icon, oid };
}

/**
 * The mob targets a section offers for one mob: one per placed icon when two or more of it stand on the map ("Flame 1", "Flame 2"),
 * else the mob as such.
 */
export function mobTargetsFor(board: RaidplanBoard, base: RaidplanAssignTarget): RaidplanAssignTarget[] {
    const icons = mobIconsOf(board, base.ref);
    return icons.length > 1 ? icons.map((ic) => iconTarget(board, base, ic.id)) : [base];
}

/** Whether two targets are the same: a mob of one placed icon is only that icon. */
export function sameTargetAs(x: RaidplanAssignTarget, y: RaidplanAssignTarget): boolean {
    return x.kind === y.kind && x.ref === y.ref && (x.kind !== "mob" || (x.oid || "") === (y.oid || ""));
}

/** Where a raider already stands on the board: his free token, a role slot on the map, the ring of his split group; "" = nowhere. */
export function placeOf(board: RaidplanBoard, userId: string, roster: RaidplanPlayer[]): string {
    if ((board.tokens || []).some((k) => k.userId === userId && !k.hidden)) return `token:${userId}`;
    const slot = (board.slots || []).find((s) => s.userId === userId && s.placed !== false && !s.hidden && s.kind !== "group");
    if (slot) return `slot:${slot.id}`;
    const p = roster.find((x) => x.userId === userId);
    const ring = p ? (board.slots || []).find((s) => s.kind === "group" && s.n === p.group && s.split && !s.hideMembers && s.placed !== false && !s.hidden) : undefined;
    return ring ? `member:${ring.id}:${userId}` : "";
}

/**
 * What the tank rows of a section put on the map. `rows` = the EFFECTIVE rows (own and inherited, class references resolved in an
 * event), `board` = the section's board (hand-placed objects, autoPos, autoPlace), `opts.template` = a template (class references
 * are placeholders, not missing), `opts.roster` = the setup (who is in which group). Pure; the positions come from layoutAuto.
 */
export function deriveAuto(rows: RaidplanAssignment[], board: RaidplanBoard, opts: AutoOptions): AutoPlan {
    const plan = { mobs: [], tanks: [], users: [] };
    if (board.autoPlace === false) return plan;
    const tankRows = (rows || []).filter((a) => AUTO_TANK_TYPES.indexOf(String(a.type)) >= 0);
    if (tankRows.length === 0) return plan;
    // 1. the mob instances, in the order of the rows; a target of one placed icon is that icon (its number is the icon's)
    const explicit = {};
    for (const a of tankRows) for (const tg of a.targets || []) if (tg.kind === "mob" && tg.n) (explicit[tg.ref] = explicit[tg.ref] || []).push(tg.n);
    const given = {};
    const bound = {};
    const rowMobs = [];
    for (const a of tankRows) {
        const keys = [];
        for (const tg of a.targets || []) {
            if (tg.kind !== "mob") continue;
            const ic = targetIcon(board, tg);
            if (ic) {
                const ikey = `m:${tg.ref}@${ic.id}`;
                bound[ikey] = ic.id;
                if (keys.indexOf(ikey) < 0) keys.push(ikey);
                if (!plan.mobs.some((m) => m.key === ikey)) plan.mobs.push({ key: ikey, ref: tg.ref, inst: mobIconNo(board, ic.id) || 1, count: 0, name: tg.name || "", icon: tg.icon || "", iconKey: autoIconKey(tg.icon || ""), iconId: "", x: 0, y: 0, moved: false, boss: tg.ref.indexOf("b:") === 0, size: 0, style: {} });
                continue;
            }
            let n = tg.n || 0;
            if (!n && tg.ref.indexOf("b:") === 0) n = 1;
            if (!n) {
                // a row that names a mob of the catalog without a number has one of its own: the lowest number nobody names
                n = 1;
                const taken = (explicit[tg.ref] || []).concat(given[tg.ref] || []);
                while (taken.indexOf(n) >= 0) n += 1;
                (given[tg.ref] = given[tg.ref] || []).push(n);
            }
            const key = `m:${tg.ref}#${n}`;
            if (keys.indexOf(key) < 0) keys.push(key);
            if (!plan.mobs.some((m) => m.key === key)) plan.mobs.push({ key, ref: tg.ref, inst: n, count: 0, name: tg.name || "", icon: tg.icon || "", iconKey: autoIconKey(tg.icon || ""), iconId: "", x: 0, y: 0, moved: false, boss: tg.ref.indexOf("b:") === 0, size: 0, style: {} });
        }
        rowMobs.push(keys);
    }
    // several of a kind: numbered - as many as the rows make, at least as many as stand on the map
    for (const m of plan.mobs) m.count = Math.max(plan.mobs.filter((x) => x.ref === m.ref).length, mobIconsOf(board, m.ref).length);
    // 2. an icon placed by hand for a mob plays its instances: a named icon its own one, the others in the order of the board (the first
    //    icon nobody named = the lowest number)
    const icons = (board.icons || []).filter((ic) => !ic.hidden);
    const refs = [];
    for (const m of plan.mobs) if (refs.indexOf(m.ref) < 0) refs.push(m.ref);
    let legacyBoss = false;
    for (const m of plan.mobs) {
        const ic = bound[m.key] ? icons.find((x) => x.id === bound[m.key]) : undefined;
        if (ic) { m.iconId = ic.id; m.x = ic.x; m.y = ic.y; }
    }
    const taken = Object.keys(bound).map((k) => bound[k]);
    for (const ref of refs) {
        let own = icons.filter((ic) => ic.mobId === ref && taken.indexOf(ic.id) < 0);
        // an older boss icon has no mob: the boss portrait without one plays the boss
        if (own.length === 0 && ref.indexOf("b:") === 0 && !legacyBoss) { own = icons.filter((ic) => !ic.mobId && String(ic.iconKey).indexOf("boss:") === 0); legacyBoss = true; }
        const list = plan.mobs.filter((m) => m.ref === ref && !bound[m.key]).sort((a, b) => a.inst - b.inst);
        // an instance an icon plays is called by that icon's number ("Flame 2" = the second Flame on the map)
        list.forEach((m, k) => { if (own[k]) { m.iconId = own[k].id; m.x = own[k].x; m.y = own[k].y; m.inst = mobIconNo(board, own[k].id) || m.inst; } });
    }
    // 3. the tanks
    const roster = opts.roster || [];
    const byUser = {};
    tankRows.forEach((a, i) => {
        const mobs = rowMobs[i];
        (a.assignees || []).forEach((ref, j) => {
            const t = { key: `t:${rowKeyOf(a)}:${j + 1}`, rowId: a.id, rowKey: rowKeyOf(a), type: String(a.type), j: j + 1, ref, state: "", userId: "", classId: "", role: "", slotKind: "", slotN: 0, mobKey: mobs.length > 0 ? mobs[j % mobs.length] : "", existing: "", x: 0, y: 0, moved: false, size: 0, style: {} };
            const p = ref.split(":");
            let uid = "";
            if (p[0] === "user") uid = p[1];
            else if (p[0] === "slot") {
                t.slotKind = p[1];
                t.slotN = Number(p[2]);
                const s = (board.slots || []).find((x) => x.kind === p[1] && x.n === Number(p[2]));
                if (s && !s.hidden && s.placed !== false) { t.state = s.userId ? "player" : "slot"; t.userId = s.userId || ""; t.existing = `slot:${s.id}`; }
                else if (s && s.userId) uid = s.userId;
                else t.state = "slot";
            } else if (p[0] === "class") {
                t.classId = p[1];
                t.role = p[3] || "";
                t.state = opts.template ? "rule" : "missing";
            } else return;
            if (uid) {
                t.userId = uid;
                t.state = "player";
                const where = placeOf(board, uid, roster);
                if (where) t.existing = where;
                else if (byUser[uid]) t.existing = `auto:${byUser[uid]}`;
                else byUser[uid] = t.key;
            }
            // an open slot named by several rows (a template's "Tank 1") is one place too
            if (t.state === "slot" && !t.existing) {
                const same = `slot:${t.slotKind}:${t.slotN}`;
                if (byUser[same]) t.existing = `auto:${byUser[same]}`;
                else byUser[same] = t.key;
            }
            plan.tanks.push(t);
        });
    });
    plan.users = plan.tanks.filter((t) => t.state === "player" && !t.existing && t.userId).map((t) => t.userId);
    // the look the orga gave each of them (board.autoStyle) and their size: their own (default a token / an icon) x all of them together (autoScale)
    const styles = board.autoStyle || {};
    const together = board.autoScale || 1;
    for (const m of plan.mobs) { m.style = styles[m.key] || {}; m.size = Math.round((m.style.size || AUTO_SIZES.icon * 2) * together * 100) / 100; }
    for (const t of plan.tanks) { t.style = styles[t.key] || {}; t.size = Math.round((t.style.size || AUTO_SIZES.token * 2) * together * 100) / 100; }
    layoutAuto(plan.mobs, plan.tanks, board);
    return plan;
}

/**
 * Where the auto objects stand (fractions of the board): one moved by hand where it was put; the boss in the middle (without a boss the
 * mobs start at the top middle), the other mobs of a boss left and right of it in rows, trash mobs in rows; each tank in front of its mob
 * (away from the boss, below it for the boss and for trash), several tanks of one mob side by side, tanks without a mob in a row below.
 * Nothing overlaps: a place that is taken moves out on a small spiral. Deterministic; changes the objects in place.
 */
export function layoutAuto(mobs: AutoMob[], tanks: AutoTank[], board: RaidplanBoard): void {
    const W = LAYOUT_W;
    const H = LAYOUT_H;
    const S = AUTO_SIZES;
    const over = board.autoPos || {};
    const scale = board.objectScale || 1;
    const placed = [];
    const add = (x, y, r) => { placed.push({ x, y, r }); };
    for (const ic of board.icons || []) if (!ic.hidden) add(ic.x * W, ic.y * H, ((ic.size || 48) * scale) / 2);
    for (const k of board.tokens || []) if (!k.hidden) add(k.x * W, k.y * H, ((k.size || 38) * scale) / 2);
    for (const s of board.slots || []) if (!s.hidden && s.placed !== false) add(s.x * W, s.y * H, ((s.size || 38) * scale) / 2);
    for (const m of board.marks || []) if (!m.hidden) add(m.x * W, m.y * H, ((m.size || 34) * scale) / 2);
    // the spacing grows with the objects: the board's symbol size x the size of all auto objects together (reference units)
    const k = scale * (board.autoScale || 1);
    const rOf = (o) => ((o.size || (o.key && o.key.indexOf("t:") === 0 ? S.token * 2 : S.icon * 2)) * scale) / 2;
    const clampTo = (v, r, max) => Math.max(r + 4, Math.min(max - r - 4, v));
    function free(x, y, r) {
        const ok = (px, py) => placed.every((c) => Math.hypot(px - c.x, py - c.y) >= r + c.r + S.gap);
        const bx = clampTo(x, r, W);
        const by = clampTo(y, r, H);
        if (ok(bx, by)) return { x: bx, y: by };
        for (let ring = 1; ring <= 12; ring++) {
            for (let s = 0; s < 12; s++) {
                const a = (s * Math.PI) / 6 + Math.PI / 2;
                const px = clampTo(x + Math.cos(a) * ring * 20, r, W);
                const py = clampTo(y + Math.sin(a) * ring * 20, r, H);
                if (ok(px, py)) return { x: px, y: py };
            }
        }
        return { x: bx, y: by };
    }
    const put = (o, p, r) => { o.x = Math.round((p.x / W) * 10000) / 10000; o.y = Math.round((p.y / H) * 10000) / 10000; add(p.x, p.y, r); };
    // what was moved by hand stays there
    for (const m of mobs) if (!m.iconId && over[m.key]) { m.moved = true; put(m, { x: over[m.key].x * W, y: over[m.key].y * H }, rOf(m)); }
    for (const t of tanks) if (!t.existing && over[t.key]) { t.moved = true; put(t, { x: over[t.key].x * W, y: over[t.key].y * H }, rOf(t)); }
    const boss = mobs.find((m) => m.boss);
    const anchor = boss && (boss.iconId || boss.moved) ? { x: boss.x * W, y: boss.y * H } : boss ? { x: W / 2, y: H * 0.4 } : { x: W / 2, y: H * 0.28 };
    if (boss && !boss.iconId && !boss.moved) put(boss, free(anchor.x, anchor.y, rOf(boss)), rOf(boss));
    const rest = mobs.filter((m) => !m.boss && !m.iconId && !m.moved);
    rest.forEach((m, i) => {
        let tx = anchor.x;
        let ty = anchor.y;
        if (boss) {
            // left and right of the boss, then a row lower
            tx = anchor.x + (i % 2 === 0 ? -1 : 1) * Math.max(S.mobSide * k, (boss ? rOf(boss) : 0) + rOf(m) + 40);
            ty = anchor.y + Math.floor(i / 2) * Math.max(S.mobRow * k, rOf(m) * 2 + 30);
        } else {
            const per = 6;
            const row = Math.floor(i / per);
            const inRow = Math.min(per, rest.length - row * per);
            tx = anchor.x + ((i % per) - (inRow - 1) / 2) * Math.max(S.trashCol * k, rOf(m) * 2 + 30);
            ty = anchor.y + row * Math.max(S.trashRow * k, rOf(m) * 2 + 60);
        }
        put(m, free(tx, ty, rOf(m)), rOf(m));
    });
    // the tanks: in front of their mob, side by side when there are several
    const need = tanks.filter((t) => !t.existing && !t.moved);
    const byMob = {};
    const order = [];
    const loose = [];
    for (const t of need) {
        const m = t.mobKey ? mobs.find((x) => x.key === t.mobKey) : undefined;
        if (!m) { loose.push(t); continue; }
        if (!byMob[t.mobKey]) { byMob[t.mobKey] = []; order.push(t.mobKey); }
        byMob[t.mobKey].push(t);
    }
    for (const key of order) {
        const m = mobs.find((x) => x.key === key);
        const mx = m.x * W;
        const my = m.y * H;
        let dx = 0;
        let dy = 1;
        if (boss && !m.boss) {
            const vx = mx - anchor.x;
            const vy = my - anchor.y;
            const len = Math.hypot(vx, vy);
            if (len > 1) { dx = vx / len; dy = vy / len; }
        }
        const list = byMob[key];
        list.forEach((t, q) => {
            // in front of the mob: about two icon sizes (grows with the objects), never closer than the two touching
            const dist = Math.max(S.tankDist * k, rOf(m) + rOf(t) + 24);
            const off = (q - (list.length - 1) / 2) * Math.max(S.tankSpread * k, rOf(t) * 2 + 20);
            put(t, free(mx + dx * dist - dy * off, my + dy * dist + dx * off, rOf(t)), rOf(t));
        });
    }
    loose.forEach((t, u) => { put(t, free(anchor.x + (u - (loose.length - 1) / 2) * Math.max(S.looseCol * k, rOf(t) * 2 + 20), anchor.y + S.looseRow * k, rOf(t)), rOf(t)); });
}

/** Where a tank of the plan stands: its own auto place, or the object that already stands for him; null = nowhere (a missing class). */
export function tankPoint(plan: AutoPlan, t: AutoTank, board: RaidplanBoard, places: Record<string, AutoPoint>): AutoPoint | null {
    if (t.state === "missing") return null;
    if (!t.existing) return { x: t.x, y: t.y };
    const p = t.existing.split(":");
    if (p[0] === "slot") { const s = (board.slots || []).find((x) => x.id === p[1]); return s ? { x: s.x, y: s.y } : null; }
    if (p[0] === "token") { const k = (board.tokens || []).find((x) => x.userId === p[1]); return k ? { x: k.x, y: k.y } : null; }
    if (p[0] === "member") {
        if (places && places[p[2]]) return places[p[2]];
        const s = (board.slots || []).find((x) => x.id === p[1]);
        return s ? { x: s.x, y: s.y } : null;
    }
    if (p[0] === "auto") { const o = plan.tanks.find((x) => x.key === t.existing.slice(5)); return o ? { x: o.x, y: o.y } : null; }
    return null;
}

/** The mob instance an icon plays: an auto icon ("auto:<key>") or one placed by hand; null = the tank rows do not know it. */
export function mobOfIcon(plan: AutoPlan, id: string): AutoMob | null {
    if (id.indexOf("auto:") === 0) return plan.mobs.find((m) => m.key === id.slice(5) && !m.iconId) || null;
    return plan.mobs.find((m) => m.iconId === id) || null;
}

/**
 * The facing of an icon from the tank rows: the angle to the first tank of its instance that stands on the map (0 = up, clockwise, on a
 * board `ar` times as wide as high); -2 = the rows know the mob but none of its tanks stands anywhere (keep the own facing); -1 = the rows
 * do not know the icon (the older rule of lib/raidplan/assign.ts facingOf applies).
 */
export function autoFacing(plan: AutoPlan, id: string, from: AutoPoint, board: RaidplanBoard, places: Record<string, AutoPoint>, ar: number): number {
    const m = mobOfIcon(plan, id);
    if (!m) return -1;
    for (const t of plan.tanks) {
        if (t.mobKey !== m.key) continue;
        const p = tankPoint(plan, t, board, places);
        if (!p) continue;
        const dx = (p.x - from.x) * ar;
        const dy = p.y - from.y;
        if (dx === 0 && dy === 0) return 0;
        const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
        return Math.round(((deg % 360) + 360) % 360);
    }
    return -2;
}

/** The places of the raiders the auto tanks stand for (the thin lines of the heal rows find a tank there). */
export function autoPlaces(plan: AutoPlan): Record<string, AutoPoint> {
    const out = {};
    for (const t of plan.tanks) if (t.state === "player" && t.userId && !t.existing) out[t.userId] = { x: t.x, y: t.y };
    return out;
}

/** "Anzahl" of a mob target: 1 = the row's own one (no number), 2+ = that many of its kind, numbered 1..n (at most 20). */
export function setMobCount(rows: RaidplanAssignment[], rowId: string, ref: string, count: number): RaidplanAssignment[] {
    return rows.map((a) => {
        if (a.id !== rowId) return a;
        const first = a.targets.find((x) => x.kind === "mob" && x.ref === ref);
        if (!first) return a;
        const at = a.targets.indexOf(first);
        const rest = a.targets.filter((x) => !(x.kind === "mob" && x.ref === ref));
        const n = Math.max(1, Math.min(20, Math.floor(count) || 1));
        const made = [];
        if (n === 1) made.push({ kind: "mob", ref, name: first.name, icon: first.icon });
        else for (let i = 1; i <= n; i++) made.push({ kind: "mob", ref, name: first.name, icon: first.icon, n: i });
        return { ...a, suggested: false, targets: [...rest.slice(0, at), ...made, ...rest.slice(at)] };
    });
}

/** "Nr." of a single mob target: which of several of its kind the row means (0 = its own, numbered by the rows in order). */
export function setMobInstance(rows: RaidplanAssignment[], rowId: string, ref: string, n: number): RaidplanAssignment[] {
    return rows.map((a) => {
        if (a.id !== rowId) return a;
        const first = a.targets.find((x) => x.kind === "mob" && x.ref === ref);
        if (!first) return a;
        const at = a.targets.indexOf(first);
        const rest = a.targets.filter((x) => !(x.kind === "mob" && x.ref === ref));
        const k = Math.max(0, Math.min(20, Math.floor(n) || 0));
        // n: undefined is left out of the saved JSON (the row's own one)
        const one = { ...first, n: k > 0 ? k : undefined };
        return { ...a, suggested: false, targets: [...rest.slice(0, at), one, ...rest.slice(at)] };
    });
}

/** How many targets of one mob a row has (its "Anzahl") and the number a single one carries (0 = its own). */
export function mobCountOf(row: RaidplanAssignment, ref: string): number {
    return row.targets.filter((x) => x.kind === "mob" && x.ref === ref).length;
}

export function mobInstanceOf(row: RaidplanAssignment, ref: string): number {
    const list = row.targets.filter((x) => x.kind === "mob" && x.ref === ref);
    return list.length === 1 ? list[0].n || 0 : 0;
}

// ---- "im Bild zuweisen": the right-click menu of the map writes the tank rows ----------------------------------------------

/** A row of the board's own rows whose one assignee tanks the mob now: its mob targets become this one (its other targets stay). */
function retarget(a: RaidplanAssignment, target: RaidplanAssignTarget): RaidplanAssignment {
    return { ...a, suggested: false, targets: [...a.targets.filter((x) => x.kind !== "mob"), target] };
}

/**
 * "Tankt -> <mob>" on a player, a slot or a tank of the rows (`ref` = its assignee reference): the tank row that has him alone gets the
 * mob as its target; one he shares with others loses him and he gets a row of his own; nobody has him yet = a new row. `type` is the
 * kind of row a new one is (tank on a boss, trashtank on trash). Only the board's own rows are touched.
 */
export function tankTo(board: RaidplanBoard, ref: string, target: RaidplanAssignTarget, type: RaidplanAssignType): RaidplanBoard {
    const rows = board.assignments || [];
    const own = rows.find((a) => AUTO_TANK_TYPES.indexOf(String(a.type)) >= 0 && a.assignees.indexOf(ref) >= 0);
    if (own && own.assignees.length === 1) return { ...board, assignments: rows.map((a) => (a.id === own.id ? retarget(a, target) : a)) };
    const kept = own ? rows.map((a) => (a.id === own.id ? { ...a, suggested: false, assignees: a.assignees.filter((r) => r !== ref) } : a)) : rows;
    const row = { id: `a${Math.random().toString(36).slice(2, 9)}`, type: own ? own.type : type, title: "", spell: null, assignees: [ref], targets: [target], note: "", suggested: false, preferredClasses: [], allowOthers: false };
    return { ...board, assignments: [...kept, row] };
}

/** "Tankt nicht mehr": the assignee leaves every own tank row; a row nobody is left in goes. */
export function untank(board: RaidplanBoard, ref: string): RaidplanBoard {
    const hit = (a) => AUTO_TANK_TYPES.indexOf(String(a.type)) >= 0 && a.assignees.indexOf(ref) >= 0;
    const rows = [];
    for (const a of board.assignments || []) {
        if (!hit(a)) { rows.push(a); continue; }
        const rest = a.assignees.filter((r) => r !== ref);
        if (rest.length > 0) rows.push({ ...a, suggested: false, assignees: rest });
    }
    return { ...board, assignments: rows };
}

/** The first own tank row that names a mob instance (`m:<ref>#<n>` of the plan), or "" - "Tank wählen ..." opens it. */
export function rowOfMob(plan: AutoPlan, key: string): string {
    const t = plan.tanks.find((x) => x.mobKey === key);
    return t ? t.rowId : "";
}