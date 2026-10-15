---
'@fuzdev/mdz': minor
---

**breaking** fix: internal links render verbatim under the base path via `resolve()`'s pathname form instead of as route ids, so `(group)` segments, interior `//`, `[...]` segments, and `?query`/`#fragment` contents are no longer rewritten (and `[param]` segments no longer throw); a leading `/` followed by any `/` or `\` run collapses to one `/`; precompiled output emits `resolve('docs/foo')` without the leading slash; `MdzLinkRender`'s `resolve` variant carries `path` (no leading slash) instead of `href`
