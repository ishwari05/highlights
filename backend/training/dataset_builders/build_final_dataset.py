from pathlib import Path

import pandas as pd


BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"

OUTPUT_PATH = DATA_DIR / "highlight_dataset_final.csv"

DATASETS = [
    {
        "path": DATA_DIR / "highlight_dataset.csv",
        "source": "cnn_dailymail",
        "max_rows": None,
    },
    {
        "path": DATA_DIR / "billsum_highlight_dataset.csv",
        "source": "billsum",
        "max_rows": None,
    },
    {
        "path": DATA_DIR / "wikihow_highlight_dataset.csv",
        "source": "wikihow",
        "max_rows": None,
    },
    {
        "path": DATA_DIR / "pubmedqa_highlight_dataset.csv",
        "source": "pubmedqa",
        "max_rows": None,
    },
    {
        "path": DATA_DIR / "arxiv_highlight_dataset.csv",
        "source": "arxiv",
        "max_rows": 50000,
    },
    {
        "path": DATA_DIR / "wikipedia_highlight_dataset.csv",
        "source": "wikipedia",
        "max_rows": 50000,
    },
]


def load_and_clean(config):
    path = config["path"]
    source = config["source"]
    max_rows = config["max_rows"]

    if not path.exists():
        raise FileNotFoundError(f"Missing dataset: {path}")

    df = pd.read_csv(path)

    if "sentence" not in df.columns or "score" not in df.columns:
        raise ValueError(f"{path} must contain sentence and score columns")

    df = df[["sentence", "score"]].copy()
    df["source"] = source

    df = df.dropna(subset=["sentence", "score"])
    df["sentence"] = df["sentence"].astype(str).str.strip()
    df["score"] = df["score"].astype(float).clip(0, 1)

    df = df[df["sentence"].str.len() >= 30]
    df = df.drop_duplicates(subset=["sentence"])

    if max_rows is not None and len(df) > max_rows:
        df = df.sample(
            n=max_rows,
            random_state=42,
        )

    return df


def main():
    frames = []

    for config in DATASETS:
        df = load_and_clean(config)
        print(config["source"], "rows:", len(df))
        frames.append(df)

    final_df = pd.concat(
        frames,
        ignore_index=True,
    )

    final_df = final_df.drop_duplicates(
        subset=["sentence"],
    )

    final_df = final_df.sample(
        frac=1,
        random_state=42,
    ).reset_index(drop=True)

    final_df.to_csv(
        OUTPUT_PATH,
        index=False,
    )

    print("\nSaved:", OUTPUT_PATH)
    print("Rows:", len(final_df))
    print("\nSource counts:")
    print(final_df["source"].value_counts())
    print("\nScore distribution:")
    print(final_df["score"].describe())


if __name__ == "__main__":
    main()