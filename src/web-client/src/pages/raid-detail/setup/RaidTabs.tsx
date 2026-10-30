// A raid group (#811) in the setup editor: the tabs "Raid 1 | Raid 2" over the
// editor — one per raid of the evening, each with its title, how many stand in it
// and its state. A click switches the editor to that raid; a raider dragged onto
// a tab (or picked first, then the tab clicked) goes onto that raid's first free
// place. "Angemeldet" is one pool for every raid, so the tabs are the only way
// between them. Also the dialog "Weiteren Raid hinzufügen".
import { useEffect, useState, type DragEvent } from "react";
import type { RaidGroup, RaidGroupRaid } from "../../../api";
import { useT } from "../../../i18n";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/overlay/Modal";
import Badge from "../../../components/ui/Badge";
import Field from "../../../components/ui/form/Field";

/** The state word of a raid's setup: empty, draft, approved or posted. */
function stateOf(raid: RaidGroupRaid): "none" | "draft" | "approved" | "posted" {
    if (raid.posted) return "posted";
    if (raid.approved && raid.status === "approved") return "approved";
    return raid.placed > 0 || raid.status !== "none" ? "draft" : "none";
}

function RaidTab({ raid, current, moving, editable, onSwitch, onMove }: {
    raid: RaidGroupRaid;
    current: boolean;
    /** a raider is being dragged or is picked: the other tabs are drop targets */
    moving: boolean;
    editable: boolean;
    onSwitch: (id: string) => void;
    onMove: (id: string, userId?: string) => void;
}) {
    const t = useT();
    const [over, setOver] = useState(false);
    const target = moving && !current && editable && !raid.cancelled;
    const state = stateOf(raid);
    const drop = target ? {
        onDragOver: (e: DragEvent<HTMLButtonElement>) => { e.preventDefault(); setOver(true); },
        onDragLeave: () => setOver(false),
        onDrop: (e: DragEvent<HTMLButtonElement>) => { e.preventDefault(); setOver(false); onMove(raid.id, e.dataTransfer.getData("text/plain") || undefined); },
    } : {};
    return (
        <button
            type="button" role="tab" aria-selected={current}
            className={`se-raidtab${current ? " se-current" : ""}${target ? " se-raidtab-target" : ""}${over ? " se-over" : ""}`}
            data-tip={t("setup.raidGroup.tabTip", { title: raid.title, placed: raid.placed, size: raid.size })}
            data-tip-sub={raid.index === 1 ? `${t("setup.raidGroup.primaryTip")} ${t("setup.raidGroup.tabSub")}` : t("setup.raidGroup.tabSub")}
            onClick={() => (target ? onMove(raid.id) : onSwitch(raid.id))}
            {...drop}
        >
            <span className="se-raidtab-no">{t("setup.raidGroup.tab", { index: raid.index })}</span>
            <span className="se-raidtab-title">{raid.title}</span>
            <span className="se-raidtab-count">{raid.placed}/{raid.size}</span>
            {target ? <span className="se-raidtab-here">{t("setup.raidGroup.dropHere")}</span> : <span className={`se-raidtab-state se-st-${state}`}>{t(`setup.raidGroup.state.${state}`)}</span>}
            {raid.index === 1 && <Badge tone="accent" className="se-raidtab-primary">{t("setup.raidGroup.primary")}</Badge>}
        </button>
    );
}

/** The raids of the group as tabs, plus how many stand in the other raids. */
export function RaidTabs({ group, current, moving, editable, elsewhere, onSwitch, onMove }: {
    group: RaidGroup;
    current: string;
    moving: boolean;
    editable: boolean;
    /** signed-up raiders standing in the other raids (not in "Angemeldet" here) */
    elsewhere: number;
    onSwitch: (id: string) => void;
    onMove: (id: string, userId?: string) => void;
}) {
    const t = useT();
    return (
        <div className="se-raidtabs" role="tablist" aria-label={t("setup.raidGroup.aria")}>
            {group.raids.map((raid) => (
                <RaidTab key={raid.id} raid={raid} current={raid.id === current} moving={moving} editable={editable} onSwitch={onSwitch} onMove={onMove} />
            ))}
            <span className="se-raidtabs-meta">
                {t("setup.raidGroup.places", { count: group.count, places: group.places })}
                {elsewhere > 0 && <> · {t("setup.raidGroup.elsewhere", { count: elsewhere })}</>}
            </span>
        </div>
    );
}

/** "Weiteren Raid hinzufügen": the title of the new raid ("<Titel> 2", editable), then create. */
export function AddRaidModal({ open, onClose, suggested, running, onCreate }: {
    open: boolean;
    onClose: () => void;
    suggested: string;
    running: boolean;
    onCreate: (title: string) => void;
}) {
    const t = useT();
    const [title, setTitle] = useState(suggested);
    useEffect(() => {
        if (open) setTitle(suggested);
    }, [open, suggested]);
    return (
        <Modal
            open={open} onClose={onClose} icon="members" tone="raids" kicker={t("setup.raidGroup.add")} title={t("setup.raidGroup.addTitle")} width={520}
            hint={t("setup.raidGroup.addText")}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon="members" running={running} disabled={!title.trim()} onClick={() => onCreate(title.trim())}>{t("setup.raidGroup.create")}</Button>
                </>
            )}
        >
            <form onSubmit={(e) => { e.preventDefault(); if (title.trim()) onCreate(title.trim()); }}>
                <Field className="field se-addraid" label={t("setup.raidGroup.titleLabel")} htmlFor="se-addraid-title">
                    <input id="se-addraid-title" value={title} maxLength={100} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
                </Field>
            </form>
        </Modal>
    );
}
