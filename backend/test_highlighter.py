from pathlib import Path
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "models" / "distilbert_highlighter"

tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_PATH)

sentences = [
    "Coffee is a beverage brewed from roasted coffee beans.",
    "The word coffee entered the English language in 1582.",
    "Click here to read more.",
    "Coffee contains caffeine, a stimulant that affects the central nervous system.",
]

inputs = tokenizer(
    sentences,
    padding=True,
    truncation=True,
    max_length=128,
    return_tensors="pt"
)

with torch.no_grad():
    outputs = model(**inputs)
    probs = torch.softmax(outputs.logits, dim=1)

for sentence, prob in zip(sentences, probs):
    important_score = prob[1].item()
    print(round(important_score, 4), "-", sentence)