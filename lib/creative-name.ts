// F5 — default creative name resolution (client-side, at enqueue time).
//
// When the user leaves a creative's name input empty, we derive a sensible
// default so the queued job never ships an unnamed creative:
//   - DPA active + a product set name available → the product set name with any
//     trailing DD/MM[/YYYY] date token (and adjacent dash separator) stripped.
//     Catalog product sets are commonly named like "LT1100.5 - 06/06" / "LT1100.5 06/06"
//     where the date is noise for the creative name.
//   - otherwise, if we have a file name → the file name without its extension.
//   - last resort → "Criativo 1".
//
// Pure + deterministic so it can be unit-tested without React/DOM.
// Spec: docs/superpowers/plans/2026-06-11-campaign-builder-features.md (Task B1b, Step 5).

export function defaultCreativeName(opts: {
  dpa: boolean;
  productSetName?: string;
  fileName?: string;
}): string {
  // The contract is that this NEVER returns an empty string — the queued job
  // must not ship an unnamed creative. Each branch below therefore falls
  // through to the next candidate when stripping leaves nothing behind:
  //   product set name → file name (stem) → "Criativo 1".

  if (opts.dpa && opts.productSetName) {
    // Strip a trailing DD/MM[/YYYY] date token (and adjacent dash separator).
    // A product set named purely by a date (e.g. "06/06") strips to "" — fall
    // through to the file name / last resort instead of returning empty.
    const stripped = opts.productSetName
      .replace(/\s*[-—–]?\s*\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b\s*$/, '')
      .trim();
    if (stripped) return stripped;
  }

  if (opts.fileName) {
    // Drop the file extension. A leading-dot file (e.g. ".env") strips to ""
    // — fall through to the last resort rather than returning empty.
    const stem = opts.fileName.replace(/\.[^.]+$/, '').trim();
    if (stem) return stem;
  }

  return 'Criativo 1';
}
