import type { CSSProperties } from "react";

/**
 * A spec icon on a tile tinted in the class colour. The colour goes in as --cc,
 * so the stylesheet can mix the tint per theme (see .rd-spec in raid-detail.css).
 */
export default function SpecTile({ iconUrl, classColor, size = "md" }: { iconUrl?: string; classColor?: string; size?: "sm" | "md" | "lg" }) {
    const style = (classColor ? { "--cc": classColor } : undefined) as CSSProperties | undefined;
    return (
        <span className={`rd-spec rd-spec-${size}`} style={style} aria-hidden="true">
            {iconUrl ? <img src={iconUrl} alt="" loading="lazy" /> : <span className="rd-spec-ph" />}
        </span>
    );
}
