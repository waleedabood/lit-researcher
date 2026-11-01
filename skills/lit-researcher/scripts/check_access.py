#!/usr/bin/env python3
"""Check that the Python packages and the literature APIs this skill needs are reachable."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ensure_packages import ensure_packages  # noqa: E402

ensure_packages()

import requests  # noqa: E402

# (label, domain, test URL, essential). Semantic Scholar is a chasing fallback; DataCite and doi.org only verify DOIs Crossref doesn't hold.
HOSTS = [
    ("PubMed", "eutils.ncbi.nlm.nih.gov", "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?retmode=json", True),
    ("Europe PMC", "www.ebi.ac.uk", "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=epilepsy&format=json&pageSize=1", False),
    ("ClinicalTrials.gov", "clinicaltrials.gov", "https://clinicaltrials.gov/api/v2/studies?pageSize=1", True),
    ("Crossref", "api.crossref.org", "https://api.crossref.org/works?rows=1", True),
    ("OpenAlex", "api.openalex.org", "https://api.openalex.org/works?per-page=1&filter=cites:W2134365734"
     + "".join(f"&{k}={os.environ[v]}" for k, v in (("api_key", "OPENALEX_API_KEY"), ("mailto", "OPENALEX_EMAIL")) if os.environ.get(v)), False),
    ("Semantic Scholar", "api.semanticscholar.org", "https://api.semanticscholar.org/graph/v1/paper/PMID:36614931?fields=title", False),
    ("DataCite", "api.datacite.org", "https://api.datacite.org/dois?page[size]=1", False),
    ("doi.org", "doi.org", "https://doi.org/api/handles/10.1000/1", False),
]
blocked = []
for name, domain, url, essential in HOSTS:
    code = None
    try:
        code = requests.get(url, timeout=20).status_code
        ok = code < 500 and code != 429
        if code == 429:
            hint = {"OpenAlex": "Set OPENALEX_API_KEY (free key at openalex.org) or OPENALEX_EMAIL; until then citation chasing uses the next source.",
                    "Semantic Scholar": "Citation chasing uses the next source."}.get(name, "Requests may fail for now; try again shortly.")
            print(f"LIMITED {name} ({domain}): HTTP 429 rate/credit limit. {hint}")
    except requests.RequestException:
        ok = False
    if ok or code != 429:
        print(("ok      " if ok else "BLOCKED ") + f"{name} ({domain})")
    if not ok and code != 429:
        blocked.append((domain, essential))
if blocked:
    print("\nTo allow them in the Claude app: Settings > Capabilities > Create and edit files > "
          "Use the internet while making files (on) > Allowed websites > Manage. Add each blocked site, one per entry:")
    for domain, _ in blocked:
        print("  " + domain)
    print("Then start a new chat (open chats keep the old setting).")
    if any(essential for _, essential in blocked):
        sys.exit(1)
    print("\nOnly optional sources are blocked: the search can run. Without Europe PMC, the search uses PubMed and ClinicalTrials.gov and open full text comes from PubMed Central via NCBI. Without OpenAlex or Semantic Scholar, citation chasing uses Europe PMC or PubMed's own links; without DataCite or doi.org, DOIs outside Crossref show as not found.")
    sys.exit(0)
print("\nAll set.")
