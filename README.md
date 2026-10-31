# lit-researcher

A Claude skill for reproducible, verified literature searches on clinical and biomedical questions.

**Code does everything factual. The LLM makes the judgment calls. You approve.**

- Code searches PubMed, Europe PMC and ClinicalTrials.gov, chases citations, de-duplicates and ranks.
- Claude proposes the search concepts (you approve them), screens papers and picks the sentence that answers each question.
- Code copies that sentence word for word from the paper, checks every number against the source, and checks every reference against Crossref / DataCite / PubMed, including retractions.
- You get an Excel workbook and a review page with the exact source sentence next to every fact, plus a "Your verdict" column.
- You also get `references.ris`: every included paper with abstract, links and the verified key-finding sentences, ready for Zotero, EndNote or Mendeley (File → Import).

Nothing factual reaches you unless code found it in a registry or in the paper's own text.

## Install

**Claude app (claude.ai, desktop, mobile):** add *Lit Researcher* from the directory (Customize → Skills → Browse), or download `lit-researcher.zip` from the Releases page and upload it under Customize → Skills → **+** → Create skill → Upload a skill.

**Claude Code:**

```
/plugin install lit-researcher --marketplace waleedabood/lit-researcher
```

**Python 3:** already included when you use the skill in the Claude app. Only needed on your own computer if you run it in Claude Code (install from python.org). Packages install on first run, or with `pip install -r skills/lit-researcher/requirements.txt`.

**Allowed websites** (Claude app): Settings → Capabilities → Create and edit files → Use the internet while making files → Allowed websites → Manage. Start a new chat after changing this.
- Required: `eutils.ncbi.nlm.nih.gov`, `www.ebi.ac.uk`, `clinicaltrials.gov`, `api.crossref.org`
- Recommended: `api.openalex.org`, `api.datacite.org`, `doi.org`
- Optional: `api.semanticscholar.org`

The skill runs `check_access.py` first and tells you exactly which sites are missing.

### Optional: OpenAlex key

OpenAlex now limits anonymous requests. Without a key, citation chasing falls back to Europe PMC (results still come, slightly fewer). To use OpenAlex, set either environment variable:

```
OPENALEX_API_KEY=your-free-key   # from openalex.org
OPENALEX_EMAIL=you@example.org
```

## Use

Ask a clinical question, e.g. *"What is the recurrence risk after a first unprovoked seizure, and does immediate treatment change it?"*

1. Claude scores your question and proposes search concepts and sub-questions. Reply **approved** or edit them.
2. The search, screening, retrieval and fact extraction run.
3. You get `lit_review.xlsx`, a review page and `references.ris`. Mark each fact Accepted / Partly correct / Rejected, and import the .ris into your reference manager.

## Limits

- Facts come from open full text where available, otherwise from abstracts (flagged as "abstract only").
- Screening and sentence choice are LLM judgments; review them. The workbook shows every decision with its reason.
- Papers without a DOI (often older journals) are verified against PubMed, but the second-pass reference check has no source text for them.
- Not a substitute for a formal systematic review protocol (dual independent screening, risk-of-bias assessment).
