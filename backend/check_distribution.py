import pandas as pd

df = pd.read_csv("data/highlight_dataset.csv")

df["score"] = df["score"].clip(0, 1)

print(df["score"].describe())

print("\nTop 20 Scores")
print(df["score"].sort_values(ascending=False).head(20))

print("\nBottom 20 Scores")
print(df["score"].sort_values().head(20))