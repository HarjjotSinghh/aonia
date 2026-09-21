import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { findMuse, museCommand, parseLoginOutput } from "../src/muse.js";
import type { Profile } from "../src/profiles.js";
import { tempHome } from "./helpers.js";

const profile: Profile = {
  id: "work",
  name: "Work",
  createdAt: "",
  lastUsedAt: null,
  roots: { config: "/p/work/config", data: "/p/work/data" },
};

describe("museCommand", () => {
  it("runs the given muse binary with the profile's environment", () => {
    assert.deepEqual(museCommand("muse", profile, ["login"], "linux"), {
      command: "muse",
      args: ["login"],
      env: { XDG_CONFIG_HOME: "/p/work/config", XDG_DATA_HOME: "/p/work/data" },
    });
    assert.deepEqual(museCommand("/opt/muse/bin/muse", profile, ["serve", "--disable-sandbox"], "darwin").env, {
      XDG_CONFIG_HOME: "/p/work/config",
      XDG_DATA_HOME: "/p/work/data",
      TBH_CREDENTIAL_BACKEND: "file",
    });
  });
});

describe("findMuse", () => {
  let home = "";
  let cleanup = async () => {};
  beforeEach(async () => ({ home, cleanup } = await tempHome()));
  afterEach(() => cleanup());

  it("returns an explicit path when it exists, null when it does not", async () => {
    const bin = join(home, "muse");
    await writeFile(bin, "#!/bin/sh\n");
    await chmod(bin, 0o755);
    assert.equal(await findMuse(bin, {}, "linux"), bin);
    assert.equal(await findMuse(join(home, "missing"), {}, "linux"), null);
  });

  it("searches PATH for a bare name, honouring Windows extensions", async () => {
    const dirA = join(home, "a");
    const dirB = join(home, "b");
    await mkdir(dirA);
    await mkdir(dirB);
    await writeFile(join(dirB, "muse"), "#!/bin/sh\n");
    await chmod(join(dirB, "muse"), 0o755);
    const env = { PATH: [dirA, dirB].join(delimiter) };
    assert.equal(await findMuse("muse", env, "linux"), join(dirB, "muse"));
    await writeFile(join(dirA, "muse.cmd"), "@echo off\n");
    assert.equal(await findMuse("muse", env, "win32"), join(dirA, "muse.cmd"));
    assert.equal(await findMuse("muse", { PATH: dirA }, "linux"), null);
    assert.equal(await findMuse("muse", {}, "linux"), null);
  });
});

describe("parseLoginOutput", () => {
  it("pulls the device URL and code out of what muse login prints", () => {
    const text = [
      "Open this page to sign in:",
      "  https://auth.meta.com/oauth/device/?code=JXZW-GJCG",
      "confirm this code matches:",
      "  JXZW-GJCG",
      "",
      "Waiting for approval...",
    ].join("\n");
    assert.deepEqual(parseLoginOutput(text), { url: "https://auth.meta.com/oauth/device/?code=JXZW-GJCG", code: "JXZW-GJCG" });
  });
  it("returns nulls until the prompt has been printed", () => {
    assert.deepEqual(parseLoginOutput("Open this page to sign in:\n"), { url: null, code: null });
    assert.deepEqual(parseLoginOutput(""), { url: null, code: null });
  });
});
