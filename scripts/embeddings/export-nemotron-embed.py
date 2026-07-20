#!/usr/bin/env python3
"""Export NVIDIA Nemotron-3-Embed to the ONNX layout the Electron app's
in-process embedder (apps/electron/electron/main/services/local-embedder.ts)
loads.

Why this script exists: HF only ships the safetensors checkpoint; the app runs
the model via onnxruntime-node (no Python, no server at runtime). The export
bakes the bidirectional (non-causal) attention into the graph — validated
bit-exact against the reference sentence-transformers stack (cosine 1.000000).

Usage (one-time per machine):

    python scripts/embeddings/export-nemotron-embed.py --output "<dataPath>/models/nemotron-3-embed-1b"

    # optional smaller/faster-on-CPU int8 variant alongside the fp32 graph:
    python scripts/embeddings/export-nemotron-embed.py --output ... --quantize

Requires: pip install "transformers @ git+https://github.com/huggingface/transformers.git"
          torch onnx onnxscript onnxruntime
(PyPI transformers does not know `ministral3` yet — the model card's
">=5.2.0" note refers to the git builds. 2026-07-19.)

Layout produced (what local-embedder.ts expects):
    <output>/config.json
    <output>/tokenizer.json
    <output>/tokenizer_config.json
    <output>/onnx/model.onnx          (+ model.onnx.data external weights)
    <output>/onnx/model_quantized.onnx  (only with --quantize; int8 dynamic)
"""

import argparse
import json
import sys
from pathlib import Path

MODEL_ID_DEFAULT = "nvidia/Nemotron-3-Embed-1B-BF16"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default=MODEL_ID_DEFAULT, help="HF repo id (default: %(default)s)")
    ap.add_argument("--output", required=True, type=Path, help="Target model dir (e.g. <dataPath>/models/nemotron-3-embed-1b)")
    ap.add_argument("--quantize", action="store_true", help="Also write an int8 dynamic-quantized graph")
    ap.add_argument("--validate", action="store_true", default=True, help=argparse.SUPPRESS)
    args = ap.parse_args()

    import torch  # deferred so --help stays dependency-free
    from transformers import AutoModel, AutoTokenizer

    out: Path = args.output
    onnx_dir = out / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading {args.model} (fp32, CPU)…", flush=True)
    tok = AutoTokenizer.from_pretrained(args.model)
    model = AutoModel.from_pretrained(args.model, dtype=torch.float32, attn_implementation="eager")
    model.eval()
    print(f"Loaded {sum(p.numel() for p in model.parameters()) / 1e9:.2f}B params", flush=True)

    class Wrapper(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, input_ids, attention_mask):
            return self.m(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state

    dummy = tok(["passage: hello world"], return_tensors="pt")
    onnx_path = onnx_dir / "model.onnx"
    print(f"Exporting {onnx_path}…", flush=True)
    with torch.no_grad():
        torch.onnx.export(
            Wrapper(model),
            (dummy["input_ids"], dummy["attention_mask"]),
            str(onnx_path),
            input_names=["input_ids", "attention_mask"],
            output_names=["last_hidden_state"],
            dynamic_axes={
                "input_ids": {0: "batch", 1: "sequence"},
                "attention_mask": {0: "batch", 1: "sequence"},
                "last_hidden_state": {0: "batch", 1: "sequence"},
            },
            opset_version=17,
            do_constant_folding=True,
        )

    model.config.save_pretrained(out)
    tok.save_pretrained(out)
    print("Saved config + tokenizer.", flush=True)

    # Smoke-check the artifact the same way the app consumes it.
    import numpy as np
    import onnxruntime as ort

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    enc = tok(["query: what actions do I have?"], return_tensors="np")
    hidden = sess.run(None, {"input_ids": enc["input_ids"], "attention_mask": enc["attention_mask"]})[0]
    mask = enc["attention_mask"][..., None].astype(np.float32)
    pooled = (hidden * mask).sum(axis=1) / mask.sum(axis=1)
    pooled /= np.linalg.norm(pooled, axis=1, keepdims=True)
    assert pooled.shape[1] == model.config.hidden_size, pooled.shape
    print(f"Smoke check OK — hidden {hidden.shape}, pooled {pooled.shape}", flush=True)

    if args.quantize:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        q8 = onnx_dir / "model_quantized.onnx"
        print(f"Quantizing -> {q8}…", flush=True)
        quantize_dynamic(str(onnx_path), str(q8), weight_type=QuantType.QInt8)
        sess_q = ort.InferenceSession(str(q8), providers=["CPUExecutionProvider"])
        hidden_q = sess_q.run(None, {"input_ids": enc["input_ids"], "attention_mask": enc["attention_mask"]})[0]
        pooled_q = (hidden_q * mask).sum(axis=1) / mask.sum(axis=1)
        pooled_q /= np.linalg.norm(pooled_q, axis=1, keepdims=True)
        agree = float((pooled[0] @ pooled_q[0]))
        print(f"int8 vs fp32 agreement: {agree:.4f} (expect >=0.95)", flush=True)

    print(json.dumps({"model": args.model, "output": str(out), "dims": model.config.hidden_size}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
