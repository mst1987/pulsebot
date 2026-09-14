import type { ReactNode } from "react";
import WowIcon from "./WowIcon";

// The rounded tile an icon sits on in a head: 48 px in the page head, 34 px in a
// part head. Its tint is the section's --area-* colour or a result tone.
//
// The class is `.itile`, not `.tile`: in the SPA `.tile` is the dashboard's stat
// tile, and reusing the name would restyle every figure on the start page.

export type TileTone =
    | "home" | "recruitment" | "cla" | "raids" | "roster" | "history" | "lootcouncil" | "channels" | "settings"
    | "ok" | "mid" | "bad" | "none";

export default function IconTile({ icon, tone, size = "md" }: {
    /** A WoW icon name, or a line icon node. */
    icon: string | ReactNode;
    tone?: TileTone;
    size?: "md" | "lg";
}) {
    return (
        <span className={["itile", size === "lg" ? "lg" : "", tone ? `t-${tone}` : ""].filter(Boolean).join(" ")} aria-hidden="true">
            {typeof icon === "string" ? <WowIcon name={icon} size={size === "lg" ? 32 : 22} /> : icon}
        </span>
    );
}
