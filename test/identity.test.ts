import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { identityOf } from "../src/identity.js";
import type { Profile } from "../src/profiles.js";
import { tempHome, writeAuthJson } from "./helpers.js";

describe("identityOf", () => {
  let home = "";
  let cleanup = async () => {};
  let profile: Profile;
  beforeEach(async () => {
    ({ home, cleanup } = await tempHome());
    profile = { id: "work", name: "Work", createdAt: "", lastUsedAt: null, roots: { config: join(home, "config"), data: join(home, "data") } };
  });
  afterEach(() => cleanup());

  it("reports no login when auth.json is absent", async () => {
    assert.deepEqual(await identityOf(profile), { hasLogin: false, email: null, name: null });
  });

  it("reads exactly email, name and login state, and nothing that is secret", async () => {
    await writeAuthJson(profile.roots.config, { email: "me@example.com", name: "Me Myself", token: "TOP-SECRET-123" });
    const identity = await identityOf(profile);
    assert.deepEqual(identity, { hasLogin: true, email: "me@example.com", name: "Me Myself" });
    assert.deepEqual(Object.keys(identity).sort(), ["email", "hasLogin", "name"]);
    assert.equal(JSON.stringify(identity).includes("SECRET"), false);
  });

  it("treats unparseable or shapeless files as no login rather than failing", async () => {
    await mkdir(join(profile.roots.config, "muse"), { recursive: true });
    await writeFile(join(profile.roots.config, "muse", "auth.json"), "{ nope");
    assert.deepEqual(await identityOf(profile), { hasLogin: false, email: null, name: null });
    await writeFile(join(profile.roots.config, "muse", "auth.json"), '{"providers":{}}');
    assert.deepEqual(await identityOf(profile), { hasLogin: false, email: null, name: null });
  });

  it("accepts a Keychain style pointer file without a token as a login", async () => {
    await mkdir(join(profile.roots.config, "muse"), { recursive: true });
    await writeFile(
      join(profile.roots.config, "muse", "auth.json"),
      JSON.stringify({ schema_version: 2, providers: { meta: { mechanism: "oauth", storage: "keychain", user_email: "kc@example.com" } } }),
    );
    assert.deepEqual(await identityOf(profile), { hasLogin: true, email: "kc@example.com", name: null });
  });
});
