from pathlib import Path

import pandas as pd
from datasets import load_dataset
from nltk.tokenize import sent_tokenize
from sentence_transformers import SentenceTransformer, util
from tqdm import tqdm


BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_PATH = BASE_DIR / "data" / "highlight_dataset.csv"

OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

print("Loading CNN/DailyMail...")
dataset = load_dataset(
    "cnn_dailymail",
    "3.0.0",
    split="train[:500]"
)

print("Loading sentence embedding model...")
embedder = SentenceTransformer("all-MiniLM-L6-v2")

rows = []

for sample in tqdm(dataset):

    article = sample["article"]
    summary = sample["highlights"]

    sentences = sent_tokenize(article)

    sentences = [
        s.strip()
        for s in sentences
        if len(s.strip()) > 30
    ]

    if not sentences:
        continue

    sentence_embeddings = embedder.encode(
        sentences,
        convert_to_tensor=True,
        normalize_embeddings=True
    )

    summary_embedding = embedder.encode(
        summary,
        convert_to_tensor=True,
        normalize_embeddings=True
    )

    similarities = util.cos_sim(
        sentence_embeddings,
        summary_embedding,
    ).squeeze()

    # With a single sentence, squeeze() + topk() yield a scalar int, not a list.
    if similarities.dim() == 0:
        similarities = similarities.unsqueeze(0)

    top_k = min(3, len(sentences))
    top_indices = set(similarities.topk(top_k).indices.flatten().tolist())

    similarity_scores = similarities.flatten().tolist()

    for index, sentence in enumerate(sentences):
        label = 1 if index in top_indices else 0

        rows.append({
            "sentence": sentence,
            "label": label,
            "score": float(similarity_scores[index]),
        })


df = pd.DataFrame(rows)

df.to_csv(
    OUTPUT_PATH,
    index=False
)

print("Saved to:", OUTPUT_PATH)
print(df.head())
print(df["label"].value_counts())