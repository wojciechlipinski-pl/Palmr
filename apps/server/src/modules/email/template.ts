import sanitizeHtml from "sanitize-html";

// Placeholders available to the admin-editable "file shared with you" email template.
// Keep this list in sync with the UI legend in
// apps/web/src/app/settings/components/share-notification-template-editor.tsx
export const SHARE_NOTIFICATION_PLACEHOLDERS = [
  "fileName",
  "fileCount",
  "senderName",
  "senderEmail",
  "recipientEmail",
  "expiryDate",
  "downloadLink",
  "message",
  "appName",
] as const;

export type SharePlaceholderKey = (typeof SHARE_NOTIFICATION_PLACEHOLDERS)[number];

const PLACEHOLDER_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

export function findPlaceholders(text: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;

  PLACEHOLDER_PATTERN.lastIndex = 0;
  while ((match = PLACEHOLDER_PATTERN.exec(text)) !== null) {
    found.add(match[1]);
  }

  return Array.from(found);
}

// Returns the list of `{token}` placeholders in `text` that are not part of `allowed`.
export function findInvalidPlaceholders(text: string, allowed: readonly string[]): string[] {
  return findPlaceholders(text).filter((token) => !(allowed as readonly string[]).includes(token));
}

// Substitutes every known `{token}` in `template` with `values[token]`. Any `{token}`
// without a matching value (shouldn't happen for already-validated templates) is left
// untouched rather than replaced with "undefined".
export function renderTemplate(template: string, values: Record<string, string>): string {
  PLACEHOLDER_PATTERN.lastIndex = 0;
  return template.replace(PLACEHOLDER_PATTERN, (full, token) =>
    Object.prototype.hasOwnProperty.call(values, token) ? values[token] : full
  );
}

// Strips all markup from an admin-supplied email subject line - subjects are plain text.
export function sanitizeEmailSubject(subject: string): string {
  return sanitizeHtml(subject, { allowedTags: [], allowedAttributes: {} }).trim();
}

// Sanitizes admin-supplied HTML for an email body: keeps common formatting/layout tags
// and inline styles (email clients rely on inline CSS), strips scripts, iframes, forms,
// event handlers, and any non-http(s)/mailto URL scheme.
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "a",
      "b",
      "blockquote",
      "br",
      "div",
      "em",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "i",
      "img",
      "li",
      "ol",
      "p",
      "span",
      "strong",
      "table",
      "tbody",
      "td",
      "th",
      "thead",
      "tr",
      "u",
      "ul",
    ],
    allowedAttributes: {
      "*": ["style", "class", "align", "width", "height"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
    },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
  }).trim();
}
