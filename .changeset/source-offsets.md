---
'@fuzdev/mdz': minor
---

feat: `Mdz` and `MdzNodeView` take an opt-in `source_offsets` prop that puts each node's `start` and `end` on the elements rendered for it as `data-mdz-start` and `data-mdz-end` — blocks, inline formatting, every rendered link, and registered elements — and passes them as props to injected `code` and `codeblock` components (typed `MdzSourceOffsetProps` on `MdzCodeComponent` and `MdzCodeblockComponent`), so a consumer can map rendered output back to its source and match anchors to link nodes by offset; off by default with unchanged output, not inherited by a nested `Mdz`, absent from `MdzStream`, and `svelte_preprocess_mdz` leaves a usage that sets it to the runtime
