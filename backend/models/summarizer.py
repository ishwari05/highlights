from transformers import pipeline

print("Loading BART model...")

summarizer = pipeline(
    "summarization",
    model="facebook/bart-large-cnn"
)

print("BART loaded successfully")


def generate_summary(text: str):
    result = summarizer(
        text[:3000],
        max_length=150,
        min_length=50,
        do_sample=False
    )

    return result[0]["summary_text"]