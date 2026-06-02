import pandas as pd
from pathlib import Path
from sklearn.model_selection import train_test_split

from datasets import Dataset
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_PATH = BASE_DIR / "data" / "highlight_dataset.csv"
MODEL_OUT = BASE_DIR / "models" / "distilbert_highlighter"

df = pd.read_csv(DATA_PATH)

df = df.dropna()
df = df[["sentence", "label"]]
df["label"] = df["label"].astype(int)

positive_df = df[df["label"] == 1]
negative_df = df[df["label"] == 0].sample(
    n=len(positive_df),
    random_state=42
)

df = pd.concat([positive_df, negative_df])
df = df.sample(frac=1, random_state=42)

train_df, val_df = train_test_split(
    df,
    test_size=0.15,
    random_state=42,
    stratify=df["label"]
)

train_ds = Dataset.from_pandas(train_df)
val_ds = Dataset.from_pandas(val_df)

model_name = "distilbert-base-uncased"

tokenizer = AutoTokenizer.from_pretrained(model_name)

def tokenize(batch):
    return tokenizer(
        batch["sentence"],
        truncation=True,
        padding="max_length",
        max_length=128,
    )

train_ds = train_ds.map(tokenize, batched=True)
val_ds = val_ds.map(tokenize, batched=True)

train_ds = train_ds.remove_columns(["sentence", "__index_level_0__"])
val_ds = val_ds.remove_columns(["sentence", "__index_level_0__"])

train_ds.set_format("torch")
val_ds.set_format("torch")

model = AutoModelForSequenceClassification.from_pretrained(
    model_name,
    num_labels=2
)

training_args = TrainingArguments(
    output_dir=str(BASE_DIR / "training_outputs"),
    eval_strategy="epoch",
    save_strategy="epoch",
    learning_rate=2e-5,
    per_device_train_batch_size=8,
    per_device_eval_batch_size=8,
    num_train_epochs=2,
    weight_decay=0.01,
    logging_steps=50,
    load_best_model_at_end=True,
)

trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=train_ds,
    eval_dataset=val_ds,
)

trainer.train()

MODEL_OUT.mkdir(parents=True, exist_ok=True)

model.save_pretrained(MODEL_OUT)
tokenizer.save_pretrained(MODEL_OUT)

print("Saved model to:", MODEL_OUT)