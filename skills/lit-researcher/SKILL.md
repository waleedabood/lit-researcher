---
name: lit-researcher
description: Reproducible, verified literature search for clinical and biomedical questions. Turns the user's question into search concepts for them to approve, then runs logged searches of PubMed, Europe PMC and ClinicalTrials.gov, chases citations, screens papers, and builds a fact table in which every sentence and number is checked by code against the source and every reference is checked against registries (DOI, year, author, retractions), ending with an Excel workbook and a fact list with exact quotes. Use this whenever the user asks what the literature says about a medical question, wants a literature search, evidence review, evidence table, or "what is the outcome / prognostic value / efficacy / accuracy of X in Y" with citations, even if they don't say "literature search". Not for checking an existing manuscript's references (that is a reference check) or for general web questions.
compatibility: Needs Python 3 with network access to eutils.ncbi.nlm.nih.gov, clinicaltrials.gov, api.crossref.org, api.openalex.org, api.datacite.org and doi.org (www.ebi.ac.uk for Europe PMC recommended; api.semanticscholar.org optional, as a citation-chasing fallback); packages requests, rapidfuzz, openpyxl, python-docx, pypdf (pysbd optional, for better sentence splitting). OpenAlex citation chasing needs OPENALEX_API_KEY or OPENALEX_EMAIL; without it chasing uses Europe PMC.
---

# Literature researcher

A literature review where **code does everything factual** (searching, de-duplication, ranking, fetching text, verifying quotes and numbers, building references) and **you make the judgment calls** (concepts, screening, choosing evidence). The user makes the final verdicts in the workbook.

The reason for this split: language models invent plausible citations, numbers and quotes. Here nothing factual reaches the user unless code found it in a registry or in the paper's own text. So never type a reference, DOI, author, year or number from memory; every fact must come from a verified evidence row.

`<skill-dir>` below is the folder containing this SKILL.md. Scripts are in `<skill-dir>/scripts/`. Use a work folder `lit/<short-topic>/` in the current working directory unless the user names one.

## 0. Check access (first use in a session)

```bash
python3 <skill-dir>/scripts/check_access.py
```

If packages are missing, `pip install -r <skill-dir>/requirements.txt`. If OpenAlex shows LIMITED, carry on: citation chasing falls back to Europe PMC; mention once that setting `OPENALEX_API_KEY` (free at openalex.org) or `OPENALEX_EMAIL` restores it. If the script exits with an error because sites are blocked, show the user its output as printed: the blocked domains, one per line (the Allowed websites list takes one site per entry), and the settings path (Settings → Capabilities → Create and edit files → Use the internet while making files → Allowed websites → Manage). Then stop; the search cannot work without them. If only the optional sites (Europe PMC, Semantic Scholar, DataCite, doi.org) are blocked, the script exits cleanly: carry on, and mention it once in the reply. Without Europe PMC the search runs on PubMed and ClinicalTrials.gov, and open full text comes from PubMed Central through NCBI instead; a host that fails once is skipped for the rest of the run, so a blocked site costs one timeout, not one per paper.

## 1. Question check and concepts, then stop for approval

Before any search, score the user's question with the rubric in `references/question-rubric.md` (read it), so a vague question is fixed while that is cheap.

1. Score the question **as written** on criteria 1–6 and 8 (0/1/2, one-line reason each). If the verdict will not be Ready, write the **suggested question**: the most useful answerable version, with every value you filled in shown in [brackets]. Don't ask the user to fill gaps; fill them the way the rubric says.
2. Write `<dir>/protocol.json` (below) for the suggested question if there is one, otherwise for the original.
3. Write `<dir>/question_check.json` (format in the rubric) and run:

```bash
python3 <skill-dir>/scripts/litsearch.py check <dir>
```

Code adds real PubMed hit counts (criterion 7), counts recent systematic reviews, totals the score, applies the verdict rules and writes `question_check.md`.

The protocol:

```json
{
 "title": "short topic name, e.g. Cenobamate in LGS",
 "question": "the user's question in one sentence",
 "subquestions": [{"id": "Q1", "text": "..."}, {"id": "Q2", "text": "..."}],
 "concepts": [
  {"name": "Intervention or test", "terms": ["synonym", "brand name", "code name"], "mesh": ["MeSH heading"]},
  {"name": "Condition or setting", "terms": ["..."], "mesh": ["..."]}
 ],
 "include": ["..."], "exclude": ["..."],
 "reviews": "include|exclude", "letters": "include|exclude",
 "years": [2010, 2026], "humans_only": true,
 "max_per_source": 200, "max_screen": 150,
 "approved": false
}
```

- Concepts are ANDed; terms within a concept are ORed. Two concepts is usual; each extra concept cuts hits sharply. Use MeSH headings only when sure they exist.
- Sub-questions (2–4) define the fact table; phrase each the way a source sentence would answer it.
- Say whether reviews and letters count, so screening is not a guess. For small or new literatures, consider including case series.
- `python3 <skill-dir>/scripts/litsearch.py queries <dir>` prints the exact database queries.

**Stop and ask the user to approve**, in plain language (no JSON):

Start with the contents of `question_check.md`, **pasted exactly as written** (score table, hit counts, recent reviews, suggested question). Then:

```
Question: <the suggested question, or the original if Ready>

Concepts I will search (all must appear; any synonym counts):
1. <Concept>: synonym, synonym, synonym  (MeSH: ...)
2. <Concept>: ...

Sub-questions the facts will answer:
Q1 ...
Q2 ...

Limits: years ..., humans only, include ..., exclude ...

Reply "approved" to search this, or change anything (concepts, synonyms, the bracketed additions).
```

If the verdict is Workable, add one line: "Or reply "use original" to search your question exactly as asked." (Not offered when the verdict is Needs refining.) If recent systematic reviews were found and the protocol excludes reviews, say in one line that they may already answer the question and will not be screened. If the user replies "use original", rebuild the protocol for the original question and ask again. Set `"approved": true` only after the user approves; this one reply approves both the question and the concepts.

Briefly flag judgment calls worth a thought (an ambiguous abbreviation, a broad synonym, a year cut-off), then the exact queries under "Exact queries (for reference)". Do not search until the user approves; then set `"approved": true`. If they change something, edit and ask again.

## 2. Search, chase, rank (code)

```bash
python3 <skill-dir>/scripts/litsearch.py search <dir>
python3 <skill-dir>/scripts/litsearch.py rank <dir>
```

If hits are very few (<10) or very many (>2,000), tell the user and propose a change rather than continuing. Then pick 3–5 clearly relevant primary papers from the top of `screening_list.json` as seeds, chase their references and citing papers, and rank again:

```bash
python3 <skill-dir>/scripts/litsearch.py chase <dir> --seeds PMID:123,PMID:456
python3 <skill-dir>/scripts/litsearch.py rank <dir>
```

Chasing uses OpenAlex for each seed's references and citing papers, falling back to Semantic Scholar, then Europe PMC, then PubMed's own reference and cited-by links if one is unreachable or busy, and always adds PubMed's similar articles (`--similar 20`), which find new papers nobody has cited yet. The Search log records which source answered for each seed; mention it if a fallback was used.

## 3. Screen (you)

For **every** record in `screening_list.json`, write `<dir>/screening_decisions.json` (template: `screening_decisions.template.json`): `{"id", "decision": "include|exclude|maybe", "reason", "note"}`. Exclusion reasons: `off_topic, wrong_population, wrong_design, no_relevant_outcome, not_primary_data, duplicate, not_retrievable, other`. Apply the protocol's rules, not your sense of what is interesting; when you bend a rule, say why in `note` so the user can overrule it. Watch for abbreviation collisions (e.g. a drug name matching a place name).

## 4. Retrieve (code)

```bash
python3 <skill-dir>/scripts/litsearch.py retrieve <dir>
```

Fetches open full text or abstracts, flags retractions, expressions of concern, preprints and letters, and writes `evidence_candidates.json` (top source sentences per paper and sub-question). The whole text of each paper is in its `source_file`, one `[sN]` sentence per line. If the user has PDFs of paywalled papers, add `--sources <folder>` with files named by record id (`PMID_123.pdf`).

## 5. Extract facts (you choose, code copies and checks)

Write `<dir>/extractions.json` (template: `extractions.template.json`), one row per fact:

`{"id": "E1", "paper_id": "PMID:123", "subq": "Q1", "anchor": "...", "fact": "...", "design": "...", "n": "...", "population": "...", "comparison": "...", "result": "...", "note": "..."}`

- **Choose the sentence** that best answers the sub-question, anywhere in the source. `anchor` is 6–15 consecutive words copied character-for-character from it; code copies the whole sentence into the table, so the user always sees the paper's own words.
- **`fact`** is what the user reads first: one complete, plain-language sentence that stands on its own. Start with the population and its size, name the drug or test, give the result with numbers and units, and the comparison or time point if the source has one. Spell out abbreviations; keep the source's hedges; for mixed cohorts say so ("In 41 patients with DEE, 33 of them with LGS, …"). Example: "In 36 children and adults with LGS, cenobamate reduced seizure frequency in 31 (86%); 22 (61%) had a ≥75% reduction and five (14%) became seizure-free."
- **Numbers are checked by code:** every number in `n` and `result` must appear in the chosen sentence, written as digits the way the sentence writes them; numbers in `fact`, `population` and `comparison` must appear somewhere in the paper. Do not add numbers up or convert them (4 + 9 is not "13" unless the paper says 13). If numbers are spread over two sentences, make two rows.
- `result` says what was measured, never a bare number or only a sample size. `note`: abstract-only, flags, caveats.

```bash
python3 <skill-dir>/scripts/litsearch.py verify <dir>
```

For each `PROBLEM`, fix the anchor or the wording from the source and rerun. Never change a number to something the source does not say; drop a row rather than force it.

## 6. Fact list (code)

```bash
python3 <skill-dir>/scripts/litsearch.py facts <dir>
```

Writes `facts.md`: one line per verified fact, plus a numbered reference list built by code from registry metadata. No narrative synthesis is written unless the user asks.

## 7. Ref-check every fact

Follow `references/ref-check.md` on `facts.md` with `--out <dir>/refcheck` (delete that folder first if it exists). This re-checks every reference against the registries and every fact against its source, as a second pass independent of step 5. Judge strictly: a different number, population, time point or a lost hedge is `partial`. If a fact comes back `partial`, `contradicts` or `not_found`, fix it in step 5, rerun `verify` and `facts`, and re-judge only the changed facts, once. Don't delete a fact just because the check disliked it; leave it with its verdict for the user.

## 8. Workbook

```bash
python3 <skill-dir>/scripts/litsearch.py workbook <dir>
```

`lit_review.xlsx` opens on **Evidence**: one row per fact with the paper, flags, full text vs abstract, the exact source sentence, the LLM fact and fields, the ref-check result, and the user's **Your verdict** column; then Screening (with **Your decision**), All records (every de-duplicated record with its status, including those ranked too low to screen, and a **Your decision** column), Search log (queries, hits, flow counts, exclusion reasons), Protocol (with the question check) and References. The same command also writes `references.ris` (every included paper with title, authors, journal, DOI and PubMed links, abstract, and the verified source sentences as notes), which imports into Zotero, EndNote or Mendeley in one step (File → Import). Give the user the workbook and `references.ris` as downloadable files (in Claude apps, copy it to the outputs folder, e.g. `/mnt/user-data/outputs/`, or use the file-presenting tool).

The same command writes two review pages from the workbook. Both have the list of rows on the left and the expanded view on the right (by default: paper, LLM fact, exact extract, and the whole abstract with the extract highlighted), a Fields menu, wrap/compact text, filters, and status buttons (Not reviewed / Accepted / Partly correct / Rejected) plus "Your comment" and "Your edited fact" boxes. Rebuilding the workbook keeps whatever the user has already entered in the "Your …" columns.

- `review.html` is the offline copy: one file with the workbook inside it, opened by double-click in any browser. "Save as HTML" keeps the changes in the page, and "Save Excel" writes them into the workbook with its formatting kept.
- `review_artifact.html` is for phones and sharing: if you can publish artifacts here, show it as an artifact so the user can review on any device. Where you can update an existing artifact, reuse one artifact named "Lit Review" for every review rather than making a new one each time, so the user's artifact list doesn't fill up; each topic keeps its changes separately (it saves changes to claude.ai where the artifact supports storage, and otherwise keeps them in that browser; "Export Excel" downloads the workbook with the changes). If you can't, give the user `review.html` as a download instead.

Give `protocol.json` a short `"title"` (e.g. "Cenobamate in LGS"); the pages are named "<title> Review".

## 9. Reply

```bash
python3 <skill-dir>/scripts/litsearch.py summary <dir>
```

Reply with, in this order:
1. The workbook file, `references.ris` (for Zotero/EndNote/Mendeley: File → Import), and the review page (the artifact, or `review.html` as a download).
2. Flow counts: records found → screened → included → facts verified → ref-check verdicts.
3. The bottom line per sub-question in 1–3 sentences, using only verified facts with their E-numbers and reference numbers. Say plainly when evidence is thin, retrospective, abstract-only or absent; an empty answer is a finding.
4. Flags: retracted / concern / preprint / letter papers, abstract-only papers carrying key facts, internal inconsistencies in sources, judgment calls the user may want to overrule.
5. The contents of `facts_summary.md`, **pasted exactly as written**. It is built by code: each sub-question's full text as a heading; under it, each fact as the inline LLM verdict (✅ supports · 🟡 partial · ❌ contradicts · ⚠️ not found), E-number, reference number and **LLM fact**, followed by the **Exact extract** copied from the paper; then a reference key. Don't shorten, reorder or retype it: the point is that the user sees code-copied source text, not a paraphrase.

## 10. Exact-extract paragraph (code only, on request)

When the user asks for the findings as one paragraph, build it from the **exact extracts** (the source sentences code copied from each paper), never from the LLM facts. Code writes the file:

```bash
python3 <skill-dir>/scripts/litsearch.py paragraph <dir>
```

It writes `<dir>/exact_extracts_paragraph.txt`: the verified sentences ordered by sub-question then fact number, each followed only by its reference number in [brackets], matching the reference list in `facts_summary.md`. A sentence that two facts share appears once. Before writing, code checks every sentence against the paper's saved text and then checks it appears verbatim in the written file.

- **Never type, paste, retype or summarize the paragraph in chat.** Send the file only as a downloadable file, because any text that passes through the model can change. In chat say only how many sentences it has, that code verified all of them against the source, and that the model did not retype the text.
- Sentences stay exactly as copied, including section labels ("RESULTS: …") and any run-on text from the source such as a figure caption. Don't edit, trim or reword them.
- If the command reports `MISMATCH`, it writes no file. Don't deliver anything; tell the user which rows failed.
- Don't offer an LLM-written version unless the user asks for one.
