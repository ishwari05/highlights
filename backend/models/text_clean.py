import re

# Wikipedia / academic style: [91], [ 91 ], [citation needed]
CITATION_PATTERN = re.compile(
    r"\[\s*(?:\d+\s*(?:[-–—]\s*\d+)?|citation needed|note)\s*\]",
    re.IGNORECASE,
)

WHITESPACE_PATTERN = re.compile(r"\s+")


def clean_sentence(text: str) -> str:
    """Remove reference markers and normalize whitespace for display and matching."""
    if not text:
        return ""

    cleaned = CITATION_PATTERN.sub("", text)
    cleaned = WHITESPACE_PATTERN.sub(" ", cleaned)
    return cleaned.strip()


def clean_sentences(sentences: list[str]) -> list[str]:
    return [clean_sentence(s) for s in sentences if clean_sentence(s)]
