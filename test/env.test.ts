import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { envFor } from "../src/env.js";
import type { Profile } from "../src/profiles.js";

const profile: Profile = {
  id: "work",
  name: "Work",
  createdAt: "2026-09-21T00:00:00.000Z",
  lastUsedAt: null,
  roots: { config: "/home/me/.aonia/profiles/work/config", data: "/home/me/.aonia/profiles/work/data" },
};

describe("envFor", () => {
  it("sets exactly the two XDG roots on linux and windows", () => {
    for (const platform of ["linux", "win32"] as const) {
      assert.deepEqual(envFor(profile, platform), {
        XDG_CONFIG_HOME: "/home/me/.aonia/profiles/work/config",
        XDG_DATA_HOME: "/home/me/.aonia/profiles/work/data",
      });
    }
  });

  it("adds the file credential backend on macOS, and nothing else", () => {
    assert.deepEqual(envFor(profile, "darwin"), {
      XDG_CONFIG_HOME: "/home/me/.aonia/profiles/work/config",
      XDG_DATA_HOME: "/home/me/.aonia/profiles/work/data",
      TBH_CREDENTIAL_BACKEND: "file",
    });
  });

  it("never sets MUSE_AUTH_PATH or META_API_KEY", () => {
    for (const platform of ["linux", "win32", "darwin"] as const) {
      const env = envFor(profile, platform);
      assert.equal("MUSE_AUTH_PATH" in env, false);
      assert.equal("META_API_KEY" in env, false);
    }
  });
});
