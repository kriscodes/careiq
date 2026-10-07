import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccessField, AccessPassword, AccessShell } from "../src/components/access/AccessShell";

test("a pasted verification code has one labeled field with autofill and a linked hint", () => {
  const markup = renderToStaticMarkup(React.createElement(AccessField, { label: "Verification code", name: "code", inputMode: "numeric", autoComplete: "one-time-code", hint: "Enter the whole six-digit code." }));
  assert.match(markup, /for="cq-a-code"/);
  assert.match(markup, /id="cq-a-code"/);
  assert.match(markup, /autoComplete="one-time-code"/i);
  assert.match(markup, /inputMode="numeric"/i);
  assert.match(markup, /aria-describedby="cq-a-code-hint"/);
  assert.match(markup, /id="cq-a-code-hint"/);
});
test("credentials support password managers without placing secrets in HTML defaults", () => {
  const login = renderToStaticMarkup(React.createElement(AccessPassword));
  const creation = renderToStaticMarkup(React.createElement(AccessPassword, { creating: true }));
  assert.match(login, /autoComplete="current-password"/i);
  assert.match(creation, /autoComplete="new-password"/i);
  assert.match(login, /aria-label="Show password"/);
  assert.doesNotMatch(login, /value=/);
  assert.match(login, /type="button"/);
});
test("setup exposes current progress and assistance with an accessible native dialog", () => {
  const props: Parameters<typeof AccessShell>[0] = { step: 2, children: "Form" };
  const markup = renderToStaticMarkup(React.createElement(AccessShell, props));
  assert.match(markup, /aria-current="step"/);
  assert.match(markup, /aria-label="Practice setup: step 2 of 3"/);
  assert.match(markup, /<dialog[^>]+aria-labelledby="cq-help-title"/);
  assert.match(markup, /id="cq-help-title"/);
});
