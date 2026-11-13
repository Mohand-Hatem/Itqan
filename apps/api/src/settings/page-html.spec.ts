import { describe, expect, it } from "vitest";
import { cleanPageHtml } from "./page-html.js";

describe("cleanPageHtml", () => {
  it("strips scripts, styles, event handlers, iframes, images and javascript: links", () => {
    const dirty = [
      "<p onclick=\"alert(1)\">Hi <script>alert('x')</script><strong>there</strong></p>",
      "<style>body{display:none}</style>",
      '<iframe src="https://evil.example"></iframe>',
      '<img src=x onerror="alert(1)">',
      '<a href="javascript:alert(1)">bad</a>',
      '<a href="//evil.example">relative</a>',
      "<svg><script>alert(1)</script></svg>",
    ].join("");
    const clean = cleanPageHtml(dirty);
    expect(clean).not.toMatch(/script|onclick|onerror|iframe|<img|<style|javascript:|svg|evil/i);
    expect(clean).toContain("<p>Hi <strong>there</strong></p>");
  });

  it("keeps safe formatting and forces rel on links", () => {
    const html =
      '<h2>About</h2><ul><li><em>One</em></li></ul><a href="https://x.example" rel="opener" target="_blank">x</a><a href="mailto:t@example.com">mail</a>';
    expect(cleanPageHtml(html)).toBe(
      '<h2>About</h2><ul><li><em>One</em></li></ul><a href="https://x.example" rel="noopener nofollow">x</a><a href="mailto:t@example.com" rel="noopener nofollow">mail</a>',
    );
  });

  it("keeps Arabic text", () => {
    expect(cleanPageHtml("<p>مرحبا بكم</p>")).toBe("<p>مرحبا بكم</p>");
  });
});
