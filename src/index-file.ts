import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AoniaError } from "./errors.js";

export interface IndexEntry {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The whole of `~/.aonia/profiles.json`. Never holds a secret. */
export interface ProfileIndex {
  version: 1;
  profiles: IndexEntry[];
  bindings: Record<string, string>;
}

export function emptyIndex(): ProfileIndex {
  return { version: 1, profiles: [], bindings: {} };
}

export async function readIndex(file: string): Promise<ProfileIndex> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyIndex();
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AoniaError("index_corrupt", `${file} is not valid JSON. Fix or delete it; profiles on disk are unaffected.`);
  }
  return reviveIndex(parsed);
}

/** Keeps what is well formed and drops the rest, so one bad entry never hides the others. */
export function reviveIndex(value: unknown): ProfileIndex {
  const out = emptyIndex();
  if (typeof value !== "object" || value === null) {
    return out;
  }
  const v = value as { profiles?: unknown; bindings?: unknown };
  if (Array.isArray(v.profiles)) {
    for (const item of v.profiles) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const entry = item as Record<string, unknown>;
      const id = entry["id"];
      if (typeof id !== "string") {
        continue;
      }
      out.profiles.push({
        id,
        name: typeof entry["name"] === "string" ? entry["name"] : id,
        createdAt: typeof entry["createdAt"] === "string" ? entry["createdAt"] : new Date(0).toISOString(),
        lastUsedAt: typeof entry["lastUsedAt"] === "string" ? entry["lastUsedAt"] : null,
      });
    }
  }
  if (typeof v.bindings === "object" && v.bindings !== null && !Array.isArray(v.bindings)) {
    for (const [path, id] of Object.entries(v.bindings as Record<string, unknown>)) {
      if (typeof id === "string") {
        out.bindings[path] = id;
      }
    }
  }
  return out;
}

/** Atomic: write a sibling temp file, then rename over the index. */
export async function writeIndex(file: string, index: ProfileIndex): Promise<void> {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.profiles.json.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(index, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await rename(tmp, file);
}
