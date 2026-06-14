(function () {
  const MIN_SENTENCE_LENGTH = 30;
  const CITATION_PATTERN = /\[\s*(?:\d+\s*(?:[-–—]\s*\d+)?|citation needed|note)\s*\]/gi;

  /**
   * ──────────────────────────────────────────────────────────
   *  Promotional / marketing content filter
   * ──────────────────────────────────────────────────────────
   *  Why: Newsletter sign-ups, subscription CTAs, privacy
   *  banners, and marketing copy are routinely extracted as
   *  "sentences" from web pages.  They carry zero educational
   *  value and confuse the DistilBERT importance scorer,
   *  producing false-positive highlights.
   *
   *  This filter runs BEFORE sentence indexing so that none
   *  of this text ever reaches the /analyze endpoint.
   * ──────────────────────────────────────────────────────────
   */
  const PROMOTIONAL_PATTERNS = [
    // Newsletter & subscription CTAs
    /\bsubscribe\b/i,
    /\bsubscribers\b/i,
    /\bnewsletter\b/i,
    /\bsign\s+up\b/i,
    /\bjoin\s+over\b/i,
    /\bregister\s+now\b/i,
    /\bget\s+started\b/i,

    // Privacy / legal boilerplate
    /\bprivacy\s+statement\b/i,
    /\bprivacy\s+policy\b/i,
    /\bcookie\s+policy\b/i,

    // Marketing & engagement hooks
    /\bstay\s+up\s+to\s+date\b/i,
    /\blatest\s+news\b/i,
    /\bdelivered\s+weekly\b/i,
    /\bdelivered\s+twice\s+weekly\b/i,
    /\btry\s+for\s+free\b/i,
    /\bbook\s+a\s+demo\b/i,

    // Advertising / sponsorship markers
    /\badvertisement\b/i,
    /\bsponsored\b/i,

    // Generic CTA phrases
    /\blearn\s+more\b/i,
    /\bcontact\s+us\b/i,
    /\bfollow\s+us\b/i,

    // Additional promotional patterns
    /\bspecial\s+offer\b/i,
    /\blimited\s+time\b/i,
    /\bfree\s+trial\b/i,
    /\bunsubscribe\b/i,
    /\bopt[\s-]?in\b/i,
    /\bopt[\s-]?out\b/i,
  ];

  function isPromotionalContent(text) {
    const lower = text.toLowerCase();
    return PROMOTIONAL_PATTERNS.some((pattern) => pattern.test(lower));
  }

  /**
   * ──────────────────────────────────────────────────────────
   *  Structural / non-article content filter
   * ──────────────────────────────────────────────────────────
   *  Why: Navigation menus, breadcrumbs, footer text, cookie
   *  consent notices, and link-heavy fragments appear as
   *  extracted text but are not part of the article body.
   *  Filtering them prevents meaningless highlights.
   * ──────────────────────────────────────────────────────────
   */

  /** Phrases that signal navigation / footer / cookie UI text */
  const STRUCTURAL_PATTERNS = [
    /\bbreadcrumb/i,
    /\bskip\s+to\s+(main\s+)?content\b/i,
    /\bback\s+to\s+top\b/i,
    /\ball\s+rights\s+reserved\b/i,
    /\bterms\s+(of\s+)?(service|use)\b/i,
    /\bcookies?\s+(are\s+)?(used|enable|help|allow)\b/i,
    /\bwe\s+use\s+cookies\b/i,
    /\baccept\s+(all\s+)?cookies\b/i,
    /\bmanage\s+preferences\b/i,
    /\bcopyright\s+©?\s*\d{4}/i,
    /\bpowered\s+by\b/i,
    /\bsite\s*map\b/i,
  ];

  /**
   * Returns true when the sentence looks like structural or
   * navigational page chrome rather than article prose.
   */
  function isStructuralContent(text) {
    const lower = text.toLowerCase();

    // ── Structural pattern match ────────────────────────────
    if (STRUCTURAL_PATTERNS.some((pattern) => pattern.test(lower))) {
      return true;
    }

    // ── Link-heavy: more than half the words are URLs ───────
    // Why: lines stuffed with hrefs are nav / footer lists.
    const words = text.split(/\s+/).filter(Boolean);
    const urlWords = words.filter(
      (w) => /^https?:\/\//i.test(w) || /\.com|\.org|\.net|\.edu/i.test(w),
    );
    if (words.length > 0 && urlWords.length / words.length > 0.5) {
      return true;
    }

    // ── Pipe / arrow delimited lists ────────────────────────
    // Why: menus often look like "Home | About | Contact".
    const pipeSegments = text.split(/\s*[|›»→>]\s*/);
    if (pipeSegments.length >= 4 && pipeSegments.every((s) => s.split(/\s+/).length <= 4)) {
      return true;
    }

    return false;
  }

  // ──────────────────────────────────────────────────────────

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

  /**
   * ──────────────────────────────────────────────────────────
   *  Master gate: decides whether a sentence is worth sending
   *  to the ML model.
   *
   *  Order of checks (cheapest first):
   *    1. Too short → reject
   *    2. Wikipedia section headings / citations → reject
   *    3. Promotional / marketing → reject
   *    4. Structural / navigation → reject
   *    5. Too few real words (< 5) → reject
   * ──────────────────────────────────────────────────────────
   */
  function shouldKeepSentence(sentence) {
    const text = sentence.trim();

    // ── Minimum length guard ────────────────────────────────
    // Why: very short fragments can't carry meaningful content.
    if (text.length < 30) return false;

    const lower = text.toLowerCase();

    // ── Wikipedia / reference section headings ──────────────
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

    // ── Starts with a citation reference number ─────────────
    if (/^\[\s*\d+\s*\]/.test(text)) return false;

    // ── Over-cited sentence (likely a reference list entry) ─
    const citationCount = (text.match(/\[\s*\d+\s*\]/g) || []).length;
    if (citationCount >= 3) return false;

    // ── Bibliographic metadata ──────────────────────────────
    if (/^isbn\b/i.test(text)) return false;
    if (/^doi\b/i.test(text)) return false;
    if (/retrieved\s+\d{1,2}\s+[a-z]+\s+\d{4}/i.test(text)) return false;
    if (/archived from the original/i.test(text)) return false;

    // ── Promotional / marketing content ─────────────────────
    // Why: newsletter CTAs, subscription banners, ad markers,
    //      and privacy notices are never article content.
    if (isPromotionalContent(text)) {
      console.log("[Highlights] Filtered promotional content:", text);
      return false;
    }

    // ── Structural / navigational page chrome ───────────────
    // Why: menus, breadcrumbs, footer boilerplate, cookie
    //      consent text should never be highlighted.
    if (isStructuralContent(text)) {
      console.log("[Highlights] Filtered structural content:", text);
      return false;
    }

    // ── Too few meaningful words ────────────────────────────
    // Why: short CTA buttons / labels that survived length
    //      check in characters but contain <5 real words.
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 5) {
      console.log("[Highlights] Filtered short sentence:", text);
      return false;
    }

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

