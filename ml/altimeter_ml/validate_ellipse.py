"""External validation on HUMAN ratings: the ELLIPSE corpus (Crossley et al., 2023; CC BY-NC-SA 4.0,
used here for non-commercial evaluation only and never redistributed).

ELLIPSE essays are by US grade 8-12 English-language learners, scored by trained human raters on a 1-5
holistic scale. They are not IELTS essays and the scale differs, so we only ask a ranking question:
does the IELTS-trained scorer order essays the way human raters do, beyond essay length?

Steps: CSV -> jsonl -> web/scripts/dump-features.mjs (same TS feature code, training lexicon) ->
score with the exported model.json (pure-Python tree walk, which also checks the export) -> Spearman.
"""

from __future__ import annotations

import csv
import json
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "ellipse" / "ellipse_train.csv"
WORK = ROOT / "data" / "work"
ART = ROOT / "artifacts"
WEB = ROOT.parent / "web"
CRITERIA = ["TR", "CC", "LR", "GRA"]


def tree_value(t: dict, x: list[float]) -> float:
    if not t["f"]:
        return t["leaf"][0]
    i = 0
    while True:
        v = x[t["f"][i]]
        nxt = t["l"][i] if v <= t["t"][i] else t["r"][i]
        if nxt < 0:
            return t["leaf"][~nxt]
        i = nxt


def predict(model: dict, X: np.ndarray) -> dict[str, np.ndarray]:
    out = {}
    for c in CRITERIA:
        trees = model["criteria"][c]["trees"]
        out[c] = np.array([sum(tree_value(t, list(row)) for t in trees) for row in X])
    return out


def partial_spearman(x: np.ndarray, y: np.ndarray, z: np.ndarray) -> float:
    """Spearman correlation of x and y after removing the (rank) linear effect of z from both."""
    rx, ry, rz = (pd.Series(v).rank().values for v in (x, y, z))
    A = np.c_[np.ones_like(rz), rz]
    ex = rx - A @ np.linalg.lstsq(A, rx, rcond=None)[0]
    ey = ry - A @ np.linalg.lstsq(A, ry, rcond=None)[0]
    return float(np.corrcoef(ex, ey)[0, 1])


def main() -> None:
    csv.field_size_limit(10**8)
    rows = list(csv.DictReader(RAW.open(encoding="utf-8", errors="replace")))
    src = WORK / "ellipse.jsonl"
    with src.open("w") as f:
        for r in rows:
            f.write(json.dumps({"id": r["text_id_kaggle"], "topic": r["prompt"], "essay": r["full_text"], "split": "external"}) + "\n")
    feats_path = WORK / "ellipse_features.jsonl"
    subprocess.run(["node", "scripts/dump-features.mjs", str(src), str(feats_path), "--keep-lexicon"], cwd=WEB, check=True)

    model = json.loads((WEB / "src" / "lib" / "essay" / "model.json").read_text())
    F = pd.read_json(feats_path, lines=True, dtype={"id": str})
    X = F[model["features"]].values
    pred = predict(model, X)
    overall = np.mean([pred[c] for c in CRITERIA], axis=0)
    human = np.array([float(r["Overall"]) for r in rows])
    by_id = {r["text_id_kaggle"]: r for r in rows}
    words = np.array([float(by_id[i]["num_words"]) for i in F["id"].astype(str)])

    res = {
        "corpus": "ELLIPSE (Crossley et al., 2023), training release, human holistic scores 1-5",
        "n": int(len(F)),
        "spearman_model_vs_human": round(float(spearmanr(overall, human).statistic), 3),
        "spearman_length_vs_human": round(float(spearmanr(words, human).statistic), 3),
        "partial_spearman_controlling_length": round(partial_spearman(overall, human, words), 3),
        "per_criterion_spearman": {c: round(float(spearmanr(pred[c], human).statistic), 3) for c in CRITERIA},
        "human_analytic_vs_our_criterion": {
            "Vocabulary~LR": round(float(spearmanr(pred["LR"], [float(r["Vocabulary"]) for r in rows]).statistic), 3),
            "Grammar~GRA": round(float(spearmanr(pred["GRA"], [float(r["Grammar"]) for r in rows]).statistic), 3),
            "Cohesion~CC": round(float(spearmanr(pred["CC"], [float(r["Cohesion"]) for r in rows]).statistic), 3),
        },
        "note": "Different population (US secondary ELLs) and scale; a ranking check, not an IELTS accuracy claim.",
    }
    (ART / "ellipse_validation.json").write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
