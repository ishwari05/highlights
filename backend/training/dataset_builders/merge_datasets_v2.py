from pathlib import Path
import pandas as pd

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"

cnn_path = DATA_DIR / "highlight_dataset.csv"
billsum_path = DATA_DIR / "billsum_highlight_dataset.csv"
out_path = DATA_DIR / "highlight_dataset_v2.csv"

cnn = pd.read_csv(cnn_path)
billsum = pd.read_csv(billsum_path)

cnn = cnn[["sentence", "score"]].copy()
cnn["source"] = "cnn_dailymail"

billsum = billsum[["sentence", "score", "source"]].copy()

df = pd.concat([cnn, billsum], ignore_index=True)

df = df.dropna(subset=["sentence", "score"])
df["sentence"] = df["sentence"].astype(str).str.strip()
df["score"] = df["score"].astype(float).clip(0, 1)

df = df[df["sentence"].str.len() >= 30]
df = df.drop_duplicates(subset=["sentence"])

df = df.sample(frac=1, random_state=42).reset_index(drop=True)

df.to_csv(out_path, index=False)

print("Saved:", out_path)
print("Rows:", len(df))
print(df["source"].value_counts())
print(df["score"].describe())