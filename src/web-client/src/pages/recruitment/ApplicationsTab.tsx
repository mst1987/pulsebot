import { useState, type ReactNode } from "react";
import type { Application, RecruitmentData } from "../../api";
import { useTableSort, type Dir } from "../../lib/tableSort";
import { channelUrl } from "../../lib/discordLinks";
import { SortTh } from "../../components/SortTh";
import { ExternalIcon } from "../../components/icons";
import { classColorProps } from "../../components/ClassSpec";
import { Modal } from "../../components/ui/Modal";
import { Button, IconButton, buttonClass } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Expand from "../../components/ui/Expand";
import { PartHead } from "../../components/ui/PartHead";
import WowIcon from "../../components/ui/WowIcon";
import { ICONS, isUrl, openExternal, shortStamp } from "./shared";
import { ClassTile, StatusBadge } from "./RecruitmentBits";

type AppSortKey = "character" | "discord" | "date" | "status";

const APP_SORT_DEFAULTS: Record<AppSortKey, Dir> = { character: "asc", discord: "asc", date: "desc", status: "asc" };

const STATUS_ORDER: Record<string, number> = { neu: 0, offen: 1, archiviert: 2 };

function ApplicationDetails({ app, onClose }: { app: Application; onClose: () => void }) {
    const who = app.displayName || app.discordName || (app.applicantId ? "Discord-Mitglied" : "—");
    const link = (value: string, icon: string) => {
        const v = (value || "").trim();
        if (!v) return <span className="csub">—</span>;
        return (
            <span className="rc-link">
                <WowIcon name={icon} size={20} />
                {isUrl(v) ? <a className="mlink" href={v} target="_blank" rel="noopener noreferrer">{v.replace(/^https?:\/\//, "")}</a> : v}
            </span>
        );
    };
    return (
        <Modal
            open onClose={onClose} width={680}
            icon={app.classIcon || "inv_misc_questionmark"} tone="none"
            kicker={`Bewerbung · ${shortStamp(app.createdAt)}`}
            title={app.character || app.name || "Bewerbung"}
            hint="Aus dem Thread im Bewerbungs-Channel"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Schließen</Button>
                    <a className={buttonClass("primary", "md", true)} href={app.url} target="_blank" rel="noopener noreferrer">
                        <ExternalIcon />Thread in Discord öffnen
                    </a>
                </>
            )}
        >
            <div className="rc-app-badges">
                {app.className && <b className="rc-app-class"><span {...classColorProps(app.classColor)}>{app.className}</span></b>}
                {app.spec && <Badge tone="accent" icon={app.specIcon || undefined}>{app.spec}</Badge>}
                <StatusBadge status={app.status} />
            </div>
            <dl className="rc-meta">
                <dt>Bewerber</dt>
                <dd>{who}{app.discordName && app.discordName !== who && <span className="csub"> (@{app.discordName})</span>}</dd>
                <dt>Armory</dt><dd>{link(app.armory, ICONS.armory)}</dd>
                <dt>WarcraftLogs</dt><dd>{link(app.wcl, ICONS.wcl)}</dd>
            </dl>
            <div className="kicker rc-about-head">Über den Bewerber</div>
            <div className="rc-about">{app.description || <span className="csub">Keine Angabe.</span>}</div>
        </Modal>
    );
}

export function ApplicationsTab({ data }: { data: RecruitmentData }) {
    const [openId, setOpenId] = useState("");
    const apps = data.applications || [];
    const { sort, dir, onSort, apply } = useTableSort<AppSortKey>("recruitment-applications-sort", APP_SORT_DEFAULTS, "date");
    const rows = apply(apps, (a, key) => {
        switch (key) {
            case "character": return (a.character || a.name || "").toLowerCase();
            case "discord": return (a.discordName || a.displayName || "").toLowerCase();
            case "status": return STATUS_ORDER[a.status] ?? 9;
            default: return a.createdAt || 0;
        }
    });
    const channel = data.channels.find((c) => c.id === data.applicationChannelId);
    const opened = apps.find((a) => a.threadId === openId) || null;

    let content: ReactNode;
    if (!data.applicationChannelId) {
        content = (
            <div className="rc-empty rc-empty-panel">
                <Badge tone="mid">Kein Bewerbungs-Channel</Badge>
                <span>Lege ihn in den <a className="mlink" href="/settings">Einstellungen</a> fest, damit die Bewerbungen hier erscheinen.</span>
            </div>
        );
    } else if (data.applicationsError) {
        content = <div className="rc-empty rc-empty-panel"><Badge tone="bad">Fehler</Badge><span>{data.applicationsError}</span></div>;
    } else if (!apps.length) {
        content = <div className="rc-empty rc-empty-panel"><Badge>Keine Bewerbungen</Badge><span>In den letzten 6 Wochen kam keine Bewerbung.</span></div>;
    } else {
        content = (
            <div className="rc-tbl">
                <table className="idx">
                    <thead>
                        <tr>
                            <SortTh sortKey="character" label="Charakter" sort={sort} dir={dir} onSort={onSort} />
                            <SortTh sortKey="discord" label="Discord" sort={sort} dir={dir} onSort={onSort} style={{ width: 170 }} />
                            <SortTh sortKey="date" label="Eingereicht" sort={sort} dir={dir} onSort={onSort} style={{ width: 140 }} />
                            <SortTh sortKey="status" label="Status" sort={sort} dir={dir} onSort={onSort} tip="Status" tipSub="neu = jünger als 7 Tage · offen = Thread aktiv · archiviert = Thread archiviert." style={{ width: 120 }} />
                            <th style={{ width: 210 }} />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((a) => (
                            <tr key={a.threadId} className="rc-row" onClick={() => setOpenId(a.threadId)}>
                                <td>
                                    <div className="rc-char">
                                        <ClassTile app={a} />
                                        <div>
                                            <div className="cname"><span {...classColorProps(a.classColor)}>{a.character || a.name || "Bewerbung"}</span></div>
                                            <div className="csub">{a.spec || a.classSpec || "—"}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="csub">{a.discordName ? `@${a.discordName}` : a.displayName || "—"}</td>
                                <td className="mono csub">{shortStamp(a.createdAt)}</td>
                                <td><StatusBadge status={a.status} /></td>
                                <td onClick={(e) => e.stopPropagation()}>
                                    <div className="rc-acts">
                                        {isUrl(a.armory) && <IconButton size="sm" icon={ICONS.armory} tip="Armory" tipSub={a.armory} onClick={() => openExternal(a.armory)} />}
                                        {isUrl(a.wcl) && <IconButton size="sm" icon={ICONS.wcl} tip="WarcraftLogs" tipSub={a.wcl} onClick={() => openExternal(a.wcl)} />}
                                        <Expand open={openId === a.threadId} onToggle={() => setOpenId(openId === a.threadId ? "" : a.threadId)} />
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    return (
        <>
            <PartHead
                icon={ICONS.applications} tone="recruitment" title="Bewerbungen" crumb="Recruitment › Bewerbungen"
                tip="Die letzten 10 Bewerbungen der vergangenen 6 Wochen"
                tipSub="Aus den Threads im Bewerbungs-Channel, neueste zuerst."
                action={data.applicationChannelId && data.activeGuildId
                    ? (
                        <a className={buttonClass("ghost", "sm", true)} href={channelUrl(data.activeGuildId, data.applicationChannelId)} target="_blank" rel="noopener noreferrer">
                            <ExternalIcon />#{channel ? channel.name : "bewerbungen"} öffnen
                        </a>
                    )
                    : undefined}
            />
            {content}
            {opened && <ApplicationDetails app={opened} onClose={() => setOpenId("")} />}
        </>
    );
}
