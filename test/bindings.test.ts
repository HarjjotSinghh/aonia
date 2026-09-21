import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Bindings, normalizeBindingPath } from "../src/bindings.js";
import { AoniaPaths } from "../src/paths.js";
import { tempHome } from "./helpers.js";

describe("normalizeBindingPath", () => {
  it("resolves to an absolute path without a trailing separator", () => {
    assert.equal(normalizeBindingPath("/code/client/", "linux"), resolve("/code/client"));
    assert.equal(normalizeBindingPath("/code//client/./", "linux"), resolve("/code/client"));
  });
  it("folds case on windows only", () => {
    assert.equal(normalizeBindingPath("C:\\Code\\Client", "win32"), resolve("C:\\Code\\Client").toLowerCase());
    assert.notEqual(normalizeBindingPath("/Code/Client", "linux"), resolve("/Code/Client").toLowerCase());
  });
});

describe("Bindings", () => {
  let home = "";
  let cleanup = async () => {};
  let bindings: Bindings;
  beforeEach(async () => {
    ({ home, cleanup } = await tempHome());
    bindings = new Bindings(new AoniaPaths(home), "linux");
  });
  afterEach(() => cleanup());

  it("is empty at first", async () => {
    assert.deepEqual(await bindings.list(), {});
    assert.equal(await bindings.get("/anything"), null);
  });

  it("binds a directory and resolves it and its descendants, nearest ancestor first", async () => {
    await bindings.set("/code/client", "work");
    await bindings.set("/code/client/oss", "personal");
    assert.equal(await bindings.get("/code/client"), "work");
    assert.equal(await bindings.get("/code/client/src/deep"), "work");
    assert.equal(await bindings.get("/code/client/oss"), "personal");
    assert.equal(await bindings.get("/code/client/oss/lib"), "personal");
    assert.equal(await bindings.get("/code"), null);
    assert.equal(await bindings.get("/code/client-other"), null);
  });

  it("stores normalized keys", async () => {
    await bindings.set("/code/client/", "work");
    assert.deepEqual(await bindings.list(), { [resolve("/code/client")]: "work" });
  });

  it("remove reports whether anything was bound", async () => {
    await bindings.set("/code/client", "work");
    assert.equal(await bindings.remove("/code/client/"), true);
    assert.equal(await bindings.remove("/code/client"), false);
    assert.deepEqual(await bindings.list(), {});
  });

  it("survives alongside the profile entries in the same index", async () => {
    const paths = new AoniaPaths(home);
    const { readIndex, writeIndex } = await import("../src/index-file.js");
    const index = await readIndex(paths.indexFile);
    index.profiles.push({ id: "work", name: "Work", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: null });
    await writeIndex(paths.indexFile, index);
    await bindings.set("/code/client", "work");
    const after = await readIndex(paths.indexFile);
    assert.equal(after.profiles.length, 1);
    assert.deepEqual(after.bindings, { [join(resolve("/code/client"))]: "work" });
  });
});
