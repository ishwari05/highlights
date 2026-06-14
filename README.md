<div align="center">

# ⚡️ Highlights AI

**An AI-powered Chrome extension that summarizes and highlights the most important content from webpages and PDFs using transformer-based NLP models.**

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg?style=flat-square)](#)
[![Python Version](https://img.shields.io/badge/python-3.9%2B-blue.svg?style=flat-square)](#)
[![PyTorch](https://img.shields.io/badge/PyTorch-2.0%2B-ee4c2c.svg?style=flat-square)](#)
[![HuggingFace](https://img.shields.io/badge/🤗_Transformers-latest-yellow.svg?style=flat-square)](#)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100%2B-00a393.svg?style=flat-square)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg?style=flat-square)](#)

[Demo Video/GIF Placeholder]

</div>

---

## 📖 Project Overview

Information density on the modern web is at an all-time low. Readers spend too much cognitive bandwidth filtering out noise, ads, and filler text to find actionable signals. 

**Highlights AI** solves the signal-to-noise problem. It acts as an autonomous reading assistant that dynamically extracts semantic meaning from DOM trees and complex PDF objects, strips away the noise, and maps high-signal sentences back onto the original document via custom DOM overlays.

By leveraging a fine-tuned `distilbert-base-uncased` transformer model, the system understands context and ranks sentence importance across diverse domains—from high-density arXiv research papers to noisy news articles.

### Why This Project Matters
This project bridges the gap between raw NLP research and practical, consumer-facing browser extensions. It demonstrates end-to-end applied ML engineering: from custom dataset curation and model fine-tuning to building resilient text-extraction pipelines and custom rendering layers within a Chrome extension sandbox.

---

## ✨ Core Product Features

### Webpage Analysis
* **Intelligent Content Extraction:** Robust DOM traversal that isolates main content and semantic HTML while stripping out noisy elements (ads, banners, newsletters, cookie popups, CTAs).
* **Transformer-Powered Highlights:** Context-aware sentence segmentation and scoring.
* **Abstractive Summaries:** Generates concise bullet points representing the document's core thesis.
* **Reading Metrics:** Calculates original read time vs. highlighted read time to quantify efficiency gains.

### PDF Document Intelligence
* **Universal PDF Support:** Natively supports direct PDF URLs, local uploads, arXiv preprints, whitepapers, and annual reports.
* **Deep Document Parsing:** Advanced text extraction bridging the gap between visual layout and semantic flow.
* **AI Feature Extraction:** Summary generation and sentence-level highlight ranking optimized for academic and financial language.

### Custom PDF Viewer Engine
Chrome's native PDF viewer is a black-box environment that blocks content scripts, preventing DOM manipulation and native highlighting. To solve this, I built a custom PDF rendering engine inside the extension.
* **PDF.js Canvas Integration:** High-fidelity document rendering.
* **Transparent DOM Text Layer:** Maps raw PDF coordinates to absolute-positioned DOM elements for precise text manipulation.
* **Split-Screen AI Analysis Panel:** A sticky UI layer delivering document summaries alongside the reading experience.
* **Native In-Document Highlights:** Dynamically applies CSS/Mark highlights natively onto the PDF text layer.

---

## 🧠 Machine Learning & AI Pipeline

<div align="center">
[Architecture Diagram Placeholder: End-to-End Pipeline]
</div>

### The AI Pipeline
```text
Webpage/PDF → Content Extraction → DOM Cleaning → Sentence Segmentation → Transformer Inference (Scoring) → Ranking Thresholds → Highlight Selection → Summary Generation (BART) → UI DOM Injection
```

### Model Architecture
* **Base Model:** `distilbert-base-uncased`
* **Task:** Sentence importance regression (Sequence Classification with 1 output logit).
* **Objective:** Predicts an importance score between 0.0 and 1.0. The model explicitly learns: *"How important is this sentence relative to the broader context of the document?"*

### Dataset Engineering
Standard summarization datasets lack granular sentence-level importance scores. To train the regressor, I engineered a custom, multi-domain dataset encompassing **187,224 unique examples**.

**Sources & Domains:**
* `CNN/DailyMail` (News)
* `BillSum` (Legal/Technical)
* `WikiHow` (Educational/Instructional)
* `PubMedQA` (Medical Research)
* `arXiv` (Scientific Papers)
* `Wikipedia` (General Knowledge)

### Training Performance
The model was fine-tuned to predict Rouge-L / semantic overlap scores between individual sentences and the ground-truth abstractive summaries. 

| Metric | Score | Observation |
|--------|-------|-------------|
| **Train Loss** | 0.00587 | Consistent convergence |
| **Eval Loss** | 0.00618 | Minimal overfitting |
| **MAE** | 0.0559 | High precision on importance bounds |
| **RMSE** | 0.0786 | Strong penalty for severe ranking misses |

**Result:** A highly generalized model capable of scoring sentence importance across previously unseen document domains with remarkable human-alignment.

---

## 🛠 Engineering Architecture

### Stack
* **Frontend:** Chrome Extension Manifest V3, Vanilla JavaScript, HTML5/CSS3, PDF.js
* **Backend:** FastAPI, Uvicorn, Python 3.9+
* **Machine Learning:** PyTorch, HuggingFace Transformers, Scikit-learn, Pandas, NumPy, PyMuPDF

### Repository Structure
```text
.
├── backend/                  # FastAPI service and ML inference endpoints
│   ├── models/               # PyTorch model definitions and weights
│   ├── training/             # Dataset generation and fine-tuning scripts
│   └── api.py                # REST endpoints
├── extension/                # Chrome Extension source
│   ├── content/              # DOM traversal and highlight injection
│   ├── pdf_viewer/           # Custom PDF rendering engine
│   ├── popup/                # Extension UI
│   └── manifest.json
└── README.md
```

---

## 🧩 Engineering Challenges Solved

### 1. Bypassing Chrome PDF Viewer Limitations
**Problem:** Chrome’s default PDF viewer operates inside a restricted `<embed>` tag, blocking content scripts and preventing DOM manipulation.  
**Solution:** I engineered a custom PDF viewer within the extension using `pdf.js`. By intercepting `.pdf` network requests, the extension routes the user to a local viewer page, bypassing Chrome's restrictions and enabling full DOM control.

### 2. Precise Text-Layer Alignment in PDFs
**Problem:** PDFs are fundamentally visual formats, not semantic ones. Rendering text requires placing transparent text spans perfectly over a painted canvas.  
**Solution:** I implemented a custom coordinate-mapping system that applies PDF transform matrices to the DOM. By mapping `viewport.transform` to CSS `matrix()` transforms, the transparent text layer aligns perfectly with the canvas, allowing native HTML `<mark>` tags and CSS Custom Highlights to appear exactly over the painted text.

### 3. Noisy Web Extraction
**Problem:** Modern DOM trees are polluted with ads, navbars, and hidden tracking pixels, poisoning transformer inputs.  
**Solution:** Built a heuristic-driven DOM walker that utilizes `NodeFilter`, `IntersectionObserver` principles, and computed styles to filter out visually hidden elements, non-semantic tags, and injected ad-containers, ensuring only high-quality paragraph tokens reach the backend.

### 4. Highlight Ranking Quality
**Problem:** Classification models (Is highlight? Yes/No) fail on long documents because they either highlight too much or too little.  
**Solution:** Formulated the problem as a continuous regression task. By predicting an absolute importance score (0-1), the client can dynamically set dynamic thresholding (e.g., "Show me the top 15% of sentences"), adapting the highlight density to the user's preference and document length.

### 5. Async Coordination: Render vs. Inference
**Problem:** PDF canvas rendering is heavily asynchronous, as is network-bound ML inference. Applying DOM highlights before the text-layer exists results in silent failures.  
**Solution:** Designed a deterministic synchronization state machine in JavaScript that tracks `isPdfRendered` and `analysisHighlights`. Visual highlights are only mapped and injected once both the PDF rendering pipeline and the FastAPI response have successfully resolved.

### 6. Multi-Domain Dataset Creation
**Problem:** Existing datasets are heavily skewed towards news articles (CNN/DailyMail), causing models to fail on academic papers or legal text.  
**Solution:** Wrote a modular data pipeline to synthesize a massive 187k+ dataset combining arXiv, PubMed, WikiHow, and BillSum. Sentences were scored against abstractive summaries using ROUGE overlap heuristics to create continuous target variables for the regression model.

---

## 📊 Reading Metrics Integration
To prove the value of the tool, the UI dynamically calculates the efficiency gained from the model:
* **Original Reading Time** (based on ~225 WPM)
* **Highlights Reading Time** (WPM applied to top N% sentences)
* **Time Saved** (%)
* **Coverage Score** (Semantic density captured)
* **Confidence Score** (Model certainty)

---

## 🚀 Installation & Usage

### Backend Setup
1. Clone the repository and navigate to the backend:
   ```bash
   git clone https://github.com/yourusername/highlights-ai.git
   cd highlights-ai/backend
   ```
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Start the FastAPI inference server:
   ```bash
   uvicorn api:app --host 127.0.0.1 --port 8000
   ```

### Extension Setup
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select the `/extension` directory from the cloned repository.

### Usage
1. Navigate to any long-form article or PDF URL.
2. Click the **Highlights AI** extension icon in your browser toolbar.
3. View the generated summary in the sidebar and watch the important sentences highlight directly on the page.

---

## 🔭 Future Roadmap & Key Learnings

### Roadmap (V2)
* **WASM / ONNX Optimization:** Compiling the PyTorch model to ONNX to run inference entirely client-side within the browser (Offline Inference).
* **OCR for Scanned PDFs:** Integrating Tesseract.js to build text layers for flattened, scanned documents.
* **User-Adaptive Highlighting:** Implementing a feedback loop where user interactions (accepting/rejecting highlights) fine-tune the model locally.
* **Intent-Aware Modes:** Dynamic prompting/weighting to adjust highlight focus based on the reader's persona (Student vs. Researcher vs. Investor).

### Key Learnings
Building this required deeply understanding the intersection of frontend rendering architectures and NLP inference limitations. The hardest lesson was realizing that **the ML model is only 20% of the product**; 80% of the engineering effort went into data sanitization, asynchronous state management, and bridging the semantic gap between HTML/PDF structures and raw text streams.
