// Item quality → the colour WoW paints an item's name in. One place for it, so
// a looted item reads the same in the loot tables, the hover previews and the
// character paperdoll instead of each view owning its own palette (same rule as
// ClassSpec.tsx's class colours).
//
// Two shapes reach the client and both are accepted here:
//   - a number  — Wowhead's 0-7 scale, stored on imported loot rows
//                 (utils/lootImport.js's enrichItemNames),
//   - a string  — Blizzard's "EPIC"/"RARE"/… from the armoury gear endpoint.
// Anything else (an item Wowhead never resolved) is "unknown" and keeps the
// default text colour rather than being guessed into a rarity.

import type React from "react";

export type ItemQuality = number | string | null | undefined;

// Poor/Common map to theme colours, not the game's raw grey/white — those read
// fine on WoW's always-dark UI, but a literal #ffffff is invisible against this
// app's light-theme white panels.
const QUALITY_COLOR: Record<string, string> = {
    POOR: "var(--muted)", COMMON: "var(--text)", UNCOMMON: "#1eff00", RARE: "#0070dd",
    EPIC: "#a335ee", LEGENDARY: "#ff8000", ARTIFACT: "#e6cc80", HEIRLOOM: "#00ccff",
};

// Wowhead's numeric scale, in order.
const BY_NUMBER = ["POOR", "COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY", "ARTIFACT", "HEIRLOOM"];

/** "EPIC", "RARE", … — "" when the quality is unknown or unrecognised. */
export function qualityName(quality: ItemQuality): string {
    if (typeof quality === "number") return BY_NUMBER[quality] || "";
    const name = String(quality || "").trim().toUpperCase();
    return QUALITY_COLOR[name] ? name : "";
}

/** The raw colour for a quality, "" when unknown (e.g. for an icon border). */
export function itemQualityColor(quality: ItemQuality): string {
    const name = qualityName(quality);
    return name ? QUALITY_COLOR[name] : "";
}

/**
 * Props for any element showing an item name: hands the colour to the DOM as
 * the `--iq` custom property so `.item-quality` can darken it for the light
 * theme (uncommon green and legendary orange wash out on white otherwise) —
 * same mechanism as classColorProps()'s `--cc`. `baseClass` is the caller's own
 * class ("mlink" on a Wowhead link, "loot-pop-name" in a hover row); an unknown
 * quality adds nothing, so the name keeps the surrounding text colour.
 */
export function itemQualityProps(quality: ItemQuality, baseClass = ""): { className?: string; style?: React.CSSProperties } {
    const color = itemQualityColor(quality);
    const className = [baseClass, color ? "item-quality" : ""].filter(Boolean).join(" ");
    return {
        ...(className ? { className } : {}),
        ...(color ? { style: { "--iq": color } as React.CSSProperties } : {}),
    };
}
