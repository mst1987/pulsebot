// What every part of the Kaderplaner reads: the view model, the chosen roster
// and the actions that change them (KaderPage.tsx provides it).
import { createContext, useContext } from "react";
import type { KaderPlace, KaderPlayer, KaderRole, KaderRoster, KaderView } from "../../api";

export type KaderModal =
    | { type: "account"; userId: string }
    | { type: "add" }
    | { type: "roster"; mode: "new" | "edit" }
    | { type: "picker"; role: KaderRole }
    | null;

export type KaderCtx = {
    view: KaderView;
    roster: KaderRoster | null;
    players: Map<string, KaderPlayer>;
    /** May change things (area "kader" at write level). */
    canWrite: boolean;
    selectRoster: (id: string) => void;
    /** Runs a write, swaps in the view it answers with; a failure is a toast. Resolves to the new view or null. */
    run: (call: Promise<KaderView>) => Promise<KaderView | null>;
    /** Puts a player into the chosen roster (by the natural role unless one is given), onto its bench or out. */
    place: (userId: string, to: KaderPlace, role?: KaderRole) => Promise<void>;
    open: (modal: KaderModal) => void;
};

export const KaderContext = createContext<KaderCtx | null>(null);

export function useKader(): KaderCtx {
    const v = useContext(KaderContext);
    if (!v) throw new Error("useKader outside of KaderPage");
    return v;
}
