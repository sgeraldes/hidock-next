"""
Score a diarization run against the two flagged facts for Rec47:
  A) Is there a speaker-change boundary near 2:31 (151s) — the Memo -> Sebastian handoff?
     (clip A is offset 0, so 151s in clip A == 151s absolute)
  B) How many distinct speakers in the roll-call window (clip B = absolute 930-990s)?
     clip B is offset 930, so within-clip time t maps to absolute t+930.

Usage: python score.py <run.json> --window A|B
Prints boundary proximity (A) or distinct-speaker count (B).
"""
import argparse, json, sys

if sys.platform == "win32":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

TARGET_BOUNDARY = 151.0  # 2:31, within clip A (offset 0)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("--window", choices=["A", "B"], required=True)
    ap.add_argument("--tol", type=float, default=15.0)
    args = ap.parse_args()
    data = json.load(open(args.run, encoding="utf-8"))
    segs = data["segments"]
    spk = data.get("distinct_speakers") or sorted({s["speaker"] for s in segs})
    print(f"run={args.run}")
    print(f"distinct_speakers={spk} (n={len(spk)})")
    print(f"timings={json.dumps(data.get('timings',{}))}")
    if args.window == "A":
        # boundaries = start of every segment whose speaker != previous
        bounds = [segs[i]["start"] for i in range(1, len(segs))
                  if segs[i]["speaker"] != segs[i-1]["speaker"]]
        near = [b for b in bounds if abs(b - TARGET_BOUNDARY) <= args.tol]
        print(f"speaker-change boundaries: {[round(b,1) for b in bounds]}")
        if near:
            best = min(near, key=lambda b: abs(b - TARGET_BOUNDARY))
            print(f"PASS: boundary at {best:.1f}s (target {TARGET_BOUNDARY}s, |dz|={abs(best-TARGET_BOUNDARY):.1f}s <= {args.tol})")
        else:
            closest = min(bounds, key=lambda b: abs(b - TARGET_BOUNDARY)) if bounds else None
            print(f"FAIL: no boundary within {args.tol}s of {TARGET_BOUNDARY}s. closest={closest}")
    else:
        print(f"distinct speakers across window B = {len(spk)}")

if __name__ == "__main__":
    main()
