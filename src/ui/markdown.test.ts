import { describe, expect, it } from "vitest";
import { reflowMarkdown } from "./markdown";

describe("reflowMarkdown", () => {
  it("joins hard-wrapped lines and keeps headings, lists and table rows separate", () => {
    const md = [
      "# Title",
      "",
      "First line of a",
      "paragraph with `code` and **bold**.",
      "",
      "- item one",
      "  continued",
      "- item two",
      "",
      "| A | B |",
      "|---|---|",
      "| x | [link](https://example.com) |",
    ].join("\n");
    expect(reflowMarkdown(md)).toEqual([
      { text: "Title", head: true },
      { text: "First line of a paragraph with code and bold." },
      { text: "- item one continued", indent: true },
      { text: "- item two", indent: true },
      { text: "A — B", indent: true },
      { text: "x — link (https://example.com)", indent: true },
    ]);
  });
});
