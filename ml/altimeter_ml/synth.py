"""Synthetic institutions, cohorts and learners for the Altimeter demo.

Everything about PEOPLE here is synthetic (names, institutions, abilities, practice history, official
results). The essay TEXTS are real learner essays from the public corpus (Apache-2.0), assigned to
synthetic learners whose latent writing ability is close to the essay's corpus label, and they are
scored in the app by the real model through the real queue.

The generator records each learner's true latent ability, so the readiness forecast can be backtested.

Output: data/work/synth.json and web/src/lib/readiness-prior.json (fitted from OBSERVED data only).
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "data" / "work"
WEB_PRIOR = ROOT.parent / "web" / "src" / "lib" / "readiness-prior.json"
SKILLS = ["reading", "listening", "writing", "speaking"]
WEEKS = 16
TODAY = date(2026, 10, 26)  # anchor; the seed shifts every timestamp so "today" is the seed day

INSTITUTIONS = [
    {"key": "cendekia", "name": "SMA Cendekia Nusantara", "kind": "school", "city": "Jakarta Selatan", "minors": True, "base": 5.15,
     "cohorts": [
         {"key": "iup-a", "name": "XII IUP Prep A", "target": 6.0, "min": 5.5, "deadline": "2027-01-29", "n": 96, "capacity": 8},
         {"key": "iup-b", "name": "XII IUP Prep B", "target": 6.0, "min": 5.5, "deadline": "2027-01-29", "n": 92, "capacity": 8},
     ]},
    {"key": "merahputih", "name": "Universitas Merah Putih, Pusat Bahasa", "kind": "university", "city": "Bandung", "minors": False, "base": 5.65,
     "cohorts": [
         {"key": "lpdp-7", "name": "LPDP Prep Batch 7", "target": 6.5, "min": 6.0, "deadline": "2026-12-14", "n": 110, "capacity": 10},
         {"key": "predep", "name": "Pre-departure IUP 2027", "target": 6.5, "min": 6.0, "deadline": "2027-02-26", "n": 88, "capacity": 8},
     ]},
    {"key": "arunika", "name": "Arunika Energi, Global Talent", "kind": "corporate", "city": "Jakarta Pusat", "minors": False, "base": 6.0,
     "cohorts": [
         {"key": "oa-2027", "name": "Overseas Assignment 2027", "target": 7.0, "min": 6.5, "deadline": "2027-03-31", "n": 64, "capacity": 6},
     ]},
]

FIRST = ("Adi Agus Aisyah Alya Andi Anisa Arief Ayu Bagus Bima Cahya Citra Dewi Dian Dimas Dina Eka Fajar Farah Fikri Gita Hana "
         "Hendra Ika Indah Intan Joko Kevin Kirana Laras Lia Maya Nadia Naufal Nisa Putra Putri Raka Rani Reza Rizky Sari Satria "
         "Sekar Tania Tegar Tiara Wulan Yoga Yuda Zahra").split()
LAST = ("Pratama Saputra Wijaya Kusuma Santoso Hidayat Nugroho Lestari Siregar Nasution Simanjuntak Wibowo Setiawan Permata "
        "Rahman Gunawan Hakim Utami Purnomo Halim Tanjung Harahap Firmansyah Susanto Maharani Anggraini Ramadhan Syahputra").split()

# Observation model used by the GENERATOR (the app learns its own noise/bias from data).
SOURCE_SD = {"practice": 0.45, "mock": 0.35, "ai_speaking": 0.55, "official": 0.2}
SOURCE_BIAS = {"practice": 0.0, "mock": -0.05, "ai_speaking": 0.2, "official": 0.0}
SKILL_OFFSET = {"reading": 0.1, "listening": 0.3, "writing": -0.35, "speaking": -0.1}

# Approximate Academic Reading / Listening raw-score -> band anchors (public guides vary by test form).
RAW_BANDS = {
    "reading": [(39, 9.0), (37, 8.5), (35, 8.0), (33, 7.5), (30, 7.0), (27, 6.5), (23, 6.0), (19, 5.5), (15, 5.0), (13, 4.5), (10, 4.0), (8, 3.5), (6, 3.0), (4, 2.5), (0, 2.0)],
    "listening": [(39, 9.0), (37, 8.5), (35, 8.0), (32, 7.5), (30, 7.0), (26, 6.5), (23, 6.0), (18, 5.5), (16, 5.0), (13, 4.5), (11, 4.0), (8, 3.5), (6, 3.0), (4, 2.5), (0, 2.0)],
}


def half(x: float) -> float:
    return float(np.clip(np.floor(x * 2 + 0.5) / 2, 1.0, 9.0))


def raw_for_band(skill: str, band: float, rnd: np.random.Generator) -> int:
    rows = RAW_BANDS[skill]
    for i, (raw, b) in enumerate(rows):
        if band >= b:
            hi = 40 if i == 0 else rows[i - 1][0] - 1
            return int(rnd.integers(raw, max(raw, hi) + 1))
    return 0


def main() -> None:
    rnd = np.random.default_rng(20261026)
    essays = pd.read_json(WORK / "essays.jsonl", lines=True)
    # Model answers (8.0 on every criterion) are not learner essays; keep them out of learner histories.
    essays = essays[~((essays[["TR", "CC", "LR", "GRA"]] == 8.0).all(axis=1))].reset_index(drop=True)
    pool = {b: list(rnd.permutation(essays.index[essays.Overall == b].values)) for b in sorted(essays.Overall.unique())}
    used: set[int] = set()

    def pick_essay(latent: float) -> int | None:
        target = half(latent + rnd.normal(0, 0.25))
        for delta in [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5]:
            lst = pool.get(target + delta, [])
            while lst:
                i = int(lst.pop())
                if i not in used:
                    used.add(i)
                    return i
        return None

    out = {"anchor": TODAY.isoformat(), "weeks": WEEKS, "institutions": [], "students": [], "attempts": [], "essays": [], "officials": [], "prompts": {}}
    sid = 0
    eng_kinds = ["high", "medium", "low", "dropped"]
    eng_p = [0.28, 0.44, 0.2, 0.08]
    rate = {"high": 3.0, "medium": 1.6, "low": 0.6, "dropped": 1.6}
    growth_mult = {"high": 1.35, "medium": 1.0, "low": 0.55, "dropped": 0.4}

    for inst in INSTITUTIONS:
        out["institutions"].append({k: v for k, v in inst.items() if k != "cohorts"} | {"cohorts": inst["cohorts"]})
        for co in inst["cohorts"]:
            for _ in range(co["n"]):
                sid += 1
                eng = str(rnd.choice(eng_kinds, p=eng_p))
                person = float(rnd.normal(0, 0.45))
                base = {s: inst["base"] + person + SKILL_OFFSET[s] + float(rnd.normal(0, 0.25)) for s in SKILLS}
                slope = {s: max(-0.01, float(rnd.normal(0.035, 0.018)) * growth_mult[eng]) for s in SKILLS}
                start = int(rnd.integers(0, 3)) * 7                      # joined in the first three weeks
                stop = WEEKS * 7 if eng != "dropped" else int(rnd.integers(28, 56))
                age = int(rnd.integers(16, 18)) if inst["minors"] else int(rnd.integers(21, 34))
                name = f"{rnd.choice(FIRST)} {rnd.choice(LAST)}"
                consent = (not inst["minors"]) or (rnd.random() < 0.9)
                st = {"sid": sid, "inst": inst["key"], "cohort": co["key"], "name": name, "age": age, "engagement": eng,
                      "base": base, "slope": slope, "start_day": start, "guardian_consent": bool(consent) if inst["minors"] else None,
                      "external_ref": f"acs_{rnd.integers(10**7, 10**8)}"}
                out["students"].append(st)

                def latent(s: str, day: float) -> float:
                    return base[s] + slope[s] * (day / 7.0)

                # practice history: Poisson arrivals per week
                day = float(start)
                while True:
                    day += float(rnd.exponential(7.0 / rate[eng]))
                    if day >= min(stop, WEEKS * 7):
                        break
                    s = str(rnd.choice(SKILLS, p=[0.3, 0.3, 0.2, 0.2]))
                    kind = "mock" if rnd.random() < 0.18 else "practice"
                    if s == "writing":
                        i = pick_essay(latent(s, day))
                        if i is not None:
                            e = essays.loc[i]
                            out["essays"].append({"sid": sid, "day": round(day, 3), "essay_id": e.id, "label": float(e.Overall),
                                                  "labels": {c: float(e[c]) for c in ["TR", "CC", "LR", "GRA"]}})
                            out["prompts"][e.topic_key] = e.topic
                            out["essays"][-1]["prompt_key"] = e.topic_key
                        continue
                    src = "ai_speaking" if s == "speaking" else kind
                    obs = half(latent(s, day) + SOURCE_BIAS[src] + rnd.normal(0, SOURCE_SD[src]))
                    a = {"sid": sid, "skill": s, "source": src, "band": obs, "day": round(day, 3)}
                    if s in RAW_BANDS:
                        a["raw"] = raw_for_band(s, obs, rnd)
                    out["attempts"].append(a)

                # ~30% sat the official test in the last 10 weeks
                if rnd.random() < 0.3:
                    d = float(rnd.uniform((WEEKS - 10) * 7, WEEKS * 7 - 2))
                    bands = {s: half(latent(s, d) + rnd.normal(0, SOURCE_SD["official"])) for s in SKILLS}
                    overall = half(sum(bands.values()) / 4)
                    out["officials"].append({"sid": sid, "day": round(d, 2), **bands, "overall": overall,
                                             "verified": "trf_verified" if rnd.random() < 0.35 else "self_reported"})

    # Readiness prior from OBSERVED practice data: per-learner OLS slope, pooled by skill.
    att = pd.DataFrame(out["attempts"])
    slopes = {}
    for s in ["reading", "listening", "speaking"]:
        vals = []
        for _, g in att[att.skill == s].groupby("sid"):
            if len(g) >= 4 and g.day.max() - g.day.min() >= 21:
                b = np.polyfit(g.day / 7.0, g.band, 1)[0]
                vals.append(b)
        v = np.array(vals)
        # observed OLS slopes include noise; shrink the spread with a method-of-moments correction
        slopes[s] = {"mean": round(float(np.mean(v)), 4), "sd": round(float(max(0.01, np.sqrt(max(0, np.var(v) * 0.35)))), 4),
                     "p90": round(float(np.quantile(v, 0.9)), 4)}
    slopes["writing"] = dict(slopes["reading"])
    prior = {
        "version": "readiness-2026.10.26",
        "slope": slopes,
        "noise": {"practice": 0.45, "mock": 0.35, "ai_writing": 0.5, "ai_speaking": 0.55, "official": 0.2},
        "processLevel": 0.05,
        "processSlope": 0.004,
        "fitted_from": f"{len(att)} synthetic practice attempts (observed bands only, not the latent truth)",
    }
    WEB_PRIOR.write_text(json.dumps(prior, indent=2))
    (WORK / "synth.json").write_text(json.dumps(out))
    print({k: len(v) for k, v in out.items() if isinstance(v, list)}, "prompts", len(out["prompts"]))
    print(json.dumps(prior["slope"], indent=1))


if __name__ == "__main__":
    main()
