// Small pieces the start page and its raid-details modal share.
import type { DashboardRole } from "../api";
import Bar from "./ui/Bar";
import WowIcon from "./ui/WowIcon";
import { useT } from "../i18n";
import { roleLabel } from "../lib/wowNames";

/**
 * How full a role is, as a bar tone: full is ok, one short in a big role is
 * the accent (normal a few days out), more than that is mid, less than half bad.
 */
function roleTone(role: Pick<DashboardRole, "filled" | "target">): "ok" | "mid" | "bad" | undefined {
    if (!role.target || role.filled >= role.target) return "ok";
    const share = role.filled / role.target;
    if (share < 0.5) return "bad";
    return share >= 0.9 ? undefined : "mid";
}

/** "5/6" on a bar that stretches over its column (the shared Bar has a fixed width for tables). */
export function RoleBar({ role }: { role: DashboardRole }) {
    const t = useT();
    return (
        <span className="ov-rolebar">
            <Bar
                value={role.filled} max={role.target} tone={roleTone(role)}
                label={`${role.filled}/${role.target}`}
                tip={t("dashboard.roleBar.tip", { label: roleLabel(role.key, role.label), filled: role.filled, target: role.target })}
            />
        </span>
    );
}

/**
 * A square icon button that is a link to another site (Discord, Raid-Helper,
 * softres.it). The shared IconButton is a <button>; this is the same look on an
 * <a>, with the tooltip as its accessible name.
 */
export function IconLink({ icon, href, tip, tipSub }: { icon: string; href: string; tip: string; tipSub?: string }) {
    return (
        <a className="ibtn sm" href={href} target="_blank" rel="noopener noreferrer" aria-label={tip} data-tip={tip} data-tip-sub={tipSub}>
            <WowIcon name={icon} size={20} />
        </a>
    );
}
