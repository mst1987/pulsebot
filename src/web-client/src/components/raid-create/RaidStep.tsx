import { useT } from "../../i18n";
import { plannedSeats, withInstance, withSize, withVersion } from "../../lib/eventPlan";
import { Button } from "../ui/Button";
import Badge from "../ui/Badge";
import Segment from "../ui/Segment";
import CompositionEditor from "../CompositionEditor";
import { AppearanceFields, BuffPicker, InstancePicker, RoleRanges, SizePicker, SwitchRow } from "../RaidPlanFields";
import { CheckIcon } from "../icons";
import type { TemplateMode } from "./createHelpers";
import type { RaidCreateForm } from "./useRaidCreateForm";

/**
 * Step "Raid" (only for an EventHelper event, #261): version, instances, size,
 * tanks/healers large; ranges, required buffs and the switches behind "Mehr";
 * "Als Vorlage speichern" beside the version.
 */
export function RaidStep({ f }: { f: RaidCreateForm }) {
    const t = useT();
    const { form, patch, changePlan, versions, version, baseTemplate, problem, template } = f;
    const { plan, freeSize } = form;
    const moreCount = [plan.melee, plan.ranged].filter(Boolean).length + plan.requiredBuffs.length
        + (plan.fairness ? 1 : 0) + (plan.wishes ? 1 : 0) + (plan.autoSuggest ? 1 : 0)
        + (plan.overflow === "off" ? 1 : 0) + (plan.lockAtLimit ? 1 : 0)
        + (plan.color ? 1 : 0) + (plan.image.url ? 1 : 0) + (plan.emojiStyle !== "arcane" ? 1 : 0);
    const toggleBuff = (key: string) => changePlan({
        ...plan, requiredBuffs: plan.requiredBuffs.includes(key) ? plan.requiredBuffs.filter((b) => b !== key) : [...plan.requiredBuffs, key],
    });
    return (
        <>
            <div className="re-raid-head">
                <Segment size="sm" ariaLabel={t("raidCreate.raid.version")} value={plan.versionId}
                    onChange={(id) => { patch({ freeSize: false }); changePlan(withVersion(plan, versions.find((v) => v.id === id))); }}
                    options={versions.map((v) => ({ value: v.id, label: v.short, tip: v.label }))} />
                <span className="re-raid-tpl">
                    {baseTemplate && <Badge tip={t("raidCreate.raid.templateBadge")} tipSub={t("raidCreate.raid.templateBadgeSub")}>{baseTemplate.name}</Badge>}
                    <Button variant="ghost" size="sm" icon="inv_misc_note_05" onClick={template.openSave}>{t("raidCreate.raid.saveAsTemplate")}</Button>
                </span>
            </div>
            {template.open && (
                <div className="re-tpl-save" role="group" aria-label={t("raidCreate.raid.saveAsTemplate")}>
                    {baseTemplate && (
                        <Segment<TemplateMode> size="sm" ariaLabel={t("raidCreate.raid.tplMode")} value={template.mode} onChange={template.setMode}
                            options={[{ value: "update", label: t("raidCreate.raid.tplUpdate", { name: baseTemplate.name }) }, { value: "new", label: t("raidCreate.raid.tplNew") }]} />
                    )}
                    {template.mode === "new" && (
                        <input type="text" aria-label={t("raidCreate.raid.tplName")} value={template.name} onChange={(e) => template.setName(e.target.value)} placeholder={t("raidCreate.raid.tplNamePlaceholder")} />
                    )}
                    <span className="re-tpl-acts">
                        <Button variant="ghost" size="sm" onClick={() => template.setOpen(false)}>{t("common.cancel")}</Button>
                        <Button size="sm" running={template.saving} disabled={!!problem || (template.mode === "new" && !template.name.trim())} onClick={template.save}>{t("common.save")}</Button>
                    </span>
                </div>
            )}
            <InstancePicker version={version} value={plan.instanceIds} onToggle={(id) => changePlan(withInstance(plan, version, id))} />
            <SizePicker version={version} instanceIds={plan.instanceIds} size={plan.size} free={freeSize} onFree={(v) => patch({ freeSize: v })}
                onSize={(size) => changePlan(withSize(plan, version, size ?? 0))} />
            <CompositionEditor size={plan.size || null} value={{ tank: plan.tank, healer: plan.healer }}
                onChange={(c) => changePlan({ ...plan, tank: c.tank, healer: c.healer })} />
            <div className="re-fit" role="status">
                {problem
                    ? <Badge tone="bad">{problem}</Badge>
                    : <Badge tone="ok" icon={<CheckIcon />} tip={t("raidCreate.raid.fitTip")} tipSub={t("raidCreate.raid.fitTipSub")}>{t("raidCreate.raid.planned", { planned: plannedSeats(plan), size: plan.size })}</Badge>}
            </div>
            <details className="rt-more">
                <summary>{t("raidCreate.raid.more")}{moreCount ? <Badge count>{moreCount}</Badge> : null}</summary>
                <div className="rt-more-body">
                    <AppearanceFields idPrefix="re" version={version} instanceIds={plan.instanceIds} color={plan.color} image={plan.image} emojiStyle={plan.emojiStyle}
                        onChange={(look) => changePlan({ ...plan, ...look })} />
                    <RoleRanges idPrefix="re" melee={plan.melee} ranged={plan.ranged} onChange={(r) => changePlan({ ...plan, ...r })} />
                    <BuffPicker version={version} value={plan.requiredBuffs} onToggle={toggleBuff} />
                    <div className="rt-switches">
                        <SwitchRow label={t("raidCreate.raid.fairness")} tip={t("raidCreate.raid.fairnessTip")} checked={plan.fairness} onChange={(v) => changePlan({ ...plan, fairness: v })} />
                        <SwitchRow label={t("raidCreate.raid.wishes")} tip={t("raidCreate.raid.wishesTip")} checked={plan.wishes} onChange={(v) => changePlan({ ...plan, wishes: v })} />
                        <SwitchRow label={t("raidCreate.raid.autoSuggest")} tip={t("raidCreate.raid.autoSuggestTip")} checked={plan.autoSuggest} onChange={(v) => changePlan({ ...plan, autoSuggest: v })} />
                        <SwitchRow label={t("raidCreate.raid.overflow")} tip={t("raidCreate.raid.overflowTip")} checked={plan.overflow !== "off"} onChange={(v) => changePlan({ ...plan, overflow: v ? "bench" : "off" })} />
                        <SwitchRow label={t("raidCreate.raid.lockAtLimit")} tip={t("raidCreate.raid.lockAtLimitTip")} checked={plan.lockAtLimit} onChange={(v) => changePlan({ ...plan, lockAtLimit: v })} />
                    </div>
                </div>
            </details>
        </>
    );
}
