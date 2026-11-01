#!/usr/bin/env python3
"""Install the packages the scripts need on first run, so a missing one can't crash a stage."""
import importlib
import importlib.util
import site
import subprocess
import sys

# import name -> pip name. pysbd is optional and refcheck.py runs without it.
PACKAGES = {"requests": "requests", "rapidfuzz": "rapidfuzz", "openpyxl": "openpyxl", "docx": "python-docx", "pypdf": "pypdf"}
# A virtualenv takes the plain install. A system or Homebrew Python refuses it (PEP 668), so then use the user's own folder.
ATTEMPTS = ([], ["--user"], ["--user", "--break-system-packages"])


def missing_packages():
    importlib.invalidate_caches()
    return [PACKAGES[m] for m in PACKAGES if importlib.util.find_spec(m) is None]


def ensure_packages():
    missing = missing_packages()
    if not missing:
        return
    print("Installing missing packages: " + " ".join(missing), file=sys.stderr)
    for extra in ATTEMPTS:
        subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check",
                        "--retries", "1", "--timeout", "20", *extra, *missing],
                       stdout=sys.stderr, stderr=subprocess.DEVNULL)
        site.addsitedir(site.getusersitepackages())  # the folder may not have existed when Python started
        missing = missing_packages()
        if not missing:
            return
    print("MISSING PACKAGES: could not install them automatically. Run: pip install " + " ".join(missing))
    sys.exit(1)
