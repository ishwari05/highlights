(function () {
  const MIN_SENTENCE_LENGTH = 30;
  const CITATION_PATTERN = /\[\s*(?:\d+\s*(?:[-–—]\s*\d+)?|citation needed|note)\s*\]/gi;

  function normalizeWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function cleanSentenceText(text) {
    return normalizeWhitespace(text.replace(CITATION_PATTERN, ""));
  }

  function splitIntoSentences(text) {
    const normalized = text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    return normalized
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= MIN_SENTENCE_LENGTH);
  }

  function shouldKeepSentence(sentence) {
    const text = sentence.trim();
    if (text.length < 30) return false;

    const lower = text.toLowerCase();

    const bannedExact = [
      "references",
      "external links",
      "further reading",
      "bibliography",
      "see also",
      "notes",
      "sources"
    ];

    if (bannedExact.includes(lower)) return false;

    if (/^\[\s*\d+\s*\]/.test(text)) return false;

    const citationCount = (text.match(/\[\s*\d+\s*\]/g) || []).length;
    if (citationCount >= 3) return false;

    if (/^isbn\b/i.test(text)) return false;
    if (/^doi\b/i.test(text)) return false;
    if (/retrieved\s+\d{1,2}\s+[a-z]+\s+\d{4}/i.test(text)) return false;
    if (/archived from the original/i.test(text)) return false;

    return true;
  }

  /**
   * Map sentences to collapsedText character offsets (same coordinate system as segments).
   */
  function buildSentenceIndex(collapsedText) {
    const sentences = [];
    const byId = new Map();
    let searchFrom = 0;

    for (const rawText of splitIntoSentences(collapsedText)) {
      const cleaned = cleanSentenceText(rawText);
      if (cleaned.length < MIN_SENTENCE_LENGTH) {
        continue;
      }

      if (!shouldKeepSentence(rawText)) {
        continue;
      }

      let start = collapsedText.indexOf(rawText, searchFrom);
      if (start === -1) {
        start = collapsedText.indexOf(cleaned, searchFrom);
      }
      if (start === -1) {
        const flexible = cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
        const match = collapsedText.slice(searchFrom).match(new RegExp(flexible, "i"));
        if (match && typeof match.index === "number") {
          start = searchFrom + match.index;
        }
      }

      if (start === -1) {
        continue;
      }

      const end = start + (collapsedText.indexOf(rawText, start) === start ? rawText.length : cleaned.length);
      const id = sentences.length;

      const entry = {
        id,
        text: rawText,
        cleaned,
        start,
        end,
      };

      sentences.push(entry);
      byId.set(id, entry);
      searchFrom = end;
    }

    return { sentences, byId };
  }

  window.HighlightsSentenceIndex = {
    buildSentenceIndex,
    cleanSentenceText,
    splitIntoSentences,
  };
})();
