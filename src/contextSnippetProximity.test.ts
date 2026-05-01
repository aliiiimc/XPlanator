import test from "node:test";
import assert from "node:assert/strict";
import { shouldSkipSameFileRelatedRange } from "./contextSnippetProximity";

test("skips overlapping same-file ranges", () => {
  assert.equal(shouldSkipSameFileRelatedRange(10, 12, 12, 14), true);
});

test("skips nearby same-file ranges within proximity window", () => {
  assert.equal(shouldSkipSameFileRelatedRange(20, 22, 24, 26, 3), true);
});

test("keeps distant same-file ranges beyond proximity window", () => {
  assert.equal(shouldSkipSameFileRelatedRange(20, 22, 30, 32, 3), false);
});
