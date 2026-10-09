import { useEffect, useRef, useState } from "react";
import type { SetupEditorData, StoredSetup } from "../../../api";
import { pingTextToSave, publishHint, setupState, GROUP_SIZE } from "../../../lib/signups/setupEditor";
import { belowEndPlacement } from "../../../lib/ui/popoverPosition";
import { useT } from "../../../i18n";
import { Button } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import Popover from "../../../components/ui/Popover";
import WowIcon from "../../../components/ui/WowIcon";
import { ChevronDownIcon } from "../../../components/ui/icons";
import { clock, dateTime, MAX_RAID_SIZE } from "./setupText";

/** One entry of the bar's "Mehr" menu. `on` marks a switch (fairness, the compact view …): checked or not. */
export type MoreItem = { id: string; label: string; sub: string; icon: string; on?: boolean; disabled?: boolean; onSelect: () => void };

/**
 * "Mehr ▾" in the bar: everything that is not the evening's one action — propose
 * anew, the group count, the ping text, the switches (fairness, wishes, "nicht
 * zusammen", bench in the post), the compact view, search, the AI explanation,
 * the weights. "sep" draws a line between kinds. Portalled like "Event verwalten".
 */
export function MoreMenu({ items }: { items: (MoreItem | "sep")[] }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const anchor = useRef<HTMLDivElement>(null);
    return (
        <div className="se-more" ref={anchor}>
            <Button
                variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={open}
                data-tip={open ? undefined : t("setup.editor.more")} data-tip-sub={open ? undefined : t("setup.editor.moreSub")}
                onClick={() => setOpen((o) => !o)}
            >
                {t("setup.editor.more")}<span className="se-more-chev" aria-hidden="true"><ChevronDownIcon /></span>
            </Button>
            {open && (
                <Popover anchor={anchor} place={belowEndPlacement()} follow="reposition" onClose={() => setOpen(false)} className="se-more-pop" role="menu">
                    {items.map((it, i) => (it === "sep" ? <div key={`sep-${i}`} className="se-more-sep" role="separator" /> : (
                        <button
                            key={it.id} type="button" role={it.on === undefined ? "menuitem" : "menuitemcheckbox"}
                            aria-checked={it.on === undefined ? undefined : it.on}
                            className={`se-more-item${it.on ? " is-on" : ""}`} disabled={it.disabled}
                            onClick={() => { setOpen(false); it.onSelect(); }}
                        >
                            <WowIcon name={it.icon} size={24} />
                            <span className="se-more-text">
                                <span className="se-more-label">{it.label}</span>
                                <span className="se-more-sub">{it.sub}</span>
                            </span>
                        </button>
                    )))}
                </Popover>
            )}
        </div>
    );
}

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

/**
 * The setup's ONE state, first in the bar (`setupState`): "Entwurf", "Freigegeben ·
 * nicht gepostet", "Gepostet · Stand 2" … — never "Gepostet" beside "noch nicht
 * gepostet". What the post will do or did (the old line under the bar, #290:
 * channel, DMs, failures, an outdated message) is its tooltip; while the DMs run
 * the badge says so.
 */
export function StatusBadge({ setup, publish }: { setup: StoredSetup; publish: SetupEditorData["publish"] }) {
    const t = useT();
    const state = setupState(setup, publish);
    const hint = publishHint(publish, setup.status === "approved", clock);
    const lines: string[] = [];
    if (hint) lines.push(hint.text);
    if (state.key === "draft") {
        lines.push(t("setup.status.draftSub"));
        if (setup.origin === "auto") lines.push(setup.updatedAt ? t("setup.status.autoSubAt", { time: dateTime(setup.updatedAt) }) : t("setup.status.autoSub"));
    } else if (state.key === "changed") {
        lines.push(setup.approved ? t("setup.status.changedSubSince", { time: dateTime(setup.approved.approvedAt) }) : t("setup.status.changedSub"));
    } else if (state.key === "posted" && setup.approvedAt) {
        lines.push(t("setup.status.approvedSubSince", { time: dateTime(setup.approvedAt) }));
    }
    if (hint && hint.sub) lines.push(hint.sub);
    const label = hint && hint.running ? `${state.label} · ${t("setup.state.dmsRunning")}` : state.label;
    return (
        <Badge tone={state.tone} className="se-state" tip={state.label} tipSub={lines.filter(Boolean).join("\n")}>
            {label}
        </Badge>
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
