import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SetupEditorData, StoredSetup } from "../../../api";
import { pingTextToSave, publishHint, GROUP_SIZE } from "../../../lib/setupEditor";
import { useT } from "../../../i18n";
import { Button } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import WowIcon from "../../../components/ui/WowIcon";
import { clock, dateTime, MAX_RAID_SIZE } from "./setupText";

/**
 * The raid size, editable right in the bar (#354): a change reshuffles groups
 * and bench live in the browser (`resizeLineup`), then commits — on blur or
 * Enter, not per keystroke, so a half-typed number never triggers a reshuffle.
 * "Unsaved" shows for the moment the typed value differs from what is stored.
 */
export function SizeControl({ size, disabled, onCommit }: { size: number; disabled: boolean; onCommit: (size: number) => void }) {
    const t = useT();
    // the size is entered as a number of groups; the total (groups times 5) is calculated
    const groups = Math.max(1, Math.ceil(size / GROUP_SIZE));
    const maxGroups = Math.floor(MAX_RAID_SIZE / GROUP_SIZE);
    const [text, setText] = useState(String(groups));
    useEffect(() => setText(String(groups)), [groups]);
    const parsed = Math.round(Number(text));
    const valid = text.trim() !== "" && Number.isFinite(parsed) && parsed >= 1 && parsed <= maxGroups;
    const dirty = valid && parsed !== groups;
    const commit = () => {
        if (valid && parsed !== groups) onCommit(parsed * GROUP_SIZE);
        else setText(String(groups));
    };
    return (
        <label className="se-size" data-tip={t("setup.editor.sizeTip")} data-tip-sub={t("setup.editor.sizeSub")}>
            <span className="kicker">{t("setup.editor.sizeLabel")}</span>
            <input
                type="number" min={1} max={maxGroups} step={1} value={text} disabled={disabled}
                onChange={(e) => setText(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                aria-label={t("setup.editor.sizeLabel")}
            />
            <span className="se-size-total">{t("setup.editor.sizeTotal", { size: (valid ? parsed : groups) * GROUP_SIZE, perGroup: GROUP_SIZE })}</span>
            {dirty && <span className="se-size-dirty" data-tip={t("setup.editor.sizeUnsavedTip")}>{t("setup.editor.sizeUnsaved")}</span>}
        </label>
    );
}

export function StatusBadge({ setup }: { setup: StoredSetup }) {
    const t = useT();
    if (setup.status === "approved") {
        return (
            <Badge
                tone="ok" tip={t("setup.status.approved")}
                tipSub={setup.approvedAt ? t("setup.status.approvedSubSince", { time: dateTime(setup.approvedAt) }) : t("setup.status.approvedSub")}
            >
                {t("setup.status.approved")}
            </Badge>
        );
    }
    if (setup.changedSinceApproval) {
        return (
            <Badge tone="mid" tip={t("setup.status.changedTip")} tipSub={setup.approved ? t("setup.status.changedSubSince", { time: dateTime(setup.approved.approvedAt) }) : t("setup.status.changedSub")}>
                {t("setup.status.changed")}
            </Badge>
        );
    }
    const draft = <Badge tone="mid" tip={t("setup.status.draft")} tipSub={t("setup.status.draftSub")}>{t("setup.status.draft")}</Badge>;
    if (setup.origin !== "auto") return draft;
    return (
        <>
            {draft}
            <Badge tone="accent" tip={t("setup.status.autoTip")} tipSub={setup.updatedAt ? t("setup.status.autoSubAt", { time: dateTime(setup.updatedAt) }) : t("setup.status.autoSub")}>
                {t("setup.status.auto")}
            </Badge>
        </>
    );
}

/**
 * One calm line under the bar (#290): before the approval what it will post and
 * send, after it what it did — the details in the tooltip, one "Setup posten".
 */
export function PublishLine({ data, setup, busy, posting, onPost }: {
    data: SetupEditorData;
    setup: StoredSetup;
    busy: boolean;
    posting: boolean;
    onPost: () => void;
}) {
    const t = useT();
    const hint = publishHint(data.publish, setup.status === "approved", clock);
    if (!hint) return null;
    return (
        <div className={`se-publish${hint.tone ? ` se-publish-${hint.tone}` : ""}`}>
            <WowIcon name="inv_letter_15" size={18} />
            <span className="se-publish-text" data-tip={hint.tip} data-tip-sub={hint.sub}>{hint.text}</span>
            {!data.publish?.dmsEnabled && !hint.canPost && !data.publish?.cancelled && (
                <Link className="se-publish-link" to="/settings?section=kategorien">{t("setup.publishLine.enableDms")}</Link>
            )}
            {hint.canPost && (
                <Button
                    variant="ghost" size="sm" icon="inv_letter_15" running={posting || hint.running} disabled={busy}
                    data-tip={t("setup.publishLine.post")}
                    data-tip-sub={t("setup.publishLine.postSub")}
                    onClick={onPost}
                >
                    {t("setup.publishLine.post")}
                </Button>
            )}
        </div>
    );
}

/**
 * The text everyone placed gets pinged with when the setup is posted (matches
 * the "Ping everyone" modal on the Discord side) — a minor, always-visible
 * supplementary control. Commits on blur or Enter, never per keystroke.
 */
export function PingTextField({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (text: string) => void }) {
    const t = useT();
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const commit = () => {
        const next = pingTextToSave(draft, value);
        if (next !== null) onSave(next);
    };
    return (
        <div className="se-pingtext">
            <span className="se-pingtext-label" data-tip={t("setup.pingText.tip")}>
                📢 {t("setup.pingText.title")}
            </span>
            <input
                type="text"
                className="se-pingtext-input"
                value={draft}
                maxLength={300}
                disabled={disabled}
                aria-label={t("setup.pingText.label")}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }}
            />
            <span className="se-pingtext-hint">{t("setup.pingText.hint")}</span>
        </div>
    );
}
