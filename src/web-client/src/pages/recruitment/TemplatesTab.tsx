import { deleteRecruitmentTemplate, type ApiError, type RecruitmentData, type RecruitmentTemplate } from "../../api";
import type { CollectionEditor } from "../../lib/collectionEditor";
import { useTableSort, type Dir } from "../../lib/tableSort";
import { specsInContent } from "../../lib/recruitmentSpecs";
import { TrashIcon } from "../../components/icons";
import { useToast } from "../../components/Jobs";
import { useConfirm } from "../../components/ui/Modal";
import { Button, IconButton } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import DataTable from "../../components/ui/DataTable";
import { PartHead } from "../../components/ui/PartHead";
import { useT } from "../../i18n";
import { ICONS } from "./shared";
import { EditIcon, WantedIcons } from "./RecruitmentBits";

type TemplateSortKey = "name" | "wanted" | "button" | "posted";

const TEMPLATE_SORT_DEFAULTS: Record<TemplateSortKey, Dir> = { name: "asc", wanted: "asc", button: "asc", posted: "desc" };

export function TemplatesTab({ data, editor, onPost, onChanged }: {
    data: RecruitmentData;
    editor: CollectionEditor;
    onPost: (templateId: string) => void;
    onChanged: (msg: string) => void;
}) {
    const t = useT();
    const ask = useConfirm();
    const toast = useToast();
    const postedCount = (id: string) => data.posts.filter((p) => p.templateId === id).length;
    const sort = useTableSort<TemplateSortKey>("recruitment-templates-sort", TEMPLATE_SORT_DEFAULTS, "name");
    const sortValue = (tpl: RecruitmentTemplate, key: TemplateSortKey) => {
        switch (key) {
            case "name": return (tpl.name || "").toLowerCase();
            case "wanted": return specsInContent(tpl.content, data.specCatalog).map((s) => s.name).join(" ").toLowerCase();
            case "button": return (tpl.buttonLabel || "").toLowerCase();
            default: return postedCount(tpl.id);
        }
    };

    const remove = async (tpl: RecruitmentTemplate) => {
        if (!(await ask({ title: t("recruitment.templates.deleteTitle"), text: t("recruitment.templates.deleteText", { name: tpl.name || t("recruitment.templates.noName") }), action: t("common.delete") }))) return;
        try {
            await deleteRecruitmentTemplate(tpl.id);
            onChanged(t("recruitment.templates.deleted"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <>
            <PartHead
                icon={ICONS.templates} tone="recruitment" title={t("recruitment.templates.title")} crumb={t("recruitment.crumb.templates")}
                tip={t("recruitment.templates.tip")} tipSub={t("recruitment.templates.tipSub")}
                action={<Button variant="ghost" size="sm" icon={ICONS.templates} onClick={editor.startNew}>{t("recruitment.templates.new")}</Button>}
            />
            <DataTable
                rows={data.templates} rowKey={(tpl) => tpl.id} sort={sort} sortValue={sortValue}
                wrapClassName="rc-tbl" rowClassName="rc-row" onRowClick={(tpl) => editor.startEdit(tpl.id)}
                columns={[
                    { id: "name", label: t("recruitment.templates.colName"), sortKey: "name", cell: (tpl) => <div className="cname">{tpl.name || t("recruitment.templates.noName")}</div> },
                    { id: "wanted", label: t("recruitment.templates.colWanted"), sortKey: "wanted", tip: t("recruitment.posts.wantedTip"), tipSub: t("recruitment.posts.wantedSub"), width: 150, cell: (tpl) => <WantedIcons content={tpl.content} data={data} /> },
                    { id: "button", label: t("recruitment.templates.colButton"), sortKey: "button", tip: t("recruitment.templates.buttonTip"), tipSub: t("recruitment.templates.buttonSub"), width: 150, className: "csub", cell: (tpl) => tpl.buttonLabel || "—" },
                    { id: "posted", label: t("recruitment.templates.colPosted"), sortKey: "posted", tip: t("recruitment.templates.postedTip"), tipSub: t("recruitment.templates.postedSub"), width: 110, cell: (tpl) => {
                        const n = postedCount(tpl.id);
                        return <Badge count tone={n ? "accent" : undefined}>{n}</Badge>;
                    } },
                    { id: "actions", width: 200, actions: true, cell: (tpl) => (
                        <div className="rc-acts">
                            <Button variant="run" size="sm" icon={ICONS.post} onClick={() => onPost(tpl.id)}>{t("recruitment.templates.post")}</Button>
                            <IconButton size="sm" icon={<EditIcon />} tip={t("common.edit")} onClick={() => editor.startEdit(tpl.id)} />
                            <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip={t("common.delete")} onClick={() => remove(tpl)} />
                        </div>
                    ) },
                ]}
                empty={(
                    <div className="rc-empty rc-empty-panel">
                        <Badge>{t("recruitment.templates.empty")}</Badge>
                        <Button variant="ghost" size="sm" icon={ICONS.templates} onClick={editor.startNew}>{t("recruitment.templates.new")}</Button>
                    </div>
                )}
            />
        </>
    );
}
