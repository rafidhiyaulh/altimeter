"""Prepare the public IELTS Task 2 corpus (btnotpt/ielts_task_2, Apache-2.0) for training.

What this fixes, because the raw corpus would otherwise flatter any model trained on it:
  1. Mojibake (UTF-8 read as Latin-1, e.g. "â\x80\x99") is repaired.
  2. Exact duplicate essays are dropped (2,939 inside the original train split alone).
  3. The original train/test split leaks: 945 essays and 999 prompts appear in both. We pool both
     splits and re-split by prompt, so no prompt is ever seen in training and testing.

Output: data/work/essays.jsonl, one essay per line with split ("train" | "test") and fold (0-4, train only).
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
CRITERIA = ["TR", "CC", "LR", "GRA"]


def fix_text(s: str) -> str:
    if "â" in s or "Ã" in s:
        try:
            s = s.encode("latin-1", errors="strict").decode("utf-8", errors="strict")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace("\r\n", "\n").replace(" ", " ")
    return s.strip()


def norm_topic(s: str) -> str:
    # "...important v.1" and "...important v.2" are the same prompt
    s = fix_text(s).lower()
    s = re.sub(r"\bv\.?\s*\d+\s*$", "", s)
    return re.sub(r"[^a-z]+", " ", s).strip()


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    frames = []
    for name in ["train", "test"]:
        d = pd.read_parquet(RAW / f"{name}.parquet")
        d["orig_split"] = name
        frames.append(d)
    df = pd.concat(frames, ignore_index=True)
    n_raw = len(df)
    df["topic"] = df["topic"].map(fix_text)
    df["essay"] = df["essay"].map(fix_text)
    df["topic_key"] = df["topic"].map(norm_topic)
    df["essay_key"] = df["essay"].str.lower().str.replace(r"\s+", " ", regex=True)

    dup = df.duplicated("essay_key", keep="first")
    leak_essays = len(set(df.loc[df.orig_split == "train", "essay_key"]) & set(df.loc[df.orig_split == "test", "essay_key"]))
    leak_topics = len(set(df.loc[df.orig_split == "train", "topic_key"]) & set(df.loc[df.orig_split == "test", "topic_key"]))
    df = df[~dup].copy()
    df = df[df["essay"].str.split().str.len() >= 50]
    df = df[df[CRITERIA + ["Overall"]].notna().all(axis=1)]

    # Group split by prompt: 20% of prompts held out for the test set, the rest in 5 folds.
    topics = np.array(sorted(df["topic_key"].unique()))
    h = np.array([int(hashlib.sha256(t.encode()).hexdigest()[:8], 16) for t in topics])
    test_topics = set(topics[(h % 100) < 20])
    df["split"] = np.where(df["topic_key"].isin(test_topics), "test", "train")
    df["fold"] = -1
    tr = df["split"] == "train"
    df.loc[tr, "fold"] = df.loc[tr, "topic_key"].map(lambda t: int(hashlib.sha256(("f" + t).encode()).hexdigest()[:8], 16) % 5)
    df["id"] = df["essay_key"].map(lambda s: hashlib.sha256(s.encode()).hexdigest()[:16])

    out = WORK / "essays.jsonl"
    with out.open("w") as f:
        for r in df.itertuples():
            f.write(json.dumps({
                "id": r.id, "topic": r.topic, "topic_key": r.topic_key, "essay": r.essay,
                "TR": r.TR, "CC": r.CC, "LR": r.LR, "GRA": r.GRA, "Overall": r.Overall,
                "split": r.split, "fold": int(r.fold), "feedback": r.feedback,
            }) + "\n")

    report = {
        "raw_rows": n_raw,
        "exact_duplicates_dropped": int(dup.sum()),
        "leaked_essays_between_original_splits": int(leak_essays),
        "leaked_prompts_between_original_splits": int(leak_topics),
        "rows_kept": int(len(df)),
        "prompts": int(df["topic_key"].nunique()),
        "train_rows": int(tr.sum()),
        "test_rows": int((~tr).sum()),
        "band8_all_criteria_rows": int(((df[CRITERIA] == 8.0).all(axis=1)).sum()),
        "label_values_overall": {str(k): int(v) for k, v in df["Overall"].value_counts().sort_index().items()},
    }
    (WORK / "prep_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
