import type { CSSProperties } from "react";
import type { AbsenceIdentity } from "../../api";
import { classColorProps } from "../../components/character/ClassSpec";
import { wowIconUrl } from "../../lib/wow/wowIcon";
import { displayName } from "../../lib/roster/absences";

// Small pieces the three views of Roster › Abwesenheiten share: the spec icon on
// a tile tinted in the class colour (like the setup editor's SpecTile, its
// colour as --cc), and a raider's name in class colour with what they play.

const PX = { sm: 18, md: 24, lg: 34 } as const;

export function AbSpec({ who, size = "md" }: { who: Pick<AbsenceIdentity, "specIcon" | "classColor">; size?: "sm" | "md" | "lg" }) {
    const style = (who.classColor ? { "--cc": who.classColor } : undefined) as CSSProperties | undefined;
    return (
        <span className={`ab-spec ab-spec-${size}`} style={style} aria-hidden="true">
            {who.specIcon ? <img src={wowIconUrl(who.specIcon, PX[size])} alt="" loading="lazy" /> : <span className="ab-spec-ph" />}
        </span>
    );
}

export function ClassName({ who, className = "" }: { who: Pick<AbsenceIdentity, "character" | "name" | "classColor">; className?: string }) {
    const colored = classColorProps(who.classColor);
    return (
        <span className={[className, colored.className || ""].filter(Boolean).join(" ")} style={colored.style}>
            {displayName(who)}
        </span>
    );
}
