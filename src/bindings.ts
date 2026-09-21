import { dirname, resolve } from "node:path";
import { readIndex, writeIndex } from "./index-file.js";
import type { AoniaPaths } from "./paths.js";

/** Absolute, no trailing separator, case folded on Windows where paths compare that way. */
export function normalizeBindingPath(path: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = resolve(path);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Directory to profile id. A binding covers the directory and everything under it. */
export class Bindings {
  constructor(
    private readonly paths: AoniaPaths,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async get(path: string): Promise<string | null> {
    const index = await readIndex(this.paths.indexFile);
    let current = normalizeBindingPath(path, this.platform);
    for (;;) {
      const id = index.bindings[current];
      if (id !== undefined) {
        return id;
      }
      const parent = dirname(current);
      if (parent === current) {
        return null;
      }
      current = parent;
    }
  }

  async set(path: string, id: string): Promise<void> {
    const index = await readIndex(this.paths.indexFile);
    index.bindings[normalizeBindingPath(path, this.platform)] = id;
    await writeIndex(this.paths.indexFile, index);
  }

  async remove(path: string): Promise<boolean> {
    const index = await readIndex(this.paths.indexFile);
    const key = normalizeBindingPath(path, this.platform);
    if (!(key in index.bindings)) {
      return false;
    }
    delete index.bindings[key];
    await writeIndex(this.paths.indexFile, index);
    return true;
  }

  async list(): Promise<Record<string, string>> {
    return { ...(await readIndex(this.paths.indexFile)).bindings };
  }
}
