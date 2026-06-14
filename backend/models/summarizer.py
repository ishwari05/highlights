import re
from transformers import pipeline

print("Loading BART model...")

summarizer = pipeline(
    "summarization",
    model="facebook/bart-large-cnn",
)

print("BART loaded successfully")


MAX_CHUNK_WORDS = 850
MIN_CHUNK_WORDS = 120


def clean_text(text: str) -> str:
    if not text:
        return ""

    text = re.sub(r"\s+", " ", text)
    return text.strip()


def split_into_chunks(
    text: str,
    max_words: int = MAX_CHUNK_WORDS,
) -> list[str]:
    words = text.split()
    chunks = []

    for i in range(0, len(words), max_words):
        chunk = " ".join(words[i:i + max_words])

        if len(chunk.split()) >= MIN_CHUNK_WORDS:
            chunks.append(chunk)

    return chunks


def remove_duplicate_sentences(text: str) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", text)

    seen = set()
    cleaned = []

    for sentence in sentences:
        key = sentence.lower().strip()

        if not key:
            continue

        if key in seen:
            continue

        seen.add(key)
        cleaned.append(sentence.strip())

    return " ".join(cleaned)


def get_summary_lengths(word_count: int) -> tuple[int, int]:
    """
    Dynamic summary size based on document length.
    Returns: (max_length, min_length)
    """

    if word_count < 500:
        return 70, 25

    if word_count < 1500:
        return 110, 40

    if word_count < 4000:
        return 160, 60

    if word_count < 10000:
        return 220, 90

    return 300, 120


def summarize_chunk(text: str) -> str:
    word_count = len(text.split())

    if word_count < 150:
        max_length = 80
        min_length = 25
    elif word_count < 500:
        max_length = 120
        min_length = 40
    else:
        max_length = 180
        min_length = 60

    result = summarizer(
        text,
        max_length=max_length,
        min_length=min_length,
        do_sample=False,
        no_repeat_ngram_size=3,
        length_penalty=1.2,
        truncation=True,
    )

    return result[0]["summary_text"].strip()


def summarize_final(
    text: str,
    original_word_count: int,
) -> str:
    max_length, min_length = get_summary_lengths(
        original_word_count
    )

    result = summarizer(
        text,
        max_length=max_length,
        min_length=min_length,
        do_sample=False,
        no_repeat_ngram_size=3,
        length_penalty=1.6,
        truncation=True,
    )

    return result[0]["summary_text"].strip()


def generate_summary(text: str) -> str:
    text = clean_text(text)

    if not text:
        return ""

    original_word_count = len(text.split())

    # Tiny content: don't summarize aggressively
    if original_word_count < 80:
        return text

    chunks = split_into_chunks(text)

    # Small article
    if len(chunks) <= 1:
        try:
            return summarize_final(
                text,
                original_word_count,
            )
        except Exception as error:
            print("Summary failed:", error)
            return text[:500]

    # Large article / PDF
    chunk_summaries = []

    for chunk in chunks:
        try:
            summary = summarize_chunk(chunk)
            chunk_summaries.append(summary)
        except Exception as error:
            print("Chunk failed:", error)

    if not chunk_summaries:
        return text[:500]

    merged_summary = " ".join(chunk_summaries)
    merged_summary = remove_duplicate_sentences(
        merged_summary
    )

    try:
        final_summary = summarize_final(
            merged_summary,
            original_word_count,
        )

        final_summary = remove_duplicate_sentences(
            final_summary
        )

        return final_summary

    except Exception as error:
        print("Final summary failed:", error)
        return merged_summary