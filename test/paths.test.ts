import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { AoniaPaths, defaultMuseConfigRoot, isProfileId, museConfigDir, museDataDir } from "../src/paths.js";

describe("isProfileId", () => {
  it("accepts lowercase slugs up to 32 characters", () => {
    for (const ok of ["a", "work", "client-a", "p1", "a".repeat(32)]) {
      assert.equal(isProfileId(ok), true, ok);
    }
  });
  it("rejects anything that is not a slug", () => {
    for (const bad of ["", "Work", "-work", "work_", "wo rk", "a".repeat(33), "../x", "work/", "."]) {
      assert.equal(isProfileId(bad), false, bad);
    }
  });
});

describe("AoniaPaths", () => {
  it("derives every path from one home", () => {
    const paths = new AoniaPaths("/tmp/aonia-home");
    assert.equal(paths.indexFile, join("/tmp/aonia-home", "profiles.json"));
    assert.equal(paths.profilesDir, join("/tmp/aonia-home", "profiles"));
    assert.equal(paths.profileDir("work"), join("/tmp/aonia-home", "profiles", "work"));
    assert.deepEqual(paths.rootsFor("work"), {
      config: join("/tmp/aonia-home", "profiles", "work", "config"),
      data: join("/tmp/aonia-home", "profiles", "work", "data"),
    });
  });

  it("prefers an explicit home, then AONIA_HOME, then ~/.aonia", () => {
    assert.equal(AoniaPaths.resolve("/explicit", { AONIA_HOME: "/from-env" }).home, resolve("/explicit"));
    assert.equal(AoniaPaths.resolve(undefined, { AONIA_HOME: "/from-env" }).home, resolve("/from-env"));
    assert.ok(AoniaPaths.resolve(undefined, {}).home.endsWith(".aonia"));
  });
});

describe("Muse directories", () => {
  it("names the muse subdirectory inside each root", () => {
    const roots = { config: "/p/config", data: "/p/data" };
    assert.equal(museConfigDir(roots), join("/p/config", "muse"));
    assert.equal(museDataDir(roots), join("/p/data", "muse"));
  });
  it("finds the default Muse config root from XDG_CONFIG_HOME or the home directory", () => {
    assert.equal(defaultMuseConfigRoot({ XDG_CONFIG_HOME: "/xdg" }), join("/xdg", "muse"));
    assert.ok(defaultMuseConfigRoot({}).endsWith(join(".config", "muse")));
    assert.ok(defaultMuseConfigRoot({ XDG_CONFIG_HOME: "" }).endsWith(join(".config", "muse")));
  });
});
