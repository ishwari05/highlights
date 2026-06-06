(function () {
  const ANALYSIS_STATE_KEY = "__highlightsAnalysisState";

  function findContentRoot() {
    const selectors = [
      "#mw-content-text .mw-parser-output",
      "article",
      "main",
      "[role='main']",
      ".post-content",
      ".entry-content",
      ".article-body",
      ".markdown-body",
      "#content",
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);

      if (
        element &&
        element.innerText.trim().split(/\s+/).filter(Boolean).length >= 120
      ) {
        return element;
      }
    }

    return document.body;
  }

  function computeReducedReadingTime(readingTime, highlightCount) {
    const ratio = Math.max(0.28, 0.55 - highlightCount * 0.04);
    return Math.max(1, Math.ceil(readingTime * ratio));
  }

  function normalizeHighlights(highlights) {
    if (!Array.isArray(highlights)) {
      return [];
    }

    return highlights
      .map((item) => {
        if (typeof item === "string") {
          return {
            id: null,
            text: item.trim(),
            score: null,
          };
        }

        if (item && typeof item === "object") {
          const parsedId = Number(item.id);

          return {
            id: Number.isInteger(parsedId) && parsedId >= 0 ? parsedId : null,
            text: typeof item.text === "string" ? item.text.trim() : "",
            score: typeof item.score === "number" ? item.score : null,
          };
        }

        return null;
      })
      .filter((item) => item && item.text);
  }

  function normalizeHighlightIds(ids) {
    if (!Array.isArray(ids)) {
      return [];
    }

    return ids
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id >= 0);
  }

  function buildPageMeta(
    pageTitle,
    wordCount,
    readingTime,
    highlightCount,
    isPdf,
    metrics,
  ) {
    return {
      title: pageTitle,
      wordCount,
      readingTime: metrics?.original_read_time ?? readingTime,
      reducedReadingTime:
        metrics?.highlights_read_time ??
        computeReducedReadingTime(readingTime, highlightCount),
      highlightCount,
      isPdf,
      metrics: metrics || {},
    };
  }

  function navigateToSentence(sentence, state) {
    const helper = window.HighlightsHelper;

    if (!helper || !state) {
      return;
    }

    if (state.isPdf) {
      helper.tryFindOnPage(sentence.slice(0, 120));
      return;
    }

    const highlightObject = state.highlightObjects?.find(
      (item) => item.text === sentence,
    );

    if (highlightObject && Number.isInteger(highlightObject.id)) {
      const indexedById = state.sentenceIndex?.sentences?.find(
        (entry) => Number(entry.id) === Number(highlightObject.id),
      );

      if (indexedById) {
        helper.scrollToPosition(indexedById.start, state.segments);
        return;
      }
    }

    const indexedEntry = state.sentenceIndex?.sentences?.find(
      (entry) => entry.cleaned === sentence || entry.text === sentence,
    );

    if (indexedEntry) {
      helper.scrollToPosition(indexedEntry.start, state.segments);
      return;
    }

    const match = helper.findSentencePosition(sentence, state.collapsedText);

    if (match) {
      helper.scrollToPosition(match.start, state.segments);
      return;
    }

    const block = helper.findParagraphForSentence(sentence, state.contentRoot);

    if (block) {
      block.classList.add("highlights-paragraph-active");
      block.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      window.setTimeout(() => {
        block.classList.remove("highlights-paragraph-active");
      }, 2400);

      return;
    }

    helper.tryFindOnPage(sentence.slice(0, 120));
  }

  function extractHighlightIds(highlightObjects, fallbackIds) {
    const idsFromObjects = highlightObjects
      .map((item) => item.id)
      .filter((id) => Number.isInteger(id) && id >= 0);

    if (idsFromObjects.length > 0) {
      return idsFromObjects;
    }

    return normalizeHighlightIds(fallbackIds);
  }

  async function runAnalysis() {
    const helper = window.HighlightsHelper;
    const panelUI = window.HighlightsPanelUI;
    const api = window.HighlightsAPI;
    const sentenceIndexLib = window.HighlightsSentenceIndex;

    let loadingMeta = null;

    try {
      if (!helper) {
        return {
          ok: false,
          reason: "helper-missing",
        };
      }

      if (!panelUI) {
        return {
          ok: false,
          reason: "panel-ui-missing",
        };
      }

      if (!api || typeof api.analyzeWithBackend !== "function") {
        return {
          ok: false,
          reason: "api-missing",
        };
      }

      if (
        !sentenceIndexLib ||
        typeof sentenceIndexLib.buildSentenceIndex !== "function"
      ) {
        return {
          ok: false,
          reason: "sentence-index-missing",
        };
      }

      if (!document.body) {
        return {
          ok: false,
          reason: "no-document-body",
        };
      }

      helper.clearPreviousHighlights();
      panelUI.unmount();

      const isPdf = helper.isPdfViewer();
      const pageTitle = document.title.trim();
      const contentRoot = isPdf ? document.body : findContentRoot();
      const pageIndex = helper.buildPageIndex(contentRoot);

      const isWikipedia = /^[a-z]{2,3}\.wikipedia\.org$/i.test(
        window.location.hostname,
      );

      let articleText;

      if (isWikipedia) {
        articleText = Array.from(
          document.querySelectorAll(
            "#mw-content-text .mw-parser-output > p",
          ),
        )
          .map((p) => p.innerText.trim())
          .filter((p) => p.length > 80)
          .join("\n\n");
      } else {
        articleText = pageIndex.collapsedText || "";
      }

      const wordCount = articleText
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;

      const readingTime = Math.max(
        1,
        Math.ceil(wordCount / 225),
      );

      loadingMeta = buildPageMeta(
        pageTitle,
        wordCount,
        readingTime,
        0,
        isPdf,
        null,
      );

      await panelUI.mountLoading(loadingMeta);

      if (!articleText.trim() || articleText.length < 100) {
        throw new Error("Not enough article text found on this page.");
      }

      const sentenceIndex = sentenceIndexLib.buildSentenceIndex(articleText);

      console.log(
        "[Highlights] Sentence index:",
        sentenceIndex.sentences.length,
        "sentences",
      );

      const indexedPayload = sentenceIndex.sentences.map((entry) => ({
        id: Number(entry.id),
        text: entry.text,
      }));

      const backendResult = await api.analyzeWithBackend(
        articleText,
        indexedPayload,
      );

      const summary =
        typeof backendResult.summary === "string"
          ? backendResult.summary.trim()
          : "No summary returned.";

      const highlightObjects = normalizeHighlights(
        backendResult.highlights,
      );

      const highlights = highlightObjects.map(
        (item) => item.text,
      );

      const highlightIds = extractHighlightIds(
        highlightObjects,
        backendResult.highlight_ids,
      );

      const metrics = backendResult.metrics || {};

      const highlightCount = Math.max(
        highlights.length,
        highlightIds.length,
      );

      const state = {
        isPdf,
        contentRoot,
        collapsedText: pageIndex.collapsedText,
        segments: pageIndex.segments,
        sentenceIndex,
        highlightObjects,
      };

      window[ANALYSIS_STATE_KEY] = state;

      let highlightResult = {
        appliedCount: 0,
        domRangeCount: 0,
        paragraphCount: 0,
        method: "skipped",
        unmatchedSentences: [],
      };

      if (!isPdf && (highlightIds.length > 0 || highlights.length > 0)) {
        const ranges =
          highlightIds.length > 0
            ? helper.buildRangesFromSentenceIds(
                highlightIds,
                sentenceIndex,
                pageIndex.segments,
              )
            : helper.buildRangesFromTexts(
                highlights,
                pageIndex.collapsedText,
                pageIndex.segments,
              );

        console.log(
          "[Highlights] Highlight IDs:",
          highlightIds,
        );

        console.log(
          "[Highlights] Highlight ranges:",
          ranges,
        );

        highlightResult = helper.applyHighlights(
          ranges,
          contentRoot,
        );

        console.log(
          "[Highlights] Apply result:",
          highlightResult,
        );

        console.log(
          "[Highlights] Diagnostics:",
          helper.getHighlightDiagnostics(),
        );
      }

      const pageData = buildPageMeta(
        pageTitle,
        wordCount,
        readingTime,
        highlightCount,
        isPdf,
        metrics,
      );

      pageData.summary =
        summary || "No summary returned by the backend.";

      pageData.highlights = highlights;
      pageData.topSentences = highlights;
      pageData.highlightObjects = highlightObjects;
      pageData.highlightIds = highlightIds;

      await panelUI.mount(pageData, {
        onNavigate: (sentence) => navigateToSentence(sentence, state),
      });

      const host = document.getElementById("highlights-root");
      const panel = host?.shadowRoot?.querySelector(".hl-panel");

      if (panel) {
        const rect = panel.getBoundingClientRect();

        console.log(
          "[Highlights] Sidebar visible:",
          rect.width > 0 && rect.height > 0,
          rect,
        );
      }

      return {
        ok: true,
        highlights: highlightResult,
        isPdf,
        summary,
        metrics,
        highlightIds,
      };
    } catch (error) {
      console.error("[Highlights] Analysis failed:", error);

      const panelUIOnError = window.HighlightsPanelUI;

      if (
        panelUIOnError &&
        typeof panelUIOnError.mountError === "function"
      ) {
        await panelUIOnError.mountError(
          "Could not connect to AI service. Start the backend: uvicorn app:app --reload",
          loadingMeta || {
            title: document.title.trim(),
            wordCount: 0,
            readingTime: 1,
            reducedReadingTime: 1,
            highlightCount: 0,
            isPdf: false,
            metrics: {},
          },
        );
      }

      return {
        ok: false,
        reason: "error",
        message: error?.message ? error.message : String(error),
      };
    }
  }

  window.__highlightsRunAnalysis = runAnalysis;
})();