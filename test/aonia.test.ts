import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createAonia, type Aonia } from "../src/aonia.js";
import { tempHome, writeAuthJson } from "./helpers.js";

describe("createAonia", () => {
  let home = "";
  let cleanup = async () => {};
  let aonia: Aonia;
  beforeEach(async () => {
    ({ home, cleanup } = await tempHome());
    aonia = createAonia({ home, platform: "darwin", env: { PATH: "" }, musePath: "/opt/muse", now: () => new Date("2026-09-21T09:00:00.000Z") });
  });
  afterEach(() => cleanup());

  it("honours AONIA_HOME from env when no home is given", () => {
    assert.equal(createAonia({ env: { AONIA_HOME: join(home, "via-env") } }).paths.home, join(home, "via-env"));
  });

  it("wires profiles, identity, commands and bindings together", async () => {
    const work = await aonia.createProfile("work", { name: "Work" });
    assert.deepEqual((await aonia.listProfiles()).map((p) => p.id), ["work"]);
    assert.deepEqual(await aonia.identityOf(work), { hasLogin: false, email: null, name: null });
    await writeAuthJson(work.roots.config, { email: "w@example.com", name: "W" });
    assert.deepEqual(await aonia.identityOf(work), { hasLogin: true, email: "w@example.com", name: "W" });
    assert.deepEqual(aonia.loginCommand(work), {
      command: "/opt/muse",
      args: ["login"],
      env: { XDG_CONFIG_HOME: work.roots.config, XDG_DATA_HOME: work.roots.data, TBH_CREDENTIAL_BACKEND: "file" },
    });
    assert.deepEqual(aonia.runCommand(work, ["serve"]).args, ["serve"]);
    assert.deepEqual(aonia.envFor(work), aonia.loginCommand(work).env);
    await aonia.bindings.set("/code/client", "work");
    assert.equal(await aonia.bindings.get("/code/client/src"), "work");
    await aonia.touch("work");
    assert.equal((await aonia.getProfile("work")).lastUsedAt, "2026-09-21T09:00:00.000Z");
    await aonia.renameProfile("work", "Client");
    assert.equal((await aonia.getProfile("work")).name, "Client");
  });

  it("refuses to bind to a profile that does not exist", async () => {
    await assert.rejects(aonia.bindings.set("/code", "nope"), (e: unknown) => (e as { code?: string }).code === "no_such_profile");
  });

  it("removeProfile drops bindings with the profile", async () => {
    await aonia.createProfile("work");
    await aonia.bindings.set("/code/client", "work");
    await aonia.removeProfile("work");
    assert.deepEqual(await aonia.bindings.list(), {});
    assert.deepEqual(await aonia.listProfiles(), []);
  });

  it("doctor runs with the configured platform, env and muse path", async () => {
    const findings = await aonia.doctor();
    assert.deepEqual(findings.map((f) => f.code).sort(), ["macos_file_backend", "muse_missing"]);
  });
});
