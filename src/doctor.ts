import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { identityOf } from "./identity.js";
import { readIndex } from "./index-file.js";
import { findMuse } from "./muse.js";
import { museDataDir, type AoniaPaths } from "./paths.js";
import type { ProfileStore } from "./profiles.js";

export interface Finding {
  level: "info" | "warn" | "error";
  code: string;
  message: string;
  profileId?: string;
}

export interface DoctorContext {
  paths: AoniaPaths;
  store: ProfileStore;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  musePath: string;
}

/** Everything that would make a profile misbehave, in the order a person would fix it. */
export async function doctor(ctx: DoctorContext): Promise<Finding[]> {
  const findings: Finding[] = [];

  const apiKey = ctx.env["META_API_KEY"];
  if (typeof apiKey === "string" && apiKey.length > 0) {
    findings.push({
      level: "warn",
      code: "meta_api_key_inherited",
      message: "META_API_KEY is set in this environment. Muse uses it before any account login, so every profile would bill that key. Unset it to use profile logins.",
    });
  }

  if ((await findMuse(ctx.musePath, ctx.env, ctx.platform)) === null) {
    findings.push({
      level: "error",
      code: "muse_missing",
      message: ctx.musePath === "muse" ? "muse was not found on PATH. Install Muse Code or pass --muse <path>." : `muse was not found at ${ctx.musePath}.`,
    });
  }

  if (ctx.platform === "darwin") {
    findings.push({
      level: "info",
      code: "macos_file_backend",
      message: "On macOS Muse keeps the default login in the Keychain. Profile logins live in each profile's own auth.json (mode 0600) instead, which is what lets two profiles run at once.",
    });
  }

  const index = await readIndex(ctx.paths.indexFile);
  const profiles = await ctx.store.list();
  const present = new Set(profiles.map((profile) => profile.id));
  for (const entry of index.profiles) {
    if (!present.has(entry.id)) {
      findings.push({
        level: "warn",
        code: "index_entry_missing_dir",
        profileId: entry.id,
        message: `Profile "${entry.id}" is in profiles.json but its directory ${ctx.paths.profileDir(entry.id)} is gone. Run: aonia rm ${entry.id}`,
      });
    }
  }

  for (const profile of profiles) {
    for (const [label, dir] of [
      ["config", profile.roots.config],
      ["data", profile.roots.data],
    ] as const) {
      try {
        await access(dir, constants.R_OK | constants.W_OK);
      } catch {
        findings.push({
          level: "error",
          code: "root_unwritable",
          profileId: profile.id,
          message: `Profile "${profile.id}": the ${label} root ${dir} is not readable and writable by this user.`,
        });
      }
    }
    const identity = await identityOf(profile);
    if (!identity.hasLogin) {
      findings.push({
        level: "warn",
        code: "no_login",
        profileId: profile.id,
        message: `Profile "${profile.id}" has no login. Run: aonia login ${profile.id}`,
      });
    }
    const bytes = await dirSize(museDataDir(profile.roots));
    findings.push({
      level: "info",
      code: "disk_usage",
      profileId: profile.id,
      message: `Profile "${profile.id}" uses ${formatBytes(bytes)} under ${museDataDir(profile.roots)} (sessions, model catalog, skills cache).`,
    });
  }

  return findings;
}

/** Total size of every regular file under `path`; 0 when it does not exist. Symlinks are not followed. */
export async function dirSize(path: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }
  let total = 0;
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(child);
    } else if (entry.isFile()) {
      total += (await stat(child)).size;
    }
  }
  return total;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1000) {
    return `${bytes} B`;
  }
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
