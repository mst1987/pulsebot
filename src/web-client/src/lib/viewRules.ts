// What is drawn on a board and for whom (pure, tested in test/web-client/viewRules.test.js): the plan's own switches, the switch of one object and what one
// viewer chose for himself. The plan says what everybody sees; a viewer can only hide more, never show what the plan hides.
// Written with function declarations and one-line signatures only.

export type ViewPrefs = { highlight: boolean; selection: boolean; links: boolean; names: boolean; roleRings: boolean; groupRings: boolean };

export const DEFAULT_PREFS = { highlight: true, selection: true, links: true, names: true, roleRings: true, groupRings: true };

/** The remembered preferences of a viewer from the stored text: every key that is not a real boolean falls back to on. */
export function parsePrefs(raw: string | null): ViewPrefs {
    let o = {};
    try { o = raw ? JSON.parse(raw) : {}; } catch { o = {}; }
    const out = { ...DEFAULT_PREFS };
    for (const k of Object.keys(DEFAULT_PREFS)) if (o && typeof o[k] === "boolean") out[k] = o[k];
    return out;
}

/** A switch of the plan combined with a switch of the viewer: shown only when neither hides it (a plan without the field shows it). */
export function shownFor(planFlag: boolean | undefined, viewerFlag: boolean): boolean {
    return planFlag !== false && viewerFlag;
}

/** Whether the ring round one object is drawn: the board's role rings and the object's own switch (both default on). */
export function ringShownFor(boardRoleRings: boolean | undefined, objectRing: boolean | undefined): boolean {
    return boardRoleRings !== false && objectRing !== false;
}

/** Whether the frame and the grips of the selection are drawn: only in an editor, only for a selected object, and only when the viewer did not switch it off. */
export function selectionDrawn(editable: boolean, selected: boolean, viewerFlag: boolean): boolean {
    return editable && selected && viewerFlag;
}
