from pathlib import Path

import nltk
import pandas as pd
from datasets import load_dataset
from nltk.tokenize import sent_tokenize
from rouge_score import rouge_scorer
from tqdm import tqdm


BASE_DIR = Path(__file__).resolve().parents[2]
OUT = BASE_DIR / "data" / "pubmedqa_highlight_dataset.csv"

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

    print("Loading PubMedQA...")
    dataset = load_dataset(
        "pubmed_qa",
        "pqa_labeled",
        split="train"
    )

    print("Columns:", dataset.column_names)

    scorer = rouge_scorer.RougeScorer(["rouge1"], use_stemmer=True)

    rows = []

    for sample in tqdm(dataset):
        context = sample.get("context", {})
        question = clean_text(sample.get("question", ""))
        long_answer = clean_text(sample.get("long_answer", ""))

        contexts = context.get("contexts", []) if isinstance(context, dict) else []

        article = clean_text(" ".join(contexts))
        summary = clean_text(question + " " + long_answer)

        if not article or not summary:
            continue

        for sentence in sent_tokenize(article):
            sentence = clean_text(sentence)

            if len(sentence) < 40:
                continue

            score = scorer.score(summary, sentence)["rouge1"].fmeasure

            rows.append({
                "sentence": sentence,
                "score": max(0.0, min(1.0, float(score))),
                "source": "pubmedqa",
            })

    df = pd.DataFrame(rows, columns=["sentence", "score", "source"])
    df = df.dropna(subset=["sentence", "score"])
    df["sentence"] = df["sentence"].astype(str).str.strip()
    df["score"] = df["score"].astype(float).clip(0, 1)
    df = df[df["sentence"].str.len() >= 40]
    df = df.drop_duplicates(subset=["sentence"])

    df.to_csv(OUT, index=False)

    print("Saved:", OUT)
    print("Rows:", len(df))

    if len(df) > 0:
        print(df.head())
        print(df["score"].describe())


if __name__ == "__main__":
    main()