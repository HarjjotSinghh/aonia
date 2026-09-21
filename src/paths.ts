import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** A profile id is its directory name. Lowercase slug, 1 to 32 characters. */
export const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function isProfileId(value: string): boolean {
  return PROFILE_ID.test(value);
}

/** The two directories a profile owns. `config` becomes XDG_CONFIG_HOME, `data` becomes XDG_DATA_HOME. */
export interface Roots {
  config: string;
  data: string;
}

export class AoniaPaths {
  constructor(readonly home: string) {}

  /** Explicit home, else AONIA_HOME, else ~/.aonia. */
  static resolve(home?: string, env: NodeJS.ProcessEnv = process.env): AoniaPaths {
    const fromEnv = env["AONIA_HOME"];
    const chosen = home ?? (fromEnv && fromEnv.length > 0 ? fromEnv : join(homedir(), ".aonia"));
    return new AoniaPaths(resolve(chosen));
  }

  get indexFile(): string {
    return join(this.home, "profiles.json");
  }

  get profilesDir(): string {
    return join(this.home, "profiles");
  }

  profileDir(id: string): string {
    return join(this.profilesDir, id);
  }

  rootsFor(id: string): Roots {
    const dir = this.profileDir(id);
    return { config: join(dir, "config"), data: join(dir, "data") };
  }
}

/** Where Muse keeps `auth.json`, `settings.json` and `trust.json` inside a config root. */
export function museConfigDir(roots: Roots): string {
  return join(roots.config, "muse");
}

/** Where Muse keeps sessions, skills and caches inside a data root. */
export function museDataDir(roots: Roots): string {
  return join(roots.data, "muse");
}

/**
 * Muse's own config root when no profile is selected: `$XDG_CONFIG_HOME/muse`, else `~/.config/muse`
 * (also on native Windows, where Muse uses `%USERPROFILE%\.config\muse`). aonia only ever reads it,
 * and only for the opt-in seed of settings.json and trust.json.
 */
export function defaultMuseConfigRoot(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env["XDG_CONFIG_HOME"];
  return xdg && xdg.length > 0 ? join(xdg, "muse") : join(homedir(), ".config", "muse");
}
