(function () {
  const BACKEND_ANALYZE_URL = "http://127.0.0.1:8000/analyze";

  async function analyzeWithBackend(text, sentences) {
    const payload = {
      text,
    };

    if (Array.isArray(sentences) && sentences.length > 0) {
      payload.sentences = sentences.map((entry) => ({
        id: entry.id,
        text: entry.text,
      }));
    }

    console.log("Sending article to backend", text.length);

    const response = await fetch(BACKEND_ANALYZE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const result = await response.json();
    console.log("Backend response", result);
    console.log("Summary received", result.summary);
    console.log("Highlights received", result.highlights);
    console.log("Highlight IDs received", result.highlight_ids);

    return result;
  }

  window.HighlightsAPI = {
    analyzeWithBackend,
  };
})();
