import type { RaidplanBoard, RaidplanPlayer, RaidplanSlot, RaidplanSlotKind, RaidplanRosterSource } from "../../api";
import { t } from "../../i18n";
import { objectPoint } from "./geometry";
import { clamp01, newLook, SIZE_RANGES } from "./model";

// ---- who stands where ------------------------------------------------------------------

/**
 * Everyone who has a place of his own on the board: a free token, or a role slot that stands ON THE MAP (one that is only in the Besetzung bar,
 * placed: false, does not count). A member of a group who is in here is not shown again in his group (ring or name list).
 */
export function ownPlaceIds(board: RaidplanBoard): Set<string> {
    // a raider the tank rows put on the map (lib/raidplan/autoPlace.ts) has a place of his own too
    const ids = new Set([...board.tokens.map((x) => x.userId), ...(board.autoUsers || [])]);
    for (const s of board.slots) if (s.userId && s.placed !== false) ids.add(s.userId);
    return ids;
}

/** The raiders of a group marker that stand around it as tokens: its setup group, minus anyone who has a place of his own on the board (his group ring closes up). */
export function splitMembers(board: RaidplanBoard, slot: RaidplanSlot, roster: RaidplanPlayer[]): RaidplanPlayer[] {
    if (slot.kind !== "group" || !slot.split || slot.hideMembers) return [];
    const own = ownPlaceIds(board);
    return roster.filter((p) => p.group === slot.n && !own.has(p.userId));
}

/** The names a group marker that is NOT split lists ("Raider anzeigen"): its setup group minus anyone who has a place of his own. */
export function groupListMembers(board: RaidplanBoard, slot: RaidplanSlot, roster: RaidplanPlayer[]): RaidplanPlayer[] {
    if (slot.kind !== "group" || slot.hideMembers || slot.split) return [];
    const own = ownPlaceIds(board);
    return roster.filter((p) => p.group === slot.n && !own.has(p.userId));
}

/** The group number a player who stands on his own still carries as a badge: that of a split group marker of the board he belongs to, else 0. */
export function ownBadgeGroup(board: RaidplanBoard, player: RaidplanPlayer): number {
    return board.slots.some((s) => s.kind === "group" && s.split && !s.hideMembers && s.n === player.group && s.placed !== false) ? player.group : 0;
}

/** "Aus Gruppe herausnehmen": a raider of a split group becomes a free token where he stands now (his setup group stays, so assignments and the badge keep it). "Zurück in die Gruppe" is removing that token. */
export function takeOutOfGroup(board: RaidplanBoard, memberKey: string, at: { x: number; y: number } | null): RaidplanBoard {
    const ref = parseMemberId(memberKey);
    const spot = objectPoint(board, "member", memberKey) || at;
    if (!spot || !ref.userId) return board;
    return placeToken(board, ref.userId, spot.x, spot.y);
}

/** Everyone who already stands somewhere on the board: a free token, a slot, or a group that is split around its marker. */
export function placedIds(board: RaidplanBoard, roster: RaidplanPlayer[] = []): Set<string> {
    const ids = new Set([...board.tokens.map((x) => x.userId), ...(board.autoUsers || [])]);
    for (const s of board.slots) if (s.userId && s.placed !== false) ids.add(s.userId);
    for (const s of board.slots) for (const p of splitMembers(board, s, roster)) ids.add(p.userId);
    return ids;
}

/** The players of the roster who stand nowhere on this board yet, in setup order. */
export function unplaced(roster: RaidplanPlayer[], board: RaidplanBoard): RaidplanPlayer[] {
    const placed = placedIds(board, roster);
    return roster.filter((p) => !placed.has(p.userId));
}

/** Puts a free token on the board at x/y (0..1): a new one, or the moved existing one. The player leaves any slot. */
export function placeToken(board: RaidplanBoard, userId: string, x: number, y: number): RaidplanBoard {
    const old = board.tokens.find((k) => k.userId === userId);
    const token = { ...(old || { ...newLook(1), size: SIZE_RANGES.token.def }), userId, x: clamp01(x), y: clamp01(y) };
    return {
        ...board,
        slots: board.slots.map((s) => (s.userId === userId ? { ...s, userId: "" } : s)),
        tokens: old ? board.tokens.map((k) => (k.userId === userId ? token : k)) : [...board.tokens, token],
    };
}

/** Takes a free token off the board (the player is "not placed" again). Target rows keep their assignment. */
export function removeToken(board: RaidplanBoard, userId: string): RaidplanBoard {
    return { ...board, tokens: board.tokens.filter((k) => k.userId !== userId) };
}

/** Puts a player into a slot ("" = clears it). A player stands in one place: they leave their free token and any other slot. */
export function assignSlot(board: RaidplanBoard, slotId: string, userId: string): RaidplanBoard {
    return {
        ...board,
        tokens: userId ? board.tokens.filter((k) => k.userId !== userId) : board.tokens,
        slots: board.slots.map((s) => {
            if (s.id === slotId) return { ...s, userId };
            return userId && s.userId === userId ? { ...s, userId: "" } : s;
        }),
    };
}

/** The next free number for a kind: tank 1, tank 2 … */
export function nextSlotNumber(board: RaidplanBoard, kind: RaidplanSlotKind): number {
    let max = 0;
    for (const s of board.slots) if (s.kind === kind && s.n > max) max = s.n;
    return max + 1;
}

/** The id of a raider standing around a split group marker: "<slot id>~<user id>". */
export function memberId(slotId: string, userId: string): string {
    return `${slotId}~${userId}`;
}

export function parseMemberId(id: string): { slotId: string; userId: string } {
    const at = id.indexOf("~");
    return at < 0 ? { slotId: id, userId: "" } : { slotId: id.slice(0, at), userId: id.slice(at + 1) };
}

/** Players by userId, for looking up who a token or an assignment is. */
export function rosterMap(roster: RaidplanPlayer[]): Map<string, RaidplanPlayer> {
    return new Map(roster.map((p) => [p.userId, p]));
}

/**
 * What a Raid-Helper raider's tooltip adds (docs/raidplan.md, "Raid-Helper-Events"): the name Raid-Helper shows when the chip shows
 * his character ("Raid-Helper: Nick"), "Name aus Raid-Helper" when no profile character was found, "nicht mehr im Setup" when
 * Raid-Helper no longer lists him. "" for everybody else (an own event's raiders).
 */
export function rhNote(p: RaidplanPlayer): string {
    const parts = [];
    if (p.gone) parts.push(t("raidBoard.rh.goneMark"));
    if (p.nameFromRh) parts.push(t("raidBoard.rh.nameFromRh"));
    else if (p.rhName && p.rhName !== p.character) parts.push(t("raidBoard.rh.rhName", { name: p.rhName }));
    return parts.join(" · ");
}

/**
 * What the head of a Raid-Helper event's plan says about its players (docs/raidplan.md, "Raid-Helper-Events"): where they come from,
 * the warnings (stale / not available / no groups) and the small notes (names not matched, unknown specs, raiders no longer listed).
 */
export function rhSourceText(src: RaidplanRosterSource): { main: string; warns: string[]; notes: string[] } {
    const warns = [];
    const notes = [];
    const main = src.lineupSource === "signups" ? t("raidBoard.rh.sourceSignups") : t("raidBoard.rh.source");
    if (!src.available) warns.push(src.disabled ? t("raidBoard.rh.stale.disabled") : t("raidBoard.rh.unavailable"));
    else if (src.stale) {
        const why = src.disabled ? "disabled" : src.origin === "snapshot" ? "snapshot" : src.origin === "saved" ? "saved" : "last";
        warns.push(`${t(`raidBoard.rh.stale.${why}`)} ${t("raidBoard.rh.stale.keep")}`);
    }
    if (src.available && !src.hasGroups) warns.push(t("raidBoard.rh.noGroups"));
    if (src.unmatchedNames > 0) notes.push(t("raidBoard.rh.unmatched", { count: src.unmatchedNames }));
    if (src.unknown.length > 0) notes.push(t("raidBoard.rh.unknown", { count: src.unknown.length, names: [...new Set(src.unknown)].join(", ") }));
    if (src.goneCount > 0) notes.push(t("raidBoard.rh.gone", { count: src.goneCount }));
    return { main, warns, notes };
}
