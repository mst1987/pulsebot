// The detail page of one addon, /addon/<id> (design "Addon-Detailseite",
// boards 1-3): the head with icon, game version, title, description, the way
// back to all addons and the download buttons (the same server route and
// limit as the cards), a meta line, the patch notes of the newest release in
// full and the install steps. Where the Discord centre's "Patchnotes" link
// leads (services/addons/addonCenterPanel.js patchNotesUrl).
//
// Independent of the menu's game version: the addon is asked for by its id
// (GET /api/addons/detail), and the page keeps the brand colour (no content
// switch, lib/app/menu.ts isNeutralPage) — its own version(s) are a badge.
// The notes are a small, safe part of Markdown (lib/addons/addonInstall.ts
// noteGroups): headings as groups, lists, **bold**, `code` — rendered as text,
// never as HTML, never a link; GitHub's generated "What's Changed" block goes.
//
// States: an unknown, hidden or (for a raider) orga-only id is one "not here"
// with the way back; no release keeps the head and leaves downloads, notes and
// install out. Classes "dlpd-", never "ad-" (ad blockers, styles/addon.css).
import { useParams } from "react-router-dom";
import { getAddonDetail, type AddonDetailData } from "../../api";
import { AsyncView, BackButton, Badge, RaidLoader, WowIcon } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { usePageCrumb } from "../../hooks/usePageCrumb";
import { useContentVersion } from "../../hooks/useContentVersion";
import { formatDate, formatDateTime } from "../../lib/format";
import { noteGroups, type NoteGroup, type NoteSpan } from "../../lib/addons/addonInstall";
import { useT } from "../../i18n";
import { CurseforgeLink, DownloadButtons, ErrorState, InstallGuide, StateNote } from "./AddonParts";
import "../../styles/addon.css";
import "../../styles/orga-mark.css";

const ICON = "inv_gizmo_01";
const BACK = "/addon";

/** A line of the notes: text, bold and code as React text nodes, nothing else. */
function Spans({ spans }: { spans: NoteSpan[] }) {
    return (
        <>
            {spans.map((s, i) => (s.kind === "bold"
                ? <b key={i}>{s.text}</b>
                : s.kind === "code" ? <code key={i}>{s.text}</code> : <span key={i}>{s.text}</span>))}
        </>
    );
}

function Group({ group }: { group: NoteGroup }) {
    return (
        <div className={`dlpd-group dlpd-g-${group.kind}`}>
            {group.title && <h3 className="dlpd-group-head"><span className="dlpd-mark" aria-hidden="true" />{group.title}</h3>}
            {group.blocks.map((block, i) => (block.type === "list"
                ? <ul key={i}>{block.items.map((item, j) => <li key={j}><Spans spans={item} /></li>)}</ul>
                : <p key={i}><Spans spans={block.spans} /></p>))}
        </div>
    );
}

function Detail({ data }: { data: AddonDetailData }) {
    const t = useT();
    // the zip's folder: the menu's version when the addon is for it, else every version's folder
    const { version: menuVersion } = useContentVersion();
    const { addon, versions } = data;
    const release = addon.release;
    const date = release && release.publishedAt ? formatDate(Date.parse(release.publishedAt)) : "";
    const files = release ? release.assets : [];
    const groups = release ? noteGroups(release.notes) : [];
    const game = versions.map((v) => v.label).join(", ");
    return (
        <div className="dlpd-page" data-addon={addon.id}>
            <section className="page-hero dlpd-hero" aria-label={addon.name}>
                <div className="hero-main dlpd-hero-main">
                    <WowIcon name={addon.icon} size={56} className="dlpd-icon" />
                    <div className="hero-ident dlpd-ident">
                        <div className="hero-eyebrow">
                            <span className="hero-kicker">{t("addon.detail.kicker")}</span>
                            {versions.map((v) => (
                                <Badge key={v.id} className={`dlpd-ver ver-${v.id}`} icon={<span className="dlpd-dot" aria-hidden="true" />}>{v.label}</Badge>
                            ))}
                            {addon.orgaOnly && (
                                <span className="orga-chip-lbl" data-tip={t("addon.admin.orga")} data-tip-sub={t("addon.admin.orgaTip")}>{t("addon.admin.orga")}</span>
                            )}
                        </div>
                        <h1 className="hero-title dlpd-title" data-tip={addon.name}>{addon.name}</h1>
                    </div>
                    {addon.description && <p className="hero-sub dlpd-sub">{addon.description}</p>}
                    <div className="dlpd-actions">
                        <BackButton to={BACK} label={t("addon.detail.back")} />
                        {files.length > 0 && <DownloadButtons files={files} className="dlpd-download" />}
                        <CurseforgeLink addon={addon} />
                    </div>
                    {addon.stale && release && (
                        <p className="dlp-stale dlpd-wide">{t("addon.state.stale", { time: formatDateTime(addon.fetchedAt) })}</p>
                    )}
                    {release && !files.length && <p className="dlp-state dlpd-state dlpd-wide">{t("addon.state.noFiles")}</p>}
                    {!release && <div className="dlpd-wide dlpd-state-box"><StateNote addon={addon} canManage={data.canManage} /></div>}
                </div>
                <dl className="hero-meta dlpd-meta">
                    <div><dt>{t("addon.detail.meta.version")}</dt><dd className={release ? "dlpd-big" : "dlpd-big muted"}>{release ? release.version : "—"}</dd></div>
                    <div><dt>{t("addon.detail.meta.published")}</dt><dd className={release ? "" : "muted"}>{release ? (date || "—") : t("addon.detail.meta.notYet")}</dd></div>
                    {game && <div><dt>{t("addon.detail.meta.game")}</dt><dd>{game}</dd></div>}
                </dl>
            </section>

            {release && (
                <section className="dlpd-notes" aria-label={t("addon.detail.notes")}>
                    <div className="dlpd-notes-head">
                        <div className="dlpd-notes-title">
                            <div className="kicker">{t("addon.detail.notes")}</div>
                            <h2>{t("addon.detail.notesVersion", { version: release.version })}</h2>
                        </div>
                        {date && <span className="dlpd-when">{date}</span>}
                    </div>
                    {groups.length
                        ? groups.map((g, i) => <Group key={i} group={g} />)
                        : <p className="muted dlpd-none">{t("addon.detail.noNotes")}</p>}
                </section>
            )}

            {release && (versions.some((v) => v.id === menuVersion)
                ? <InstallGuide addon={addon} versionId={menuVersion} className="dlpd-install" />
                : <InstallGuide addon={addon} folders={versions} className="dlpd-install" />)}
            {release && <p className="dlp-foot muted">{t("addon.limit", { count: data.downloadLimit })}</p>}
        </div>
    );
}

/** An id that is unknown, hidden or orga-only for this account: one answer for all, never a blank page. */
function UnknownAddon() {
    const t = useT();
    return (
        <div className="empty dlp-empty dlpd-unknown">
            <WowIcon name={ICON} size={48} className="dlpd-dim" />
            <p>{t("addon.detail.unknown")}</p>
            <p className="muted dlpd-unknown-sub">{t("addon.detail.unknownSub")}</p>
            <BackButton to={BACK} label={t("addon.detail.back")} />
        </div>
    );
}

export default function AddonDetailPage() {
    const t = useT();
    const { addonId = "" } = useParams();
    const page = useApi<AddonDetailData>(() => getAddonDetail(addonId), [addonId]);
    const unknown = page.error && page.error.code === "unknown_addon";
    usePageCrumb(page.data ? page.data.addon.name : unknown ? t("addon.detail.unknownCrumb") : null);
    if (unknown) return <UnknownAddon />;
    return (
        <AsyncView
            state={page}
            loading={<RaidLoader text={t("addon.detail.loading")} />}
            error={(err) => <ErrorState error={err} onRetry={() => { void page.reload(); }} />}
        >
            {(data) => <Detail data={data} />}
        </AsyncView>
    );
}
