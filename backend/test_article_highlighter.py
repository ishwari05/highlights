from pathlib import Path
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from nltk.tokenize import sent_tokenize

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "models" / "distilbert_highlighter"

tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_PATH)

article = """
Coffee is a beverage brewed from roasted, ground coffee beans.
Darkly colored, bitter, and slightly acidic, coffee has a stimulating effect on humans, primarily due to its caffeine content.
Coffee production begins when the seeds from coffee cherries are separated to produce unroasted green coffee beans.
The beans are roasted and then ground into fine particles.
Coffee is one of the most widely consumed beverages in the world.
Click here to subscribe to our newsletter.
"""

sentences = sent_tokenize(article)

inputs = tokenizer(
    sentences,
    padding=True,
    truncation=True,
    max_length=128,
    return_tensors="pt"
)

with torch.no_grad():
    outputs = model(**inputs)
    probs = torch.softmax(outputs.logits, dim=1)[:, 1]

ranked = sorted(
    zip(sentences, probs.tolist()),
    key=lambda x: x[1],
    reverse=True
)

for sentence, score in ranked:
    print(round(score, 4), "-", sentence)