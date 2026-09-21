// "Raid-Details" of the start page's next raid (design issue #220): who signed
// up per role and class, what is prepared, and who of the category's raiders
// has not said yes yet. Loaded from /api/dashboard/next-raid when it opens — the
// member list is a Discord call the start page itself should not wait for.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getNextRaidDetails, type ApiError, type NextRaidDetails } from "../api";
import { Modal } from "./ui/Modal";
import { Button, buttonClass } from "./ui/Button";
import Badge from "./ui/Badge";
import IconTile from "./ui/IconTile";
import WowIcon from "./ui/WowIcon";
import { classColorProps } from "./ClassSpec";
import { eventPostUrl, raidplanUrl } from "../lib/discordLinks";
import { dayDate, clock, fetchedAt } from "../lib/overviewDates";
import { RoleBar, IconLink } from "./OverviewParts";
import { tOr, useT } from "../i18n";
import { classLabel, roleLabel } from "../lib/wowNames";

const STATUS_TONE = { tentative: "mid", none: undefined, bench: undefined, absence: "bad" } as const;

// The server names a raider's role by its German label (dashboardOverview.js ROLES); back to the key for the dictionary.
const ROLE_KEY_BY_LABEL: Record<string, string> = { Tank: "tank", Heiler: "healer", DPS: "dps" };

function SectHead({ icon, tone, title, count }: { icon: string; tone?: "mid"; title: string; count?: React.ReactNode }) {
    return (
        <div className="ov-sect">
            <IconTile icon={icon} tone={tone} />
            <span className="ov-sect-t">{title}</span>
            {count}
        </div>
    );
}

function Details({ raid, guildId }: { raid: NextRaidDetails; guildId: string }) {
    const t = useT();
    const planned = raid.roles.reduce((n, r) => n + r.target, 0);
    const check = (ok: boolean, icon: string, label: string, badge: string, link?: { href: string; tip: string }) => (
        <div className="ov-check">
            <IconTile icon={icon} tone={ok ? "ok" : "bad"} />
            <span className="grow">{label}</span>
            <Badge tone={ok ? "ok" : "bad"}>{badge}</Badge>
            {link && <IconLink icon={icon} href={link.href} tip={link.tip} />}
        </div>
    );
    return (
        <div className="ov-dlg-grid">
            <div className="ov-dlg-col">
                <SectHead
                    icon="achievement_guildperk_everybodysfriend" title={t("dashboard.raidDetails.signups")}
                    count={<Badge tone="accent" count className="ov-push">{raid.signupCount}/{planned}</Badge>}
                />
                <div>
                    {raid.roles.map((r) => (
                        <div className="ov-rrow" key={r.key}>
                            <WowIcon name={r.icon} size={22} />
                            <span className="ov-rrow-n">{roleLabel(r.key, r.label)}</span>
                            <RoleBar role={r} />
                        </div>
                    ))}
                </div>
                {raid.classes.length > 0
                    ? (
                        <div className="ov-classes">
                            {raid.classes.map((c) => (
                                <div className="ov-class" key={c.className}>
                                    <WowIcon name={c.icon} size={22} />
                                    <span {...classColorProps(c.classColor)}>{classLabel(c.className, c.label)}</span>
                                    <b>{c.count}</b>
                                </div>
                            ))}
                        </div>
                    )
                    : <div className="ov-note">{t("dashboard.raidDetails.noSignups")}</div>}
            </div>

            <div className="ov-dlg-col">
                <SectHead icon="inv_misc_note_01" tone="mid" title={t("dashboard.raidDetails.prep")} />
                <div className="ov-glist">
                    {check(!!raid.sheet, "inv_misc_note_02", t("dashboard.raidDetails.raidsheet"), raid.sheet ? (raid.sheet.playerCount ? t("dashboard.raidDetails.players", { count: raid.sheet.playerCount }) : t("dashboard.raidDetails.present")) : t("dashboard.raidDetails.missing"),
                        raid.sheet?.url ? { href: raid.sheet.url, tip: t("dashboard.raidDetails.openSheet") } : undefined)}
                    {check(raid.setupCount > 0, "inv_misc_groupneedmore", t("dashboard.raidDetails.setupComp"), raid.setupCount ? t("dashboard.raidDetails.setCount", { count: raid.setupCount }) : t("dashboard.raidDetails.open"),
                        raidplanUrl(raid.id) ? { href: raidplanUrl(raid.id), tip: t("dashboard.raidDetails.openRaidplan") } : undefined)}
                    {raid.lootSystem && !raid.lootSystem.softres
                        ? check(true, "inv_misc_bag_10", t("dashboard.raidDetails.lootSystem"), raid.lootSystem.label)
                        : check(!!raid.softres, "inv_scroll_11", t("dashboard.raidDetails.softres"), raid.softres ? t("dashboard.raidDetails.created") : t("dashboard.raidDetails.missing"),
                            raid.softres ? { href: raid.softres.url, tip: t("dashboard.raidDetails.openSoftres") } : undefined)}
                    {check(!!(guildId && raid.channelId), "inv_letter_15", t("dashboard.raidDetails.discordPost"), guildId && raid.channelId ? t("dashboard.raidDetails.posted") : t("dashboard.raidDetails.unknown"),
                        guildId && raid.channelId ? { href: eventPostUrl(guildId, raid.channelId, raid.id), tip: t("dashboard.raidDetails.openDiscord") } : undefined)}
                </div>

                <SectHead
                    icon="spell_holy_borrowedtime" tone="mid" title={t("dashboard.raidDetails.notSignedUp")}
                    count={raid.rolesConfigured && !raid.membersError
                        ? <Badge tone={raid.notSignedUp.length ? "mid" : "ok"} count className="ov-push">{raid.notSignedUp.length}</Badge>
                        : undefined}
                />
                {!raid.rolesConfigured
                    ? <div className="ov-note">{t("dashboard.raidDetails.noRoles")}</div>
                    : raid.membersError
                        ? <div className="ov-note">{raid.membersError}</div>
                        : raid.notSignedUp.length
                            ? (
                                <div className="ov-glist">
                                    {raid.notSignedUp.map((p) => (
                                        <div className="ov-gl" key={p.id}>
                                            {p.className
                                                ? <WowIcon name={`classicon_${p.className === "DK" ? "deathknight" : p.className.toLowerCase()}`} size={22} />
                                                : <WowIcon name="inv_misc_questionmark" size={22} />}
                                            <b {...classColorProps(p.classColor)}>{p.name}</b>
                                            {p.role && <span className="ov-muted-s">{ROLE_KEY_BY_LABEL[p.role] ? roleLabel(ROLE_KEY_BY_LABEL[p.role], p.role) : p.role}</span>}
                                            <Badge tone={STATUS_TONE[p.status]} className="ov-push">{tOr(`dashboard.raidDetails.status.${p.status}`, p.statusLabel)}</Badge>
                                        </div>
                                    ))}
                                </div>
                            )
                            : <div className="ov-note">{t("dashboard.raidDetails.allSignedUp")}</div>}
            </div>
        </div>
    );
}

export default function RaidDetailsModal({ eventId, guildId, title, icon, onClose }: {
    /** "" = closed. */
    eventId: string;
    guildId: string;
    title: string;
    icon: string;
    onClose: () => void;
}) {
    const t = useT();
    const [raid, setRaid] = useState<NextRaidDetails | null>(null);
    const [error, setError] = useState<string>("");

    useEffect(() => {
        if (!eventId) return;
        setRaid(null);
        setError("");
        getNextRaidDetails(eventId)
            .then((d) => setRaid(d.raid))
            .catch((e: ApiError) => setError(e.message));
    }, [eventId]);

    const detailHref = `/raids/detail?event=${encodeURIComponent(eventId)}`;
    const when = raid ? `${dayDate(raid.startTime * 1000)} · ${clock(raid.startTime * 1000)}${raid.channelName ? ` · #${raid.channelName}` : ""}` : "";

    return (
        <Modal
            open={!!eventId}
            onClose={onClose}
            icon={raid?.icon || icon}
            kicker={when || undefined}
            title={raid?.title || title}
            width={820}
            hint={raid && <>{t("dashboard.raidDetails.fetched", { time: fetchedAt(raid.fetchedAt) })} · <Link to={detailHref}>{t("dashboard.raidDetails.openEvent")}</Link></>}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
                    {raid && !raid.sheet
                        ? (
                            <Link className={buttonClass("primary", "md", true)} to={detailHref}>
                                <WowIcon name="inv_misc_note_02" size={22} />{t("dashboard.raidDetails.fillSheet")}
                            </Link>
                        )
                        : (
                            <Link className={buttonClass("primary", "md", true)} to={detailHref}>
                                <WowIcon name={raid?.icon || icon} size={22} />{t("dashboard.raidDetails.openRaid")}
                            </Link>
                        )}
                </>
            )}
        >
            {error
                ? <div className="ov-note bad">{error}</div>
                : raid
                    ? <Details raid={raid} guildId={guildId} />
                    : <div className="ov-note">{t("dashboard.raidDetails.loading")}</div>}
        </Modal>
    );
}
