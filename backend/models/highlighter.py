from pathlib import Path
from typing import TypedDict

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from models.sentence_split import split_sentences
from models.text_clean import clean_sentence


BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_PATH = BASE_DIR / "models" / "distilbert_highlighter_final"

tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_PATH)
model.eval()


class SentenceInput(TypedDict):
    id: int
    text: str


def _predict_scores(texts: list[str]) -> list[float]:
    if not texts:
        return []

    inputs = tokenizer(
        texts,
        padding=True,
        truncation=True,
        max_length=128,
        return_tensors="pt",
    )

    with torch.no_grad():
        outputs = model(**inputs)
        scores = outputs.logits.squeeze(-1)
        scores = torch.clamp(scores, min=0.0, max=1.0)

    return [float(score) for score in scores.tolist()]


def _select_highlights(
    ranked: list,
    score_index: int,
    threshold: float,
    min_highlights: int,
    max_highlights: int,
) -> list:
    selected = [row for row in ranked if row[score_index] >= threshold]

    if len(selected) < min_highlights:
        selected = ranked[:min_highlights]

    if len(selected) > max_highlights:
        selected = selected[:max_highlights]

    return selected


def _empty_result() -> dict:
    return {
        "highlights": [],
        "highlight_ids": [],
        "scores": [],
        "selected_score_sum": 0.0,
        "total_score_sum": 0.0,
    }


def score_sentence_items(
    items: list[SentenceInput],
) -> list[tuple[int, str, float]]:
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

    scores = _predict_scores(cleaned_texts)

    return [
        (ids[index], cleaned_texts[index], scores[index])
        for index in range(len(ids))
    ]


def get_highlights_from_index(
    sentences: list[SentenceInput],
    threshold: float = 0.45,
    min_highlights: int = 5,
    max_highlights: int = 20,
) -> dict:
    ranked = score_sentence_items(sentences)

    if not ranked:
        return _empty_result()

    ranked.sort(key=lambda row: row[2], reverse=True)

    selected = _select_highlights(
        ranked=ranked,
        score_index=2,
        threshold=threshold,
        min_highlights=min_highlights,
        max_highlights=max_highlights,
    )

    total_score_sum = sum(row[2] for row in ranked)
    selected_score_sum = sum(row[2] for row in selected)

    return {
        "highlights": [
            {
                "id": row[0],
                "text": row[1],
                "score": float(row[2]),
            }
            for row in selected
        ],
        "highlight_ids": [row[0] for row in selected],
        "scores": [float(row[2]) for row in selected],
        "selected_score_sum": float(selected_score_sum),
        "total_score_sum": float(total_score_sum),
    }


def get_highlights(
    text: str,
    threshold: float = 0.45,
    min_highlights: int = 5,
    max_highlights: int = 20,
) -> dict:
    sentences = split_sentences(text)

    if not sentences:
        return _empty_result()

    cleaned_sentences = [
        clean_sentence(sentence)
        for sentence in sentences
    ]

    cleaned_sentences = [
        sentence
        for sentence in cleaned_sentences
        if len(sentence) >= 20
    ]

    if not cleaned_sentences:
        return _empty_result()

    scores = _predict_scores(cleaned_sentences)

    ranked = sorted(
        zip(cleaned_sentences, scores),
        key=lambda row: row[1],
        reverse=True,
    )

    selected = _select_highlights(
        ranked=ranked,
        score_index=1,
        threshold=threshold,
        min_highlights=min_highlights,
        max_highlights=max_highlights,
    )

    total_score_sum = sum(score for _, score in ranked)
    selected_score_sum = sum(score for _, score in selected)

    return {
        "highlights": [
            {
                "id": None,
                "text": sentence,
                "score": float(score),
            }
            for sentence, score in selected
        ],
        "highlight_ids": [],
        "scores": [float(score) for _, score in selected],
        "selected_score_sum": float(selected_score_sum),
        "total_score_sum": float(total_score_sum),
    }