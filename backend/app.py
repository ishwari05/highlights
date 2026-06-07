import math
import os
import tempfile
from typing import List, Optional
from urllib.parse import unquote, urlparse

import requests as http_requests
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from models.highlighter import (
    SentenceInput,
    get_highlights,
    get_highlights_from_index,
)
from models.pdf_parser import extract_text_from_pdf
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


class AnalyzePdfUrlRequest(BaseModel):
    url: str = Field(min_length=1)


def count_words(text: str) -> int:
    if not text:
        return 0
    return len(text.split())


def coverage_score(
    article_word_count: int,
    summary_word_count: int,
    highlights_word_count: int,
) -> int:
    if article_word_count <= 0:
        return 0

    compressed_words = summary_word_count + highlights_word_count
    compression_ratio = compressed_words / article_word_count

    coverage = round(compression_ratio * 4000)

    return min(95, max(60, coverage))


def confidence_label(coverage: int) -> str:
    if coverage >= 85:
        return "High"
    if coverage >= 70:
        return "Medium"
    return "Low"


def extract_highlight_texts(highlights: list) -> list[str]:
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
    highlight_texts = extract_highlight_texts(highlights)

    article_word_count = count_words(article_text)
    summary_word_count = count_words(summary)
    highlights_word_count = sum(count_words(highlight) for highlight in highlight_texts)

    original_read_time = max(
        1,
        math.ceil(article_word_count / WORDS_PER_MINUTE),
    )

    highlights_read_time = max(
        1,
        math.ceil((summary_word_count + highlights_word_count) / WORDS_PER_MINUTE),
    )

    time_saved = max(original_read_time - highlights_read_time, 0)

    coverage = coverage_score(
        article_word_count=article_word_count,
        summary_word_count=summary_word_count,
        highlights_word_count=highlights_word_count,
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
        "selected_score_sum": round(float(selected_score_sum), 4),
        "total_score_sum": round(float(total_score_sum), 4),
    }


def _file_name_from_url(url: str) -> str:
    """Extract a human-readable filename from a PDF URL."""
    path = urlparse(url).path
    basename = os.path.basename(unquote(path)) if path else ""
    return basename if basename.lower().endswith(".pdf") else "downloaded.pdf"


@app.get("/")
def root():
    return {
        "status": "ok",
        "service": "Highlights AI Backend",
    }


@app.post("/analyze")
def analyze(request: AnalyzeRequest):
    article_text = request.text.strip()

    summary = generate_summary(article_text)
    summary_text = clean_sentence(summary) if summary else ""

    if request.sentences:
        sentence_payload: list[SentenceInput] = [
            {
                "id": item.id,
                "text": item.text,
            }
            for item in request.sentences
        ]

        highlight_result = get_highlights_from_index(sentence_payload)

        highlights = highlight_result.get("highlights", [])
        selected_score_sum = highlight_result.get("selected_score_sum", 0.0)
        total_score_sum = highlight_result.get("total_score_sum", 0.0)

        return {
            "summary": summary_text,
            "highlights": highlights,
            "highlight_ids": highlight_result.get("highlight_ids", []),
            "scores": highlight_result.get("scores", []),
            "metrics": build_reading_metrics(
                article_text=article_text,
                summary=summary_text,
                highlights=highlights,
                selected_score_sum=selected_score_sum,
                total_score_sum=total_score_sum,
            ),
        }

    highlight_result = get_highlights(article_text)

    highlights = highlight_result.get("highlights", [])
    selected_score_sum = highlight_result.get("selected_score_sum", 0.0)
    total_score_sum = highlight_result.get("total_score_sum", 0.0)

    return {
        "summary": summary_text,
        "highlights": highlights,
        "highlight_ids": highlight_result.get("highlight_ids", []),
        "scores": highlight_result.get("scores", []),
        "metrics": build_reading_metrics(
            article_text=article_text,
            summary=summary_text,
            highlights=highlights,
            selected_score_sum=selected_score_sum,
            total_score_sum=total_score_sum,
        ),
    }


@app.post("/analyze-pdf")
async def analyze_pdf(file: UploadFile = File(...)):
    suffix = ".pdf"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    parsed = extract_text_from_pdf(tmp_path)
    article_text = parsed["text"]

    summary = generate_summary(article_text)
    summary_text = clean_sentence(summary) if summary else ""

    highlight_result = get_highlights(article_text)

    highlights = highlight_result.get("highlights", [])
    selected_score_sum = highlight_result.get("selected_score_sum", 0.0)
    total_score_sum = highlight_result.get("total_score_sum", 0.0)

    return {
        "file_name": parsed["file_name"],
        "page_count": parsed["page_count"],
        "word_count": parsed["word_count"],
        "summary": summary_text,
        "highlights": highlights,
        "scores": highlight_result.get("scores", []),
        "metrics": build_reading_metrics(
            article_text=article_text,
            summary=summary_text,
            highlights=highlights,
            selected_score_sum=selected_score_sum,
            total_score_sum=total_score_sum,
        ),
    }


@app.post("/analyze-pdf-url")
def analyze_pdf_url(request: AnalyzePdfUrlRequest):
    """Download a PDF from *url*, extract text, summarize, and highlight."""
    url = request.url.strip()

    print(f"Received PDF URL: {url}")

    if not url.startswith(("http://", "https://")):
        if url.startswith("chrome-extension://"):
            raise HTTPException(status_code=400, detail="Invalid PDF URL. Expected public http/https PDF URL.")
        raise HTTPException(status_code=400, detail="Invalid PDF URL scheme.")

    # ── Special arXiv handling ────────────────────────────
    if "arxiv.org/pdf/" in url and not url.endswith(".pdf"):
        url = f"{url}.pdf"
        print(f"Normalized arXiv URL to: {url}")

    # ── Download the PDF to a temporary file ─────────────
    try:
        response = http_requests.get(
            url, 
            timeout=60, 
            stream=True,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"}
        )
        response.raise_for_status()
    except http_requests.RequestException as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch PDF: {str(e)}")

    content_type = response.headers.get("Content-Type", "")
    if "application/pdf" not in content_type and "/pdf/" not in url:
        raise HTTPException(status_code=400, detail="URL does not appear to point to a valid PDF.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        for chunk in response.iter_content(chunk_size=8192):
            tmp.write(chunk)
        tmp_path = tmp.name

    # ── Extract, summarize, highlight ────────────────────
    parsed = extract_text_from_pdf(tmp_path)
    article_text = parsed["text"]

    file_name = _file_name_from_url(url)

    summary = generate_summary(article_text)
    summary_text = clean_sentence(summary) if summary else ""

    highlight_result = get_highlights(article_text)

    highlights = highlight_result.get("highlights", [])
    selected_score_sum = highlight_result.get("selected_score_sum", 0.0)
    total_score_sum = highlight_result.get("total_score_sum", 0.0)

    return {
        "file_name": file_name,
        "page_count": parsed["page_count"],
        "word_count": parsed["word_count"],
        "summary": summary_text,
        "highlights": highlights,
        "scores": highlight_result.get("scores", []),
        "metrics": build_reading_metrics(
            article_text=article_text,
            summary=summary_text,
            highlights=highlights,
            selected_score_sum=selected_score_sum,
            total_score_sum=total_score_sum,
        ),
    }