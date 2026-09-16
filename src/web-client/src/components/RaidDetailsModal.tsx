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

const STATUS_TONE = { tentative: "mid", none: undefined, bench: undefined, absence: "bad" } as const;

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
                    icon="achievement_guildperk_everybodysfriend" title="Anmeldungen"
                    count={<Badge tone="accent" count className="ov-push">{raid.signupCount}/{planned}</Badge>}
                />
                <div>
                    {raid.roles.map((r) => (
                        <div className="ov-rrow" key={r.key}>
                            <WowIcon name={r.icon} size={22} />
                            <span className="ov-rrow-n">{r.label}</span>
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
                                    <span {...classColorProps(c.classColor)}>{c.label}</span>
                                    <b>{c.count}</b>
                                </div>
                            ))}
                        </div>
                    )
                    : <div className="ov-note">Noch keine Anmeldungen.</div>}
            </div>

            <div className="ov-dlg-col">
                <SectHead icon="inv_misc_note_01" tone="mid" title="Vorbereitung" />
                <div className="ov-glist">
                    {check(!!raid.sheet, "inv_misc_note_02", "Raidsheet", raid.sheet ? (raid.sheet.playerCount ? `${raid.sheet.playerCount} Spieler` : "vorhanden") : "fehlt",
                        raid.sheet?.url ? { href: raid.sheet.url, tip: "Raidsheet öffnen" } : undefined)}
                    {check(raid.setupCount > 0, "inv_misc_groupneedmore", "Setup / Comp", raid.setupCount ? `${raid.setupCount} gesetzt` : "offen",
                        raidplanUrl(raid.id) ? { href: raidplanUrl(raid.id), tip: "Raidplan bei Raid-Helper öffnen" } : undefined)}
                    {check(!!raid.softres, "inv_scroll_11", "Softres", raid.softres ? "erstellt" : "fehlt",
                        raid.softres ? { href: raid.softres.url, tip: "Softres-Liste öffnen" } : undefined)}
                    {check(!!(guildId && raid.channelId), "inv_letter_15", "Discord-Post", guildId && raid.channelId ? "gepostet" : "unbekannt",
                        guildId && raid.channelId ? { href: eventPostUrl(guildId, raid.channelId, raid.id), tip: "Anmeldung in Discord öffnen" } : undefined)}
                </div>

                <SectHead
                    icon="spell_holy_borrowedtime" tone="mid" title="Noch nicht angemeldet"
                    count={raid.rolesConfigured && !raid.membersError
                        ? <Badge tone={raid.notSignedUp.length ? "mid" : "ok"} count className="ov-push">{raid.notSignedUp.length}</Badge>
                        : undefined}
                />
                {!raid.rolesConfigured
                    ? <div className="ov-note">Der Kategorie sind keine Raider-Rollen zugeordnet (Einstellungen → Kategorien).</div>
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
                                            {p.role && <span className="ov-muted-s">{p.role}</span>}
                                            <Badge tone={STATUS_TONE[p.status]} className="ov-push">{p.statusLabel}</Badge>
                                        </div>
                                    ))}
                                </div>
                            )
                            : <div className="ov-note">Alle Raider der Kategorie haben sich angemeldet.</div>}
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
            hint={raid && <>Stand Raid-Helper: {fetchedAt(raid.fetchedAt)} · <Link to={detailHref}>Raid-Event öffnen</Link></>}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Schließen</Button>
                    {raid && !raid.sheet && (
                        <Link className={buttonClass("primary", "md", true)} to={detailHref}>
                            <WowIcon name="inv_misc_note_02" size={22} />Sheet füllen
                        </Link>
                    )}
                </>
            )}
        >
            {error
                ? <div className="ov-note bad">{error}</div>
                : raid
                    ? <Details raid={raid} guildId={guildId} />
                    : <div className="ov-note">Lade Anmeldungen…</div>}
        </Modal>
    );
}
