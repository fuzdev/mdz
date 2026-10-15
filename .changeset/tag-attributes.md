---
'@fuzdev/mdz': minor
---

**breaking** feat: tag attributes — quoted string (`"`/`'`) and bare boolean attributes on components and elements (`<Alert status="error">`, `<aside class="box">`); element attributes filter to a closed inert allowlist (`class`, `title`, `lang`, `dir`, `role`, `aria-label`/`-hidden`/`-describedby`/`-labelledby`, others dropped with a DEV warning), components receive only the attributes named at registration (`MdzComponents` entries are a bare component, which gets none, or `{component, props}` with a name list or `'all'`; the preprocessor's `components` option mirrors it as `{path, props}`), and a rendered component that throws falls back to its literal placeholder via a per-component `<svelte:boundary>`; malformed forms stay literal text; `MdzNodeElement`/`MdzNodeComponent` gain a required `attributes: Array<MdzAttribute>` and the `open` opcode an optional `attributes`; an element registered as `false` now renders as an unregistered placeholder
