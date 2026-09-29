import Segment from "./Segment";
import type { VersionChoice } from "../../api/raidTemplates";
import { useT } from "../../i18n";

// The compact version switch every list that mixes game versions shows
// (#545): one option per version this list has rows of (plus the main
// version even with none — see api/raidTemplates.ts VersionChoice), each
// labelled "<short> · <count>", and "Alle" to lift the filter. First built for
// the roster and the loot history's "Charaktere" tab (#543); every other list
// that mixes versions (Raids, Vorlagen, Loot-Council, Dashboard) reuses it.
//
// Renders nothing with one or fewer choices — a switch with a single option
// filters nothing, so the control simply stays away instead of a Segment of
// one. Persisting the choice and resolving what "" means (the main version,
// unless the caller asks for something else) is the caller's job — this
// component only draws the options it is handed and reports a click.
export default function VersionFilter({ versions, value, onChange, ariaLabel, allTip, size = "sm" }: {
    versions: VersionChoice[];
    /** The version id currently shown, or "all". */
    value: string;
    /** A version id, or "all". */
    onChange: (value: string) => void;
    ariaLabel: string;
    /** A tooltip for the "Alle" option — the roster explains what it means for attendance. */
    allTip?: string;
    size?: "md" | "sm";
}) {
    const t = useT();
    if (versions.length <= 1) return null;
    return (
        <Segment<string>
            size={size}
            ariaLabel={ariaLabel}
            value={value}
            onChange={onChange}
            options={[
                ...versions.map((v) => ({ value: v.id, label: v.count === undefined ? v.short : `${v.short} · ${v.count}`, tip: v.label })),
                { value: "all", label: t("common.all"), tip: allTip },
            ]}
        />
    );
}
