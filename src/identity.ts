import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { museConfigDir } from "./paths.js";
import type { Profile } from "./profiles.js";

/** The non-secret part of a login. Nothing else from auth.json ever leaves this module. */
export interface Identity {
  hasLogin: boolean;
  email: string | null;
  name: string | null;
}

const NONE: Identity = { hasLogin: false, email: null, name: null };

export async function identityOf(profile: Profile): Promise<Identity> {
  let raw: string;
  try {
    raw = await readFile(join(museConfigDir(profile.roots), "auth.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...NONE };
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...NONE };
  }
  const meta = (parsed as { providers?: { meta?: unknown } } | null)?.providers?.meta;
  if (typeof meta !== "object" || meta === null) {
    return { ...NONE };
  }
  const fields = meta as Record<string, unknown>;
  const text = (key: "mechanism" | "user_email" | "user_full_name"): string | null => {
    const value = fields[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  return { hasLogin: text("mechanism") !== null, email: text("user_email"), name: text("user_full_name") };
}
