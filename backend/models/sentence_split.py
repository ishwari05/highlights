import re

# Align with extension/content/sentence-index.js
SENTENCE_SPLIT_PATTERN = re.compile(r"(?<=[.!?])\s+")
WHITESPACE_PATTERN = re.compile(r"\s+")


def split_sentences(text: str, min_length: int = 30) -> list[str]:
    normalized = WHITESPACE_PATTERN.sub(" ", text.replace("\n", " ")).strip()
    if not normalized:
        return []

    parts = SENTENCE_SPLIT_PATTERN.split(normalized)
    return [part.strip() for part in parts if len(part.strip()) >= min_length]
