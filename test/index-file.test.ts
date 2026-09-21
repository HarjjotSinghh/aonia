import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { emptyIndex, readIndex, reviveIndex, writeIndex } from "../src/index-file.js";
import { tempHome } from "./helpers.js";

describe("profiles.json", () => {
  let home = "";
  let cleanup = async () => {};
  before(async () => ({ home, cleanup } = await tempHome()));
  after(() => cleanup());

  it("reads an empty index when the file does not exist", async () => {
    assert.deepEqual(await readIndex(join(home, "missing", "profiles.json")), emptyIndex());
  });

  it("round trips profiles and bindings and writes the file with mode 0600", async () => {
    const file = join(home, "profiles.json");
    const index = emptyIndex();
    index.profiles.push({ id: "work", name: "Work", createdAt: "2026-09-21T00:00:00.000Z", lastUsedAt: null });
    index.bindings["/code/client"] = "work";
    await writeIndex(file, index);
    assert.deepEqual(await readIndex(file), index);
    if (process.platform !== "win32") {
      assert.equal((await stat(file)).mode & 0o777, 0o600);
    }
    assert.ok((await readFile(file, "utf8")).endsWith("\n"));
  });

  it("drops malformed entries instead of failing on them", () => {
    const revived = reviveIndex({
      version: 1,
      profiles: [{ id: "ok" }, { name: "no id" }, "junk", null, { id: "dated", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: 5 }],
      bindings: { "/a": "ok", "/b": 7 },
    });
    assert.deepEqual(revived.profiles, [
      { id: "ok", name: "ok", createdAt: "1970-01-01T00:00:00.000Z", lastUsedAt: null },
      { id: "dated", name: "dated", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: null },
    ]);
    assert.deepEqual(revived.bindings, { "/a": "ok" });
    assert.deepEqual(reviveIndex("nonsense"), emptyIndex());
  });

  it("raises index_corrupt on invalid JSON rather than silently starting over", async () => {
    const file = join(home, "corrupt.json");
    await writeFile(file, "{ not json");
    await assert.rejects(readIndex(file), (error: unknown) => {
      return error instanceof Error && (error as { code?: string }).code === "index_corrupt";
    });
  });
});
