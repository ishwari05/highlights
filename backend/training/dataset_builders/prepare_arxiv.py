from pathlib import Path

import nltk
import pandas as pd
from datasets import load_dataset
from nltk.tokenize import sent_tokenize
from rouge_score import rouge_scorer
from tqdm import tqdm


BASE_DIR = Path(__file__).resolve().parents[2]
OUT = BASE_DIR / "data" / "arxiv_highlight_dataset.csv"

OUT.parent.mkdir(parents=True, exist_ok=True)


def ensure_nltk():
    try:
        sent_tokenize("This is a test. Another test.")
    except LookupError:
        nltk.download("punkt")
        nltk.download("punkt_tab")


def clean_text(text):
    if not text:
        return ""
    return " ".join(str(text).replace("\n", " ").split())


def main():
    ensure_nltk()

    print("Loading arXiv dataset...")

    dataset = load_dataset(
        "ccdv/arxiv-summarization",
        split="train[:1000]"
    )

    print("Columns:", dataset.column_names)

    scorer = rouge_scorer.RougeScorer(["rouge1"], use_stemmer=True)

    rows = []

    for sample in tqdm(dataset):
        article = clean_text(sample.get("article", ""))
        summary = clean_text(sample.get("abstract", ""))

        if not article or not summary:
            continue

        for sentence in sent_tokenize(article):
            sentence = clean_text(sentence)

            if len(sentence) < 50:
                continue

            score = scorer.score(summary, sentence)["rouge1"].fmeasure

            rows.append({
                "sentence": sentence,
                "score": max(0.0, min(1.0, float(score))),
                "source": "arxiv",
            })

    df = pd.DataFrame(rows, columns=["sentence", "score", "source"])
    df = df.dropna(subset=["sentence", "score"])
    df["sentence"] = df["sentence"].astype(str).str.strip()
    df["score"] = df["score"].astype(float).clip(0, 1)
    df = df[df["sentence"].str.len() >= 50]
    df = df.drop_duplicates(subset=["sentence"])

    df.to_csv(OUT, index=False)

    print("Saved:", OUT)
    print("Rows:", len(df))

    if len(df) > 0:
        print(df.head())
        print(df["score"].describe())
    else:
        print("No rows generated. Check dataset columns.")


if __name__ == "__main__":
    main()