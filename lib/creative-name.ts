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
  if (opts.dpa && opts.productSetName)
    return opts.productSetName
      .replace(/\s*[-—–]?\s*\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b\s*$/, '')
      .trim();
  if (opts.fileName) return opts.fileName.replace(/\.[^.]+$/, '');
  return 'Criativo 1';
}
