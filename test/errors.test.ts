import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AoniaError } from "../src/index.js";

describe("AoniaError", () => {
  it("carries a stable code and a readable message", () => {
    const error = new AoniaError("no_such_profile", 'No profile named "work"');
    assert.equal(error.code, "no_such_profile");
    assert.equal(error.message, 'No profile named "work"');
    assert.equal(error.name, "AoniaError");
    assert.ok(error instanceof Error);
  });
});
