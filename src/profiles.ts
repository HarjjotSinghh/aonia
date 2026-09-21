import { constants } from "node:fs";
import { access, copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { AoniaError } from "./errors.js";
import { readIndex, writeIndex } from "./index-file.js";
import { AoniaPaths, defaultMuseConfigRoot, isProfileId, museConfigDir, museDataDir, type Roots } from "./paths.js";

export interface Profile {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  roots: Roots;
}

export interface CreateOptions {
  /** Display label. Defaults to the id. */
  name?: string;
  /** Copy settings.json and trust.json from Muse's default config root. Never auth.json. */
  seedFromDefault?: boolean;
}

/** Files the seed may copy out of the default root. auth.json is deliberately absent. */
const SEED_FILES = ["settings.json", "trust.json"] as const;

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assertId(id: string): void {
  if (!isProfileId(id)) {
    throw new AoniaError(
      "bad_profile_id",
      `"${id}" is not a valid profile id: lowercase letters, digits and dashes, 1 to 32 characters, starting with a letter or digit.`,
    );
  }
}

export class ProfileStore {
  constructor(
    private readonly paths: AoniaPaths,
    private readonly env: NodeJS.ProcessEnv,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Profiles on disk, in id order. The index supplies names and dates; the directory is the truth. */
  async list(): Promise<Profile[]> {
    const index = await readIndex(this.paths.indexFile);
    const onDisk = await this.dirs();
    const out: Profile[] = [];
    const seen = new Set<string>();
    for (const entry of index.profiles) {
      if (!onDisk.has(entry.id)) {
        continue;
      }
      seen.add(entry.id);
      out.push({ ...entry, roots: this.paths.rootsFor(entry.id) });
    }
    for (const id of onDisk) {
      if (seen.has(id)) {
        continue;
      }
      const info = await stat(this.paths.profileDir(id));
      out.push({ id, name: id, createdAt: info.birthtime.toISOString(), lastUsedAt: null, roots: this.paths.rootsFor(id) });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }

  async get(id: string): Promise<Profile> {
    const found = (await this.list()).find((profile) => profile.id === id);
    if (!found) {
      throw new AoniaError("no_such_profile", `No profile named "${id}". Run: aonia list`);
    }
    return found;
  }

  async create(id: string, options: CreateOptions = {}): Promise<Profile> {
    assertId(id);
    const dir = this.paths.profileDir(id);
    if (await exists(dir)) {
      throw new AoniaError("profile_exists", `Profile "${id}" already exists at ${dir}`);
    }
    const roots = this.paths.rootsFor(id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await mkdir(museConfigDir(roots), { recursive: true, mode: 0o700 });
    await mkdir(museDataDir(roots), { recursive: true, mode: 0o700 });
    if (options.seedFromDefault) {
      await this.seed(roots);
    }
    const name = options.name ?? id;
    const createdAt = this.now().toISOString();
    const index = await readIndex(this.paths.indexFile);
    index.profiles = index.profiles.filter((entry) => entry.id !== id);
    index.profiles.push({ id, name, createdAt, lastUsedAt: null });
    await writeIndex(this.paths.indexFile, index);
    return { id, name, createdAt, lastUsedAt: null, roots };
  }

  /** Removes the profile's directories and every reference to it. Never touches Muse's default roots. */
  async remove(id: string): Promise<void> {
    assertId(id);
    await rm(this.paths.profileDir(id), { recursive: true, force: true });
    const index = await readIndex(this.paths.indexFile);
    index.profiles = index.profiles.filter((entry) => entry.id !== id);
    for (const [path, bound] of Object.entries(index.bindings)) {
      if (bound === id) {
        delete index.bindings[path];
      }
    }
    await writeIndex(this.paths.indexFile, index);
  }

  /** The id is the directory and never changes; only the label does. */
  async rename(id: string, name: string): Promise<void> {
    const profile = await this.get(id);
    const index = await readIndex(this.paths.indexFile);
    const entry = index.profiles.find((candidate) => candidate.id === id);
    if (entry) {
      entry.name = name;
    } else {
      index.profiles.push({ id, name, createdAt: profile.createdAt, lastUsedAt: profile.lastUsedAt });
    }
    await writeIndex(this.paths.indexFile, index);
  }

  async touch(id: string): Promise<void> {
    const profile = await this.get(id);
    const at = this.now().toISOString();
    const index = await readIndex(this.paths.indexFile);
    const entry = index.profiles.find((candidate) => candidate.id === id);
    if (entry) {
      entry.lastUsedAt = at;
    } else {
      index.profiles.push({ id, name: profile.name, createdAt: profile.createdAt, lastUsedAt: at });
    }
    await writeIndex(this.paths.indexFile, index);
  }

  private async dirs(): Promise<Set<string>> {
    try {
      const entries = await readdir(this.paths.profilesDir, { withFileTypes: true });
      return new Set(entries.filter((entry) => entry.isDirectory() && isProfileId(entry.name)).map((entry) => entry.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new Set();
      }
      throw error;
    }
  }

  private async seed(roots: Roots): Promise<void> {
    const source = defaultMuseConfigRoot(this.env);
    const target = museConfigDir(roots);
    for (const file of SEED_FILES) {
      const from = join(source, file);
      if (await exists(from)) {
        await copyFile(from, join(target, file), constants.COPYFILE_EXCL);
      }
    }
  }
}
