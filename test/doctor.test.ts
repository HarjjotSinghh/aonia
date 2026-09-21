import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { dirSize, doctor, type Finding } from "../src/doctor.js";
import { writeIndex, readIndex } from "../src/index-file.js";
import { AoniaPaths, museDataDir } from "../src/paths.js";
import { ProfileStore } from "../src/profiles.js";
import { tempHome, writeAuthJson } from "./helpers.js";

function codes(findings: Finding[]): string[] {
  return findings.map((finding) => finding.code).sort();
}

describe("doctor", () => {
  let home = "";
  let cleanup = async () => {};
  let paths: AoniaPaths;
  let store: ProfileStore;
  let museDir = "";
  beforeEach(async () => {
    ({ home, cleanup } = await tempHome());
    paths = new AoniaPaths(home);
    store = new ProfileStore(paths, {});
    museDir = join(home, "bin");
    await mkdir(museDir);
    await writeFile(join(museDir, "muse"), "#!/bin/sh\n");
    await chmod(join(museDir, "muse"), 0o755);
    await writeFile(join(museDir, "muse.exe"), "");
  });
  afterEach(() => cleanup());

  const ctx = (overrides: Partial<Parameters<typeof doctor>[0]> = {}) => ({
    paths,
    store,
    env: { PATH: museDir },
    platform: "linux" as NodeJS.Platform,
    musePath: "muse",
    ...overrides,
  });

  it("is quiet on a clean linux machine with no profiles", async () => {
    assert.deepEqual(await doctor(ctx()), []);
  });

  it("warns about an inherited META_API_KEY", async () => {
    const findings = await doctor(ctx({ env: { PATH: museDir, META_API_KEY: "sk-live" } }));
    assert.deepEqual(codes(findings), ["meta_api_key_inherited"]);
    assert.equal(findings[0]?.level, "warn");
    assert.equal(findings[0]?.message.includes("sk-live"), false);
  });

  it("errors when muse is not on PATH", async () => {
    const findings = await doctor(ctx({ env: { PATH: join(home, "empty") } }));
    assert.deepEqual(codes(findings), ["muse_missing"]);
    assert.equal(findings[0]?.level, "error");
  });

  it("reports a profile with no login, and disk usage for every profile", async () => {
    await store.create("work");
    await store.create("personal");
    await writeAuthJson(paths.rootsFor("personal").config, { email: "p@example.com" });
    await writeFile(join(museDataDir(paths.rootsFor("personal")), "blob"), "x".repeat(1000));
    const findings = await doctor(ctx());
    assert.deepEqual(codes(findings), ["disk_usage", "disk_usage", "no_login"]);
    const noLogin = findings.find((finding) => finding.code === "no_login");
    assert.equal(noLogin?.profileId, "work");
    assert.ok(noLogin?.message.includes("aonia login work"));
    const usage = findings.find((finding) => finding.code === "disk_usage" && finding.profileId === "personal");
    assert.ok(usage?.message.includes("1.0 kB") || usage?.message.includes("1000 B"), usage?.message);
  });

  it("warns about index entries whose directory is gone", async () => {
    const index = await readIndex(paths.indexFile);
    index.profiles.push({ id: "ghost", name: "Ghost", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: null });
    await writeIndex(paths.indexFile, index);
    const findings = await doctor(ctx());
    assert.deepEqual(codes(findings), ["index_entry_missing_dir"]);
    assert.equal(findings[0]?.profileId, "ghost");
  });

  it("explains the macOS file backend once", async () => {
    const findings = await doctor(ctx({ platform: "darwin" }));
    assert.deepEqual(codes(findings), ["macos_file_backend"]);
    assert.equal(findings[0]?.level, "info");
  });

  it("errors when a root is not writable", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async () => {
    await store.create("work");
    await writeAuthJson(paths.rootsFor("work").config);
    await chmod(paths.rootsFor("work").data, 0o500);
    try {
      const findings = await doctor(ctx());
      assert.ok(codes(findings).includes("root_unwritable"));
      assert.equal(findings.find((finding) => finding.code === "root_unwritable")?.profileId, "work");
    } finally {
      await chmod(paths.rootsFor("work").data, 0o700);
    }
  });
});

describe("dirSize", () => {
  it("sums file sizes recursively and returns 0 for a missing directory", async () => {
    const { home, cleanup } = await tempHome();
    try {
      await mkdir(join(home, "a", "b"), { recursive: true });
      await writeFile(join(home, "a", "one"), "12345");
      await writeFile(join(home, "a", "b", "two"), "1234567");
      assert.equal(await dirSize(join(home, "a")), 12);
      assert.equal(await dirSize(join(home, "missing")), 0);
    } finally {
      await cleanup();
    }
  });
});
