

export type View = {
    role: string;
    tiers: string[];
    contents: string[];
    category: string;
    bisTier: string;
    /** "drop" is a stored value from before the drop check became its own page; it opens the Raider tab. */
    tab: "roster" | "bis" | "drop" | "bislists" | "compare";
    /** BiS-Listen: which tier's sets, which specs are switched off, what is marked. */
    listTier: string;
    listOff: string[];
    listFocus: number;
    /** Loot-Vergleich: which raiders (by key) are switched off. */
    cmpOff: string[];
};
