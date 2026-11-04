# Twitch stream announcements

Per Discord server, like MEE6: the orga lists Twitch channels, the bot posts a card when one goes live, keeps it
current and greys it out when the stream ends. User view: [guide-web-admin.md](guide-web-admin.md#twitch).

Code: `src/services/twitch/` (`twitchSettings.js` entries and limits, `twitchJob.js` the poll, `twitchCard.js` the
message), `src/classes/twitch.js` (API client), `src/stores/discord/twitchStateStore.js`,
`src/web/apiRoutes/system/twitch.js`; client `pages/settings/discord/SettingsTwitch.tsx`, words in
`lib/settings/twitch.ts`.

## Data model

- **Entries** in `settings/config.json` at `serverSettings[guildId].twitchStreamers`:
  `{ login, channelId, roleId, text, games, source }`. `source` is only `"orga"` for now. Limits: 25 streamers per
  server, 500 characters of own text, 5 game names of 60 characters each. `login` matches `^[a-z0-9_]{2,25}$`; the API
  also takes `@name` and a `twitch.tv/name` link and refuses other links.
- **State** in `settings/twitch-state.json`, one record per `"<guildId>:<login>"` (message and channel id, stream id,
  start, last sighting, end, end retries, last edit, hash, error, `pendingEnds`, `removedAt`). It is not part of the
  config: it changes every run and a settings PATCH must not race it. It survives a restart.
- **Credentials** in `settings/config.json` at `twitch: { clientId, clientSecret }`, one app for all servers.
  `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` are only the bootstrap.
- **Game filter:** empty means every game. Otherwise a name matches when the stream's category contains it,
  ignoring case ("World of Warcraft" also hits "World of Warcraft: The War Within"). A stream without a category only
  passes without a filter.

## The job (`twitchJob.js`)

Only the live bot polls (`isLiveInstance()`); a test instance does not, but "Jetzt prüfen" works everywhere. One
central poll asks for each login once, whichever servers list it.

- **Every 2 minutes.** A failed answer, a timeout, a 429 or a 200 without a `data` list means "unknown": never offline,
  nothing is counted.
- **Pause after a 429:** the next run is skipped (poll interval plus 30 seconds).
- **Ending:** after 2 offline answers at least 1 minute apart.
- **Resume:** a new stream id within 10 minutes of the end or last sighting is the same session. The old message goes
  live again, without a ping and regardless of the filter.
- **Updates:** at most every 5 minutes and only when name, title, game, viewers, text or role changed. A new preview
  picture alone never causes an edit.
- **State is written right after every post,** so a restart cannot ping twice. A failed write does not count as a
  failed post: it is logged, kept in the memory of the process and written again, so a second ping is also ruled out
  within the process. Two rare cases can still ping twice: a restart in exactly that gap, and a send that times out
  although Discord did deliver it, because the job then counts the post as failed.
- **Message deleted in Discord:** it stays deleted for that session. No repost, no second ping, `messageGone` is set.
- **A failed resume edit** clears the hash and `lastEditAt`, so every next run tries again without the gap between
  edits: the card must not say "ended" while the stream runs. A normal update that fails waits for the gap as usual.
- **A restart during the "ended" edit:** `endPending` is written together with `endedAt`, before the edit, so the next
  run finishes it.
- **A new stream with an old message still open:** the old message gets one more "ended" edit first. If that fails it
  moves to `pendingEnds`, each with its own `endFailingSince`, and is retried; the new stream posts and pings as usual.
- **Giving up:** when the "ended" edit keeps failing, the job stops after 24 hours from the first failure and shows
  `end_gave_up` until the next stream starts. This holds for `pendingEnds` and removed entries too.
- **Channel or message gone:** 10003/10008, or `channel_not_found` from the edit, end the retries at once (`channel_gone`,
  `messageGone`); that is no temporary failure.
- **Errors stay visible:** an error lands on its entry and stays after the stream until a post or edit works. Codes:
  `channel_gone`, `no_permission`, `wrong_guild`, `post_failed`, `end_gave_up`. An offline bot is no error of the entry.
- **Removed entry:** its running message is ended (with the 24-hour rule above); a temporary failure keeps the state.
  The state stays as a **tombstone** (`removedAt` with the stream id) until the stream is over: Twitch says offline, or
  shows another stream id. Then it is dropped, so the file does not grow.
- **Listed again during the same stream:** no second ping. The old message goes live again, and the tombstone clears. In
  another channel it counts as a changed channel. With another stream id it is a normal new post with a ping. Logins
  are compared in lower case.
- **Changed channel:** a running message stays where it is (`postedChannelId` in the status); the next stream appears
  in the new channel.

## The ping

- Only the **first post** of a stream pings, and only the entry's one role: `discord.postPayload(…, { pingRoleId })`
  sends `allowedMentions: { parse: [], roles: [roleId] }`. The card itself and every edit send `parse: []`.
- Foreign text (stream title, game, name) is escaped and stays on one line, so a title cannot ping anyone. The own text
  fills `{streamer} {title} {game} {url}` in a single pass.
- `twitchPing` is a **use** of a role, shown on the role page, but not a granting use: `selfRole.grantingUses` leaves
  it out, so the role can still be taken by button. A ping grants no rights.
- **Discord's rule:** `allowedMentions` only limits who may be pinged, it does not create the right to. A role that is
  not set to "Allow anyone to @mention this role" only notifies when the bot has "Mention @everyone, @here, and All
  Roles" in that channel. Without it the name appears in the card and nobody gets a notification, and **no error
  comes back**, so the status cannot show it. Discord's developer docs do not spell this out; the interaction is
  described by third-party guides and bot docs.
- **What the page can warn about instead:** `view.mention` (`discord.mentionInfoIn`) is `{ botCanMentionAll,
  unmentionableRoleIds }` for the active server, read from the cache only, no member list. `botCanMentionAll` is `null`
  when unknown (bot offline, server not loaded), which never throws. The list leaves out @everyone and managed roles.
  The dialog shows a hint under the role picker and the table's role column a tooltip when the role is listed and
  `botCanMentionAll` is `false`. `null` shows nothing, and neither ever blocks saving. The hint only checks the right
  at server level: a channel overwrite that takes it away, or grants it, goes unnoticed.

## The icon

`eh_ui_twitch` (`UI_ICONS`, `scripts/render-ui-emojis.js`, `assets/emojis/eh_ui_twitch.png`) stands in front of the
card's kicker through `emojiText`; without the emoji loaded the kicker is just the words, no unicode stand-in. It is
the one exception to the grey line icons: Twitch's filled glitch in `#9146FF`, path from `simple-icons` (CC0-1.0; the
trademark stays Twitch's), which is no dependency. `ensureAppEmojis` uploads it at startup.

The web client draws the same path inline as the brand icon `twitch` (`lib/ui/iconSet.ts`, `Icon.tsx`) in the token
`--twitch-purple`: in the settings menu, the section head, the dialog head and the row under Connections.

## Rights

Area `settings`: GET needs read, the write routes write plus CSRF. Always the session's active server;
`serverSettingsGuildId` guards against a server switched in another tab (409 `server_switched`), as with the other
per-server settings. A channel or role of another server is refused with 403 `other_server`. The credentials go
through `PATCH /api/settings` and are full-admin only; `hasCredentials` in the view tells everybody with the settings
area only yes or no, because the page's status needs it. Full admins also get `config.twitch.inUse` in the settings
config: whether any server lists a streamer, so missing credentials count only then: the badge at "Connections" stays
quiet without `inUse`, while the Twitch row itself still says what is missing. `config.twitch.credentialsRejected`
says that the last check got `bad_credentials` with the credentials saved now, only as yes or no. The row then warns
"credentials rejected" and counts like missing credentials. It lives in memory only: empty after a restart until the
next check, gone at once when other credentials are saved.

## API

| Call | Body | Answer |
|---|---|---|
| `GET /api/settings/twitch` | - | view; without an active server 400 `no_active_server` |
| `POST /api/settings/twitch` | `serverSettingsGuildId, login, channelId, roleId?, text?, games?` | view |
| `PUT /api/settings/twitch` | `serverSettingsGuildId, login, channelId?, roleId?, text?, games?`; omitted = kept, `roleId: ""` removes | view; 404 `not_found` |
| `DELETE /api/settings/twitch` | `serverSettingsGuildId, login` | view; 404 `not_found` |
| `POST /api/settings/twitch/check` | `serverSettingsGuildId` | `{ result, ...view }` |

`result` is `{ checked, live }` or `{ skipped }` with `no_credentials`, `bad_credentials`, `bot_offline`,
`rate_limited`, `twitch_unavailable` or `failed`. `bad_credentials` means Twitch refused the app: 400, 401 or 403 from
the token call, or a 401 that stays after a new token. The secret appears in no answer and no log.

`lastRun` is global, since a Twitch failure is too. "Jetzt prüfen" only writes it when it really asked Twitch: a server
without entries does not wipe the error of the last run.

The view holds `guildId, hasCredentials, mention, lastRun: { at, error }, limits, streamers`, and each streamer a `status`:
`state` (`live`, `filtered`, `offline`), `since, endedAt, title, game, viewers, messageGone, error, postedChannelId`.
The status can be up to 5 minutes old. `filtered` means "running, no announcement": the filter, or a failed post, in
which case `error` is set. `lastRun.at` is 0 until the first run of this process.

Other errors: 400 `unknown_server`, `invalid_login`, `duplicate_streamer`, `missing_channel`, `invalid_channel`,
`invalid_role`, `text_too_long`, `too_many`, `too_many_games`, `invalid_list`. `invalid_channel` refuses what the bot
knows not to be a text channel, announcement channel or thread (voice, stage, forum, category), only when the channel
changes; an unknown channel or an offline bot does not block. The server's messages are German only, so the client
words every code itself (`twitchErrorText`). The form enforces the limits itself, because the server cuts a too long
game name silently.

## Creating the Twitch app

1. Open <https://dev.twitch.tv/console> with any Twitch account (Twitch asks for two-factor authentication).
2. **Applications → Register Your Application.** Any name; OAuth redirect URL `http://localhost` (required by the form,
   never used); a category; client type **Confidential**.
3. **Manage** the app, copy the **Client ID**, press **New Secret** and copy the secret.
4. In the menu: Einstellungen → Alle Server → Verbindungen → Twitch. The secret is never shown again; leaving the field
   empty keeps it.

The bot only uses an app token (client credentials) to read public streams; no streamer has to log in or agree to
anything.
