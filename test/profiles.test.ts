import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { AoniaError } from "../src/errors.js";
import { readIndex } from "../src/index-file.js";
import { AoniaPaths, museConfigDir } from "../src/paths.js";
import { ProfileStore } from "../src/profiles.js";
import { tempHome, writeAuthJson } from "./helpers.js";

describe("ProfileStore", () => {
  let home = "";
  let cleanup = async () => {};
  let paths: AoniaPaths;
  let store: ProfileStore;
  const fixedNow = () => new Date("2026-09-21T09:00:00.000Z");

  beforeEach(async () => {
    ({ home, cleanup } = await tempHome());
    paths = new AoniaPaths(home);
    store = new ProfileStore(paths, {}, fixedNow);
  });
  afterEach(() => cleanup());

  it("starts empty", async () => {
    assert.deepEqual(await store.list(), []);
  });

  it("creates the two roots and their muse subdirectories, records the profile, returns it", async () => {
    const profile = await store.create("work", { name: "Work" });
    assert.deepEqual(profile, {
      id: "work",
      name: "Work",
      createdAt: "2026-09-21T09:00:00.000Z",
      lastUsedAt: null,
      roots: paths.rootsFor("work"),
    });
    assert.ok((await stat(join(profile.roots.config, "muse"))).isDirectory());
    assert.ok((await stat(join(profile.roots.data, "muse"))).isDirectory());
    if (process.platform !== "win32") {
      assert.equal((await stat(paths.profileDir("work"))).mode & 0o777, 0o700);
    }
    assert.deepEqual(await store.list(), [profile]);
    const index = await readIndex(paths.indexFile);
    assert.deepEqual(index.profiles, [{ id: "work", name: "Work", createdAt: "2026-09-21T09:00:00.000Z", lastUsedAt: null }]);
  });

  it("uses the id as the name when none is given", async () => {
    assert.equal((await store.create("personal")).name, "personal");
  });

  it("rejects bad ids and duplicates with stable codes", async () => {
    await assert.rejects(store.create("Work"), (e: unknown) => e instanceof AoniaError && e.code === "bad_profile_id");
    await assert.rejects(store.create("../etc"), (e: unknown) => e instanceof AoniaError && e.code === "bad_profile_id");
    await store.create("work");
    await assert.rejects(store.create("work"), (e: unknown) => e instanceof AoniaError && e.code === "profile_exists");
  });

  it("lists directories that are missing from the index, and hides index entries whose directory is gone", async () => {
    await mkdir(join(paths.profilesDir, "orphan", "config"), { recursive: true });
    await writeFile(paths.indexFile, JSON.stringify({ version: 1, profiles: [{ id: "ghost", name: "Ghost" }], bindings: {} }));
    const listed = await store.list();
    assert.deepEqual(listed.map((p) => p.id), ["orphan"]);
    assert.equal(listed[0]?.name, "orphan");
    assert.deepEqual(listed[0]?.roots, paths.rootsFor("orphan"));
  });

  it("ignores directories whose name is not a profile id", async () => {
    await mkdir(join(paths.profilesDir, "Not A Profile"), { recursive: true });
    await mkdir(join(paths.profilesDir, ".hidden"), { recursive: true });
    assert.deepEqual(await store.list(), []);
  });

  it("get returns the profile or raises no_such_profile", async () => {
    await store.create("work");
    assert.equal((await store.get("work")).id, "work");
    await assert.rejects(store.get("nope"), (e: unknown) => e instanceof AoniaError && e.code === "no_such_profile");
  });

  it("seeds settings.json and trust.json from the default root, never auth.json", async () => {
    const defaultRoot = join(home, "default-xdg");
    await mkdir(join(defaultRoot, "muse"), { recursive: true });
    await writeFile(join(defaultRoot, "muse", "settings.json"), '{"schema_version":1,"model":"muse-spark-1.3"}');
    await writeFile(join(defaultRoot, "muse", "trust.json"), '{"projects":{}}');
    await writeAuthJson(defaultRoot, { token: "DEFAULT-SECRET" });
    const defaultAuth = join(defaultRoot, "muse", "auth.json");
    const untouched = await readFile(defaultAuth, "utf8");
    const seeded = new ProfileStore(paths, { XDG_CONFIG_HOME: defaultRoot }, fixedNow);
    const profile = await seeded.create("work", { seedFromDefault: true });
    const dir = museConfigDir(profile.roots);
    assert.equal(await readFile(join(dir, "settings.json"), "utf8"), '{"schema_version":1,"model":"muse-spark-1.3"}');
    assert.equal(await readFile(join(dir, "trust.json"), "utf8"), '{"projects":{}}');
    await assert.rejects(stat(join(dir, "auth.json")));
    // The default root was only read: its auth.json is byte for byte what it was.
    assert.equal(await readFile(defaultAuth, "utf8"), untouched);
  });

  it("seed is a no-op when the default root has nothing to copy", async () => {
    const seeded = new ProfileStore(paths, { XDG_CONFIG_HOME: join(home, "nowhere") }, fixedNow);
    const profile = await seeded.create("work", { seedFromDefault: true });
    await assert.rejects(stat(join(museConfigDir(profile.roots), "settings.json")));
  });

  it("removes the directory tree, the index entry and any binding to it", async () => {
    await store.create("work");
    await store.create("personal");
    const index = await readIndex(paths.indexFile);
    index.bindings["/code/a"] = "work";
    index.bindings["/code/b"] = "personal";
    await (await import("../src/index-file.js")).writeIndex(paths.indexFile, index);
    await store.remove("work");
    await assert.rejects(stat(paths.profileDir("work")));
    assert.deepEqual((await store.list()).map((p) => p.id), ["personal"]);
    assert.deepEqual((await readIndex(paths.indexFile)).bindings, { "/code/b": "personal" });
  });

  it("remove refuses ids that are not slugs, so it can never leave the profiles directory", async () => {
    await assert.rejects(store.remove("../.."), (e: unknown) => e instanceof AoniaError && e.code === "bad_profile_id");
  });

  it("rename changes the display name only", async () => {
    await store.create("work");
    await store.rename("work", "Client A");
    const profile = await store.get("work");
    assert.equal(profile.name, "Client A");
    assert.equal(profile.id, "work");
  });

  it("touch stamps lastUsedAt", async () => {
    await store.create("work");
    const later = new ProfileStore(paths, {}, () => new Date("2026-09-22T10:00:00.000Z"));
    await later.touch("work");
    assert.equal((await store.get("work")).lastUsedAt, "2026-09-22T10:00:00.000Z");
  });
});
