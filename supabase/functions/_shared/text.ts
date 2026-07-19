// Deterministic brand sanitizer for model output.
//
// Em and en dashes are an AI tell and are banned from Aster copy (the brand
// rule: use commas, colons, periods or parentheses instead). Every AI-generation
// function asks the model to avoid them in its prompt, but a prompt is a request,
// not a guarantee: models still slip a dash in now and then. This function is the
// guarantee. Run it over any generated prose before it is saved or returned, so a
// stray dash can never reach a candidate, hiring manager or interviewer.
//
// Numeric en-dash ranges (e.g. "2019–2021", "3–5 years") are kept legible as
// hyphens; every other em/en dash becomes a comma, then spacing/punctuation is
// tidied so we never leave "word ," or "word, ." behind.
export function stripDashes(s: unknown): string {
  if (typeof s !== "string" || !s) return typeof s === "string" ? s : "";
  return s
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2") // 2019–2021 / 3—5 → 2019-2021 / 3-5
    .replace(/[ \t]*[–—][ \t]*/g, ", ")       // en/em dash as punctuation → ", "
    .replace(/,\s*([,.;:!?])/g, "$1")                    // ", ." → ".", ", ," → ","
    .replace(/\s+([,.;:!?])/g, "$1")                     // drop any space before punctuation
    .replace(/[ \t]{2,}/g, " ")                          // collapse doubled spaces
    .trim();
}
