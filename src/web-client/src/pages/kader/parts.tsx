// Small pieces every view of the Kaderplaner draws the same way: a player's
// name in the class colour, the class bar, the attendance value and meter, the
// week squares, the head of a sub view.
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { KaderDay, KaderPlayer, KaderRole } from "../../api";
import { classColorProps } from "../../components/ClassSpec";
import { ChevronLeftIcon } from "../../components/icons";
import { IconTile, WowIcon } from "../../components/ui";
import { t, useT } from "../../i18n";
import { ROLE_ICON } from "../../lib/raidplan/assign";
import { roleLabel } from "../../lib/wowNames";
import { activeOf, classIconOf, className, colorOf, specIconOf, specName } from "../../lib/kader/model";
import { DAYS } from "../../lib/kader/players";
import { useKader } from "./kaderContext";

/** The coloured bar at the left of a row: the class colour, grey without a class. */
export function ClassBar({ color, small = false }: { color: string; small?: boolean }) {
    return <span className={`kp-bar${small ? " kp-small" : ""}`} style={{ "--cc": color || "var(--line)" } as CSSProperties} aria-hidden="true" />;
}

/**
 * A WoW icon with a name: rounded, with the name as its accessible label and
 * tooltip. Nothing without an icon name.
 */
export function KIcon({ name, label, size = 20, tip = true }: { name: string; label: string; size?: number; tip?: boolean }) {
    if (!name) return null;
    return (
        <span className="kp-ico" role="img" aria-label={label} data-tip={tip ? label : undefined}>
            <WowIcon name={name} size={size} />
        </span>
    );
}

/** A spec's icon ("Warrior-Protection"), named in the menu language. */
export function SpecIcon({ specKey, size = 20 }: { specKey: string | null | undefined; size?: number }) {
    const { view } = useKader();
    if (!specKey) return null;
    return <KIcon name={specIconOf(view.classes, specKey)} label={`${specName(view.classes, specKey)} · ${className(view.classes, specKey.split("-")[0])}`} size={size} />;
}

/** A class's icon ("Warrior"). */
export function ClassIcon({ classKey, size = 20 }: { classKey: string; size?: number }) {
    const { view } = useKader();
    return <KIcon name={classIconOf(view.classes, classKey)} label={className(view.classes, classKey)} size={size} />;
}

/** The role icon the raid detail and the raid plan use for their role groups. */
export function RoleIcon({ role, size = 20 }: { role: KaderRole; size?: number }) {
    return <KIcon name={ROLE_ICON[role] || ""} label={roleLabel(role)} size={size} tip={false} />;
}

/** What a player plays at a glance: the main spec's icon, else the class icon, else an empty square of the same size. */
export function PlayerIcon({ player, size = 20 }: { player: KaderPlayer; size?: number }) {
    const a = activeOf(player);
    if (a && a.mainSpec) return <SpecIcon specKey={a.mainSpec} size={size} />;
    if (a && a.className) return <ClassIcon classKey={a.className} size={size} />;
    return <span className="kp-ico kp-ico-none" style={{ "--ico": `${size}px` } as CSSProperties} aria-hidden="true" />;
}

/** The character's name in its class colour (the Discord name when there is no character). */
export function CharName({ player, className: extra = "" }: { player: KaderPlayer; className?: string }) {
    const { view } = useKader();
    const a = activeOf(player);
    const color = colorOf(view.classes, player);
    return (
        <span className={[extra, color ? "class-colored" : "kp-noclass"].filter(Boolean).join(" ")} style={classColorProps(color).style}>
            {a ? a.name : t("kader.player.noChar")}
        </span>
    );
}

export function Meter({ pct, tone = "" }: { pct: number | null; tone?: string }) {
    return (
        <span className={`kp-meter${tone ? ` ${tone}` : ""}`} aria-hidden="true">
            <i style={{ "--fill": `${pct ?? 0}%` } as CSSProperties} />
        </span>
    );
}

/** Seven squares, Monday first: which evenings the raider says they can. */
export function WeekDots({ days }: { days: KaderDay[] }) {
    const tr = useT();
    const can = DAYS.filter((d) => days.includes(d)).map((d) => tr(`kader.day.${d}`));
    return (
        <span className="kp-week" role="img" aria-label={can.length ? tr("kader.player.canDays", { days: can.join(", ") }) : tr("kader.player.noDays")}
            data-tip={can.length ? tr("kader.player.canDays", { days: can.join(", ") }) : tr("kader.player.noDays")}>
            {DAYS.map((d) => <i key={d} className={days.includes(d) ? "on" : ""} />)}
        </span>
    );
}

/** The head of the players and setup views: back to the board, kicker, title, actions on the right. */
export function SubHead({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
    const tr = useT();
    return (
        <div className="kp-head">
            <Link to="/kader" className="kp-back"><ChevronLeftIcon />{tr("kader.nav.back")}</Link>
            <IconTile icon="inv_misc_groupneedmore" tone="kader" />
            <div className="kp-head-text">
                <div className="kicker">{kicker}</div>
                <h1>{title}</h1>
            </div>
            {children && <div className="kp-head-act">{children}</div>}
        </div>
    );
}
