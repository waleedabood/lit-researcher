# Question rubric

Scores the user's question **before** any search, so a vague question is fixed while it is cheap to fix. Eight criteria, each 0, 1 or 2 (total 16). You score criteria 1–6 and 8 with a one-line reason each; **code scores criterion 7** from real PubMed hit counts, adds up the total and applies the verdict rules (`<skill-dir>/scripts/litsearch.py check`).

Score the question as the user wrote it, not the version you would have asked. Judge only what is in the words; do not give credit for things you guess they meant.

| # | Criterion | 0 | 1 | 2 |
|---|---|---|---|---|
| 1 | **Population** (who) | Not stated | Broad or vague ("epilepsy", "ICU patients") | Specific condition, plus age group or setting when it matters ("children and adults with Lennox–Gastaut syndrome") |
| 2 | **Intervention / exposure / test** (what) | Not stated | A class or vague ("new antiseizure drugs", "EEG findings") | A named drug, test, exposure or EEG pattern |
| 3 | **Comparator** | The question compares ("better", "versus") but names nothing to compare with | Implied but unnamed ("compared with standard care") | Named, **or** the question clearly needs none (a single-arm outcome or prognosis question) |
| 4 | **Outcome** (what is measured) | Not stated | General domain only ("outcome", "efficacy", "prognostic value") | Specific and measurable ("≥50% seizure reduction", "death or poor mRS at 3 months", "sensitivity for seizures") |
| 5 | **Question type** | Cannot tell what kind of question it is | Type is clear but several are mixed (e.g. efficacy **and** mechanism **and** cost) | One type (therapy, prognosis, diagnosis, aetiology/risk, frequency), so the study design that answers it is clear |
| 6 | **Terms** (searchability) | A key term is ambiguous or collides with another meaning and is not defined ("CAPE" as an undefined abbreviation) | Brand-only or jargon terms that need synonyms the user should confirm ("Xcopri") | Standard terms, or abbreviations spelled out |
| 7 | **Feasibility** (code) | PubMed hits for the combined concepts ≤ 2 or > 5,000 | 3–9 or 2,001–5,000 | 10–2,000 |
| 8 | **Time frame and setting** | Not stated where it changes the answer (a prognosis question with no follow-up time) | Partly stated | Stated (publication years, follow-up time, setting), **or** clearly irrelevant to this question |

## Verdict rules (applied by code)

- **Ready** (14–16, no 0 on criteria 1, 2 or 4): search the question as written.
- **Workable** (10–13, no 0 on criteria 1, 2 or 4): searchable, but the suggested question is better. The user picks either.
- **Needs refining** (≤ 9, or any 0 on criteria 1, 2 or 4): the original can't be searched well; only the suggested question is offered.

Every criterion counts the same; the blocking rule already covers the three that matter most.

## The suggested question

When the verdict is not Ready, write the **most useful answerable version** of the user's question; don't ask them to fill gaps. For each criterion that scored below 2, fill it with the most likely intended value, chosen the way a clinician-researcher would:

- Population: the condition as usually studied, all ages unless the question implies one.
- Intervention or test: the generic name plus the brand the user used ("cenobamate (Xcopri)"); abbreviations spelled out.
- Comparator: "none (single-arm outcomes)" for a drug-outcome or prognosis question; the usual standard for a comparison question.
- Outcome: the field's standard outcome for that question type (seizure frequency reduction, responder rate ≥50%, seizure freedom, adverse events for a drug; death or functional outcome at a stated time for prognosis; sensitivity and specificity for a test).
- Time frame: a publication-year range that captures the literature (from the drug's first trials, or the last 10 years), and a follow-up time where the outcome needs one.

Put every filled-in value in [brackets] so the user sees what you added. The same values go straight into the draft concepts and sub-questions, so approving the suggested question approves the search.

## Recent reviews (code, not scored)

`check` also counts systematic reviews and meta-analyses matching the concepts from the last 5 years. If there are some, say so: the user may want to read them first, or narrow the question to what they don't cover.

## What to write

`<dir>/question_check.json`:

```json
{
 "question": "the user's question, exactly as written",
 "question_type": "therapy | prognosis | diagnosis | aetiology | frequency | mixed | unclear",
 "scores": {
  "population":   {"score": 1, "reason": "one line"},
  "intervention": {"score": 2, "reason": "..."},
  "comparator":   {"score": 2, "reason": "..."},
  "outcome":      {"score": 1, "reason": "..."},
  "type":         {"score": 2, "reason": "..."},
  "terms":        {"score": 1, "reason": "..."},
  "timeframe":    {"score": 2, "reason": "..."}
 },
 "refined_question": "the suggested question (see above), with every value you filled in in [brackets]; empty when the verdict will clearly be Ready",
 "best_designs": "the study designs that answer this type of question, e.g. RCTs, then prospective cohorts"
}
```

Leave criterion 7 out: code fills it from the hit counts. Score the original question, and build the draft concepts and sub-questions in protocol.json from the suggested question when there is one.
