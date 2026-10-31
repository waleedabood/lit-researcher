# Ref-check procedure

Used in step 7 of SKILL.md to re-check every fact in `facts.md` against its source and every reference against the registries.


You check references in a manuscript. Code does everything factual (finding citations, verifying references against Crossref/DataCite, fetching source text, extracting quotes). Your job is step 2: **you choose** the source sentence that best matches each claim, and suggest a verdict. **Code extracts the wording**: you only point at the sentence, and code copies it word for word from the source into the report. Your verdict is a suggestion: the user makes the final verdict in the spreadsheet, next to the code's own top 3 sentences and your pick.

The script is `scripts/refcheck.py` in this skill's folder. Use a work folder next to the manuscript named `<manuscript name>.refcheck/` unless the user gave one.

## 1. Prepare

If you were given pasted text instead of a file path, write it unchanged to a new `.md` file in the project root named after its title (e.g. `rapid-eeg-sleep-review.md`; never overwrite an existing file), with the reference list under a `References` heading, and use that file as the manuscript.

```bash
python3 <skill-dir>/scripts/refcheck.py prepare "<manuscript>" --out "<workdir>"
```

Useful options: `--refs FILE` if the reference list is in a separate file; `--sources DIR` if the user has PDFs of the cited papers (named `3.pdf` or `ref3.pdf` by reference number), which gives full text for paywalled papers. If prepare reports no references found, ask the user where the reference list is rather than guessing.

## 2. Choose the best sentence and suggest a verdict

Read `<workdir>/checks.json`. Each check is one (claim sentence, reference) pair with `candidates`: the source sentences most likely to be relevant, ranked by code by word overlap (a short source such as an abstract is passed through whole, best first). The top 3 appear in the spreadsheet as "Code match 1-3". Don't settle for them: choose the sentence *you* judge best (the one that most directly supports or refutes the claim, preferably the one with the specific numbers), wherever it is in the source. Catching a paraphrase the code's word matching missed is the main reason you are here. The full source is in `source_file` (one sentence per line, `[sN]` prefix); Grep it when the candidates don't settle the question.

The source text belongs to `source_title` / `source_doi`, so judge against that paper. When `ref_status` is `doi_mismatch`, this is the paper the citation describes if code could find it; otherwise it is the paper the cited DOI/PMID actually points to. Say which in the note, e.g. "judged against the linked paper (Wright et al., Emerg Med J 2021), not the cited Hobbs et al."

For each check suggest one verdict:

- `supports`: the source states the claim, including its specifics (numbers, populations, direction of effect).
- `partial`: the source supports part of it, or a weaker or narrower version (e.g. the claim says "all adults", the source says "children"; the claim says "causes", the source says "associated with").
- `contradicts`: the source says the opposite.
- `not_found`: the source text is available but doesn't address the claim.
- `cannot_assess`: no source text (`source_level` is `none`), or the claim cannot be checked against this kind of source.

Rules:

- **Anchor** = your pointer to the sentence you chose: 6–15 consecutive words copied character-for-character from that sentence. Copy, never paraphrase, never stitch words from two places. Required for `supports`, `partial` and `contradicts`; for `not_found`, give one only if a sentence is worth showing the user (e.g. the closest the source comes); leave it empty for `cannot_assess`. Finalize rejects anchors under 5 words. It doesn't show the anchor itself: it replaces it with the whole source sentence it was found in. So the anchor only has to point at the right sentence.
- Judge the specifics. A number, sample, or population that differs from the source makes the verdict `partial` at best.
- When `source_level` is `abstract`, the full paper may say more. Prefer `not_found` over `contradicts` unless the abstract plainly says the opposite, and say "abstract only" in the note.
- A `ref_status` other than `verified`/`found_without_doi`, or `ref_retracted: true`, goes in the note (e.g. "paper retracted; notice 10.1016/…", "cited DOI points to a different paper"). `ref_updates` lists retraction, correction and erratum notices. Mention a correction only if it could change the claim.
- Notes are one short sentence, written for the author.

Write `<workdir>/judgments.json` as a list of `{"id", "verdict", "anchor", "note"}` (the template is `judgments.template.json`).

## 3. Finalize

```bash
python3 <skill-dir>/scripts/refcheck.py finalize "<workdir>"
```

Finalize looks for every anchor in the source and fails any it cannot find. For each `PROBLEM` line, reopen the source file, copy the anchor again exactly, and rerun finalize. Never change a verdict just to make a problem go away. After one retry, leave whatever still fails; the report marks it "quote not verified".

## 4. Back to the main workflow

Return to step 8 of SKILL.md. The ref-check results are merged into the fact table by `litsearch.py workbook`.
