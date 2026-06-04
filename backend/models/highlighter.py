from pathlib import Path
from typing import TypedDict

import torch
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
)

from models.sentence_split import split_sentences
from models.text_clean import clean_sentence


BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_PATH = BASE_DIR / "models" / "distilbert_highlighter_regression"

tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_PATH)
model.eval()


class SentenceInput(TypedDict):
    id: int
    text: str


def _predict_scores(
    texts: list[str],
) -> list[float]:
    """
    Regression inference.

    The model outputs one raw importance value per sentence.
    We clamp it into the 0–1 range.
    """

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

        scores = torch.clamp(
            scores,
            min=0.0,
            max=1.0,
        )

    return [
        float(score)
        for score in scores.tolist()
    ]


def score_sentence_items(
    items: list[SentenceInput],
) -> list[tuple[int, str, float]]:
    """
    Score indexed sentences.

    Returns:
        [
            (sentence_id, cleaned_text, importance_score)
        ]
    """

    if not items:
        return []

    ids: list[int] = []
    cleaned_texts: list[str] = []

    for item in items:
        cleaned = clean_sentence(
            item["text"]
        )

        if len(cleaned) < 20:
            continue

        ids.append(
            int(item["id"])
        )

        cleaned_texts.append(
            cleaned
        )

    if not cleaned_texts:
        return []

    scores = _predict_scores(
        cleaned_texts
    )

    return [
        (
            ids[index],
            cleaned_texts[index],
            scores[index],
        )
        for index in range(len(ids))
    ]


def _empty_result() -> dict:
    return {
        "highlights": [],
        "highlight_ids": [],
        "scores": [],
        "selected_score_sum": 0.0,
        "total_score_sum": 0.0,
    }


def get_highlights_from_index(
    sentences: list[SentenceInput],
    threshold: float = 0.45,
    min_highlights: int = 5,
    max_highlights: int = 20,
) -> dict:
    """
    Production path.

    Receives pre-indexed sentences from the Chrome extension.
    Scores them with the regression model.
    Returns stable sentence IDs so frontend can highlight by ID.
    """

    ranked = score_sentence_items(
        sentences
    )

    if not ranked:
        return _empty_result()

    ranked.sort(
        key=lambda row: row[2],
        reverse=True,
    )

    top = [row for row in ranked if row[2] >= threshold]

    if len(top) < min_highlights:
        top = ranked[:min_highlights]

    if len(top) > max_highlights:
        top = top[:max_highlights]

    total_score_sum = sum(
        row[2]
        for row in ranked
    )

    selected_score_sum = sum(
        row[2]
        for row in top
    )

    return {
        "highlights": [
            {
                "id": row[0],
                "text": row[1],
                "score": float(row[2]),
            }
            for row in top
        ],
        "highlight_ids": [
            row[0]
            for row in top
        ],
        "scores": [
            float(row[2])
            for row in top
        ],
        "selected_score_sum": float(
            selected_score_sum
        ),
        "total_score_sum": float(
            total_score_sum
        ),
    }


def get_highlights(
    text: str,
    threshold: float = 0.45,
    min_highlights: int = 5,
    max_highlights: int = 20,
) -> dict:
    """
    Fallback path.

    Splits raw article text, scores sentences,
    and returns top highlights.

    This is used when frontend does not send sentence IDs.
    """

    sentences = split_sentences(
        text
    )

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

    scores = _predict_scores(
        cleaned_sentences
    )

    ranked = sorted(
        zip(
            cleaned_sentences,
            scores,
        ),
        key=lambda row: row[1],
        reverse=True,
    )

    top = [row for row in ranked if row[1] >= threshold]

    if len(top) < min_highlights:
        top = ranked[:min_highlights]

    if len(top) > max_highlights:
        top = top[:max_highlights]

    total_score_sum = sum(
        score
        for _, score in ranked
    )

    selected_score_sum = sum(
        score
        for _, score in top
    )

    return {
        "highlights": [
            {
                "id": None,
                "text": sentence,
                "score": float(score),
            }
            for sentence, score in top
        ],
        "highlight_ids": [],
        "scores": [
            float(score)
            for _, score in top
        ],
        "selected_score_sum": float(
            selected_score_sum
        ),
        "total_score_sum": float(
            total_score_sum
        ),
    }