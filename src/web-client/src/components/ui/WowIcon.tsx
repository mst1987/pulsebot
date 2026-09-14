import { useState } from "react";
import { FALLBACK_ICON, wowIconUrl } from "../../lib/wowIcon";

// A WoW icon from the zamimg CDN — the standard icon wherever something has a
// game meaning (a menu section, an action, a boss). Decorative by design: the
// label next to it carries the meaning, so alt stays empty. A name the CDN does
// not know falls back to the question mark instead of a broken image.
export default function WowIcon({ name, size = 18, className = "" }: {
    name: string;
    size?: number;
    className?: string;
}) {
    const [failed, setFailed] = useState(false);
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
