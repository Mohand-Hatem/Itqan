// Teacher page HTML is cleaned on save (docs/09 #8). Allow-list only: anything else is dropped.
import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "u", "h2", "h3", "ul", "ol", "li", "blockquote", "a"],
  allowedAttributes: { a: ["href", "rel"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  // Our rel wins over anything the teacher wrote.
  transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener nofollow" }) },
};

export const cleanPageHtml = (html: string) => sanitizeHtml(html, OPTIONS).trim();
