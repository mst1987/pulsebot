// Shared class/spec rendering for loot characters — ported from
// renderAdmin.js's classSpecCell()/charLink()/charClassSuffix()/specIcon().
// Colour and icon URL always come from the API response (never recomputed
// client-side — same rule the app already follows for the recruitment spec
// catalog, see lib/recruitmentSpecs.ts's header comment).
import { Link } from "react-router-dom";

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
    return (
        <span style={{ fontWeight: 700, color: classColor || undefined }}>
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
    return (
        <Link className="mlink" to={`/history/char?name=${encodeURIComponent(character)}`} style={{ color: classColor || undefined }}>
            {character}
        </Link>
    );
}
