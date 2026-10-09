

export type View = {
    role: string;
    tiers: string[];
    contents: string[];
    category: string;
    /** The roster the council works for (#676) — wins over `category`; "" = none picked. */
    roster?: string;
    bisTier: string;
    /** With a roster: Ersatz shown as candidates too (#667) — this browser's own, never stored for the game. */
    bench?: boolean;
    /**
     * "drop" is a stored value from before the drop check became its own page;
     * it opens the Raider tab. "weights" is the tab before it became "profiles" (#676).
     */
    tab: "roster" | "bis" | "drop" | "bislists" | "compare" | "weights" | "profiles";
    /** BiS-Listen: which tier's sets, which specs are switched off, what is marked. */
    listTier: string;
    listOff: string[];
    listFocus: number;
    /** Loot-Vergleich: which raiders (by key) are switched off. */
    cmpOff: string[];
};
