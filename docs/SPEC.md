# aonia — design

Status: planning, 2026-09-20. Nothing is implemented. Everything marked *probed* was checked against
Muse Code `1.3.0-R3401.1` on macOS on that date; everything marked *spike* is an open question with a
plan for answering it.

Companion ticket in Helicon: **Multi-account Muse profiles** (helicon#45).

---

## 1. Problem

Muse Code has exactly one login per machine. `muse login` writes to `~/.config/muse/auth.json`, and
every `muse` process — the TUI, `muse serve`, anything a GUI spawns — uses it. There is no `--account`,
no profile flag, no second slot.

That becomes a problem the moment a person holds two credentials, which is increasingly common:

- an employer's subscription and a personal one;
- a client credential kept separate from everything else, deliberately, under an NDA;
- a Standard-tier account for confidential work and a much cheaper Contributor-tier one for side
  projects, chosen per project rather than per machine;
- two subscriptions, simply.

The only way across that line today is `muse logout`, `muse login`, and a browser round trip. Running
two accounts *concurrently* — one thread on work while another runs on personal — is not possible at all.

## 2. Solution

Give Muse named profiles by giving each account its own config and data root, and starting `muse`
pointed at one of them. A profile is a directory pair. Selecting one is three environment variables.

`aonia` is a library first, a CLI second. Helicon consumes the library; the CLI is the same thing for
people who live in a terminal.

### Principles

1. **Never touch a credential.** No read, write, copy, export or transmit. `muse login` owns every
   login. `aonia` owns directories and environment variables. The only thing it reads out of
   `auth.json` is the non-secret identity — email, display name, whether a login exists.
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
beside it (Mach-O on macOS, `.exe` and roughly 400 MB on Windows). It resolves credentials in this
order: `MUSE_AUTH_PATH`, then `$XDG_CONFIG_HOME/muse/auth.json`, then `$HOME/.config/muse/auth.json`.
It also reads `MUSE_LOGIN`, `MUSE_NO_AUTO_UPDATE`, `MUSE_INSTALL_DIR`, `MUSE_CHANNEL_URL`,
`MUSE_CLIENT_ID` and `MUSE_AUTH_URL`. Login is an OIDC device-code flow against `auth.meta.com`.

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
the item name, which is exactly what makes its multi-account story work. Muse does not appear to.

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
on disk and can be re-indexed from the directory names.

## 5. Library API

```ts
listProfiles(): Promise<Profile[]>          // name, id, roots, lastUsedAt, identity
createProfile(name: string): Promise<Profile>   // makes the roots; does not log in
removeProfile(id: string): Promise<void>        // removes the roots; never touches ~/.config/muse
envFor(profile: Profile): Record<string, string>
    // { XDG_CONFIG_HOME, XDG_DATA_HOME, MUSE_AUTH_PATH } — the only thing that selects an account
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
aonia list                  # names, identities, tiers, last used
aonia run <name> [-- args]  # muse under that profile; `-- serve`, `-- resume`, anything
aonia bind <path> <name>    # a directory selects its own account
aonia env <name>            # print the variables, for a hand-written shim
aonia shim <name>           # optional: generate a `muse-<name>` wrapper on PATH
aonia doctor
aonia rm <name>             # after an explicit confirmation
```

`aonia run` inherits the caller's stdio so the TUI behaves exactly as `muse` does. A profile with no
login says so and points at `aonia login <name>` rather than starting a doomed process.

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

**S1 — macOS Keychain collision.** Needs two real Muse accounts. Log in under profile A, log in under
profile B, then check whether A still works and whether a second Keychain item exists. If they collide,
test two escapes: denying Keychain access to force `keychain_fallback_file`, which puts the token in
the profile's own `auth.json`; and setting `HOME` per spawned process so the legacy Keychain API
resolves a different login keychain — noting that `HOME` moves much more than the keychain, so it may
cost more than it buys. **This decides what macOS can promise**, and the answer goes in the README
either way. Worst case: concurrency on Linux and Windows, sequential switching on macOS, stated up front.

**S2 — Windows native.** Native Windows Muse keeps config in `%USERPROFILE%\.config\muse` and data in
`%USERPROFILE%\.local\share\muse`. Does its PowerShell launcher honour `XDG_CONFIG_HOME` and
`XDG_DATA_HOME`, or only `MUSE_AUTH_PATH`? Probe on a `windows-latest` runner.

**S3 — WSL passthrough.** `WSLENV` or an explicit `env VAR=… muse serve`, and where the roots live
inside the distro.

**S4 — Meters per account.** `usage/read` returns `{}` until a model call, `usage/changed` carries no
session id, and `tier` is an opaque numeric id rather than a plan name. A newly added account therefore
shows no meter until its first turn; decide what that empty state says.

**S5 — Two hosts, one worktree.** Two `muse serve` processes on one directory with different data
roots: check `trust.json` and `session-index.db` for contention.

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

**Per-tier defaults.** A project pinned to a Standard-tier account for confidential work, Contributor
everywhere else, chosen from the project's binding.

## 10. Prior art

The cross-agent switcher space is crowded — `aisw`, `cc-switch`, `cursor-account-switcher`, Mjolnir,
cockpit-tools and a long tail of Claude-only tools. Two things are worth taking from that:

- The wide ones ship device fingerprinting and cap-triggered rotation, and are built for quota farming.
  That is the market pull this design refuses on purpose.
- None of them is Muse-shaped. Mjolnir covers Muse among many harnesses; nothing is built around the
  native Muse CLI, its MSP host, and a GUI that already reads the real plan meter.

That gap, plus Helicon's existing users, is the entire reason this is worth building.
