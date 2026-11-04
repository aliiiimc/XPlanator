import test from "node:test";
import assert from "node:assert/strict";
import { parseExplanation, stripHighlightMarkers } from "./explanationParser";

test("parseExplanation extracts French sections", () => {
  const sections = parseExplanation(
    `Resume:
Cette fonction additionne deux nombres.

Details:
Elle prend [[a]] et [[b]], calcule total, puis le retourne.

A retenir:
Elle encapsule une addition simple.`,
    "fr"
  );

  assert.equal(sections.summary, "Cette fonction additionne deux nombres.");
  assert.match(sections.details, /calcule total/);
  assert.equal(sections.takeaway, "Elle encapsule une addition simple.");
});

test("parseExplanation extracts English sections and removes decorative markdown", () => {
  const sections = parseExplanation(
    `**Summary:**
- It reads the selected code.

**Details:**
- It builds a prompt for the model.

**Key takeaway:**
- It prepares a focused explanation request.`,
    "en"
  );

  assert.equal(sections.summary, "It reads the selected code.");
  assert.equal(sections.details, "It builds a prompt for the model.");
  assert.equal(sections.takeaway, "It prepares a focused explanation request.");
});

test("parseExplanation keeps takeaway short and moves overflow into details", () => {
  const sections = parseExplanation(
    `Summary:
Short summary.

Details:
Original details.

Key takeaway:
Keep this sentence short. Extra explanation that belongs in the details panel.`,
    "en"
  );

  assert.equal(sections.takeaway, "Keep this sentence short.");
  assert.match(sections.details, /Original details/);
  assert.match(sections.details, /Extra explanation/);
});

test("parseExplanation falls back when the model ignores the requested format", () => {
  const sections = parseExplanation("This is a plain explanation.\nIt has no labelled sections.", "en");

  assert.equal(sections.summary, "");
  assert.equal(sections.details, "This is a plain explanation.\nIt has no labelled sections.");
  assert.equal(sections.takeaway, "");
});

test("stripHighlightMarkers removes model highlight brackets for copied text", () => {
  assert.equal(stripHighlightMarkers("Use [[total]] after [[sum]]."), "Use total after sum.");
});
