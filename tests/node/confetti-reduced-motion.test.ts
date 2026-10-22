import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";
import Confetti from "../../components/Confetti";

test("SSR: Confetti renders null when active is false", () => {
  const html = renderToString(React.createElement(Confetti, { active: false }));
  assert.equal(html, "");
});

test("SSR: Confetti initial server render is safe and produces null without throwing", () => {
  const html = renderToString(React.createElement(Confetti, { active: true }));
  assert.equal(html, "");
});
