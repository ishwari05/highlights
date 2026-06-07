from pathlib import Path

import numpy as np
import pandas as pd
from datasets import Dataset
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import train_test_split
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
)


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_PATH = BASE_DIR / "data" / "highlight_dataset_final.csv"
MODEL_OUT = BASE_DIR / "models" / "distilbert_highlighter_final"


def compute_metrics(eval_pred):
    predictions, labels = eval_pred

    predictions = np.squeeze(predictions)
    labels = np.squeeze(labels)

    predictions = np.clip(predictions, 0, 1)
    labels = np.clip(labels, 0, 1)

    mae = mean_absolute_error(labels, predictions)
    mse = mean_squared_error(labels, predictions)
    rmse = np.sqrt(mse)

    return {
        "mae": mae,
        "mse": mse,
        "rmse": rmse,
    }


def main():
    df = pd.read_csv(DATA_PATH)

    df = df.dropna(subset=["sentence", "score"])
    df = df[["sentence", "score"]]

    df["sentence"] = df["sentence"].astype(str).str.strip()
    df["score"] = df["score"].astype(float).clip(0, 1)

    df = df[df["sentence"].str.len() >= 30]

    # Spread low ROUGE scores so the model learns better ranking separation.
    df["score"] = df["score"] ** 0.75

    df = df.rename(columns={"score": "labels"})

    print("Dataset:", DATA_PATH)
    print("Rows:", len(df))
    print(df["labels"].describe())

    train_df, val_df = train_test_split(
        df,
        test_size=0.10,
        random_state=42,
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

    remove_train_cols = [
        col for col in ["sentence", "__index_level_0__"]
        if col in train_ds.column_names
    ]

    remove_val_cols = [
        col for col in ["sentence", "__index_level_0__"]
        if col in val_ds.column_names
    ]

    train_ds = train_ds.remove_columns(remove_train_cols)
    val_ds = val_ds.remove_columns(remove_val_cols)

    train_ds.set_format("torch")
    val_ds.set_format("torch")

    model = AutoModelForSequenceClassification.from_pretrained(
        model_name,
        num_labels=1,
        problem_type="regression",
    )

    training_args = TrainingArguments(
        output_dir=str(BASE_DIR / "training_outputs_final"),
        eval_strategy="epoch",
        save_strategy="epoch",
        learning_rate=2e-5,
        per_device_train_batch_size=16,
        per_device_eval_batch_size=16,
        num_train_epochs=3,
        weight_decay=0.01,
        logging_steps=100,
        load_best_model_at_end=True,
        metric_for_best_model="mae",
        greater_is_better=False,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        compute_metrics=compute_metrics,
    )

    trainer.train()

    MODEL_OUT.mkdir(parents=True, exist_ok=True)

    model.save_pretrained(MODEL_OUT)
    tokenizer.save_pretrained(MODEL_OUT)

    print("Saved final regression model to:", MODEL_OUT)


if __name__ == "__main__":
    main()