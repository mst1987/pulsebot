import { useState } from "react";
import { FALLBACK_ICON, wowIconUrl } from "../../lib/wow/wowIcon";
import { isUiIcon } from "../../lib/ui/iconSet";
import Icon from "./Icon";

// A WoW icon from the zamimg CDN — the icon for game content (a boss, an item,
// a class, a spec, a role). Decorative by design: the label next to it carries
// the meaning, so alt stays empty. A name the CDN does not know falls back to
// the question mark instead of a broken image.
//
// It is also the one switch between the two icon worlds (#951): a key of the
// app's own set (lib/ui/iconSet.ts — "raids", "settings", "warcraftLogs" …)
// draws the set's <Icon/> instead, so every building block that takes an icon
// name (Button, IconTile, Badge, SectionRail …) accepts both.
//
// A local path ("/versions/classic.png" - a game version's launcher icon) is
// drawn as it is: a plain image of at most 48 px (the files' own size), no
// zamimg frame, no rounded crop, no tint. Its alt text names it, but the
// label next to it carries the meaning, so it stays hidden from screen readers.
export const LOCAL_ICON_MAX = 48;

export default function WowIcon({ name, size = 18, className = "", alt = "" }: {
    name: string;
    size?: number;
    className?: string;
    /** Only for a local image: the alt text (the version's label). */
    alt?: string;
}) {
    const [failed, setFailed] = useState(false);
    if (isUiIcon(name)) return <Icon name={name} size={size} className={className} />;
    if (name.startsWith("/")) {
        const px = Math.min(size, LOCAL_ICON_MAX);
        return <img className={`ver-img${className ? ` ${className}` : ""}`} src={name} width={px} height={px} alt={alt} aria-hidden="true" draggable={false} />;
    }
    const src = wowIconUrl(failed ? FALLBACK_ICON : name, size);
    return (
        <img
            className={`wi${className ? ` ${className}` : ""}`}
            src={src}
            width={size}
            height={size}
            alt=""
            loading="lazy"
            onError={() => { if (!failed) setFailed(true); }}
        />
    );
}
