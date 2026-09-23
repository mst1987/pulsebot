import type { RaidplanMarkName } from "../../api";

// The eight raid target marks in the game's colours. Blizzard's own textures
// (Interface\TargetingFrame\UI-RaidTargetingIcon_1..8) are not on the icon CDN
// the client uses for every other WoW icon (lib/wowIcon.ts), and nothing is
// taken from other sites' guide images, so they are drawn here — plain shapes
// with a dark outline so they read on any map.
const COLORS: Record<RaidplanMarkName, string> = {
    skull: "#f2efe6", cross: "#e5443d", square: "#3d8fe6", moon: "#d5e6f5",
    triangle: "#3ec44e", diamond: "#b04fd9", circle: "#f58a1f", star: "#f6d33c",
};

const OUTLINE = { stroke: "#0f1115", strokeWidth: 1.4, strokeLinejoin: "round" as const, paintOrder: "stroke" as const };

export function MarkIcon({ mark, size = 30 }: { mark: RaidplanMarkName; size?: number }) {
    const fill = COLORS[mark];
    let shape;
    if (mark === "star") shape = <polygon points="12,2.5 14.9,8.8 21.7,9.6 16.6,14.2 18,21 12,17.6 6,21 7.4,14.2 2.3,9.6 9.1,8.8" fill={fill} {...OUTLINE} />;
    else if (mark === "circle") shape = <circle cx="12" cy="12" r="8.6" fill={fill} {...OUTLINE} />;
    else if (mark === "diamond") shape = <polygon points="12,2.5 20.5,12 12,21.5 3.5,12" fill={fill} {...OUTLINE} />;
    else if (mark === "triangle") shape = <polygon points="12,3 21,20 3,20" fill={fill} {...OUTLINE} />;
    else if (mark === "moon") shape = <path d="M15.5 3.2a9 9 0 1 0 5.3 13.6A7.5 7.5 0 0 1 15.5 3.2z" fill={fill} {...OUTLINE} />;
    else if (mark === "square") shape = <rect x="4" y="4" width="16" height="16" rx="1.5" fill={fill} {...OUTLINE} />;
    else if (mark === "cross") {
        shape = (
            <>
                <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" stroke="#0f1115" strokeWidth="6.2" strokeLinecap="round" />
                <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" stroke={fill} strokeWidth="3.6" strokeLinecap="round" />
            </>
        );
    } else {
        shape = (
            <>
                <path d="M12 2.5c-4.7 0-8 3.1-8 7.4 0 2.4 1.1 4.1 2.7 5.2V19h3v-2h1.3v2h2v-2H14v2h3v-3.9c1.6-1.1 3-2.8 3-5.2 0-4.3-3.3-7.4-8-7.4z" fill={fill} {...OUTLINE} />
                <circle cx="8.6" cy="10.4" r="2.1" fill="#0f1115" />
                <circle cx="15.4" cy="10.4" r="2.1" fill="#0f1115" />
                <path d="M12 12.6l1.2 2.2h-2.4z" fill="#0f1115" />
            </>
        );
    }
    return <svg className="rp-mark-svg" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">{shape}</svg>;
}
