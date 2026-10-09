// Pieces both roster pages show (#654): the version line under a roster's name
// and its main Discord role as a chip. Styles in styles/rosters.css.
import type { CSSProperties } from "react";
import type { RosterHead } from "../../api";
import { useT } from "../../i18n";

/** The version dot and the line under a roster's name: version · raids. */
export function VersionLine({ versionId, parts }: { versionId: string; parts: string[] }) {
    return (
        <span className="rn-ver">
            <i className={`ver-dot ver-${versionId}`} aria-hidden="true" />
            {parts.filter(Boolean).join(" · ")}
        </span>
    );
}

/** The roster's main Discord role as a chip in the role's colour. */
export function RoleChip({ role }: { role: RosterHead["mainRole"] }) {
    const t = useT();
    if (!role) {
        return <span className="rn-role rn-role-none" data-tip={t("roster.overview.noRole")} data-tip-sub={t("roster.overview.noRoleSub")}><i />{t("roster.overview.noRole")}</span>;
    }
    return (
        <span className="rn-role" style={{ "--rc": role.color || "var(--muted)" } as CSSProperties}>
            <i />@{role.name || role.id}
        </span>
    );
}
