"""Prepare the same PII detector for WebGPU. Requires onnx and onnxruntime.

Run from the repository root. Downloads public model weights only; no documents.
Generated weights are ignored by Git and must accompany a deployment.
"""
import hashlib
import json
import os
import sys
from pathlib import Path
import urllib.request

import onnx
import onnxruntime as ort
from onnxruntime.transformers import float16

ROOT = Path(__file__).resolve().parent.parent
REVISION = "62ca5712368705bac11b8fea19e42e65cce088dd"
BASE = f"https://huggingface.co/bardsai/eu-pii-anonimization-multilang/resolve/{REVISION}/"
CACHE = ROOT / "artifacts" / "model-export"
DEST = ROOT / "public" / "models" / "pii-fp16-62ca5712-v1"


def download(name, target):
    if target.exists():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {name}", flush=True)
    temporary = target.with_suffix(target.suffix + ".part")
    request = urllib.request.Request(BASE + name, headers={"User-Agent": "Carryover-model-preparation"})
    with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
        while chunk := response.read(4 * 1024 * 1024):
            output.write(chunk)
    os.replace(temporary, target)


if __name__ == "__main__":
    output = DEST / "onnx" / "model_fp16.onnx"
    manifest_path = DEST / "manifest.json"
    if output.exists() and manifest_path.exists():
        existing = json.loads(manifest_path.read_text(encoding="utf-8"))
        with output.open("rb") as weights:
            digest = hashlib.file_digest(weights, "sha256").hexdigest()
        if existing.get("revision") == REVISION and existing.get("sha256") == digest:
            print("Verified existing GPU export: " + str(output), flush=True)
            sys.exit(0)
    source = CACHE / "model.onnx"
    download("onnx/model.onnx", source)
    for name in ("config.json", "tokenizer.json", "tokenizer_config.json", "README.md"):
        download(name, DEST / name)
    output.parent.mkdir(parents=True, exist_ok=True)
    print("Converting full-precision weights to FP16; keeping input/output types", flush=True)
    model = float16.convert_float_to_float16(onnx.load(str(source)), keep_io_types=True)
    onnx.checker.check_model(model)
    temporary = output.with_suffix('.onnx.part')
    onnx.save(model, str(temporary))
    # ONNX checker alone misses some type inconsistencies. Resolve the graph
    # through the runtime before publishing a manifest browsers can select.
    session = ort.InferenceSession(model.SerializeToString(), providers=['CPUExecutionProvider'])
    del session
    os.replace(temporary, output)
    manifest = {
        "source": "bardsai/eu-pii-anonimization-multilang", "revision": REVISION,
        "dtype": "fp16", "bytes": output.stat().st_size,
        "sha256": hashlib.file_digest(output.open("rb"), "sha256").hexdigest(),
        "largestTensorBytes": max(len(t.raw_data) for t in model.graph.initializer),
        "license": "Apache-2.0",
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest), flush=True)
