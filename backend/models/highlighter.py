from typing import TypedDict

import torch
from pathlib import Path
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from models.text_clean import clean_sentence
from models.sentence_split import split_sentences

BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_PATH = BASE_DIR / "models" / "distilbert_highlighter"

tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_PATH)
model.eval()


class SentenceInput(TypedDict):
    id: int
    text: str


def score_sentence_items(items: list[SentenceInput]) -> list[tuple[int, str, float]]:
    """Score indexed sentences; returns (id, cleaned_text, score)."""
    if not items:
        return []

    ids: list[int] = []
    cleaned_texts: list[str] = []

    for item in items:
        cleaned = clean_sentence(item["text"])
        if len(cleaned) < 20:
            continue
        ids.append(int(item["id"]))
        cleaned_texts.append(cleaned)

    if not cleaned_texts:
        return []

    inputs = tokenizer(
        cleaned_texts,
        padding=True,
        truncation=True,
        max_length=128,
        return_tensors="pt",
    )

    with torch.no_grad():
        outputs = model(**inputs)
        scores = torch.softmax(outputs.logits, dim=1)[:, 1].tolist()

    return [(ids[i], cleaned_texts[i], scores[i]) for i in range(len(ids))]


def _build_highlight_result(
    ranked: list[tuple],
    top_k: int,
    text_index: int = 1,
    score_index: int = 2,
) -> dict:
    """Build highlight payload with score sums from ranked (text, score) or (id, text, score) rows."""
    if not ranked:
        return {
            "highlights": [],
            "selected_score_sum": 0.0,
            "total_score_sum": 0.0,
        }

    top = ranked[:top_k]
    total_score_sum = sum(row[score_index] for row in ranked)
    selected_score_sum = sum(row[score_index] for row in top)

    return {
        "highlights": [row[text_index] for row in top],
        "selected_score_sum": float(selected_score_sum),
        "total_score_sum": float(total_score_sum),
    }


def get_highlights_from_index(
    sentences: list[SentenceInput],
    top_k: int = 5,
) -> dict:
    """
    Production path: score pre-indexed sentences from the extension.
    Returns stable sentence IDs for DOM highlighting.
    """
    ranked = score_sentence_items(sentences)
    ranked.sort(key=lambda row: row[2], reverse=True)

    top = ranked[:top_k]
    result = _build_highlight_result(ranked, top_k, text_index=1, score_index=2)
    result["highlight_ids"] = [row[0] for row in top]
    result["scores"] = [row[2] for row in top]
    return result


def get_highlights(text: str, top_k: int = 5) -> dict:
    """Split raw article text, score sentences, and return top highlights with score sums."""
    sentences = split_sentences(text)
    if not sentences:
        return {
            "highlights": [],
            "selected_score_sum": 0.0,
            "total_score_sum": 0.0,
        }

    cleaned = [clean_sentence(s) for s in sentences]
    cleaned = [s for s in cleaned if len(s) >= 20]

    if not cleaned:
        return {
            "highlights": [],
            "selected_score_sum": 0.0,
            "total_score_sum": 0.0,
        }

    inputs = tokenizer(
        cleaned,
        padding=True,
        truncation=True,
        max_length=128,
        return_tensors="pt",
    )

    with torch.no_grad():
        outputs = model(**inputs)
        scores = torch.softmax(outputs.logits, dim=1)[:, 1].tolist()

    ranked = sorted(zip(cleaned, scores), key=lambda row: row[1], reverse=True)
    return _build_highlight_result(ranked, top_k, text_index=0, score_index=1)
