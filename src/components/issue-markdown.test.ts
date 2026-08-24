import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { IssueMarkdown } from "./issue-markdown";

describe("IssueMarkdown", () => {
  it("renders common evidence formatting without executing raw HTML", () => {
    const output = renderToStaticMarkup(createElement(IssueMarkdown, {
      value: '## Context\n\n- first item\n- `code`\n\n> quoted\n\n[docs](https://example.com)\n\n<script>alert("x")</script>',
    }));

    expect(output).toContain("<h4>Context</h4>");
    expect(output).toContain("<ul>");
    expect(output).toContain("<code>code</code>");
    expect(output).toContain("<blockquote>quoted</blockquote>");
    expect(output).toContain('href="https://example.com"');
    expect(output).toContain("&lt;script&gt;");
    expect(output).not.toContain("<script>");
  });

  it("does not turn unsafe link schemes into anchors", () => {
    const output = renderToStaticMarkup(createElement(IssueMarkdown, { value: "[open](javascript:alert(1))" }));

    expect(output).not.toContain("href=");
  });
});
