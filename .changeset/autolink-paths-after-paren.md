---
'@fuzdev/mdz': minor
---

feat: auto-detected paths (`./foo`, `../foo`, `/foo`) link directly after an opening `(` not preceded by an ASCII letter, digit, or `]`, and a path opened by `(` ends at its matching `)`, so `(./foo.md)` and `**(./foo.md)**` link the path with the parens as text while `foo(./bar)` and a failed link's `[a](./b c)` stay literal; the auto-link trailing trim of punctuation and unbalanced `)` repeats to a fixpoint (`(see ./a.md.)` links `./a.md`); a reference with nothing after its prefix or scheme (`(/)`, `a ./) b`, `see http://)`) no longer links; and the streaming parser now matches `mdz_parse` when an auto-link swallows an open span's first closer (`**see /a**b and c**`, `_(./my_file.md)_`), leaving the opener literal
