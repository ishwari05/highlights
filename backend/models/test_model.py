from summarizer import generate_summary

sample_text = """
Coffee is a beverage brewed from roasted coffee beans.
Coffee is darkly colored and contains caffeine.
It is consumed by millions of people worldwide.
Coffee production begins when coffee cherries are harvested.
The beans are roasted and ground before brewing.
"""

summary = generate_summary(sample_text)

print(summary)