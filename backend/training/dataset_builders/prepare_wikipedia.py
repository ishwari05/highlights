from pathlib import Path

import nltk
import pandas as pd
from datasets import load_dataset
from nltk.tokenize import sent_tokenize
from rouge_score import rouge_scorer
from tqdm import tqdm


BASE_DIR = Path(__file__).resolve().parents[2]
OUT = BASE_DIR / "data" / "wikipedia_highlight_dataset.csv"

OUT.parent.mkdir(parents=True, exist_ok=True)

MAX_ARTICLES = 1000
MIN_SENTENCE_LEN = 40


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


def is_bad_sentence(sentence):
    lower = sentence.lower().strip()

    if len(sentence) < MIN_SENTENCE_LEN:
        return True

    banned = [
        "references",
        "external links",
        "see also",
        "further reading",
        "bibliography",
        "notes",
    ]

    if lower in banned:
        return True

    if lower.startswith("isbn"):
        return True

    if lower.startswith("doi"):
        return True

    if "retrieved from" in lower:
        return True

    return False


def main():
    ensure_nltk()

    print("Loading Wikipedia sample...")

    dataset = load_dataset(
        "wikimedia/wikipedia",
        "20231101.en",
        split=f"train[:{MAX_ARTICLES}]",
    )

    print("Columns:", dataset.column_names)

    scorer = rouge_scorer.RougeScorer(
        ["rouge1"],
        use_stemmer=True,
    )

    rows = []

    for sample in tqdm(dataset):
        article = clean_text(sample.get("text", ""))
        title = clean_text(sample.get("title", ""))

        if not article or not title:
            continue

        sentences = sent_tokenize(article)

        if len(sentences) < 5:
            continue

        lead_summary = " ".join(sentences[:3])

        if len(lead_summary) < 80:
            continue

        for sentence in sentences:
            sentence = clean_text(sentence)

            if is_bad_sentence(sentence):
                continue

            score = scorer.score(
                lead_summary,
                sentence,
            )["rouge1"].fmeasure

            rows.append({
                "sentence": sentence,
                "score": max(0.0, min(1.0, float(score))),
                "source": "wikipedia",
            })

    df = pd.DataFrame(
        rows,
        columns=["sentence", "score", "source"],
    )

    df = df.dropna(subset=["sentence", "score"])
    df["sentence"] = df["sentence"].astype(str).str.strip()
    df["score"] = df["score"].astype(float).clip(0, 1)
    df["source"] = "wikipedia"

    df = df[df["sentence"].str.len() >= MIN_SENTENCE_LEN]
    df = df.drop_duplicates(subset=["sentence"])

    df.to_csv(OUT, index=False)

    print("Saved:", OUT)
    print("Rows:", len(df))

    if len(df) > 0:
        print(df.head())
        print(df["score"].describe())
    else:
        print("No rows generated.")


if __name__ == "__main__":
    main()