from pathlib import Path

import pandas as pd
from datasets import load_dataset
from nltk.tokenize import sent_tokenize
from rouge_score import rouge_scorer
from tqdm import tqdm


BASE_DIR = Path(__file__).resolve().parents[2]
OUT = BASE_DIR / "data" / "billsum_highlight_dataset.csv"

OUT.parent.mkdir(parents=True, exist_ok=True)

dataset = load_dataset("billsum", split="train[:1000]")

scorer = rouge_scorer.RougeScorer(["rouge1"], use_stemmer=True)

rows = []

for sample in tqdm(dataset):
    article = sample["text"]
    summary = sample["summary"]

    for sentence in sent_tokenize(article):
        sentence = sentence.strip()

        if len(sentence) < 30:
            continue

        score = scorer.score(summary, sentence)["rouge1"].fmeasure

        rows.append({
            "sentence": sentence,
            "score": max(0, min(1, score)),
            "source": "billsum",
        })

df = pd.DataFrame(rows)
df.to_csv(OUT, index=False)

print("Saved:", OUT)
print("Rows:", len(df))
print(df["score"].describe())