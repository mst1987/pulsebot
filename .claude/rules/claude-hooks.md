---
paths:
  - ".claude/**"
  - "test/claude-hooks/**"
  - "scripts/check-main-clean.js"
  - "eslint.config.mjs"
---

# Claude hooks (`.claude/hooks/`)

Four hooks in `.claude/settings.json` enforce the worktree-only rule and the lint rule mechanically
(checked in, so every agent in every worktree gets them). The first three are one rule at three
distances — an edit, a shell command, and the moment somebody walks away:

- `.claude/hooks/guardMainCheckout.js` (PreToolUse on Edit/Write/MultiEdit/NotebookEdit) refuses any
  edit whose target lies in the *main* worktree of this repository, in whichever directory the
  session runs. Linked worktrees, other repositories, files outside git and git-ignored files
  (`.env.dev`, `data/`) pass. A deliberate one-off override is `EVENTHELPER_ALLOW_MAIN_EDITS=1`.
- `.claude/hooks/guardMainShell.js` (PreToolUse on Bash/PowerShell, #315) does the same for a
  **shell write**: twice an empty file landed in the main checkout through a redirection the Edit
  guard never sees. It is a prefilter, not a shell parser: it refuses **only** a redirection or
  write cmdlet whose resolved target lies in the main checkout and is not git-ignored, and lets
  everything it cannot read with certainty pass (what it reads: the hook's head comment) — silence
  beats a false alarm.
- `.claude/hooks/mainCheckoutClean.js` (Stop / SubagentStop, #315) runs `scripts/check-main-clean.js`
  when an agent is done and blocks the stop while the main checkout holds anything unexpected — one
  line per find. The same script is the by-hand check (`npm run check:main`, exit 1 with the lines,
  silent when clean); it finds the main worktree through `git worktree list`, so it works from any
  worktree; git-ignored files (`.env*`, `data/`, `coverage/`) never count, and there is no list of
  excused names. It never loops (`stop_hook_active` ends it after one round).
- `.claude/hooks/lintChanged.js` (PostToolUse on Edit/Write/MultiEdit) runs ESLint on the file just
  written (`src/`, `test/`, the hooks, and `src/web-client/` with its own config) and feeds the
  problems straight back, so style errors are fixed at the edit, not at the PR. No ESLint installed
  yet (fresh worktree) means it stays silent.

All are plain Node scripts with tests under `test/claude-hooks/` (`test/helpers/tempRepo.js` builds
the throwaway repo with a linked worktree). `npm run lint` covers `src/`, `scripts/`, `test/` and the
hooks (#320 — the one exception is the quote rule in `scripts/render-ui-emojis.js`, whose SVG
constants are single-quoted on purpose; see the comment in `eslint.config.mjs`). The rules:
`@eslint/js` recommended plus `no-undef`, `no-unused-vars` (unused args as `_x`), `prefer-const`,
`no-var`, `indent` 4 (`SwitchCase: 1`) and `complexity` (warn at 30) for `src/`, `scripts/`, hooks and
`test/` (there also `eslint-plugin-jest`); the client adds `eslint-plugin-react` and `jsx-a11y`. Line
endings (LF) come from `.gitattributes`, not from ESLint — a fixed rule broke the Linux CI.

The claude-crew plugin's guard hook adds to these: it blocks non-ASCII in Bash lines, `git stash`,
test runs cut with head/tail and — via `.claude/crew.json` (`hauptcheckoutGuard`) — every Edit/Write
in the main checkout; git-ignored files (`.env.dev`, `data/`) stay editable, as with
`guardMainCheckout.js`.

Path-scoped rules live next to this file in `.claude/rules/`; each starts with a `paths:` list and
loads only when a matching file is read. `test/docs/claudeMd.test.js` checks their frontmatter and
that every path they name exists.
