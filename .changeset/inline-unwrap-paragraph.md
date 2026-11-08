---
"@fuzdev/mdz": patch
---

fix `Mdz` `inline` rendering a block `<p>` inside its `<span>` by unwrapping a lone paragraph, at runtime and in the preprocessor; a dynamic `inline` now falls back to runtime rendering
