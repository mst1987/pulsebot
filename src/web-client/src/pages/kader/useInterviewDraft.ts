// The draft of one interview while it is open (docs/kaderplaner.md, "Live"):
// what is typed stays local and saves itself SAVE_DELAY after the last change
// (only what changed, lib/kader/interview.ts patchOf), when another player is
// chosen and when the page is left.
//
// The draft knows the entry it started from (`base`) and sends that entry's
// revision with every save. When somebody else changed the interview:
// - nothing unsaved here: the draft simply takes their version (seen live);
// - unsaved input here (seen live, or a save answered 409 `stale`): the input
//   stays, autosave pauses and `conflict` names who changed it — "Neu laden"
//   (takeTheirs) takes their version, "Trotzdem speichern" (keepMine) saves
//   this draft over it. No loop: nothing saves by itself until one is chosen.
import { useCallback, useEffect, useRef, useState } from "react";
import { isStale, saveKaderInterview, type KaderChange, type KaderEntry, type KaderStaleError } from "../../api";
import { draftOf, patchOf, type InterviewDraft } from "../../lib/kader/interview";
import type { KaderRunOptions } from "./kaderContext";

export const SAVE_DELAY = 800;

export type InterviewConflict = { by: string };
type Run = <T>(call: Promise<T>, options?: KaderRunOptions) => Promise<T | null>;

const revOf = (e: KaderEntry): number => e.interview.rev || 0;

export function useInterviewDraft({ kaderId, userId, entry, run, refresh, onLost }: {
    kaderId: string;
    userId: string;
    entry: KaderEntry;
    run: Run;
    refresh: () => Promise<void>;
    /** The panel closes with input that could not be saved (a conflict nobody decided). */
    onLost: () => void;
}) {
    const [draft, setDraftState] = useState<InterviewDraft>(() => draftOf(entry));
    const [base, setBaseState] = useState<KaderEntry>(entry);
    const [conflict, setConflictState] = useState<InterviewConflict | null>(null);
    const [saving, setSaving] = useState(false);
    // the newest values for callbacks that outlive a render (the timer, the unmount)
    const draftRef = useRef(draft);
    const baseRef = useRef(base);
    const conflictRef = useRef(conflict);
    const entryRef = useRef(entry);
    const savingRef = useRef(false);
    const timer = useRef(0);
    const lostRef = useRef(onLost);
    lostRef.current = onLost;

    const setDraft = (next: InterviewDraft) => { draftRef.current = next; setDraftState(next); };
    const setBase = (next: KaderEntry) => { baseRef.current = next; setBaseState(next); };
    const setConflict = (next: InterviewConflict | null) => { conflictRef.current = next; setConflictState(next); };

    /** The entry as the page has it now, against the draft: take it over, or hold the input and ask. */
    const sync = useCallback(() => {
        if (savingRef.current) return;
        const now = entryRef.current;
        const was = baseRef.current;
        // an answer older than what this draft knows (a refetch that started before an own save) changes nothing
        if (revOf(now) < revOf(was)) return;
        if (revOf(now) === revOf(was)) {
            // the interview itself did not change (a move, a vote, a comment): only the rest of the entry is newer
            setBase(now);
            return;
        }
        if (!patchOf(draftRef.current, was)) {
            setDraft(draftOf(now));
            setBase(now);
            setConflict(null);
            return;
        }
        if (!conflictRef.current) setConflict({ by: now.interview.updatedBy });
    }, []);

    useEffect(() => {
        entryRef.current = entry;
        sync();
    }, [entry, sync]);

    /**
     * Saves what the draft changes. Without `force` against the base it started from (refused while a conflict
     * waits); with `force` against the newest version, overwriting it. Resolves to whether everything is saved.
     */
    const save = useCallback(async (force = false): Promise<boolean> => {
        window.clearTimeout(timer.current);
        if (conflictRef.current && !force) return false;
        const against = force ? entryRef.current : baseRef.current;
        const patch = patchOf(draftRef.current, against);
        if (!patch) {
            if (force) {
                setBase(entryRef.current);
                setConflict(null);
            }
            return true;
        }
        const caught: { stale?: KaderStaleError } = {};
        savingRef.current = true;
        setSaving(true);
        const result: KaderChange | null = await run(saveKaderInterview(kaderId, userId, patch, { baseRev: revOf(against), ...(force ? { force: true } : {}) }), {
            onError: (e) => {
                if (!isStale(e)) return false;
                caught.stale = e;
                return true;
            },
        });
        savingRef.current = false;
        setSaving(false);
        if (caught.stale) {
            setConflict({ by: caught.stale.by || "" });
            void refresh();
            return false;
        }
        if (!result) return false;
        const saved = result.kader ? result.kader.players[userId] : undefined;
        if (saved) {
            setBase(saved);
            // the page may not have drawn the answer yet: what it has is at least this
            if (revOf(saved) >= revOf(entryRef.current)) entryRef.current = saved;
        }
        setConflict(null);
        // somebody may have saved after this one went out: the entry the page has now decides
        sync();
        return true;
    }, [run, refresh, kaderId, userId, sync]);

    const saveRef = useRef(save);
    saveRef.current = save;

    /** A change of the draft; it saves itself SAVE_DELAY later — unless a conflict waits for a decision. */
    const change = (next: InterviewDraft) => {
        setDraft(next);
        window.clearTimeout(timer.current);
        if (conflictRef.current) return;
        timer.current = window.setTimeout(() => void saveRef.current(), SAVE_DELAY);
    };

    /** "Neu laden": the other version wins, the input here is dropped. */
    const takeTheirs = () => {
        window.clearTimeout(timer.current);
        setDraft(draftOf(entryRef.current));
        setBase(entryRef.current);
        setConflict(null);
    };

    // whatever is still unsaved goes out when the player changes or the page closes; with a conflict nothing
    // can go out unasked — the panel says the input was not saved
    useEffect(() => () => {
        window.clearTimeout(timer.current);
        if (conflictRef.current) {
            if (patchOf(draftRef.current, baseRef.current)) lostRef.current();
            return;
        }
        void saveRef.current();
    }, []);
    useEffect(() => {
        const warn = (e: BeforeUnloadEvent) => {
            if (!patchOf(draftRef.current, baseRef.current)) return;
            if (!conflictRef.current) void saveRef.current();
            e.preventDefault();
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, []);

    return {
        draft,
        change,
        save: () => save(false),
        keepMine: () => save(true),
        takeTheirs,
        saving,
        conflict,
        dirty: !!patchOf(draft, base),
    };
}
