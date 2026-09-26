import { useState, type ReactNode } from "react";
import { getRecruitmentData, type RecruitmentData } from "../../api";
import { useApi } from "../../hooks/useApi";
import AsyncView from "../../components/ui/AsyncView";
import { usePersistedSearchParam } from "../../lib/persistedState";
import { useCollectionEditor } from "../../lib/collectionEditor";
import { useToast } from "../../components/Jobs";
import { Button } from "../../components/ui/Button";
import PageHead from "../../components/ui/PageHead";
import WowIcon from "../../components/ui/WowIcon";
import "../../styles/recruitment.css";
import RaidLoader from "../../components/ui/RaidLoader";
import { useT } from "../../i18n";
import { ICONS } from "./shared";
import { ApplicationsTab } from "./ApplicationsTab";
import { TemplatesTab } from "./TemplatesTab";
import { PostsTab } from "./PostsTab";
import { PostEditor, TemplateEditor } from "./Editors";
import { PostDialog } from "./PostDialog";

// Recruitment (design issue #215): three tabs of compact tables — posted
// messages, templates, applications — and everything that is more than a row
// in a modal: the template/post editor with its live Discord preview, the
// "post a message" dialog and an application's details. The editors stay in the
// url (?edit=<id|new>, ?editpost=<id|new>), so a link to a template still opens
// it; "new" on editpost is the posting dialog.

type View = "posts" | "templates" | "applications";

const VIEWS: View[] = ["posts", "templates", "applications"];

function SubNav({ view, data, onChange }: { view: View; data: RecruitmentData; onChange: (v: View) => void }) {
    const t = useT();
    const apps = data.applications;
    const fresh = apps ? apps.filter((a) => a.status === "neu").length : 0;
    const tabs: { id: View; label: string; icon: string; count: ReactNode; accent?: boolean }[] = [
        { id: "posts", label: t("recruitment.tabs.posts"), icon: ICONS.posts, count: data.posts.length },
        { id: "templates", label: t("recruitment.tabs.templates"), icon: ICONS.templates, count: data.templates.length },
        { id: "applications", label: t("recruitment.tabs.applications"), icon: ICONS.applications, count: apps ? (fresh ? t("recruitment.tabs.appCount", { total: apps.length, fresh }) : apps.length) : null, accent: fresh > 0 },
    ];
    return (
        <div className="subnav rc-subnav" role="tablist">
            {tabs.map((tab) => (
                <button
                    key={tab.id} type="button" role="tab" aria-selected={view === tab.id}
                    className={`subnav-item${view === tab.id ? " active" : ""}`}
                    onClick={() => onChange(tab.id)}
                >
                    <WowIcon name={tab.icon} size={22} />
                    {tab.label}
                    {tab.count !== null && tab.count !== 0 && <span className={`subnav-count${tab.accent ? " accent" : ""}`}>{tab.count}</span>}
                </button>
            ))}
        </div>
    );
}

export default function RecruitmentPage() {
    const t = useT();
    const templateEditor = useCollectionEditor("edit");
    const postEditor = useCollectionEditor("editpost");
    const [storedView, setStoredView] = usePersistedSearchParam<View>("recruitment-view", "view", "posts", VIEWS);
    // An open editor forces its own tab: a link to ?edit=<id> lands on the
    // template it names, whichever tab was last open. The posting dialog
    // (?editpost=new) opens over whichever tab it was started from.
    const view: View = templateEditor.open ? "templates" : postEditor.editId ? "posts" : storedView;
    const [presetTemplateId, setPresetTemplateId] = useState("");

    const toast = useToast();

    // The lists carry every template and post in full, so the editors take
    // their entry from there; the server is asked for none. Closing an editor
    // reloads too: coming back from a save has to show the changed list, and
    // that is the same transition.
    const recruitment = useApi(() => getRecruitmentData({ view }), [view, templateEditor.open === "", postEditor.open === ""]);

    // Switching the tab always leaves whichever editor was open — otherwise it
    // would keep forcing its own tab back on.
    const switchView = (v: View) => setStoredView(v, (p) => { p.delete("edit"); p.delete("editpost"); });

    const afterChange = (msg: string) => {
        toast(msg);
        if (templateEditor.open) templateEditor.close();
        else if (postEditor.open) postEditor.close();
        else recruitment.reload();
    };

    const openPostDialog = (templateId = "") => {
        setPresetTemplateId(templateId);
        postEditor.startNew();
    };

    return (
        <AsyncView state={recruitment} loading={<RaidLoader text={t("recruitment.page.loading")} />} error={(err) => <div className="empty">{t("recruitment.page.loadError", { message: err.message })}</div>}>
            {(data) => {
                // An id that no longer exists (deleted in another tab, stale link) falls
                // back to the new-editor resp. the posting dialog rather than to nothing.
                const editingTemplate = templateEditor.editId ? data.templates.find((tpl) => tpl.id === templateEditor.editId) || null : null;
                const editingPost = postEditor.editId ? data.posts.find((p) => p.id === postEditor.editId) || null : null;

                return (
                    <div className="rc-page">
                        <PageHead
                            icon={ICONS.page} tone="recruitment" kicker={data.guildName || t("recruitment.page.serverFallback")} title={t("recruitment.page.title")}
                            action={<Button icon={ICONS.post} onClick={() => openPostDialog()}>{t("recruitment.page.postMessage")}</Button>}
                        />
                        <SubNav view={view} data={data} onChange={switchView} />
                        {view === "applications" && <ApplicationsTab data={data} />}
                        {view === "templates" && (
                            <TemplatesTab data={data} editor={templateEditor} onPost={openPostDialog} onChanged={afterChange} />
                        )}
                        {view === "posts" && (
                            <PostsTab data={data} editor={postEditor} onChanged={afterChange} reload={recruitment.reload} />
                        )}

                        {templateEditor.open && (
                            <TemplateEditor
                                key={editingTemplate?.id ?? "new"} data={data} template={editingTemplate}
                                postedIn={editingTemplate ? data.posts.filter((p) => p.templateId === editingTemplate.id).length : 0}
                                onSaved={afterChange} onClose={templateEditor.close}
                            />
                        )}
                        {postEditor.open && editingPost && (
                            <PostEditor
                                key={editingPost.id} data={data} post={editingPost}
                                templateName={data.templates.find((tpl) => tpl.id === editingPost.templateId)?.name || ""}
                                onSaved={afterChange} onClose={postEditor.close}
                            />
                        )}
                        {postEditor.open && !editingPost && (
                            <PostDialog data={data} presetTemplateId={presetTemplateId} onPosted={afterChange} onClose={postEditor.close} />
                        )}
                    </div>
                );
            }}
        </AsyncView>
    );
}
