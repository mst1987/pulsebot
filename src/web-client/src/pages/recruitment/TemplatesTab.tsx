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
    const ask = useConfirm();
    const toast = useToast();
    const postedCount = (id: string) => data.posts.filter((p) => p.templateId === id).length;
    const sort = useTableSort<TemplateSortKey>("recruitment-templates-sort", TEMPLATE_SORT_DEFAULTS, "name");
    const sortValue = (t: RecruitmentTemplate, key: TemplateSortKey) => {
        switch (key) {
            case "name": return (t.name || "").toLowerCase();
            case "wanted": return specsInContent(t.content, data.specCatalog).map((s) => s.name).join(" ").toLowerCase();
            case "button": return (t.buttonLabel || "").toLowerCase();
            default: return postedCount(t.id);
        }
    };

    const remove = async (t: RecruitmentTemplate) => {
        if (!(await ask({ title: "Vorlage löschen?", text: `„${t.name || "(ohne Name)"}" wird gelöscht. Bereits gepostete Nachrichten bleiben bestehen.`, action: "Löschen" }))) return;
        try {
            await deleteRecruitmentTemplate(t.id);
            onChanged("Vorlage gelöscht.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <>
            <PartHead
                icon={ICONS.templates} tone="recruitment" title="Recruitment-Vorlagen" crumb="Recruitment › Vorlagen"
                tip="Vorlagen-Texte" tipSub="Der Bot nutzt sie beim Posten — hier und über den Discord-Befehl /recruitment."
                action={<Button variant="ghost" size="sm" icon={ICONS.templates} onClick={editor.startNew}>Neue Vorlage</Button>}
            />
            <DataTable
                rows={data.templates} rowKey={(t) => t.id} sort={sort} sortValue={sortValue}
                wrapClassName="rc-tbl" rowClassName="rc-row" onRowClick={(t) => editor.startEdit(t.id)}
                columns={[
                    { id: "name", label: "Name", sortKey: "name", cell: (t) => <div className="cname">{t.name || "(ohne Name)"}</div> },
                    { id: "wanted", label: "Gesucht", sortKey: "wanted", tip: "Gesuchte Specs", tipSub: "Aus den „##“-Zeilen des Texts.", width: 150, cell: (t) => <WantedIcons content={t.content} data={data} /> },
                    { id: "button", label: "Button", sortKey: "button", tip: "Button-Beschriftung", tipSub: "Leer = „Jetzt bewerben“.", width: 150, className: "csub", cell: (t) => t.buttonLabel || "—" },
                    { id: "posted", label: "Gepostet", sortKey: "posted", tip: "Gepostet", tipSub: "In wie vielen Channels dieses Servers die Vorlage gerade steht.", width: 110, cell: (t) => {
                        const n = postedCount(t.id);
                        return <Badge count tone={n ? "accent" : undefined}>{n}</Badge>;
                    } },
                    { id: "actions", width: 200, actions: true, cell: (t) => (
                        <div className="rc-acts">
                            <Button variant="run" size="sm" icon={ICONS.post} onClick={() => onPost(t.id)}>Posten</Button>
                            <IconButton size="sm" icon={<EditIcon />} tip="Bearbeiten" onClick={() => editor.startEdit(t.id)} />
                            <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip="Löschen" onClick={() => remove(t)} />
                        </div>
                    ) },
                ]}
                empty={(
                    <div className="rc-empty rc-empty-panel">
                        <Badge>Noch keine Vorlagen</Badge>
                        <Button variant="ghost" size="sm" icon={ICONS.templates} onClick={editor.startNew}>Neue Vorlage</Button>
                    </div>
                )}
            />
        </>
    );
}
