// Shared class/spec rendering for loot characters — ported from
// renderAdmin.js's classSpecCell()/charLink()/charClassSuffix()/specIcon().
// Colour and icon URL always come from the API response (never recomputed
// client-side — same rule the app already follows for the recruitment spec
// catalog, see lib/recruitmentSpecs.ts's header comment).
import { Link } from "react-router-dom";

// Where a stored class/spec came from, so a wrong entry can be traced back —
// mirrors renderAdmin.js's CLASS_SOURCE_LABELS. Shared by the Charaktere table
// and the character page's hero.
export const CLASS_SOURCE_LABELS: Record<string, string> = {
    export: "Loot-Export",
    report: "Auswertung",
    wcl: "Warcraft Log",
    manual: "manuell",
};

/**
 * How a class colour is applied to text. Not as `color:` directly: WoW's
 * palette is built for a black game UI, and Priest white / Rogue yellow are
 * invisible on the light theme's white panels. Handing the colour over as the
 * custom property `--cc` lets the stylesheet decide what to do with it per
 * theme (see .class-colored in index.css, which darkens it for light mode).
 * Returns nothing when the class is unknown, so the element keeps whatever
 * colour it had (a link stays accent-coloured).
 */
export function classColorProps(classColor?: string): { className?: string; style?: React.CSSProperties } {
    if (!classColor) return {};
    return { className: "class-colored", style: { "--cc": classColor } as React.CSSProperties };
}

export function ClassSpecIcon({ iconUrl }: { iconUrl: string }) {
    if (!iconUrl) return null;
    return (
        <img
            src={iconUrl}
            alt=""
            width={18}
            height={18}
            style={{ borderRadius: 4, verticalAlign: "-4px", marginRight: 6 }}
        />
    );
}

export function ClassSpecLabel({ className, spec, classColor }: { className: string; spec: string; classColor?: string }) {
    const colored = classColorProps(classColor);
    return (
        <span className={colored.className} style={{ fontWeight: 700, ...colored.style }}>
            {spec ? `${spec} ${className}` : className}
        </span>
    );
}

// Table cell: a dash when the class is unknown, else icon + coloured label.
export function ClassSpecCell({ className, spec, classColor, iconUrl }: {
    className: string;
    spec: string;
    classColor?: string;
    iconUrl?: string;
}) {
    if (!className) return <span className="sub">—</span>;
    return (
        <>
            <ClassSpecIcon iconUrl={iconUrl || ""} />
            <ClassSpecLabel className={className} spec={spec} classColor={classColor} />
        </>
    );
}

// A character's name linking to their history page, class-coloured when known.
export function CharacterLink({ character, classColor }: { character: string; classColor?: string }) {
    const colored = classColorProps(classColor);
    return (
        <Link className={`mlink${colored.className ? ` ${colored.className}` : ""}`} to={`/history/char?name=${encodeURIComponent(character)}`} style={colored.style}>
            {character}
        </Link>
    );
}
