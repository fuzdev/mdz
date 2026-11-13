---
'@fuzdev/mdz': patch
---

fix: `mdz_from_tsdoc` returns `@see` content that opens with a backtick as written, so `` @see `foo` for bar `` renders `foo` as code instead of wrapping it in a second pair of backticks, which left both spans literal
