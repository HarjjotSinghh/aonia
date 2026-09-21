# aonia — design

Status: planning, written 2026-09-20, corrected 2026-09-21. Nothing is implemented. Everything marked
*probed* was checked against Muse Code `1.3.0-R3401.1` on macOS; everything marked *spike* is an open
question with a plan for answering it. The full evidence for the 2026-09-21 corrections is in
[`CONTEXT-2026-09-21.md`](CONTEXT-2026-09-21.md).

Companion ticket in Helicon: **Account profiles: more than one Muse login, and two of them running at
once** (helicon#45).

---

## 1. Problem

Muse Code has exactly one login per machine. `muse login` writes to `~/.config/muse/auth.json`, and
every `muse` process — the TUI, `muse serve`, anything a GUI spawns — uses it. There is no `--account`,
no profile flag, no second slot.

That becomes a problem the moment a person holds two credentials, which is increasingly common:

- an employer's subscription and a personal one;
- a client credential kept separate from everything else, deliberately, under an NDA;
- two subscriptions, simply.

(Standard versus Contributor is not on this list on purpose. It is a model choice —
`muse-spark-1.3` versus `muse-spark-1.3-contributor` — available inside any one account, so it needs
a model picker per project, which Helicon already has, not a second login.)

The only way across that line today is `muse logout`, `muse login`, and a browser round trip. Running
two accounts *concurrently* — one thread on work while another runs on personal — is not possible at all.

## 2. Solution

Give Muse named profiles by giving each account its own config and data root, and starting `muse`
pointed at one of them. A profile is a directory pair. Selecting one is two environment variables,
`XDG_CONFIG_HOME` and `XDG_DATA_HOME` — plus a third on macOS, `TBH_CREDENTIAL_BACKEND=file`, which
keeps the profile's token out of the shared Keychain item (§3).

`aonia` is a library first, a CLI second. Helicon consumes the library; the CLI is the same thing for
people who live in a terminal.

### Principles

1. **Never touch a credential.** No write, copy, export or transmit, ever. `muse login` owns every
   login. `aonia` owns directories and environment variables. It parses `auth.json` for exactly four
   non-secret fields — `user_email`, `user_full_name`, `mechanism`, `storage` — and never logs,
   persists or returns anything else from that file. (On Linux and Windows the same file also holds
   the token, which is why the rule is stated per field rather than per file.)
2. **Never mutate Muse's own state.** `~/.config/muse` and `~/.local/share/muse` are not written to.
   The default login works whether or not `aonia` is installed; uninstalling leaves no trace.
3. **Separation, not rotation.** Named profiles a person chooses. No round-robin, no cap-triggered
   switching, no wake-up tasks. (Opt-in auto-switch is designed in §9 and deliberately not in v1.)
4. **No API keys.** `META_API_KEY` beats the account login unconditionally, so detect an inherited one
   and warn. Never set one.
5. **Thin by design.** Muse's state layout is an implementation detail that can move in any release.
   Staying a small environment shim is what makes that survivable.

### Non-goals

Credential sync across machines. Rotation. Other agents (Claude Code, Codex, Gemini). Installing or
updating Muse. Org or team management. A GUI of its own — Helicon is the GUI.

## 3. What was probed

**The launcher.** `muse` on PATH is a Bash script of about 33 KB; the real binary is `muse-bin-<version>`
beside it (Mach-O on macOS, `.exe` and roughly 400 MB on Windows). The launcher reads `MUSE_AUTH_PATH`,
then `$XDG_CONFIG_HOME/muse/auth.json`, then `$HOME/.config/muse/auth.json` — but only to find a
token for its own authenticated update downloads, and it never exports that path to the binary. It
also reads `MUSE_LOGIN`, `MUSE_NO_AUTO_UPDATE`, `MUSE_INSTALL_DIR`, `MUSE_CHANNEL_URL`,
`MUSE_CLIENT_ID` and `MUSE_AUTH_URL`.

**The binary reads `XDG_CONFIG_HOME` and `XDG_DATA_HOME`, and nothing else that selects an account.**
`strings` over `muse-bin-1.3.0-R3401.1` has zero occurrences of `MUSE_AUTH_PATH` or `MUSE_CONFIG_DIR`.
Its config root is `$XDG_CONFIG_HOME/muse`, else `$HOME/.config/muse`, and its own bundled skill text
says that when `XDG_CONFIG_HOME` is set, `$HOME/.config/muse` is never read as a fallback. Login is
`muse login` with no flags ("approve a code in your browser"); `auth.json` records it as
`obtained_via: "device_code"`.

**The roots.**

```
$XDG_CONFIG_HOME/muse/    auth.json, settings.json, trust.json, lock files
$XDG_DATA_HOME/muse/      sessions/, session-index.db, skills/, plugins/,
                          model-catalog/, feature-config/, runtime/, tui-history.jsonl
```

**Identity without secrets.** An OAuth login records `providers.meta` with `mechanism: "oauth"`,
`storage`, `obtained_via: "device_code"`, `api_base_url`, `user_full_name` and `user_email`. A profile
list needs exactly those fields and nothing more.

**Isolation already works for `muse serve`.** A real host was run on 2026-09-17 against a staged
`settings.json` under temporary XDG roots. The mechanism this design rests on is not hypothetical.

**An empty profile does not inherit the default login** (probed 2026-09-21). With `XDG_CONFIG_HOME`
pointing at a root with no `auth.json`, `muse exec` exits 1 with `missing meta credentials: run
\`muse login\` or set META_API_KEY, or save credentials at <root>/muse/auth.json`, makes no network
request, and never reads the Keychain. `muse serve` under the same root does not exit: the MSP
handshake completes, `session/start` succeeds, and the first turn fails with
`error.kind: "authRequired"` and the message `not logged in: run /login to add an API key`.
`usage/read` is `{}` logged in or out; `model/list` is the usable check — logged out it returns
`source: "bundledCatalog", models: []`, logged in `source: "providerCatalog"` with real model ids.

**`TBH_CREDENTIAL_BACKEND=file`** (probed 2026-09-21). The binary's environment table carries this
variable, and disassembly of the gate shows it accepts exactly the string `file`; any other value
silently falls through to the Keychain-capable default. With `file` set, the credential provider has
no Keychain handle, so a process started that way cannot read or write `ai.meta.dev.credentials`,
and its token has to live inline in the profile's own `auth.json` — the layout Linux and Windows use
already. A real login under it has not yet been run (spike S1).

**Credential backends.** The binary carries `file`, `keychain` and `keychain_fallback_file`, with
fallback reasons `interaction_not_allowed` and `denied`, and a note that off-macOS stamps `file`.
So Linux and Windows keep the token in the profile's own `auth.json` — isolating the config root
isolates the credential for free.

**macOS is the exception.** The token is in the login Keychain as:

```
service: ai.meta.dev.credentials
account: meta
```

A fixed item, not derived from the config directory. Claude Code on the same machine has both
`Claude Code-credentials` and `Claude Code-credentials-1836978b` — it hashes its config directory into
the item name, which is exactly what makes its multi-account story work. Muse does not.

On macOS the profile's `auth.json` is therefore a 294-byte pointer — `storage: "keychain"`, identity
fields, no token — and any profile whose pointer says `keychain` reads that one shared item (proved
2026-09-21 by copying the pointer into a fresh root and watching it send a real bearer token to a fake
provider). Two Keychain-backed profiles cannot hold two accounts. The way out is
`TBH_CREDENTIAL_BACKEND=file` above, which is why `envFor()` sets it on macOS.

**`META_API_KEY` wins.** Stated outright by `muse login --help`. An inherited environment variable can
silently override a chosen profile.

## 4. Layout

```
~/.aonia/
  profiles.json          index: id, name, created, lastUsedAt, bindings.  No secrets, ever.
  profiles/
    personal/
      config/muse/…      → XDG_CONFIG_HOME
      data/muse/…        → XDG_DATA_HOME
    work/
      config/muse/…
      data/muse/…
```

`profiles.json` is small, human-readable, and safe to inspect. If it is deleted, the profiles are still
on disk and can be re-indexed from the directory names — which works because a profile's `id` **is**
its directory name: a slug matching `^[a-z0-9][a-z0-9-]{0,31}$`, chosen at `add` time and never
changed. `name` is a free display label. Renaming in v1 means changing `name` only.

## 5. Library API

```ts
listProfiles(): Promise<Profile[]>          // name, id, roots, lastUsedAt, identity
createProfile(name: string): Promise<Profile>   // makes the roots; does not log in
removeProfile(id: string): Promise<void>        // removes the roots; never touches ~/.config/muse
envFor(profile: Profile): Record<string, string>
    // { XDG_CONFIG_HOME, XDG_DATA_HOME } — plus TBH_CREDENTIAL_BACKEND: "file" on darwin.
    // The only thing that selects an account. Callers spread it over process.env; it is not a
    // complete environment.
identityOf(profile: Profile): Promise<Identity | null>   // email, name, hasLogin. Non-secret fields only.
loginCommand(profile: Profile): { command: string; args: string[]; env: Record<string, string> }
bindings.get(path) / bindings.set(path, id) / bindings.remove(path)
doctor(): Promise<Finding[]>
```

`envFor` is the whole mechanism. Everything else is bookkeeping around it.

`doctor` reports: an inherited `META_API_KEY`; `muse` not on PATH; a profile with no login; unreadable
or non-writable roots; the macOS Keychain situation per §3; and the disk each profile's data root uses,
since sessions, the model catalog and the skills cache all live there.

## 6. CLI

```bash
aonia add <name>            # create a profile
aonia login <name>          # muse login inside it; the device-code flow is Muse's, untouched
aonia list                  # ids, names, emails, login state, last used
aonia run <name> [-- args]  # muse under that profile; `-- serve`, `-- resume`, anything
aonia bind <path> <name>    # a directory selects its own account
aonia env <name>            # print the variables, for a hand-written shim
aonia shim <name>           # optional: generate a `muse-<name>` wrapper on PATH
aonia doctor
aonia rm <name>             # after an explicit confirmation
```

`aonia run` inherits the caller's stdio so the TUI behaves exactly as `muse` does. A profile with no
login says so and points at `aonia login <name>` rather than starting a doomed process — the check is
"does `<config>/muse/auth.json` exist", which is exactly the gate the binary itself uses. There is no
tier column anywhere: the subscription plan is not readable from any local file, and Contributor
versus Standard is a model id, not an account property.

## 7. Helicon integration contract

Helicon depends on the library, not the CLI. What it needs from `aonia`:

- `listProfiles()` and `identityOf()` for the accounts list in Settings;
- `envFor()` merged into the environment of the `muse serve` it already spawns;
- `loginCommand()` for adding an account without leaving the app;
- `bindings` for the project → account default;
- `doctor()` findings surfaced, particularly the `META_API_KEY` one.

What Helicon owns on its side: a host per (account, workspace) pair rather than per workspace; an
`account_id` on sessions and a default on projects; one plan meter per account instead of one per
machine; and the account chooser on a new thread. Those are tracked in the Helicon ticket, not here.

There is one platform seam worth naming: Helicon can run Muse inside WSL. Environment variables do not
cross `wsl -d <distro> --` by themselves, and profile roots have to be Linux paths inside the distro.
That is spike S3.

## 8. Open questions

**S1 — macOS Keychain.** Half answered on 2026-09-21: Keychain-backed profiles share one item, so
two of them cannot hold two accounts (§3). What remains, in order:

1. With the existing account, run `muse login` in a fresh profile root with
   `TBH_CREDENTIAL_BACKEND=file`. Expect: the Keychain item's modification date does not change, the
   profile's `auth.json` gains an inline token, and a turn under that profile succeeds. This needs one
   browser approval and no second account.
2. Start a host under that profile and one under the default login at the same time; run a turn on
   each.
3. With a second account, repeat step 1 for profile B and confirm both profiles keep working, and
   that `muse logout` inside one leaves the other alone.

If step 1 fails, fall back to the two escapes from the first draft — deny Keychain access to force
`keychain_fallback_file`, or set `HOME` per spawned process — and if those fail too, macOS v1 is
sequential switching, stated on the README's first screen. **This decides what macOS can promise.**

**S6 — what `muse login` prints without a TTY.** Helicon's in-app "Add account" has to render
whatever the device-code step prints (a URL and a code, or nothing, or a browser it opens itself).
Run it under an isolated root from a piped stdout and capture both streams; cancel before approving.

**S7 — `unsafe_registry_root`.** `muse exec` under a `/tmp` data root warned
`local session messaging disabled: unsafe_registry_root` and disabled local session messaging.
Confirm a real `~/.aonia/profiles/<id>/data` root does not trigger it.

**S2 — Windows native.** Native Windows Muse keeps config in `%USERPROFILE%\.config\muse` and data in
`%USERPROFILE%\.local\share\muse`. Does the Windows binary honour `XDG_CONFIG_HOME` and
`XDG_DATA_HOME` the way the macOS one does, and does its PowerShell launcher pass them through
untouched? Probe on a `windows-latest` runner.

**S3 — WSL passthrough.** `WSLENV` or an explicit `env VAR=… muse serve`, and where the roots live
inside the distro.

**S4 — Meters per account.** `usage/read` returns `{}` until a model call, `usage/changed` carries no
session id, and `tier` is an opaque numeric id rather than a plan name. A newly added account therefore
shows no meter until its first turn; decide what that empty state says.

**S5 — Two hosts, one worktree.** Two `muse serve` processes on one directory with different data
roots: check `trust.json` and `session-index.db` for contention. Probably moot: in 1.3.0 the runtime
directory (sockets, session registry lock) lives under `$XDG_DATA_HOME/muse/runtime`, not the
uid-keyed `/private/tmp/tbh-<uid>-rt` that older builds used, so the only thing two profiles share
on one machine is `~/Library/Application Support/Muse/session-name-authority`, which holds session
naming and is resolved through `getpwuid`, not `$HOME`. Confirm as part of S1 step 2.

## 9. Future scope — designed, not built

**Opt-in auto-switch at cap.** Off by default and enabled per project. Constrained: it may choose an
account only **when a new session starts**, never mid-session, and every switch writes an audit line.
It reads the per-account meter map that the manual feature already builds, so it is a policy on top of
existing data rather than new plumbing. It ships only after the manual flow has been in real use, and
it never becomes the default. The reason for the constraint is not technical: tools that rotate
credentials to beat a meter are the pattern abuse detection looks for, and being indistinguishable
from one is not worth a convenience.

**Config portability across machines.** Skills, settings and profile definitions travelling between
machines. Credentials never travel; each machine logs in for itself.

**Other agents.** Only if someone asks, and only behind the same profile model.

**Per-project model defaults.** A project pinned to a Standard model for confidential work and a
Contributor model everywhere else. This is a Helicon model-picker default per project, not an
`aonia` concern, and does not need a second account; listed here only so nobody re-invents it as one.

## 10. Prior art

The cross-agent switcher space is crowded — `aisw`, `cc-switch`, `cursor-account-switcher`, Mjolnir,
cockpit-tools and a long tail of Claude-only tools. Two things are worth taking from that:

- The wide ones ship device fingerprinting and cap-triggered rotation, and are built for quota farming.
  That is the market pull this design refuses on purpose.
- None of them is Muse-shaped. Mjolnir covers Muse among many harnesses; nothing is built around the
  native Muse CLI, its MSP host, and a GUI that already reads the real plan meter.

That gap, plus Helicon's existing users, is the entire reason this is worth building.

## 11. Build decisions (settled 2026-09-21)

- **Package.** npm `aonia`, `"type": "module"`, built with `tsc` to `dist/`, `engines.node >=22`,
  `bin: { aonia: "dist/cli.js" }`, runtime dependencies: none (only `node:*`). Tests with `node:test`
  and `node:assert/strict`, run as `tsc` then `node --test dist/test/*.test.js` — the same harness
  Helicon uses, so contributors move between the repos without relearning anything.
- **Layout.** `src/index.ts` (library), `src/cli.ts` (thin), `src/profiles.ts`, `src/env.ts`,
  `src/identity.ts`, `src/bindings.ts`, `src/doctor.ts`, `test/`. Every filesystem path goes through
  one `paths.ts` so the `~/.aonia` root can be overridden with `AONIA_HOME` in tests.
- **Profile id** is the directory slug (§4).
- **`envFor()`** returns `{ XDG_CONFIG_HOME, XDG_DATA_HOME }` everywhere and adds
  `TBH_CREDENTIAL_BACKEND: "file"` when `process.platform === "darwin"`. `MUSE_AUTH_PATH` is not set.
- **No tier anywhere** (§6).
- **Helicon dependency.** `aonia@0.1.0` is published to npm at the end of M1; `@helicon/server`
  declares the dependency (it owns `serveTargetFor` and the REST layer); `@helicon/daemon` gets only
  the store migrations and no `aonia` import. This keeps `npm ci` on Helicon's CI and the desktop
  esbuild bundle (which inlines every dependency and has no externals) unchanged in shape.
- **Sequencing.** M1 (this repo) lands before Helicon M2. Helicon PR #46 (YOLO mode) edits the same
  `serveTargetFor` / `planServe` / `settings` seams M2 needs; it should merge before M2 starts, and
  M2 builds on top of it.
- **`authRequired` in Helicon.** M2 replaces Muse's raw `run /login` text with an account-aware
  message and uses `model/list` `source: "bundledCatalog"` as the pre-turn login check.
