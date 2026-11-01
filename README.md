# lit-researcher

[![Latest release](https://img.shields.io/github/v/release/waleedabood/lit-researcher)](https://github.com/waleedabood/lit-researcher/releases/latest)

A Claude skill for reproducible, verified literature searches on clinical and biomedical questions.

**Code does everything factual. The LLM makes the judgment calls. You approve.**

- Code searches PubMed, Europe PMC and ClinicalTrials.gov, chases citations, de-duplicates and ranks.
- Claude proposes the search concepts (you approve them), screens papers and picks the sentence that answers each question.
- Code copies that sentence word for word from the paper, checks every number against the source, and checks every reference against Crossref / DataCite / PubMed, including retractions.
- You get an Excel workbook and a review page with the exact source sentence next to every fact, plus a "Your verdict" column.
- You also get `references.ris`: every included paper with abstract, links and the verified key-finding sentences, ready for Zotero, EndNote or Mendeley (File → Import).

Nothing factual reaches you unless code found it in a registry or in the paper's own text.

## Install

**Claude app:**

1. Download [`lit-researcher.zip`](https://github.com/waleedabood/lit-researcher/releases/latest/download/lit-researcher.zip).
2. Go to Customize → Skills → **+** → Create skill → Upload a skill.
3. Choose the zip, then start a new chat.

**Or add it from the repository (paid plans):** go to Customize → Plugins → Add → Add marketplace, paste `waleedabood/lit-researcher` under "Add from a repository", and install *Lit Researcher*. Plugins added this way also work in Cowork and in Claude Code when you sign in with the same account.

**Claude directory:** Lit Researcher is under review and not listed yet.

**Claude Code:**

```
/plugin install lit-researcher --marketplace waleedabood/lit-researcher
```

**Python 3:** already included when you use the skill in the Claude app. Only needed on your own computer if you run it in Claude Code (install from python.org). Packages install on first run, or with `pip install -r skills/lit-researcher/requirements.txt`.

**First run: allow the search sites** (Claude app). The literature sites aren't on Claude's default allowed list, so you may need to add them once: Settings → Capabilities → Create and edit files → Use the internet while making files → Allowed websites → Manage. Start a new chat after changing this.
- Required: `eutils.ncbi.nlm.nih.gov`, `clinicaltrials.gov`, `api.crossref.org`
- Recommended: `www.ebi.ac.uk` (Europe PMC; without it, full text comes from PubMed Central via NCBI), `api.openalex.org`, `api.datacite.org`, `doi.org`
- Optional: `api.semanticscholar.org`
- Only if a Python package is missing: `pypi.org`, `files.pythonhosted.org` (the scripts install missing packages on first run)

The skill runs `check_access.py` first and tells you exactly which sites are missing.

### Optional: OpenAlex key

OpenAlex now limits anonymous requests. Without a key, citation chasing falls back to Semantic Scholar, then Europe PMC, then PubMed's own reference and cited-by links (results still come, possibly fewer). To use OpenAlex, set either environment variable:

```
OPENALEX_API_KEY=your-free-key   # from openalex.org
OPENALEX_EMAIL=you@example.org
```

## Use

Ask a clinical question, e.g. *"What is the recurrence risk after a first unprovoked seizure, and does immediate treatment change it?"*

1. Claude scores your question and proposes search concepts and sub-questions. Reply **approved** or edit them.
2. The search, screening, retrieval and fact extraction run.
3. You get `lit_review.xlsx`, a review page and `references.ris`. Mark each fact Accepted / Partly correct / Rejected, and import the .ris into your reference manager.

## How papers are screened

Every record gets the same four-part checklist, answered from its title and abstract. There is no numeric score.

| Criterion | The question |
|---|---|
| Population | Is this the protocol's population or setting? |
| Intervention | Is this the protocol's intervention, exposure or test? |
| Outcome | Does it report an outcome that could answer a sub-question? |
| Design | Is this a study design the protocol allows? |

Claude answers each one **Yes** (the title or abstract says so), **No** (it clearly rules this out) or **Unclear** (it doesn't say, or there is no abstract). When torn between No and Unclear, it chooses Unclear, because a wrong No loses the paper for good.

Code then applies one rule:

| Answers | Decision |
|---|---|
| Any No | Exclude |
| No "No", at least one Unclear | Maybe |
| All Yes | Include |

- **Maybes:** those with open full text get a second look, and the full text can settle their Unclear answers. The rest stay maybe and are listed for you. Maybes are not extracted.
- **Date limits:** code excludes papers outside the protocol's years.
- **Where you see it:** the Screening sheet in `lit_review.xlsx` and the review page show all four answers for every paper, and you can overrule any decision. `references.ris` holds included papers only, without the answers.
- **Relevance score:** that workbook column is the search ranking, not this checklist.

The checklist has not been validated against human screening.

## Which model to use

**Start on Opus 5.5 at medium effort.** Where the skill can't start subagents on other models, every step runs on the model you started with, and extraction is where an error can reach you.

Where it can, it uses these settings:

| Step | Model | Effort |
|---|---|---|
| Question and search terms | The model you started with | As set |
| Screening, first pass | Sonnet 5.5 | Low |
| Screening, second look | Sonnet 5.5 | Medium |
| Extraction | Opus 5.5 | Medium |
| Reference check, in a fresh agent | Opus 5.5 | High |

Fable 5.1 is used only if you ask for it.

Most of these settings are untested starting points. Only first-pass screening has been compared across models, in one small test (50 papers on one question): Haiku 5.5, Sonnet 5.5 and Opus 5.5 all kept the 17 papers that had to survive, and neither Opus nor higher effort showed a gain. That test can't show Haiku is as safe as Sonnet.

## Limits

- Facts come from open full text where available, otherwise from abstracts (flagged as "abstract only").
- Screening and sentence choice are LLM judgments; review them. The workbook shows every paper's checklist answers, decision and reason.
- Code confirms each number is in the source, not that it describes the right group. Numbers taken from outside the quoted sentence are listed with where they were found. A bare "one" isn't checked, because it's often a pronoun.
- Papers without a DOI (often older journals) are verified against PubMed. The second-pass reference check reads their PubMed abstract, so it has no source text only when there is no PMID or no abstract.
- Not a substitute for a formal systematic review protocol (dual independent screening, risk-of-bias assessment).
