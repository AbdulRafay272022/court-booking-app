/**
 * Turn a value into a JSON string that is safe to embed inside a raw <script> tag via
 * dangerouslySetInnerHTML, even when any field of that value is owner-controlled and might
 * contain "</script>", "<!--", "-->" or ampersand-based entities.
 *
 * JSON.stringify by itself does NOT escape <, >, / or & -- a venue name containing
 * `</script><script>alert(1)</script>` would otherwise close the enclosing <script> tag and
 * execute the injected one on the public venue page. Confirmed as a real, exploitable XSS by
 * QA against apps/web/app/venues/[slug]/page.tsx before this fix landed.
 *
 * We escape the characters that let raw HTML break out of, or interact with, the surrounding
 * <script>...</script> block:
 *   -   less-than      -> <    (defeats </script and <!--)
 *   -   greater-than   -> >    (defeats -->)
 *   -   ampersand      -> &    (blocks HTML entity tricks)
 * The output is still valid JSON (JSON permits any character in a string as a \uXXXX escape),
 * so JSON-LD consumers parse it identically. We deliberately escape at the point of
 * embedding, NOT in the stored data, so no legitimate content is mutated.
 */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
