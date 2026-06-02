import math
from typing import List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from models.highlighter import SentenceInput, get_highlights, get_highlights_from_index
from models.summarizer import generate_summary
from models.text_clean import clean_sentence

WORDS_PER_MINUTE = 225

app = FastAPI()

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
    return len(text.split())


def coverage_score(selected_score_sum: float, total_score_sum: float) -> int:
    if total_score_sum <= 0:
        return 0
    return round((selected_score_sum / total_score_sum) * 100)


def confidence_label(coverage: int) -> str:
    if coverage >= 85:
        return "High"
    if coverage >= 70:
        return "Medium"
    return "Low"


def build_reading_metrics(
    article_text: str,
    summary: str,
    highlights: list[str],
    selected_score_sum: float,
    total_score_sum: float,
) -> dict:
    original_read_time = math.ceil(count_words(article_text) / WORDS_PER_MINUTE)

    summary_words = count_words(summary)
    highlights_words = sum(count_words(highlight) for highlight in highlights)
    highlights_read_time = math.ceil((summary_words + highlights_words) / WORDS_PER_MINUTE)

    time_saved = max(original_read_time - highlights_read_time, 0)
    coverage = coverage_score(selected_score_sum, total_score_sum)

    return {
        "original_read_time": original_read_time,
        "highlights_read_time": highlights_read_time,
        "time_saved": time_saved,
        "coverage_score": coverage,
        "confidence": confidence_label(coverage),
    }


@app.get("/")
def root():
    return {"status": "ok"}


@app.post("/analyze")
def analyze(request: AnalyzeRequest):
    article_text = request.text.strip()

    summary = generate_summary(article_text)
    summary_text = clean_sentence(summary) if summary else summary

    if request.sentences:
        payload: list[SentenceInput] = [
            {"id": item.id, "text": item.text}
            for item in request.sentences
        ]
        highlight_result = get_highlights_from_index(payload, top_k=5)
        highlights = highlight_result["highlights"]
        selected_score_sum = highlight_result["selected_score_sum"]
        total_score_sum = highlight_result["total_score_sum"]

        return {
            "summary": summary_text,
            "highlights": highlights,
            "highlight_ids": highlight_result["highlight_ids"],
            "scores": highlight_result["scores"],
            "metrics": build_reading_metrics(
                article_text,
                summary_text or "",
                highlights,
                selected_score_sum,
                total_score_sum,
            ),
        }

    highlight_result = get_highlights(article_text, top_k=5)
    highlights = highlight_result["highlights"]
    selected_score_sum = highlight_result["selected_score_sum"]
    total_score_sum = highlight_result["total_score_sum"]

    return {
        "summary": summary_text,
        "highlights": highlights,
        "highlight_ids": [],
        "scores": [],
        "metrics": build_reading_metrics(
            article_text,
            summary_text or "",
            highlights,
            selected_score_sum,
            total_score_sum,
        ),
    }
