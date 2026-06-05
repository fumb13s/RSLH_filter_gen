# Oracle test resources (local-only, git-ignored)

Inputs for the oracle probe that we keep on disk but DON'T commit — they're third-party and/or
contain personal account data. Everything in this folder is git-ignored except this README
(see `.gitignore`).

Expected contents (copy these in on a fresh machine before running the probe / regenerating):

- `SellfileCreator.html` (~12.7 MB) — the Sellfile Creator app, loaded by the headless probe.
  Source: `<RSL Helper install>/SellFileCreator/SellfileCreator.html`.
- `RSLHelper.db` (~1.4 MB) — a real RslHelper.db that `build-known-db.py` copies
  curated rows from. **Contains personal account data** (roster, gear, arena history; the filename
  is an account id). Sources: `%APPDATA%/RslHelper/Config/` (live) or the RSL Helper install dir.

`build-known-db.py` reads the source DB from this folder.
