import { useEffect, useState } from "react";
import {
    getSignalSettings, saveSignalSettings, SIGNAL_THRESHOLD_KEYS,
    type OrgaNotice, type OrgaNoticeLevel, type SignalSettings, type SignalThresholdKey,
} from "../../api/vermerke";
import type { ApiError } from "../../api/client";
import { Button, InfoTip, Modal, NumberStepper, Segment, Switch } from "../../components/ui";
import { SaveIcon } from "../../components/ui/icons/icons";
import { useT } from "../../i18n";

// The settings of "Hinweise aus den Daten" for the active server. First the
// thresholds (#993): from how many times in the window a hint shows. One line
// per value with − and +, the number always with its word ("60 Tage", "unter 12
// Stunden"); a value the server set itself gets "Standard" beside it. Then the
// hint to the orga at a signup (#983): a switch (off by default) and from which
// level - warning, or shadowban only. Everyone with "vermerke" read sees the
// values, only write changes them.

type Draft = Partial<Record<SignalThresholdKey, number | null>>;
const NOTICE_OFF: OrgaNotice = { enabled: false, level: "warning" };
const NOTICE_LEVELS: OrgaNoticeLevel[] = ["warning", "shadowban"];

/** The draft from the server's own values: null = the default counts. */
function draftOf(s: SignalSettings): Draft {
    const out: Draft = {};
    for (const key of SIGNAL_THRESHOLD_KEYS) out[key] = typeof s.own[key] === "number" ? s.own[key] as number : null;
    return out;
}

export default function SignalSettingsDialog({ canWrite, onClose, onSaved }: {
    canWrite: boolean;
    onClose: () => void;
    /** after a save: the hints are counted anew */
    onSaved: () => void;
}) {
    const t = useT();
    const [settings, setSettings] = useState<SignalSettings | null>(null);
    const [loadFailed, setLoadFailed] = useState("");
    const [draft, setDraft] = useState<Draft>({});
    const [notice, setNotice] = useState<OrgaNotice>(NOTICE_OFF);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState("");
    const [badFields, setBadFields] = useState<string[]>([]);

    useEffect(() => {
        let live = true;
        getSignalSettings().then((s) => {
            if (!live) return;
            setSettings(s);
            setDraft(draftOf(s));
            setNotice(s.orgaNotice || NOTICE_OFF);
        }).catch((err: ApiError) => {
            if (live) setLoadFailed(t("vermerke.thresholds.loadError", { message: (err && err.message) || String(err) }));
        });
        return () => { live = false; };
    }, [t]);

    const valueOf = (key: SignalThresholdKey): number => {
        const own = draft[key];
        return typeof own === "number" ? own : settings ? settings.defaults[key] : 0;
    };
    const set = (key: SignalThresholdKey, value: number | null) => {
        setDraft((d) => ({ ...d, [key]: value }));
        setBadFields((f) => f.filter((x) => x !== key));
    };
    // an older server without the switch (#983) shows none and saves none
    const hasNotice = !!(settings && settings.orgaNotice);
    const savedNotice = (settings && settings.orgaNotice) || NOTICE_OFF;
    const noticeChanged = hasNotice && (notice.enabled !== savedNotice.enabled || notice.level !== savedNotice.level);
    const changed = settings
        ? noticeChanged || SIGNAL_THRESHOLD_KEYS.some((k) => (draft[k] ?? null) !== (typeof settings.own[k] === "number" ? settings.own[k] : null))
        : false;
    const levels = settings && settings.orgaNoticeLevels && settings.orgaNoticeLevels.length ? settings.orgaNoticeLevels : NOTICE_LEVELS;

    const save = async () => {
        if (!settings) return;
        setSaving(true);
        setFailed("");
        try {
            const next = await saveSignalSettings(draft, settings.guildId, hasNotice ? notice : undefined);
            setSettings(next);
            setDraft(draftOf(next));
            setNotice(next.orgaNotice || NOTICE_OFF);
            onSaved();
            onClose();
        } catch (err) {
            const e = err as ApiError & { fields?: string[] };
            if (e && e.code === "bad_threshold") {
                setBadFields(Array.isArray(e.fields) ? e.fields : []);
                setFailed(t("vermerke.thresholds.badThreshold"));
            } else if (e && e.code === "bad_orga_notice") {
                setFailed(t("vermerke.thresholds.orga.bad"));
            } else if (e && e.code === "server_switched") {
                setFailed(t("vermerke.thresholds.serverSwitched"));
            } else {
                setFailed(t("vermerke.thresholds.failed", { message: (e && e.message) || String(err) }));
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open onClose={onClose} icon="vermerke" tone="vermerke" className="vmk-thr-dlg" width={580}
            kicker={t("vermerke.signals.title")}
            title={t("vermerke.thresholds.title")}
            hint={canWrite ? undefined : t("vermerke.thresholds.readOnly")}
            footer={canWrite ? (
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button variant="go" icon={<SaveIcon />} onClick={save} running={saving} disabled={!settings || !changed || saving}>
                        {t("common.save")}
                    </Button>
                </>
            ) : (
                <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
            )}
        >
            {loadFailed && <p className="vmk-error" role="alert">{loadFailed}</p>}
            {failed && <p className="vmk-error" role="alert">{failed}</p>}
            {settings && hasNotice && <h3 className="vmk-thr-head">{t("vermerke.thresholds.thresholdsHead")}</h3>}
            {settings && (
                <ul className="vmk-thr-list">
                    {SIGNAL_THRESHOLD_KEYS.map((key) => {
                        const [min, max] = settings.limits[key] || [1, 99];
                        const value = valueOf(key);
                        const own = typeof draft[key] === "number";
                        const word = t(`vermerke.thresholds.value.${key}`, { count: value });
                        return (
                            <li key={key} className={`vmk-thr${badFields.includes(key) ? " vmk-thr-bad" : ""}`} data-key={key}>
                                <span className="vmk-thr-label">
                                    {t(`vermerke.thresholds.label.${key}`)}
                                    <InfoTip head={t(`vermerke.thresholds.label.${key}`)} sub={t(`vermerke.thresholds.tip.${key}`, { min, max })} />
                                </span>
                                {canWrite ? (
                                    <NumberStepper
                                        size="sm" value={value} min={min} max={max} display={word}
                                        onChange={(n) => set(key, n)}
                                        ariaLabel={`${t(`vermerke.thresholds.label.${key}`)}: ${word}`}
                                        lessLabel={t("vermerke.thresholds.less")} moreLabel={t("vermerke.thresholds.more")}
                                    />
                                ) : (
                                    <span className="vmk-thr-value">{word}</span>
                                )}
                                <span className="vmk-thr-def">
                                    {own && canWrite ? (
                                        <Button
                                            variant="ghost" size="sm" onClick={() => set(key, null)}
                                            data-tip={t("vermerke.thresholds.defaultTip", { value: t(`vermerke.thresholds.value.${key}`, { count: settings.defaults[key] }) })}
                                        >
                                            {t("vermerke.thresholds.default")}
                                        </Button>
                                    ) : !own && (
                                        <span className="vmk-thr-std">{t("vermerke.thresholds.isDefault")}</span>
                                    )}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
            {settings && hasNotice && (
                <section className="vmk-orga" aria-labelledby="vmk-orga-head">
                    <h3 className="vmk-thr-head" id="vmk-orga-head">
                        {t("vermerke.thresholds.orga.head")}
                        <InfoTip head={t("vermerke.thresholds.orga.head")} sub={t("vermerke.thresholds.orga.tip")} />
                    </h3>
                    {canWrite ? (
                        <div className="vmk-orga-row">
                            <Switch
                                checked={notice.enabled}
                                onChange={(enabled) => setNotice((n) => ({ ...n, enabled }))}
                                label={t("vermerke.thresholds.orga.switch")}
                            />
                            <Segment<OrgaNoticeLevel>
                                size="sm"
                                ariaLabel={t("vermerke.thresholds.orga.levelLabel")}
                                value={notice.level}
                                onChange={(level) => setNotice((n) => ({ ...n, level }))}
                                options={levels.map((level) => ({ value: level, label: t(`vermerke.thresholds.orga.level.${level}`), disabled: !notice.enabled }))}
                            />
                        </div>
                    ) : (
                        <p className="vmk-orga-value">
                            {notice.enabled ? t(`vermerke.thresholds.orga.on.${notice.level}`) : t("vermerke.thresholds.orga.off")}
                        </p>
                    )}
                    <p className="vmk-orga-sub">{t("vermerke.thresholds.orga.sub")}</p>
                </section>
            )}
        </Modal>
    );
}
