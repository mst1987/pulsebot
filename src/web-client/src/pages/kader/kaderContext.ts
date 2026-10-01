// What every part of the Kaderplaner reads: the view model, the chosen Kader and
// the actions that change them (KaderPage.tsx provides it), and the live half:
// who else is in this Kader right now and what a part has open.
import { createContext, useContext, useEffect } from "react";
import type { ApiError, KaderData, KaderPlayer, KaderPresence, KaderPresenceWhat, KaderView } from "../../api";

/** The pages of one Kader, as they stand in the address (/kader/<id>/<sub>). */
export type KaderSub = "pool" | "vorauswahl" | "uebersicht" | "roster" | "fragen" | "setups";
export const SUBS: KaderSub[] = ["pool", "vorauswahl", "uebersicht", "roster", "fragen", "setups"];

export type KaderModal =
    | { type: "account"; userId: string }
    | { type: "import" }
    | { type: "addById" }
    | { type: "settings" }
    | { type: "create" }
    | { type: "activity" }
    | null;

/** What a part of the page has open with a player — reported with the live poll, so the others see it. */
export type KaderFocus = { playerId: string; what: KaderPresenceWhat; edit: boolean };
/** Who reports: the open view (interview, drawer) or a dialog on top of it (the account dialog wins). */
export type KaderFocusSource = "view" | "dialog";
/** `onError` handles a refusal itself (true = handled, no toast) — a 409 `stale` the part answers with its own choice. */
export type KaderRunOptions = { onError?: (e: ApiError) => boolean };

export type KaderCtx = {
    view: KaderView;
    kader: KaderData;
    players: Map<string, KaderPlayer>;
    /** May change things (area "kader" at write level). */
    canWrite: boolean;
    /** The signed-in account. */
    me: string;
    /** Whether the signed-in account leads this Kader (only leads vote). */
    isLead: boolean;
    /** Runs a change, swaps its answer in; a failure is a toast (unless `onError` handles it). Resolves to the answer or null. */
    run: <T>(call: Promise<T>, options?: KaderRunOptions) => Promise<T | null>;
    open: (modal: KaderModal) => void;
    /** Goes to another page of this Kader, with an optional query ("?spieler=<id>"). */
    go: (sub: KaderSub, search?: string) => void;
    /** Everybody else in this Kader right now (the live poll), with what they have open. */
    presence: KaderPresence[];
    /** A part reports what it has open, null when it closes it (useReportFocus). */
    focus: (source: KaderFocusSource, focus: KaderFocus | null) => void;
    /** Fetches the open Kader again now (after a save was refused as stale); `whole` = the whole view (character data). */
    refresh: (whole?: boolean) => Promise<void>;
};

export const KaderContext = createContext<KaderCtx | null>(null);

export function useKader(): KaderCtx {
    const v = useContext(KaderContext);
    if (!v) throw new Error("useKader outside of KaderPage");
    return v;
}

/** Reports what this part has open while it is mounted (`null` = nothing): the others see a marker on that player. */
export function useReportFocus(source: KaderFocusSource, focus: KaderFocus | null): void {
    const { focus: report } = useKader();
    const key = focus ? `${focus.playerId}|${focus.what}|${focus.edit}` : "";
    useEffect(() => {
        report(source, focus);
        return () => report(source, null);
        // the key is the focus; the object itself is new on every render
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [report, source, key]);
}
