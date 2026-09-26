// Pieces the roster and the character page share (design issue #218): the role
// badge, the attendance bar with its tooltip, the gear-state badge, the loot
// badge and the icon link. Built on the shared building blocks in ./ui; the plain
// helpers behind them live in lib/rosterView.ts.
import type { ReactNode, CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { CharGearReport, CharLootPreview, RosterAttendance, RosterRole } from "../../api";
import { useT } from "../../i18n";
import { fmtMs } from "../../lib/format";
import { ROLE_META, attendanceTone, nightLabel } from "../../lib/rosterView";
import { roleLabel } from "../../lib/wowNames";
import { Badge, WowIcon } from "../ui";

export function RoleBadge({ role }: { role: RosterRole }) {
    const t = useT();
    if (!role) return <Badge tip={t("roster.badge.roleUnknown")} tipSub={t("roster.badge.roleUnknownSub")}>–</Badge>;
    const meta = ROLE_META[role];
    const label = roleLabel(role);
    return (
        <Badge
            icon={meta.icon}
            tip={label}
            tipSub={t("roster.cols.roleSub")}
        >
            {label}
        </Badge>
    );
}

/** The attendance of one category as a fixed-width WCL bar with the missed nights in its tooltip. */
export function AttendanceBar({ attendance, categoryName }: { attendance: RosterAttendance | undefined; categoryName: string }) {
    const t = useT();
    if (!attendance || !attendance.total) {
        return (
            <span
                className="bar ros-bar is-empty"
                data-tip={t("roster.badge.noRaids")}
                data-tip-sub={t("roster.badge.noRaidsSub", { category: categoryName || t("roster.badge.thisCategory") })}
            >
                <span>–</span>
            </span>
        );
    }
    const { attended, total, pct, missed } = attendance;
    const lines = [t("roster.badge.counted", { category: categoryName || t("roster.badge.category"), total })];
    if (missed.length) lines.push(t("roster.badge.missed", { list: missed.map((m) => `${nightLabel(m.startTime * 1000)} (${m.reason})`).join(", ") }));
    else lines.push(t("roster.badge.noneMissed"));
    return (
        <span className={`bar ros-bar ${attendanceTone(pct) || ""}`} data-tip={t("roster.badge.attendanceTip", { attended, total, pct })} data-tip-sub={lines.join("\n")}>
            <i style={{ "--fill": `${pct}%` } as CSSProperties} />
            <span>{pct} %<small>{attended}/{total}</small></span>
        </span>
    );
}

/** Gear state of the newest evaluation: clean, n findings, or never evaluated. */
export function GearStateBadge({ gear }: { gear: CharGearReport | null }) {
    const t = useT();
    if (!gear) {
        return (
            <Badge icon="inv_misc_pocketwatch_01" tip={t("roster.badge.notEvaluated")} tipSub={t("roster.badge.notEvaluatedSub")}>
                {t("roster.badge.notEvaluated")}
            </Badge>
        );
    }
    const when = gear.generatedAt ? fmtMs(gear.generatedAt, false) : "";
    const source = [gear.reportTitle || gear.zone, when].filter(Boolean).join(" · ");
    if (!gear.issueCount) {
        return <Badge tone="ok" icon="trade_engraving" tip={t("roster.badge.clean")} tipSub={t("roster.badge.cleanSub", { source })}>{t("roster.badge.clean")}</Badge>;
    }
    const high = gear.issues.filter((i) => i.severity === "high").length;
    const summary = gear.issues.slice(0, 4).map((i) => `${i.slotName || i.itemName || t("roster.badge.gear")}: ${i.label}`);
    if (gear.issues.length > 4) summary.push(t("roster.badge.moreOnChar", { count: gear.issues.length - 4 }));
    return (
        <Badge
            tone={high ? "bad" : "mid"}
            icon="inv_misc_gem_variety_02"
            tip={`${t("roster.badge.gearProblems", { count: gear.issueCount })}${high ? t("roster.badge.high", { count: high }) : ""}`}
            tipSub={`${summary.join("\n")}\n${t("roster.badge.fromEvaluation", { source })}`}
        >
            {t("roster.badge.problems", { count: gear.issueCount })}
        </Badge>
    );
}

/** Loot count linking to the character's loot history, the newest items in its tooltip. */
export function LootBadge({ count, items, to }: { count: number; items: CharLootPreview[]; to: string }) {
    const t = useT();
    const shown = items.slice(0, 6).map((it) => {
        const meta = [it.reasonLabel, it.awardedAt ? nightLabel(it.awardedAt) : ""].filter(Boolean).join(" · ");
        return `${it.itemName || t("roster.badge.item", { id: it.itemId })}${meta ? ` — ${meta}` : ""}`;
    });
    if (count > shown.length && shown.length) shown.push(t("roster.badge.more", { count: count - shown.length }));
    const sub = count ? `${shown.join("\n")}\n${t("roster.badge.lootHint")}` : t("roster.badge.noLootYet");
    return (
        <Link className="ros-badge-link" to={to} data-tip={count ? t("roster.badge.itemsReceived", { count }) : t("roster.badge.noLoot")} data-tip-sub={sub}>
            <Badge icon="inv_misc_bag_10">{count}</Badge>
        </Link>
    );
}

/** A square icon link (WCL, Armory) — IconButton's look on an <a>, since these leave the page. */
export function IconLink({ href, icon, tip, size = "sm" }: { href: string; icon: string; tip: string; size?: "sm" | "md" }) {
    if (!href) return null;
    return (
        <a
            className={`ibtn${size === "sm" ? " sm" : ""}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={tip}
            data-tip={tip}
        >
            <WowIcon name={icon} size={size === "sm" ? 20 : 24} />
        </a>
    );
}

/** A dotted-underlined label that explains itself (table heads, KPI labels). */
export function TipLabel({ tip, sub, className = "", children }: { tip: string; sub?: string; className?: string; children: ReactNode }) {
    return <span className={`tipped ${className}`.trim()} data-tip={tip} data-tip-sub={sub} tabIndex={0}>{children}</span>;
}
