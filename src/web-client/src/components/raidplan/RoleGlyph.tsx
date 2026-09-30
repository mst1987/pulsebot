import type { ReactNode } from "react";

/**
 * The one glyph of a role ("Ring und Linie", #559): the raid plan's placeholder for a whole role
 * (tank, healer, melee, ranged, unknown dps) and for a group. A dark disc, the role colour as a ring
 * and the glyph as a line in that colour; ranged keeps the double ring. Own vector paths instead of
 * WoW icons, so it stays crisp at every zoom. What a player is (class, spec) stays a WoW icon
 * elsewhere; only ROLE placeholders come here.
 *
 * `bare` draws just the line glyph, for a host that already draws the disc and the ring (the open
 * token on the map: `.rp-ico` with its dashed or double ring). Colours are tokens (`--rp-role-*`,
 * `--rp-glyph-bg`), set by the `rp-glyph-<role>` class. Small sizes (up to SMALL_PX) get a thicker line.
 */
export type GlyphRole = "tank" | "healer" | "melee" | "ranged" | "dps" | "group";

const GLYPH_ROLES: GlyphRole[] = ["tank", "healer", "melee", "ranged", "dps", "group"];

/** Up to this size (px) the line is drawn thicker and the small paths are used, so it stays crisp. */
const SMALL_PX = 32;

const SWORDS_BIG = ["M14.5 17.5 3 6V3h3l11.5 11.5", "m13 19 6-6", "m16 16 4 4", "m19 21 2-2", "M14.5 6.5 18 3h3v3l-3.5 3.5", "m5 14 4 4", "m7 17-3 3", "m3 19 2 2"];
const SWORDS_SMALL = ["M14.5 17.5 3 6V3h3l11.5 11.5", "m13 19 6-6", "M14.5 6.5 18 3h3v3l-3.5 3.5", "m5 14 4 4"];
const BOW_BIG = ["M17 3h4v4", "M18.575 11.082a13 13 0 0 1 1.048 9.027 1.17 1.17 0 0 1-1.914.597L14 17", "M7 10 3.29 6.29a1.17 1.17 0 0 1 .6-1.91 13 13 0 0 1 9.03 1.05", "M9.707 14.293 21 3", "M7 14l-4 4h2v2l4-4"];
const BOW_SMALL = ["M17 3h4v4", "M18.575 11.082a13 13 0 0 1 1.048 9.027L14 17", "M7 10 3.29 6.29a13 13 0 0 1 9.63-.86", "M9.707 14.293 21 3"];
const SHIELD = ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"];
// the healer: "Herzschlag", a heart with a pulse line through it
const HEART = ["M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z", "M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"];
const FLAME = ["M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"];
const USERS = ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"];

function pathsOf(role: GlyphRole, small: boolean): string[] {
    switch (role) {
        case "melee": return small ? SWORDS_SMALL : SWORDS_BIG;
        case "ranged": return small ? BOW_SMALL : BOW_BIG;
        case "tank": return SHIELD;
        case "healer": return HEART;
        case "group": return USERS;
        default: return FLAME;
    }
}

export default function RoleGlyph({ role, size = 24, label, bare = false, className = "" }: {
    role: GlyphRole | string;
    size?: number;
    /** the role's name for a screen reader; without it the glyph is decoration (a label sits next to it) */
    label?: string;
    bare?: boolean;
    className?: string;
}) {
    const kind: GlyphRole = (GLYPH_ROLES as string[]).includes(role) ? (role as GlyphRole) : "dps";
    const small = size <= SMALL_PX;
    const px = Math.max(6, Math.round(size));
    const line = small ? 2.6 : 2;
    const cls = `rp-glyph rp-glyph-${kind}${bare ? " is-bare" : ""}${className ? ` ${className}` : ""}`;
    const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
    const paths: ReactNode = pathsOf(kind, small).map((d) => <path key={d} d={d} />);
    if (bare) {
        return (
            <svg className={cls} width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={line} strokeLinecap="round" strokeLinejoin="round" {...a11y}>
                {paths}
            </svg>
        );
    }
    const ranged = kind === "ranged";
    const ring = small ? 1.4 : 0.95;
    const k = (small ? 0.55 : 0.5) * (ranged ? 0.88 : 1);
    return (
        <svg className={cls} width={px} height={px} viewBox="0 0 24 24" fill="none" {...a11y}>
            <circle className="rp-glyph-disc" cx="12" cy="12" r={12 - ring / 2} stroke="currentColor" strokeWidth={ring} />
            {ranged && <circle cx="12" cy="12" r={12 - ring * 2.1} stroke="currentColor" strokeWidth={ring * 0.85} />}
            <g transform={`translate(12 12) scale(${k}) translate(-12 -12)`} stroke="currentColor" strokeWidth={line} strokeLinecap="round" strokeLinejoin="round">
                {paths}
            </g>
        </svg>
    );
}
