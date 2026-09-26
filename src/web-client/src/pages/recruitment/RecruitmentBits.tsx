import type { ReactNode } from "react";
import type { Application, RecruitmentData } from "../../api";
import { specsInContent, specEmojiUrl } from "../../lib/recruitmentSpecs";
import { SpecImg } from "./SpecPicker";
import { CheckIcon } from "../../components/icons";
import Badge from "../../components/ui/Badge";
import WowIcon from "../../components/ui/WowIcon";
import { useT } from "../../i18n";

/** The pencil — a pure UI function, so a line icon. */
export function EditIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16v4z" />
            <path d="m13.5 6.5 4 4" />
        </svg>
    );
}

/** A form label whose explanation sits in the tooltip instead of a hint line under the field. */
export function TipLabel({ label, tip, tipSub, htmlFor, extra }: { label: string; tip?: string; tipSub?: string; htmlFor?: string; extra?: ReactNode }) {
    return (
        <label className="rc-label" htmlFor={htmlFor}>
            {tip
                ? <span className="tipped" data-tip={tip} data-tip-sub={tipSub} tabIndex={0}>{label}</span>
                : <span>{label}</span>}
            {extra}
        </label>
    );
}

/** The spec icons a message asks for, named in the tooltip. */
export function WantedIcons({ content, data }: { content: string; data: RecruitmentData }) {
    const t = useT();
    const specs = specsInContent(content, data.specCatalog);
    if (!specs.length) return <span className="csub" data-tip={t("recruitment.bits.noSpecsTip")} data-tip-sub={t("recruitment.bits.noSpecsSub")}>—</span>;
    return (
        <span
            className="rc-specs" tabIndex={0}
            data-tip={specs.map((s) => s.name).join(" · ")}
            data-tip-sub={t("recruitment.bits.specsSub")}
        >
            {specs.map((s, i) => {
                const spec = data.specCatalog.find((c) => c.name === s.name);
                return <SpecImg key={i} url={specEmojiUrl(s.iconId, spec ? spec.icon : s.iconName, data.emojis)} />;
            })}
        </span>
    );
}

export function DraftBadge({ dirty }: { dirty: boolean }) {
    const t = useT();
    if (!dirty) return null;
    return (
        <Badge icon={<CheckIcon />} tip={t("recruitment.bits.draftSaved")} tipSub={t("recruitment.bits.draftSavedSub")}>
            {t("recruitment.bits.draftSaved")}
        </Badge>
    );
}

export function StatusBadge({ status }: { status: string }) {
    const t = useT();
    if (status === "neu") return <Badge tone="accent" tip={t("recruitment.status.newTip")} tipSub={t("recruitment.status.newSub")}>{t("recruitment.status.new")}</Badge>;
    if (status === "archiviert") return <Badge tip={t("recruitment.status.archivedTip")} tipSub={t("recruitment.status.archivedSub")}>{t("recruitment.status.archived")}</Badge>;
    return <Badge tip={t("recruitment.status.openTip")} tipSub={t("recruitment.status.openSub")}>{t("recruitment.status.open")}</Badge>;
}

/** The class icon on a tile tinted in the class colour (IconTile only knows the area tones). */
export function ClassTile({ app }: { app: Application }) {
    const cc = app.classColor ? ({ "--cls": app.classColor } as React.CSSProperties) : undefined;
    return (
        <span className={`itile rc-cls${app.classColor ? " tinted" : " t-none"}`} style={cc} aria-hidden="true">
            <WowIcon name={app.classIcon || "inv_misc_questionmark"} size={22} />
        </span>
    );
}
