import pandas as pd

df = pd.read_csv("data/highlight_dataset.csv")

print(df.columns)

print("\nScore Statistics:")
print(df["score"].describe())

print("\nFirst 5 Rows:")
print(df.head())