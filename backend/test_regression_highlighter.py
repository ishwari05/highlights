from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "models" / "distilbert_highlighter_regression"

tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_PATH)
model.eval()


sentences = [
    "Coffee is a beverage brewed from roasted, ground coffee beans.",
    "Darkly colored, bitter, and slightly acidic, coffee has a stimulating effect on humans, primarily due to its caffeine content.",
    "Coffee production begins when the seeds from coffee cherries are separated to produce unroasted green coffee beans.",
    "The beans are roasted and then ground into fine particles.",
    "Coffee is one of the most widely consumed beverages in the world.",
    "Click here to subscribe to our newsletter.",
]


inputs = tokenizer(
    sentences,
    padding=True,
    truncation=True,
    max_length=128,
    return_tensors="pt",
)

with torch.no_grad():
    outputs = model(**inputs)
    scores = outputs.logits.squeeze(-1)

scores = torch.clamp(scores, 0, 1).tolist()

ranked = sorted(
    zip(sentences, scores),
    key=lambda row: row[1],
    reverse=True,
)

for sentence, score in ranked:
    print(round(score, 4), "-", sentence)