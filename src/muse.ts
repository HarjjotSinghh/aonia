import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { envFor } from "./env.js";
import type { Profile } from "./profiles.js";

/** What to spawn. `env` is the profile's overlay only; spread it over the parent environment. */
export interface Command {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function museCommand(musePath: string, profile: Profile, args: string[], platform: NodeJS.Platform = process.platform): Command {
  return { command: musePath, args: [...args], env: envFor(profile, platform) };
}

/**
 * Resolves the muse executable: an explicit path must exist; a bare name is searched on PATH, with
 * the usual Windows extensions. Returns null when nothing is found.
 */
export async function findMuse(musePath: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  const hasSeparator = musePath.includes("/") || musePath.includes("\\") || isAbsolute(musePath);
  if (hasSeparator) {
    return (await readable(musePath)) ? musePath : null;
  }
  const dirs = (env["PATH"] ?? "").split(delimiter).filter((dir) => dir.length > 0);
  const names = platform === "win32" ? [`${musePath}.exe`, `${musePath}.cmd`, `${musePath}.bat`, musePath] : [musePath];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (await readable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

async function readable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface LoginPrompt {
  url: string | null;
  code: string | null;
}

/**
 * `muse login` without a TTY prints "Open this page to sign in:" then the device URL, then
 * "confirm this code matches:" and the code, then waits. Feed it whatever has been read so far.
 */
export function parseLoginOutput(text: string): LoginPrompt {
  const url = /https:\/\/\S+code=([A-Z0-9-]+)/i.exec(text);
  if (!url) {
    return { url: null, code: null };
  }
  return { url: url[0], code: url[1] ?? null };
}
