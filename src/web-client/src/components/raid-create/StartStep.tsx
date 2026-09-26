import { Link } from "react-router-dom";
import type { RaidCreateContext, RaidTemplate } from "../../api";
import { useT } from "../../i18n";
import { instancesOf } from "../../lib/raidTemplates";
import Badge from "../ui/Badge";
import Segment from "../ui/Segment";
import WowIcon from "../ui/WowIcon";
import RaidIcon from "../RaidIcon";
import { EMPTY_ICON, type StartTab } from "./createHelpers";
import { EventSub, IconStack, Label, OptionCard } from "./CreateParts";
import type { RaidCreateForm } from "./useRaidCreateForm";

/** Step "Vorlage": repeat the latest event of a category, start from a raid template, or start empty. */
export function StartStep({ f, ctx }: { f: RaidCreateForm; ctx: RaidCreateContext }) {
    const t = useT();
    const { choice, versions, raidTemplates, options, startTab, setStartTab, applyChoice } = f;
    const templateCard = (tpl: RaidTemplate) => {
        const v = versions.find((x) => x.id === tpl.versionId);
        const insts = instancesOf(v, tpl.instanceIds);
        const facts = [
            v?.short || tpl.versionId,
            tpl.size ? t("raidCreate.start.players", { count: tpl.size }) : "",
            tpl.size ? t("raidCreate.start.composition", { tank: tpl.composition.tank, healer: tpl.composition.healer }) : "",
        ];
        return (
            <OptionCard
                key={tpl.id}
                selected={choice?.kind === "template" && choice.id === tpl.id}
                onSelect={() => applyChoice(ctx, { kind: "template", id: tpl.id })}
                icon={<IconStack icons={insts.map((i) => i.icon)} />}
                title={tpl.name || t("raidCreate.noName")}
                sub={(
                    <>
                        <span>{facts.filter(Boolean).join(" · ")}</span>
                        {tpl.incomplete && <Badge tone="mid">{t("raidCreate.incomplete")}</Badge>}
                        {tpl.needsSize && <Badge tone="mid">{t("raidCreate.start.needsSize")}</Badge>}
                    </>
                )}
            />
        );
    };
    return (
        <>
            <div className="re-label-row re-start-head">
                <Label text={t("raidCreate.start.label")} tip={t("raidCreate.start.tip")} />
                <Segment<StartTab> size="sm" ariaLabel={t("raidCreate.start.ariaLabel")} value={startTab} onChange={setStartTab}
                    options={[{ value: "events", label: t("raidCreate.start.tabEvents") }, { value: "templates", label: t("raidCreate.templatesLink") }]} />
            </div>
            <div className="re-opts" role="radiogroup" aria-label={t("raidCreate.start.group")}>
                {startTab === "events"
                    ? options.map((ev) => (
                        <OptionCard
                            key={ev.id}
                            selected={choice?.kind === "event" && choice.id === ev.id}
                            onSelect={() => applyChoice(ctx, { kind: "event", id: ev.id })}
                            icon={<RaidIcon contentIds={ev.contentIds} sources={["title"]} />}
                            title={ev.title || t("raidCreate.noTitle")}
                            sub={<EventSub ev={ev} />}
                        />
                    ))
                    : raidTemplates.map(templateCard)}
                {startTab === "events" && !options.length && <div className="re-empty">{t("raidCreate.start.noEvents")}</div>}
                {startTab === "templates" && !raidTemplates.length && (
                    <div className="re-empty">{t("raidCreate.start.noTemplates")} <Link className="re-link" to="/raids/raid-templates">{t("raidCreate.templatesLink")}</Link></div>
                )}
                <span className="re-opts-sep" aria-hidden="true" />
                <OptionCard
                    selected={choice?.kind === "empty"}
                    onSelect={() => applyChoice(ctx, { kind: "empty", id: "" })}
                    icon={<span className="raid-ic"><WowIcon name={EMPTY_ICON} size={36} className="a" /></span>}
                    title={t("raidCreate.start.empty")}
                    sub={t("raidCreate.start.emptySub")}
                />
            </div>
        </>
    );
}
