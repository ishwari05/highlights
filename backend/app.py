import math
from typing import List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from models.highlighter import (
    SentenceInput,
    get_highlights,
    get_highlights_from_index,
)
from models.summarizer import generate_summary
from models.text_clean import clean_sentence


WORDS_PER_MINUTE = 225


app = FastAPI(
    title="Highlights AI Backend",
    version="0.1.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class IndexedSentence(BaseModel):
    id: int
    text: str = Field(min_length=1)


class AnalyzeRequest(BaseModel):
    text: str = Field(min_length=1)
    sentences: Optional[List[IndexedSentence]] = None


def count_words(text: str) -> int:
    if not text:
        return 0

    return len(text.split())


def coverage_score(
    selected_score_sum: float,
    total_score_sum: float,
) -> int:
    if total_score_sum <= 0:
        return 0

    return round(
        (selected_score_sum / total_score_sum) * 100
    )


def confidence_label(coverage: int) -> str:
    if coverage >= 85:
        return "High"

    if coverage >= 70:
        return "Medium"

    return "Low"


def extract_highlight_texts(
    highlights: list,
) -> list[str]:
    texts: list[str] = []

    for item in highlights:
        if isinstance(item, str):
            texts.append(item)

        elif isinstance(item, dict):
            text = item.get("text", "")
            if text:
                texts.append(text)

    return texts


def build_reading_metrics(
    article_text: str,
    summary: str,
    highlights: list,
    selected_score_sum: float,
    total_score_sum: float,
) -> dict:
    highlight_texts = extract_highlight_texts(
        highlights
    )

    article_word_count = count_words(
        article_text
    )

    summary_word_count = count_words(
        summary
    )

    highlights_word_count = sum(
        count_words(highlight)
        for highlight in highlight_texts
    )

    original_read_time = max(
        1,
        math.ceil(
            article_word_count / WORDS_PER_MINUTE
        ),
    )

    highlights_read_time = max(
        1,
        math.ceil(
            (
                summary_word_count
                + highlights_word_count
            )
            / WORDS_PER_MINUTE
        ),
    )

    time_saved = max(
        original_read_time - highlights_read_time,
        0,
    )

    coverage = coverage_score(
        selected_score_sum,
        total_score_sum,
    )

    return {
        "original_read_time": original_read_time,
        "highlights_read_time": highlights_read_time,
        "time_saved": time_saved,
        "coverage_score": coverage,
        "confidence": confidence_label(coverage),
        "article_word_count": article_word_count,
        "summary_word_count": summary_word_count,
        "highlights_word_count": highlights_word_count,
    }


@app.get("/")
def root():
    return {
        "status": "ok",
        "service": "Highlights AI Backend",
    }


@app.post("/analyze")
def analyze(
    request: AnalyzeRequest,
):
    article_text = request.text.strip()

    summary = generate_summary(
        article_text
    )

    summary_text = (
        clean_sentence(summary)
        if summary
        else ""
    )

    if request.sentences:
        sentence_payload: list[SentenceInput] = [
            {
                "id": item.id,
                "text": item.text,
            }
            for item in request.sentences
        ]

        highlight_result = get_highlights_from_index(
            sentence_payload
        )

        highlights = highlight_result.get(
            "highlights",
            [],
        )

        selected_score_sum = highlight_result.get(
            "selected_score_sum",
            0.0,
        )

        total_score_sum = highlight_result.get(
            "total_score_sum",
            0.0,
        )

        return {
            "summary": summary_text,
            "highlights": highlights,
            "highlight_ids": highlight_result.get(
                "highlight_ids",
                [],
            ),
            "scores": highlight_result.get(
                "scores",
                [],
            ),
            "metrics": build_reading_metrics(
                article_text=article_text,
                summary=summary_text,
                highlights=highlights,
                selected_score_sum=selected_score_sum,
                total_score_sum=total_score_sum,
            ),
        }

    highlight_result = get_highlights(
        article_text
    )

    highlights = highlight_result.get(
        "highlights",
        [],
    )

    selected_score_sum = highlight_result.get(
        "selected_score_sum",
        0.0,
    )

    total_score_sum = highlight_result.get(
        "total_score_sum",
        0.0,
    )

    return {
        "summary": summary_text,
        "highlights": highlights,
        "highlight_ids": highlight_result.get(
            "highlight_ids",
            [],
        ),
        "scores": highlight_result.get(
            "scores",
            [],
        ),
        "metrics": build_reading_metrics(
            article_text=article_text,
            summary=summary_text,
            highlights=highlights,
            selected_score_sum=selected_score_sum,
            total_score_sum=total_score_sum,
        ),
    }