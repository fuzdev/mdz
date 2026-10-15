---
'@fuzdev/mdz': minor
---

**breaking** feat: tag attributes — quoted string (`"`/`'`) and bare boolean attributes on components and elements (`<Alert status="error">`, `<aside class="box">`); element attributes filter to a closed inert allowlist (`class`, `title`, `lang`, `dir`, `role`, `aria-label`/`-hidden`/`-describedby`/`-labelledby`, others dropped with a DEV warning), component attributes pass through as props; malformed forms stay literal text; `MdzNodeElement`/`MdzNodeComponent` gain a required `attributes: Array<MdzAttribute>` and the `open` opcode an optional `attributes`; an element registered as `false` now renders as an unregistered placeholder
