import assert from "node:assert/strict";
import test from "node:test";

import { readEnvNumber } from "../../lib/config/env-number";

const cases = [
  { name: "missing value uses the default", raw: undefined, options: { default: 12 }, expected: 12 },
  { name: "blank value uses the default", raw: "", options: { default: 12 }, expected: 12 },
  { name: "whitespace uses the default", raw: "  \t ", options: { default: 12 }, expected: 12 },
  { name: "surrounding whitespace is ignored", raw: " 1e3 ", options: { default: 0 }, expected: 1000 },
  { name: "minimum bound is inclusive", raw: "2", options: { default: 0, min: 2 }, expected: 2 },
  { name: "maximum bound is inclusive", raw: "8", options: { default: 0, max: 8 }, expected: 8 },
  { name: "scientific notation is accepted", raw: "1e3", options: { default: 0 }, expected: 1000 },
  { name: "integer values are accepted", raw: "-4", options: { default: 0, integer: true }, expected: -4 },
  { name: "non-numeric value is rejected", raw: "12ms", options: { default: 0, min: 1, max: 20 }, error: "range [1, 20]" },
  { name: "infinity is rejected", raw: "Infinity", options: { default: 0, min: 1, max: 20 }, error: "range [1, 20]" },
  { name: "values below the minimum are rejected", raw: "1", options: { default: 0, min: 2, max: 20 }, error: "range [2, 20]" },
  { name: "values above the maximum are rejected", raw: "21", options: { default: 0, min: 2, max: 20 }, error: "range [2, 20]" },
  { name: "non-integers are rejected when requested", raw: "2.5", options: { default: 0, min: 1, max: 4, integer: true }, error: "range [1, 4]" },
];

for (const { name, raw, options, expected, error } of cases) {
  test(name, () => {
    const result = readEnvNumber({ LIMIT: raw }, "LIMIT", options);

    if (error !== undefined) {
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.error, /LIMIT/);
        assert.ok(result.error.includes(error));
      }
    } else {
      assert.deepEqual(result, { ok: true, value: expected });
    }
  });
}