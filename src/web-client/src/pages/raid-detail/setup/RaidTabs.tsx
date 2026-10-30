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
import NumberStepper from "../../../components/ui/form/NumberStepper";
import Switch from "../../../components/ui/form/Switch";

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

/** The titles the server gives further raids: "<Titel> 2", "<Titel> 3" … from `from` on. */
function raidTitles(base: string, from: number, count: number): string[] {
    return Array.from({ length: count }, (_, i) => `${base} ${from + i}`);
}

/**
 * "Weiteren Raid hinzufügen" / "Auf 5 Raids aufteilen" (#1035): the raids in
 * total (−/+, from the raids there + 1 up to `max`, starting at the suggestion
 * from the signups), the title of a single new raid ("<Titel> 2", editable) or
 * the titles of the new ones ("Karazhan 2 … Karazhan 5"), and whether the group
 * is filled right after. `onCreate` gets the number of NEW raids.
 */
export function AddRaidModal({ open, onClose, suggested, primaryTitle, nextIndex, current = 1, initialTotal, max = 8, running, onCreate }: {
    open: boolean;
    onClose: () => void;
    /** the title offered for a single new raid */
    suggested: string;
    /** the first raid's title, the base of "<Titel> n" */
    primaryTitle: string;
    /** the index the first new raid gets */
    nextIndex: number;
    /** the raids the group has now */
    current?: number;
    /** the suggested number of raids in total */
    initialTotal?: number;
    /** the most raids a group can have */
    max?: number;
    running: boolean;
    onCreate: (title: string, count: number, fill: boolean) => void;
}) {
    const t = useT();
    const min = current + 1;
    const limit = Math.max(min, max);
    const start = Math.min(limit, Math.max(min, initialTotal ?? min));
    const [title, setTitle] = useState(suggested);
    const [total, setTotal] = useState(start);
    const [fill, setFill] = useState(true);
    useEffect(() => {
        if (!open) return;
        setTitle(suggested);
        setTotal(start);
        setFill(true);
    }, [open, suggested, start]);
    const count = total - current;
    const single = count === 1;
    const ready = !single || Boolean(title.trim());
    const create = () => { if (ready) onCreate(single ? title.trim() : "", count, fill); };
    const titles = raidTitles(primaryTitle, nextIndex, count);
    return (
        <Modal
            open={open} onClose={onClose} icon="members" tone="raids" kicker={primaryTitle}
            title={single ? t("setup.raidGroup.addTitle") : t("setup.raidGroup.splitTitle")} width={520}
            hint={t("setup.raidGroup.addText")}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon="members" running={running} disabled={!ready} onClick={create}>
                        {single ? t("setup.raidGroup.create") : t("setup.raidGroup.split", { count: total })}
                    </Button>
                </>
            )}
        >
            <form className="se-addraid-form" onSubmit={(e) => { e.preventDefault(); create(); }}>
                <Field className="field se-addraid" label={t("setup.raidGroup.countLabel")}>
                    <NumberStepper
                        value={total} min={min} max={limit} onChange={setTotal}
                        ariaLabel={t("setup.raidGroup.countLabel")} lessLabel={t("setup.raidGroup.countLess")} moreLabel={t("setup.raidGroup.countMore")}
                    />
                </Field>
                {single ? (
                    <Field className="field se-addraid" label={t("setup.raidGroup.titleLabel")} htmlFor="se-addraid-title">
                        <input id="se-addraid-title" value={title} maxLength={100} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
                    </Field>
                ) : (
                    <Field className="field se-addraid" label={t("setup.raidGroup.preview")}>
                        <p className="se-addraid-preview" data-testid="se-addraid-preview">
                            {titles.length > 2 ? `${titles[0]} … ${titles[titles.length - 1]}` : titles.join(", ")}
                        </p>
                    </Field>
                )}
                <Switch checked={fill} onChange={setFill} label={t("setup.raidGroup.fill")} tip={t("setup.raidGroup.fillTip")} />
            </form>
        </Modal>
    );
}
