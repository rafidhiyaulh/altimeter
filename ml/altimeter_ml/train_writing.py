"""Train the IELTS Writing Task 2 scorer (one LightGBM regressor per criterion) and export it for the
TypeScript worker.

Honest evaluation:
  * features come from web/src/lib/essay/features.ts (scripts/dump-features.mjs), the serving code;
  * test prompts are never seen in training (group split by prompt, see prep.py);
  * we report against two baselines (always predict the mean; essay length only);
  * the corpus labels look machine-generated (no 7.5 band, 14% of essays at 8.0 on every criterion),
    so every metric is also reported WITHOUT those 8.0 "model answers", which are easy to spot.

Outputs:
  web/src/lib/essay/model.json         compact trees (+ node values for per-essay explanations)
  ml/artifacts/writing_eval.json       metrics, baselines, conformal interval, parity sample
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import cohen_kappa_score

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "data" / "work"
ART = ROOT / "artifacts"
WEB_MODEL = ROOT.parent / "web" / "src" / "lib" / "essay" / "model.json"
CRITERIA = ["TR", "CC", "LR", "GRA"]
VERSION = "writing-2026.10.26"

PARAMS = dict(
    objective="regression", learning_rate=0.05, num_leaves=15, min_data_in_leaf=30,
    feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0,
    seed=7, deterministic=True, force_row_wise=True, verbose=-1,
)


def ielts_round(x: np.ndarray) -> np.ndarray:
    """IELTS rounds a criterion average to the nearest half band; .25 and .75 round up."""
    return np.floor(np.asarray(x) * 2 + 0.5) / 2


def clip_band(x: np.ndarray) -> np.ndarray:
    return np.clip(x, 1.0, 9.0)


def metrics(y: np.ndarray, pred_cont: np.ndarray) -> dict:
    pred = clip_band(ielts_round(pred_cont))
    y2, p2 = (y * 2).astype(int), (pred * 2).astype(int)
    return {
        "n": int(len(y)),
        "mae": round(float(np.mean(np.abs(pred_cont - y))), 3),
        "exact": round(float(np.mean(pred == y)), 3),
        "within_half": round(float(np.mean(np.abs(pred - y) <= 0.5)), 3),
        "qwk": round(float(cohen_kappa_score(y2, p2, weights="quadratic")), 3),
        # a constant prediction (the mean baseline) has no rank correlation: report null, not NaN
        "spearman": None if np.ptp(pred_cont) == 0 else round(float(spearmanr(y, pred_cont).statistic), 3),
    }


def load() -> pd.DataFrame:
    essays = pd.read_json(WORK / "essays.jsonl", lines=True)
    feats = pd.read_json(WORK / "features.jsonl", lines=True)
    return essays.merge(feats, on="id", how="inner", validate="one_to_one")


def fit(X: pd.DataFrame, y: np.ndarray, rounds: int) -> lgb.Booster:
    return lgb.train(PARAMS, lgb.Dataset(X, y), num_boost_round=rounds)


def cv_rounds(df: pd.DataFrame, feats: list[str], target: str) -> tuple[int, np.ndarray]:
    """Pick the number of trees by 5-fold group CV; also return out-of-fold predictions."""
    oof = np.zeros(len(df))
    best = []
    for k in range(5):
        tr, va = df.fold != k, df.fold == k
        b = lgb.train(PARAMS, lgb.Dataset(df.loc[tr, feats], df.loc[tr, target]), num_boost_round=1500,
                      valid_sets=[lgb.Dataset(df.loc[va, feats], df.loc[va, target])],
                      callbacks=[lgb.early_stopping(60, verbose=False)])
        best.append(b.best_iteration)
        oof[va.values] = b.predict(df.loc[va, feats], num_iteration=b.best_iteration)
    return int(np.median(best)), oof


def export_tree(t: dict) -> dict:
    """Flatten one LightGBM tree. Child >= 0: internal node index; child < 0: leaf index ~child."""
    feat, thr, left, right, nval, dleft, leaves = [], [], [], [], [], [], []

    def walk(node: dict) -> int:
        if "leaf_index" in node or "split_index" not in node:
            leaves.append(float(node.get("leaf_value", 0.0)))
            return ~(len(leaves) - 1)
        i = len(feat)
        feat.append(int(node["split_feature"])); thr.append(float(node["threshold"]))
        nval.append(float(node["internal_value"])); dleft.append(1 if node.get("default_left", True) else 0)
        left.append(0); right.append(0)
        assert node["decision_type"] == "<=", node["decision_type"]
        left[i] = walk(node["left_child"])
        right[i] = walk(node["right_child"])
        return i

    root = t["tree_structure"]
    if "split_index" not in root:
        return {"f": [], "t": [], "l": [], "r": [], "v": [], "d": [], "leaf": [float(root.get("leaf_value", 0.0))]}
    walk(root)
    return {"f": feat, "t": thr, "l": left, "r": right, "v": nval, "d": dleft, "leaf": leaves}


def main() -> None:
    ART.mkdir(parents=True, exist_ok=True)
    df = load()
    feats = [c for c in pd.read_json(WORK / "features.jsonl", lines=True, nrows=1).columns if c != "id"]
    train, test = df[df.split == "train"].reset_index(drop=True), df[df.split == "test"].reset_index(drop=True)
    model_answer_test = (test[CRITERIA] == 8.0).all(axis=1).values

    boosters, preds, oofs, report = {}, {}, {}, {"version": VERSION, "features": feats, "criteria": {}}
    for c in CRITERIA:
        rounds, oof = cv_rounds(train, feats, c)
        b = fit(train[feats], train[c].values, rounds)
        boosters[c], oofs[c] = b, oof
        preds[c] = b.predict(test[feats])
        y = test[c].values
        len_only = fit(train[["n_words"]], train[c].values, 200).predict(test[["n_words"]])
        report["criteria"][c] = {
            "trees": rounds,
            "test": metrics(y, preds[c]),
            "test_without_band8_model_answers": metrics(y[~model_answer_test], preds[c][~model_answer_test]),
            "baseline_mean": metrics(y, np.full(len(y), train[c].mean())),
            "baseline_length_only": metrics(y, len_only),
        }

    overall_pred = np.mean([preds[c] for c in CRITERIA], axis=0)
    y_over = test["Overall"].values
    report["overall"] = {
        "rule": "mean of the four predicted criteria, IELTS rounding (.25 and .75 round up)",
        "test": metrics(y_over, overall_pred),
        "test_without_band8_model_answers": metrics(y_over[~model_answer_test], overall_pred[~model_answer_test]),
        "baseline_mean": metrics(y_over, np.full(len(y_over), train["Overall"].mean())),
    }

    # Split-conformal interval on the overall band from out-of-fold training predictions.
    oof_over = np.mean([oofs[c] for c in CRITERIA], axis=0)
    resid = np.abs(oof_over - train["Overall"].values)
    n = len(resid)
    q90 = float(np.quantile(resid, min(1.0, np.ceil((n + 1) * 0.9) / n)))
    q80 = float(np.quantile(resid, min(1.0, np.ceil((n + 1) * 0.8) / n)))
    cover90 = float(np.mean(np.abs(overall_pred - y_over) <= q90))
    report["conformal"] = {"q80": round(q80, 3), "q90": round(q90, 3), "test_coverage_90": round(cover90, 3)}

    # Global importance (gain), summed over criteria, for the model card.
    gain = sum(pd.Series(boosters[c].feature_importance("gain"), index=feats) for c in CRITERIA)
    report["top_features"] = [{"feature": k, "gain_share": round(float(v / gain.sum()), 4)} for k, v in gain.sort_values(ascending=False).head(12).items()]
    report["prep"] = json.loads((WORK / "prep_report.json").read_text())

    model = {"version": VERSION, "features": feats, "conformal": {"q80": q80, "q90": q90}, "criteria": {}}
    for c in CRITERIA:
        dump = boosters[c].dump_model()
        model["criteria"][c] = {"trees": [export_tree(t) for t in dump["tree_info"]]}
    text = json.dumps(model, separators=(",", ":"))
    WEB_MODEL.write_text(text)
    report["artifact_sha256"] = hashlib.sha256(text.encode()).hexdigest()
    report["artifact_bytes"] = len(text)

    # Parity sample: the TS evaluator must reproduce these raw scores (web/src/lib/essay/__tests__).
    sample = test.sample(300, random_state=1)
    parity = {"ids": sample["id"].tolist(), "X": sample[feats].values.tolist(),
              "raw": {c: boosters[c].predict(sample[feats]).tolist() for c in CRITERIA}}
    (ROOT.parent / "web" / "src" / "lib" / "essay" / "__tests__").mkdir(parents=True, exist_ok=True)
    (ROOT.parent / "web" / "src" / "lib" / "essay" / "__tests__" / "parity.json").write_text(json.dumps(parity))

    (ART / "writing_eval.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in ["overall", "conformal", "top_features"]}, indent=2))
    for c in CRITERIA:
        r = report["criteria"][c]
        print(c, r["trees"], "test", r["test"], "\n   no8", r["test_without_band8_model_answers"], "\n   mean", r["baseline_mean"], "\n   len", r["baseline_length_only"])


if __name__ == "__main__":
    main()
