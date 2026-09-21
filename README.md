# aonia

Named profiles for the Muse Code CLI. Keep more than one login on one machine, run two of them
at the same time, and let a project choose which one it uses.

> **Status: planning.** The design is settled and written down in [`docs/SPEC.md`](docs/SPEC.md).
> No code yet. The spikes in the spec come first, because one of them decides what macOS can honestly promise.

Aonia is the district around Mount Helicon, and "Aonian" was the classical epithet for the Muses.
It is a sibling to [Helicon](https://github.com/HarjjotSinghh/helicon), which will consume this as a library.

## What it does

Muse Code has one login per machine. `muse login` writes to `~/.config/muse/auth.json`, and every
`muse` process on that machine uses it — there is no `--account` and no profile flag. So work and
personal, or a client credential and your own, or two subscriptions, all mean logging out and back
in, with a browser round trip each time.

`aonia` gives each account its own config and data root, and starts `muse` pointed at one of them:

```bash
aonia add work              # create a profile
aonia login work            # runs `muse login` inside it — Muse's own browser flow, unchanged
aonia list                  # names, emails, login state, last used
aonia run work              # `muse`, under that profile
aonia run work -- serve     # anything `muse` takes, under that profile
aonia bind ~/code/client work
aonia env work              # print the variables, if you would rather write your own shim
aonia doctor
```

Two profiles can run at once, in the same repository, on different subscriptions.

## What it does not do

**It never touches a credential.** No reading, writing, copying, exporting or transmitting. `muse login`
owns every login; `aonia` owns directories and two environment variables. It never modifies
`~/.config/muse` or `~/.local/share/muse`, so your existing login keeps working whether or not this is
installed, and removing it leaves no trace in Muse's own state.

**It does not rotate accounts.** No round-robin, no switching when a cap is hit. This is separation —
work here, personal there, a client over there — chosen by a person. Tools that rotate credentials to
beat a meter are a different thing, and this is deliberately not one.

**It does not handle API keys.** `META_API_KEY` beats the account login unconditionally, so `aonia doctor`
warns when one is inherited from your environment. It never sets one.

## How it works

Each profile is a pair of directories, and selecting one is two environment variables:

```
~/.aonia/profiles/work/config   →  XDG_CONFIG_HOME   (auth.json, settings.json, trust.json)
~/.aonia/profiles/work/data     →  XDG_DATA_HOME     (sessions, skills, session-index.db)
```

Those two are the only account-selecting inputs the `muse` binary reads. (`MUSE_AUTH_PATH` exists,
but only the Bash launcher looks at it, for its own update downloads; the binary ignores it.)

That is the whole mechanism. Everything else is bookkeeping: which profiles exist, which one a
directory is bound to, and what identity each one holds — read from the non-secret fields of
`auth.json`, never the token.

On Linux and Windows the token lives in the profile's own `auth.json`, so isolating the config root
isolates the credential. On macOS, Muse 1.3.0 keeps it in the login Keychain under a fixed item
(`ai.meta.dev.credentials` / `meta`) that is not derived from the config directory, and every
profile whose `auth.json` points at the Keychain shares that one item. So on macOS `aonia` sets a
third variable, `TBH_CREDENTIAL_BACKEND=file`, which the binary honours and which keeps a profile's
token in its own `auth.json` instead — the same place Linux and Windows already keep it. Verified on
Muse Code 1.3.0: a login under it leaves the Keychain untouched, and a profile and the default login
run turns at the same time in the same directory. So macOS gets the same concurrency as Linux and
Windows, with one honest difference: on macOS a profile's token sits in a mode 0600 file under
`~/.aonia` rather than in the Keychain.

## With Helicon

[Helicon](https://github.com/HarjjotSinghh/helicon) will use this as a library: accounts in Settings,
one meter per account, an account per project and per thread, and one `muse serve` host per
(account, workspace) pair so two accounts genuinely run side by side.

The terminal comes first though. `aonia` works on its own, with no Helicon installed.

## Licence

MIT.

Unofficial community project. Not made, endorsed, or supported by Meta. "Muse" and "Muse Code" are
trademarks of Meta, used here only to describe the CLI this tool launches.
