# Dependabot Vulnerability Triage — 2026-07-15

Triage of the 15 open Dependabot alerts on `sgeraldes/hidock-next` (7 high, 5 moderate,
3 low). Source: <https://github.com/sgeraldes/hidock-next/security/dependabot>.

Fixes land on `beta/meeting-intelligence` first per repo routing.

## Summary

| Outcome | Count | Alerts |
| --- | --- | --- |
| **Fixed** (this change) | 5 | #91, #73, #200, #114, #247 |
| **Already patched on beta** (no action) | 6 | tar #25, #26, #29, #31, #63, #71 top-level |
| **Blocked upstream / tracked** | 4 | torch #363, #364, #365; tar #323 residual |

Net: the 5 Python alerts are resolved by upgrading `uv.lock`. The tar top-level exposure was
already fixed on beta (`tar@7.5.17`). The remaining tar residue and all torch alerts are
blocked by upstream constraints and are tracked below with remediation paths.

## Alert-by-alert

### Fixed — `uv.lock` (Python)

All five constraints in `pyproject.toml` already permitted the patched versions, so these are
pure lockfile bumps (`uv lock --upgrade-package …`), no manifest change.

| Alert | Sev | Package | Scope | Was | Now | Patched at |
| --- | --- | --- | --- | --- | --- | --- |
| #73  | HIGH   | black    | dev (direct: `black>=24.4`)       | 26.1.0 | 26.5.1 | 26.3.1 | CVE-2026-32274 (arbitrary file write via cache filename) |
| #91  | MEDIUM | requests | runtime (direct: `requests>=2.32.0`) | 2.32.5 | 2.34.2 | 2.33.0 | CVE-2026-25645 (insecure temp-file reuse in `extract_zipped_paths`) |
| #200 | MEDIUM | pytest   | dev (direct: `pytest>=8.2`)       | 9.0.2  | 9.1.1  | 9.0.3  | CVE-2025-71176 (vulnerable tmpdir handling) |
| #247 | MEDIUM | idna     | runtime (transitive via requests) | 3.11   | 3.18   | 3.15   | CVE-2026-45409 (`idna.encode()` bypass of CVE-2024-3651 fix) |
| #114 | LOW    | Pygments | dev (transitive)                  | 2.19.2 | 2.20.0 | 2.20.0 | CVE-2026-4539 (ReDoS in GUID regex) |

### Already patched on beta — `tar` top-level (dev)

`apps/electron/package-lock.json` already resolves the top-level `tar` to **7.5.17** on both
`beta` and `main`, which is above every patched threshold in these advisories. These alerts
are stale against the current lockfile and should auto-close once Dependabot re-scans:

- #25 CVE-2026-23745 (patched 7.5.3), #26 CVE-2026-23950 (7.5.4), #29 CVE-2026-24842 (7.5.7),
  #31 CVE-2026-26960 (7.5.8), #63 CVE-2026-29786 (7.5.10), #71 CVE-2026-31802 (7.5.11).

### Blocked / tracked — `tar@6.2.1` residue (#323, dev)

**ACTION ITEM (deferred):** `apps/electron/package-lock.json` still contains three `tar@6.2.1`
copies nested under native-build tooling:

- `@electron/rebuild@3.7.2` → `tar ^6.0.5`
- `@electron/node-gyp@10.2.0-electron.1` → `tar ^6.2.1`
- `cacache@16.1.3` → `tar ^6.1.11`

The open-ended advisory ranges (`tar <= 7.5.15`, patched **7.5.16**) technically include the
6.x line, so Dependabot flags 6.2.1. **There is no patched `tar` 6.x release** — the 6.x line
tops out at 6.2.1 and the fix exists only in 7.5.16+.

Why not force it now:

- **Dev/build-only, trusted inputs.** These run at `npm install` / `electron-builder
  install-app-deps` / `electron-rebuild` time and only extract archives fetched from the npm
  and Electron registries — not attacker-controlled tar files. The path-traversal CVEs require
  processing a malicious archive.
- **The only fixes perturb the protected native-rebuild toolchain.** A blanket npm `override`
  forcing `tar@^7.5.16`, or a major bump of `@electron/rebuild` 3→4 (v4 drops the direct tar
  dep), both run the `better-sqlite3` native rebuild on a new tar/toolchain. That is precisely
  the dual-ABI path guarded by `better-sqlite3-binding.smoke.test.ts`, and it is not a "safe
  upgrade" for a dev-only, trusted-input dependency.

**Remediation path:** in a dedicated PR, migrate `@electron/rebuild` 3.7.2 → 4.x (which drops
the direct `tar` dependency and modernizes the node-gyp/cacache chain), then re-run
`electron-builder install-app-deps` + the `better-sqlite3` dual-ABI smoke test across the
Node-20/Node-22 ABI matrix before merging. Isolated from this security bump because it carries
native-build regression risk.

### Blocked upstream — `torch` (#363, #364, #365, `scripts/experiments/diarization/`)

**ACTION ITEM (deferred):** `scripts/experiments/diarization/requirements.txt` pins
`torch==2.8.0` / `torchaudio==2.8.0` / `torchvision==0.23.0` (+cu126) for a hardware-gated
diarization spike (RTX 4090 / CUDA, gated HF models). It is a research spike — not installed by
`setup.py`, not in any shipped app's dependency closure, and not exercised in CI.

| Alert | Sev | CVE | Patched at | Status |
| --- | --- | --- | --- | --- |
| #363 | MEDIUM | CVE-2025-2999 (memory corruption in `unpack_sequence`) | 2.9.1 | blocked |
| #365 | LOW | CVE-2025-3001 (memory corruption in `torch.lstm_cell`) | 2.10.0 | blocked |
| #364 | LOW | CVE-2025-3000 (memory corruption in `torch.jit.script`) | **none** | unfixable |

Why not bump:

- **`whisperx` hard-pins the 2.8 line.** `whisperx==3.8.6` (and the current pre-release
  `3.8.7rc1`) require `torch~=2.8.0`, `torchaudio~=2.8.0`, `torchvision~=0.23.0`. `~=2.8.0`
  means `>=2.8.0, <2.9.0`, so torch cannot move to 2.9.1 or 2.10.0 without dropping/replacing
  whisperx. No published whisperx release supports torch ≥ 2.9.
- **#364 has no patched version** in any torch line, so torch stays flagged regardless of a bump.
- The spike's install procedure is order-sensitive and GPU/CUDA/gated-HF-specific; it cannot be
  validated in this environment.

**Remediation path:** revisit when an upstream `whisperx` release supports torch ≥ 2.10, then
bump the trio to `torch==2.10.0 / torchaudio==2.10.0 / torchvision==0.25.0` and re-validate the
spike end-to-end on GPU hardware. Until then the exposure is contained to a non-shipped,
manually-run experiment.
