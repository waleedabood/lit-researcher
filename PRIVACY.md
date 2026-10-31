# Privacy policy

Lit Researcher is a skill: instructions and Python scripts that run inside your own Claude session. The author runs no server, collects no data, and receives nothing from you.

## What leaves your session

To answer a question, the scripts send **search terms, identifiers (PMID, DOI, NCT number) and reference text** to these public scholarly services:

- PubMed (`eutils.ncbi.nlm.nih.gov`)
- Europe PMC (`www.ebi.ac.uk`)
- ClinicalTrials.gov (`clinicaltrials.gov`)
- Crossref (`api.crossref.org`)
- OpenAlex (`api.openalex.org`), DataCite (`api.datacite.org`), doi.org, and optionally Semantic Scholar (`api.semanticscholar.org`)

Nothing else is sent. Don't put patient-identifying information in your question: like any search, its terms go to these services.

## Optional settings

- `OPENALEX_API_KEY` and `OPENALEX_EMAIL`: if you set them, they are sent only to OpenAlex, to identify you for its rate limits.
- `--email` (reference checker): if you pass it, it is sent only in the request header to the services above, as their "polite pool" contact.

Neither is required, and neither is stored by the skill.

## What stays with you

Search logs, the downloaded-record cache, the Excel workbook and the review page are written to your own working folder. The skill doesn't upload them anywhere.

## Third parties

Each service above has its own privacy policy and may log requests it receives. The skill has no control over that.

## Contact

Questions: open an issue at https://github.com/waleedabood/lit-researcher/issues
