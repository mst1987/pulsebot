import { useT } from "../../i18n";

// The banner over an event of a hidden game version (#563, design "Archiv"):
// "Andere Versionen ausblenden" keeps it out of every list, but a direct link
// (the raid page, the public raid plan) still opens it — read only. The server
// sends `archived` with the event and refuses every change to it itself.

export type ArchiveInfo = { versionId: string; label: string; short: string };

function ArchiveIcon() {
    return (
        <svg className="archive-banner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="3" width="20" height="5" rx="1" />
            <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
            <path d="M10 12h4" />
        </svg>
    );
}

export default function ArchiveBanner({ archive, publicView = false }: { archive?: ArchiveInfo | null; publicView?: boolean }) {
    const t = useT();
    if (!archive) return null;
    return (
        <div className="archive-banner" role="note">
            <ArchiveIcon />
            <b className="archive-banner-title">{t("shell.archive.title", { version: archive.short })}</b>
            <span className="archive-banner-text">{publicView ? t("shell.archive.textPublic") : t("shell.archive.text")}</span>
            <span className="archive-banner-tag">{t("shell.archive.readOnly")}</span>
        </div>
    );
}
