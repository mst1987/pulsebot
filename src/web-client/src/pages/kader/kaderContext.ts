// What every part of the Kaderplaner reads: the view model, the chosen Kader and
// the actions that change them (KaderPage.tsx provides it).
import { createContext, useContext } from "react";
import type { KaderData, KaderPlayer, KaderView } from "../../api";

/** The pages of one Kader, as they stand in the address (/kader/<id>/<sub>). */
export type KaderSub = "pool" | "vorauswahl" | "uebersicht" | "roster" | "fragen" | "setups";
export const SUBS: KaderSub[] = ["pool", "vorauswahl", "uebersicht", "roster", "fragen", "setups"];

export type KaderModal =
    | { type: "account"; userId: string }
    | { type: "import" }
    | { type: "addById" }
    | { type: "settings" }
    | { type: "create" }
    | null;

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
    /** Runs a change, swaps its answer in; a failure is a toast. Resolves to the answer or null. */
    run: <T>(call: Promise<T>) => Promise<T | null>;
    open: (modal: KaderModal) => void;
    /** Goes to another page of this Kader, with an optional query ("?spieler=<id>"). */
    go: (sub: KaderSub, search?: string) => void;
};

export const KaderContext = createContext<KaderCtx | null>(null);

export function useKader(): KaderCtx {
    const v = useContext(KaderContext);
    if (!v) throw new Error("useKader outside of KaderPage");
    return v;
}
