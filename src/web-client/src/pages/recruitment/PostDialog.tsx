import { useEffect, useMemo, useState, type ReactNode } from "react";
import { postRecruitmentTemplate, type ApiError, type RecruitmentData, type TextChannel } from "../../api";
import { useDraftState } from "../../lib/persistedState";
import DiscordPreview from "./DiscordPreview";
import { useToast } from "../../components/Jobs";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import { TipLabel, WantedIcons } from "./RecruitmentBits";
import { ICONS } from "./shared";

export function PostDialog({ data, presetTemplateId, onPosted, onClose }: {
    data: RecruitmentData;
    presetTemplateId: string;
    onPosted: (msg: string) => void;
    onClose: () => void;
}) {
    const [target, patchTarget] = useDraftState("recruitment-post-target", { templateId: data.templates[0]?.id ?? "", channelId: "" });
    const [posting, setPosting] = useState(false);
    const toast = useToast();

    // "Posten" on a template row picks that template.
    useEffect(() => {
        if (presetTemplateId) patchTarget({ templateId: presetTemplateId });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [presetTemplateId]);

    const template = data.templates.find((t) => t.id === target.templateId) || data.templates[0] || null;
    const byCategory = useMemo(() => {
        const groups = new Map<string, TextChannel[]>();
        for (const c of data.channels) {
            const key = c.category || "Ohne Kategorie";
            groups.set(key, [...(groups.get(key) || []), c]);
        }
        return [...groups.entries()];
    }, [data.channels]);

    const ready = !!(data.activeGuildId && template && target.channelId);
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!template) return;
        setPosting(true);
        try {
            await postRecruitmentTemplate({ templateId: template.id, channelId: target.channelId });
            onPosted("Nachricht gepostet.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setPosting(false);
        }
    };

    let body: ReactNode;
    if (!data.activeGuildId) {
        body = <div className="rc-empty"><Badge tone="mid">Kein Server gewählt</Badge><span>Wähle oben einen Server, um eine Nachricht zu posten.</span></div>;
    } else if (!data.templates.length) {
        body = <div className="rc-empty"><Badge tone="mid">Keine Vorlage</Badge><span>Lege zuerst eine Vorlage an, um sie posten zu können.</span></div>;
    } else {
        body = (
            <form id="rc-postdlg-form" onSubmit={submit} className="rc-editor">
                <div className="rc-fields">
                    <div className="field">
                        <TipLabel label="Vorlage" htmlFor="rc-pick-template" />
                        <select id="rc-pick-template" value={template?.id || ""} onChange={(e) => patchTarget({ templateId: e.target.value })} required>
                            {data.templates.map((t) => <option key={t.id} value={t.id}>{t.name || "(ohne Name)"}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <TipLabel label="Ziel-Channel" htmlFor="rc-pick-channel" tip="Ziel-Channel" tipSub="Der Bot postet die Nachricht dort mit Bewerben-Button und merkt sie sich zum späteren Bearbeiten." />
                        {data.channels.length
                            ? (
                                <select id="rc-pick-channel" value={target.channelId} onChange={(e) => patchTarget({ channelId: e.target.value })} required>
                                    <option value="">— Channel wählen —</option>
                                    {byCategory.map(([cat, list]) => (
                                        <optgroup key={cat} label={cat}>
                                            {list.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
                                        </optgroup>
                                    ))}
                                </select>
                            )
                            : (
                                <input
                                    id="rc-pick-channel" type="text" value={target.channelId}
                                    onChange={(e) => patchTarget({ channelId: e.target.value })} placeholder="Channel-ID" required
                                />
                            )}
                    </div>
                    {template && (
                        <div className="rc-postdlg-meta">
                            <span className="kicker">Gesucht</span>
                            <WantedIcons content={template.content} data={data} />
                        </div>
                    )}
                </div>
                <div className="rc-preview">
                    <div className="kicker rc-preview-head">Vorschau in Discord</div>
                    {template && <DiscordPreview content={template.content} buttonLabel={template.buttonLabel} emojis={data.emojis} channels={data.channels} />}
                </div>
            </form>
        );
    }

    return (
        <Modal
            open onClose={onClose} width={data.activeGuildId && data.templates.length ? 1040 : 520}
            icon={ICONS.post} tone="recruitment" kicker="Recruitment" title="Nachricht posten" initialFocus="select, .btn-ghost"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    {data.activeGuildId && data.templates.length > 0 && (
                        <Button type="submit" form="rc-postdlg-form" icon={ICONS.post} running={posting} disabled={!ready}>In Channel posten</Button>
                    )}
                </>
            )}
        >
            {body}
        </Modal>
    );
}
