import { useMemo, useState } from "react";
import { createRecruitmentInvite, type ApiError, type InviteServer } from "../../api";
import { useToast } from "../../components/shell/Jobs";
import { Button } from "../../components/ui/Button";
import Segment from "../../components/ui/form/Segment";
import { LinkIcon } from "../../components/ui/icons/icons";
import { isDiscordInviteUrl } from "../../lib/discord/inviteLink";
import { useT } from "../../i18n";
import { TipLabel } from "./RecruitmentBits";
import { linkSourceOf, type LinkDraft, type LinkSource } from "./linkDraft";

// The link button of a recruitment post: where it leads and what it says.
// The link either comes from the bot — a permanent invite into a channel of a
// server the bot is on and the caller may act on — or is pasted (a partner
// guild's invite). Only Discord invites and channel links are taken; the server
// checks that again. The draft and its helpers live in linkDraft.ts.

export function LinkButtonFields({ servers, draft, patch, preferredGuildId = "", defaultLabel = "" }: {
    servers: InviteServer[];
    draft: LinkDraft;
    patch: (p: Partial<LinkDraft>) => void;
    /** The server the invite starts on: the one of an existing recruitment post, else the active server. */
    preferredGuildId?: string;
    /** The label a post gets when none is typed (the server's language). */
    defaultLabel?: string;
}) {
    const t = useT();
    const toast = useToast();
    const [creating, setCreating] = useState(false);
    const [refused, setRefused] = useState("");
    const source = linkSourceOf(draft, servers);
    const server = servers.find((s) => s.id === draft.inviteGuildId)
        || servers.find((s) => s.id === preferredGuildId) || servers[0] || null;
    const channels = useMemo(() => server?.channels ?? [], [server]);
    const channelId = channels.some((c) => c.id === draft.inviteChannelId) ? draft.inviteChannelId : (server?.suggestedChannelId || "");
    const channel = channels.find((c) => c.id === channelId) || null;
    const byCategory = useMemo(() => {
        const groups = new Map<string, typeof channels>();
        for (const c of channels) {
            const key = c.category || t("recruitment.postDialog.noCategory");
            groups.set(key, [...(groups.get(key) || []), c]);
        }
        return [...groups.entries()];
    }, [channels, t]);
    const pastedBad = !!draft.pastedUrl.trim() && !isDiscordInviteUrl(draft.pastedUrl);
    const noRight = !!channel && (!channel.canInvite || !!refused);

    const create = async () => {
        if (!server || !channel) return;
        setCreating(true);
        setRefused("");
        try {
            const invite = await createRecruitmentInvite({ guildId: server.id, channelId: channel.id, fresh: !!draft.inviteUrl });
            patch({ inviteGuildId: server.id, inviteChannelId: channel.id, inviteUrl: invite.url });
        } catch (err) {
            const e = err as ApiError;
            if (e.code === "invite_permission") setRefused(e.message);
            else toast(e.message, "err");
        } finally {
            setCreating(false);
        }
    };

    return (
        <>
            <div className="field">
                <TipLabel label={t("recruitment.postDialog.linkSource")} tip={t("recruitment.postDialog.linkSource")} tipSub={t("recruitment.postDialog.linkSourceSub")} />
                <Segment<LinkSource>
                    ariaLabel={t("recruitment.postDialog.linkSource")} size="sm" value={source}
                    onChange={(v) => patch({ linkSource: v })}
                    options={[
                        { value: "bot", label: t("recruitment.postDialog.sourceBot"), tip: t("recruitment.postDialog.sourceBot"), tipSub: t("recruitment.postDialog.sourceBotSub"), disabled: !servers.length },
                        { value: "paste", label: t("recruitment.postDialog.sourcePaste"), tip: t("recruitment.postDialog.sourcePaste"), tipSub: t("recruitment.postDialog.sourcePasteSub") },
                    ]}
                />
                {!servers.length && <div className="rc-postdlg-hint">{t("recruitment.postDialog.noInviteServers")}</div>}
            </div>
            {source === "bot" && server && (
                <>
                    <div className="rc-postdlg-row">
                        <div className="field">
                            <TipLabel label={t("recruitment.postDialog.inviteServer")} htmlFor="rc-invite-server" />
                            <select
                                id="rc-invite-server" value={server.id}
                                onChange={(e) => { setRefused(""); patch({ inviteGuildId: e.target.value, inviteChannelId: "", inviteUrl: "" }); }}
                            >
                                {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <TipLabel label={t("recruitment.postDialog.inviteChannel")} htmlFor="rc-invite-channel" tip={t("recruitment.postDialog.inviteChannel")} tipSub={t("recruitment.postDialog.inviteChannelSub")} />
                            <select
                                id="rc-invite-channel" value={channelId}
                                onChange={(e) => { setRefused(""); patch({ inviteGuildId: server.id, inviteChannelId: e.target.value, inviteUrl: "" }); }}
                            >
                                {!channelId && <option value="">{t("recruitment.postDialog.pickChannel")}</option>}
                                {byCategory.map(([cat, list]) => (
                                    <optgroup key={cat} label={cat}>
                                        {list.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                #{c.name}{c.id === server.suggestedChannelId ? ` ${t("recruitment.postDialog.suggested")}` : ""}
                                            </option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                        </div>
                    </div>
                    {noRight
                        ? (
                            <div className="rc-postdlg-hint" role="alert">
                                <span>{refused || t("recruitment.postDialog.noInviteRight")}</span>
                                <Button variant="ghost" size="sm" onClick={() => patch({ linkSource: "paste" })}>{t("recruitment.postDialog.usePaste")}</Button>
                            </div>
                        )
                        : (
                            <div className="rc-postdlg-hint">
                                {draft.inviteUrl
                                    ? <span className="rc-postdlg-link">{draft.inviteUrl}</span>
                                    : <span>{t("recruitment.postDialog.noInviteYet")}</span>}
                                <Button variant="go" size="sm" icon={<LinkIcon />} running={creating} disabled={!channel} onClick={create}>
                                    {draft.inviteUrl ? t("recruitment.postDialog.newInvite") : t("recruitment.postDialog.createInvite")}
                                </Button>
                            </div>
                        )}
                </>
            )}
            {source === "paste" && (
                <div className="field">
                    <TipLabel label={t("recruitment.postDialog.linkUrl")} htmlFor="rc-link-url" tip={t("recruitment.postDialog.linkUrl")} tipSub={t("recruitment.postDialog.linkUrlSub")} />
                    <input
                        id="rc-link-url" type="url" value={draft.pastedUrl} aria-invalid={pastedBad}
                        onChange={(e) => patch({ pastedUrl: e.target.value })} placeholder="https://discord.gg/..."
                    />
                    {pastedBad && <div className="rc-postdlg-hint" role="alert">{t("recruitment.postDialog.linkInvalid")}</div>}
                </div>
            )}
            <div className="field">
                <TipLabel label={t("recruitment.postDialog.linkLabel")} htmlFor="rc-link-label" tip={t("recruitment.postDialog.linkLabel")} tipSub={t("recruitment.postDialog.linkLabelSub")} />
                <input id="rc-link-label" type="text" maxLength={80} value={draft.linkLabel} onChange={(e) => patch({ linkLabel: e.target.value })} placeholder={defaultLabel || "Server beitreten"} />
            </div>
        </>
    );
}
