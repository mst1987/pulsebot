# Worktrees, test instances and cleanup

Every change happens in a feature worktree with its own local instance (the short form is in
CLAUDE.md, "Development Workflow"). This page is the long form: how a test instance is set up, and
how worktrees and instances are cleaned up after a merge without endangering the main checkout. The
claude hooks that enforce the worktree rule are described in `.claude/rules/claude-hooks.md`.

## Local test instances (one port per change)

Every feature worktree runs its **own** bot/web instance on a **new, unused port**, so several
changes can be reviewed side by side without clobbering each other. Never reuse the default port
(`3005`) for a feature branch — pick a fresh one and keep it stable for that worktree.

The web server boots **independently of the Discord gateway** (`src/bot.js` `start()`): it comes up
first, then the bot logs in best-effort. A missing/invalid token or an offline Discord only disables
the Discord-backed features (guild/channel/role lists, posting) — the admin menu and report pages
stay reachable. So a local instance is useful even without a working token.

- **Each worktree needs its own env file.** `.env` / `.env.dev` are git-ignored and are **not**
  copied into new worktrees, so `npm start` in a fresh worktree finds no config. Copy the dev env in
  and give it a unique port:
  ```bash
  cp ../eventhelper/.env.dev .env.dev        # from the main checkout
  printf '\nWEB_PORT=3010\nDEV_AUTO_LOGIN=1\n' >> .env.dev
  ```
  `.env.dev` points at a **separate dev Discord application**, so running it never clashes with the
  production bot. `src/bot.js` prefers `.env.dev` over `.env` automatically.
- **Port convention:** allocate a distinct `WEB_PORT` per worktree, counting up from `3010` (`3010`,
  `3011`, `3012`, …). Record the chosen port in the PR body so the reviewer knows where to look. If a
  port is already taken, take the next free one.
- **Build the client first.** The menu is served from `src/web-client/dist/`; without a build it
  404s. Run `cd src/web-client && npm install && npm run build` once per fresh worktree (or
  `npm run dev` there for live reloading) — see `.claude/rules/web-client.md`.
- **Start it** from the worktree root — with `.env.dev` in place, just `npm start` (reads `WEB_PORT`
  and `DEV_AUTO_LOGIN` from `.env.dev`), or override inline (bash:
  `WEB_PORT=3010 DEV_AUTO_LOGIN=1 NODE_ENV=development npm start`; PowerShell:
  `$env:WEB_PORT=3010; $env:DEV_AUTO_LOGIN=1; npm start`). The menu is then at
  `http://localhost:3010/` — the site root. `DEV_AUTO_LOGIN=1` auto-logs-in the first admin and is
  hard-gated to non-production (`src/config/variables.js`), so it can never weaken auth on the live
  bot.
- **After the change:** report the port/URL you used to verify it, and stop the instance when done
  (it is only for review, never left running in production).

## Cleanup after merges

Once a PR is merged, its worktree and its running test instance are dead weight — clean them up
promptly, and **periodically sweep** for leftovers (e.g. at the start of a session, or whenever asked
to “clean up test instances”). Stray instances hold ports and RAM; orphaned worktrees clutter the
tree. `npm run agents` shows every worktree with its PR state (see docs/deployment.md).

1. **Find merged worktrees:** cross-reference `git worktree list` with
   `git branch --merged origin/main` (run `git fetch origin` first). Any worktree whose branch is
   merged can go.
2. **Stop its test instance first.** Find the dev instances and stop them before touching their
   worktree:
   ```powershell
   # ports 3010+ are per-worktree dev instances (3005 is the default)
   Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -ge 3010 -and $_.LocalPort -le 3020 } | Select LocalPort, OwningProcess
   Stop-Process -Id <pid> -Force
   ```
3. **Remove the worktree — one at a time, verifying between each:**
   ```bash
   git worktree remove ../eventhelper-<name>   # do NOT reach for --force by default
   git worktree list                            # confirm the main checkout is still listed
   ```

### Safety rules

A botched sweep once wiped the main checkout (`.git` + local env). Never again:

- **Remove worktrees one by one, not in a blind `--force` loop.** After each removal, re-run
  `git worktree list` (or `git -C <main> rev-parse --git-dir`). If any git command suddenly reports
  **“not a git repository”**, STOP immediately — do not continue removing.
- **The main worktree `d:/programming/eventhelper` is sacred and must never be removed.** It holds
  the real `.git` (objects/refs) that every linked worktree depends on; losing it detaches them all.
- **`.env` / `.env.dev` are git-ignored and live ONLY on local disk — never on origin.** The main
  checkout’s env cannot be recovered from GitHub. Before any operation that could touch the main
  checkout (re-clone, delete, move), **back up its `.env` and `.env.dev` first**. A worktree’s
  `.env.dev` is a copy of the main’s and can serve as a fallback source.
- Prefer plain `git worktree remove` (which refuses on a dirty/uncommitted tree — a useful
  guardrail). Only use `--force` on a specific worktree you have confirmed is safe to discard.
