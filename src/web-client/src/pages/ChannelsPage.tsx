import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getChannels, createChannel, duplicateChannel, type ApiError, type ChannelsData } from "../api";
import type { ShellContext } from "../components/Shell";

type Flash = { type: "ok" | "err"; text: string };

const CHANNEL_TYPES = [
    { value: "text", label: "Text" },
    { value: "voice", label: "Voice" },
    { value: "announcement", label: "Ankündigung" },
    { value: "forum", label: "Forum" },
    { value: "stage", label: "Stage" },
];

function FlashBanner({ flash }: { flash: Flash | null }) {
    if (!flash) return null;
    return (
        <p className="sub" style={{ color: flash.type === "err" ? "var(--high)" : "var(--good)" }}>
            {flash.text}
        </p>
    );
}

function CreateChannelForm({ data, csrfToken, onCreated }: {
    data: ChannelsData;
    csrfToken: string | null;
    onCreated: (msg: string) => void;
}) {
    const [name, setName] = useState("");
    const [type, setType] = useState("text");
    const [parentId, setParentId] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const created = await createChannel(csrfToken, { name, type, parentId });
            setName("");
            setType("text");
            setParentId("");
            onCreated(`Kanal #${created.name} erstellt.`);
        } catch (err) {
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="card-form" onSubmit={submit}>
            {error && <p className="sub" style={{ color: "var(--high)" }}>{error}</p>}
            <div className="field">
                <label>Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. kara-signup" required />
            </div>
            <div className="field">
                <label>Typ</label>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                    {CHANNEL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
            </div>
            <div className="field">
                <label>Kategorie</label>
                <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                    <option value="">— keine Kategorie —</option>
                    {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </div>
            <div className="row-actions">
                <button className="btn" type="submit" disabled={busy}>{busy ? "Wird erstellt…" : "Kanal erstellen"}</button>
            </div>
        </form>
    );
}

function DuplicateChannelForm({ data, csrfToken, onDuplicated }: {
    data: ChannelsData;
    csrfToken: string | null;
    onDuplicated: (msg: string) => void;
}) {
    const first = data.channels[0];
    const [channelId, setChannelId] = useState(first?.id ?? "");
    const [name, setName] = useState(first?.name ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!data.channels.length) {
        return <p className="sub">Keine Kanäle zum Duplizieren gefunden.</p>;
    }

    const selectChannel = (id: string) => {
        setChannelId(id);
        // Mirrors the SSR page's script: picking a channel always overwrites the name field.
        setName(data.channels.find((c) => c.id === id)?.name ?? "");
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const created = await duplicateChannel(csrfToken, { channelId, name });
            onDuplicated(`Kanal #${created.name} dupliziert.`);
        } catch (err) {
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="card-form" onSubmit={submit}>
            {error && <p className="sub" style={{ color: "var(--high)" }}>{error}</p>}
            <div className="field">
                <label>Kanal duplizieren</label>
                <select value={channelId} onChange={(e) => selectChannel(e.target.value)} required>
                    {data.channels.map((c) => (
                        <option key={c.id} value={c.id}>
                            #{c.name} · {c.typeLabel || "Kanal"}{c.category ? ` · ${c.category}` : ""}
                        </option>
                    ))}
                </select>
                <div className="hint">Vollständiger Klon (Rechte, Thema, Slowmode) in derselben Kategorie wie das Original.</div>
            </div>
            <div className="field">
                <label>Name des Duplikats</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name übernehmen &amp; anpassen" />
                <div className="hint">Vorbelegt mit dem Original-Namen — hier anpassen. Leer = Name des Originals.</div>
            </div>
            <div className="row-actions">
                <button className="btn" type="submit" disabled={busy}>{busy ? "Wird dupliziert…" : "Duplizieren"}</button>
            </div>
        </form>
    );
}

export default function ChannelsPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const [data, setData] = useState<ChannelsData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [flash, setFlash] = useState<Flash | null>(null);

    const load = () => {
        getChannels().then(setData).catch((err: ApiError) => setError(err));
    };

    useEffect(load, []);

    const handleDone = (text: string) => {
        setFlash({ type: "ok", text });
        load();
    };

    if (error) return <div className="empty">Fehler beim Laden der Kanäle: {error.message}</div>;
    if (!data) return <div className="empty">Lade…</div>;

    if (!data.activeGuildId) {
        return (
            <>
                <h1 className="page-title">Kanäle</h1>
                <p className="sub">Wähle oben einen Server, um Kanäle zu verwalten.</p>
            </>
        );
    }

    return (
        <>
            <h1 className="page-title">Kanäle</h1>
            <FlashBanner flash={flash} />
            <h2>Neuen Kanal erstellen</h2>
            <CreateChannelForm data={data} csrfToken={csrfToken} onCreated={handleDone} />
            <h2>Kanal duplizieren</h2>
            <DuplicateChannelForm data={data} csrfToken={csrfToken} onDuplicated={handleDone} />
        </>
    );
}
