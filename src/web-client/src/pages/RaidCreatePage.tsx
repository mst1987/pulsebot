import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import {
    getRaidCreateContext, createRaid, getRaidTemplates, createRaidTemplate, deleteRaidTemplate, importRaidTemplates,
    type ApiError, type RaidCreateContext, type RaidTemplate,
} from "../api";
import type { ShellContext } from "../components/Shell";
import { TrashIcon } from "../components/icons";

function ChannelField({ channels, value, onChange }: { channels: RaidCreateContext["channels"]; value: string; onChange: (v: string) => void }) {
    if (!channels.length) {
        return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Channel-ID (kein Server gewählt)" required />;
    }
    return (
        <select value={value} onChange={(e) => onChange(e.target.value)} required>
            <option value="">— Channel wählen —</option>
            {channels.map((c) => (
                <option key={c.id} value={c.id}>#{c.name}{c.category ? ` · ${c.category}` : ""}</option>
            ))}
        </select>
    );
}

function TemplatesPanel({ templates, csrfToken, onChanged }: {
    templates: RaidTemplate[];
    csrfToken: string | null;
    onChanged: (templates: RaidTemplate[]) => void;
}) {
    const [id, setId] = useState("");
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);

    const refresh = () => getRaidTemplates().then((r) => onChanged(r.templates));

    const add = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await createRaidTemplate(csrfToken, { id, name });
            setId("");
            setName("");
            setMsg("Gespeichert.");
            await refresh();
        } catch (err) {
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    const remove = async (templateId: string) => {
        if (!confirm("Template aus der Liste entfernen?")) return;
        setBusy(true);
        try {
            await deleteRaidTemplate(csrfToken, templateId);
            await refresh();
        } catch (err) {
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    const importFromRaidHelper = async () => {
        setBusy(true);
        setError(null);
        setMsg(null);
        try {
            const r = await importRaidTemplates(csrfToken);
            onChanged(r.templates);
            setMsg(`${r.added} neu, ${r.updated} aktualisiert.`);
        } catch (err) {
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <h2>Raid-Helper-Templates</h2>
            <p className="note">Raid-Helper bietet keinen Endpunkt zum Auflisten von Templates. Der Bot pflegt daher eine eigene Liste — automatisch aus den bestehenden Events deines Servers geladen oder von Hand ergänzt. Sie füllt die Auswahl oben.</p>
            {error && <p className="sub" style={{ color: "var(--high)" }}>{error}</p>}
            {msg && <p className="sub" style={{ color: "var(--good)" }}>{msg}</p>}
            {templates.length
                ? (
                    <table className="idx" style={{ marginBottom: 14 }}>
                        <thead><tr><th>Name</th><th className="small">Template-ID</th><th /></tr></thead>
                        <tbody>
                            {templates.map((t) => (
                                <tr key={t.id}>
                                    <td><strong>{t.name || "(ohne Name)"}</strong></td>
                                    <td className="small">{t.id}</td>
                                    <td className="row-actions">
                                        <button className="btn btn-danger" type="button" disabled={busy} onClick={() => remove(t.id)}><TrashIcon />Entfernen</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )
                : <p className="sub">Noch keine Templates gespeichert.</p>}
            <div className="row-actions" style={{ marginBottom: 14 }}>
                <button className="btn btn-ghost" type="button" disabled={busy} onClick={importFromRaidHelper}>
                    {busy ? "Lädt …" : "Aus Raid-Helper laden"}
                </button>
            </div>
            <form className="card-form" onSubmit={add}>
                <div className="field"><label>Template-ID</label><input type="text" value={id} onChange={(e) => setId(e.target.value)} placeholder="z.B. 3" required /></div>
                <div className="field"><label>Name</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. GDKP Karazhan" /></div>
                <div className="row-actions"><button className="btn" type="submit" disabled={busy}>Template speichern</button></div>
            </form>
        </>
    );
}

export default function RaidCreatePage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const navigate = useNavigate();
    const [ctx, setCtx] = useState<RaidCreateContext | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const [sourceEventId, setSourceEventId] = useState("");
    const [title, setTitle] = useState("");
    const [date, setDate] = useState("");
    const [time, setTime] = useState("");
    const [templateId, setTemplateId] = useState("");
    const [channelId, setChannelId] = useState("");
    const [channelName, setChannelName] = useState("");
    const [leaderId, setLeaderId] = useState("");
    const [description, setDescription] = useState("");

    const [searchParams] = useSearchParams();

    useEffect(() => {
        getRaidCreateContext()
            .then((data) => {
                setCtx(data);
                setLeaderId(data.leaderId);
                // ?source=<eventId> pre-selects that event in the reuse picker, e.g.
                // when following a category's "＋ Event" quick-add link (RaidsPage.tsx).
                const sourceId = searchParams.get("source") || "";
                const source = sourceId ? data.reusableEvents.find((e) => e.id === sourceId) : null;
                if (source) {
                    setSourceEventId(source.id);
                    setTitle(source.title || "");
                    setTemplateId(source.templateId || "");
                    setDescription(source.description || "");
                    setChannelName(source.channelName || "");
                } else {
                    setTemplateId(data.defaults.templateId);
                    setChannelId(data.defaults.channelId);
                }
            })
            .catch((err: ApiError) => setError(err));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!ctx) return <div className="empty">Lade…</div>;

    const reusing = !!sourceEventId;

    const selectSource = (id: string) => {
        setSourceEventId(id);
        const ev = ctx.reusableEvents.find((e) => e.id === id);
        if (ev) {
            setTitle(ev.title || "");
            setTemplateId(ev.templateId || "");
            setDescription(ev.description || "");
            setChannelName(ev.channelName || "");
        }
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setSaveError(null);
        try {
            await createRaid(csrfToken, {
                title, date, time, templateId,
                ...(reusing ? { sourceEventId, channelName } : { channelId }),
                leaderId, description,
            });
            navigate("/raids", { state: { flash: { type: "ok", text: "Event angelegt." } } });
        } catch (err) {
            setSaveError((err as ApiError).message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <p className="note"><a className="mlink" href="/raids">← Zurück zur Event-Übersicht</a></p>
            <h1 className="page-title">Neues Raid-Event anlegen</h1>
            <p className="note">Legt über die Raid-Helper-API ein echtes Event mit Signup-Nachricht an. Standardwerte kommen aus den <a href="/settings">Einstellungen</a>.</p>

            <form className="card-form" onSubmit={submit}>
                {saveError && <p className="sub" style={{ color: "var(--high)" }}>{saveError}</p>}

                {ctx.reusableEvents.length > 0 && (
                    <div className="field">
                        <label>Vorhandenes Event wiederverwenden (optional)</label>
                        <select value={sourceEventId} onChange={(e) => selectSource(e.target.value)}>
                            <option value="">— Neues Event von Grund auf —</option>
                            {ctx.reusableEvents.map((ev) => (
                                <option key={ev.id} value={ev.id}>{ev.title || "(ohne Titel)"}{ev.channelName ? ` · #${ev.channelName}` : ""}</option>
                            ))}
                        </select>
                        <div className="hint">Übernimmt Titel, Template und Beschreibung. Der Channel des Events wird für das neue Datum geklont — den Namen unten anpassen.</div>
                    </div>
                )}

                <div className="field"><label>Titel</label><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="GDKP Karazhan" required /></div>
                <div className="field"><label>Datum</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
                <div className="field"><label>Uhrzeit</label><input type="time" value={time} onChange={(e) => setTime(e.target.value)} placeholder="20:00" required /></div>

                <div className="field">
                    <label>Template</label>
                    <input
                        type="text" list="raidTemplateList" value={templateId} onChange={(e) => setTemplateId(e.target.value)}
                        placeholder="Template wählen oder ID eintippen" autoComplete="off" required
                    />
                    <datalist id="raidTemplateList">
                        {ctx.templates.map((t) => <option key={t.id} value={t.id}>{t.name || "(ohne Name)"}</option>)}
                    </datalist>
                    <div className="hint">{ctx.templates.length ? "Aus der Liste wählen oder eine eigene Raid-Helper-Template-ID eintippen." : "Noch keine Templates hinterlegt — Raid-Helper-Template-ID eintippen oder unten laden/anlegen."}</div>
                </div>

                {!reusing && (
                    <div className="field">
                        <label>Channel</label>
                        <ChannelField channels={ctx.channels} value={channelId} onChange={setChannelId} />
                        <div className="hint">Text-Channels des oben gewählten Servers.</div>
                    </div>
                )}
                {reusing && (
                    <div className="field">
                        <label>Channelname (neuer Klon)</label>
                        <input type="text" value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="z.B. gdkp-kara-24-07" required />
                        <div className="hint">Aus dem gewählten Event vorbelegt — hier anpassen. Der Channel wird geklont (Rechte, Thema) und das neue Event darin gepostet.</div>
                    </div>
                )}

                <div className="field">
                    <label>Event-Leiter (Discord-User-ID)</label>
                    <input type="text" value={leaderId} onChange={(e) => setLeaderId(e.target.value)} required />
                    <div className="hint">Vorbelegt mit deiner ID.</div>
                </div>
                <div className="field">
                    <label>Beschreibung (optional)</label>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Weitere Infos zum Raid …" />
                </div>

                <div className="row-actions">
                    <button className="btn" type="submit" disabled={saving}>{saving ? "Wird angelegt…" : "Event anlegen"}</button>
                    <a className="btn btn-ghost" href="/raids">Abbrechen</a>
                </div>
            </form>

            <TemplatesPanel templates={ctx.templates} csrfToken={csrfToken} onChanged={(templates) => setCtx({ ...ctx, templates })} />
        </>
    );
}
