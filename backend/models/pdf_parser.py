from pathlib import Path

import fitz


def extract_text_from_pdf(file_path: str) -> dict:
    pdf_path = Path(file_path)

    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    doc = fitz.open(pdf_path)

    pages = []
    full_text_parts = []

    for page_index, page in enumerate(doc):
        text = page.get_text("text").strip()

        pages.append({
            "page": page_index + 1,
            "text": text,
            "word_count": len(text.split()),
        })

        if text:
            full_text_parts.append(text)

    doc.close()

    full_text = "\n\n".join(full_text_parts).strip()

    return {
        "file_name": pdf_path.name,
        "page_count": len(pages),
        "word_count": len(full_text.split()),
        "text": full_text,
        "pages": pages,
    }