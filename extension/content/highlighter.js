(function () {
  const HIGHLIGHT_REGISTRY_KEY = "highlights-important";
  const IGNORED_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "OPTION",
    "HEAD",
    "META",
    "LINK",
    "SVG",
  ]);

  const BLOCK_SELECTORS =
    "p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, figcaption, dd, dt, pre, [role='paragraph']";

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (element.hidden) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function isIgnoredNode(node) {
    if (!node.parentElement) {
      return true;
    }

    if (node.parentElement.closest("#highlights-root, #highlights-panel, .highlights-margin-guide, #analysis-panel")) {
      return true;
    }

    if (node.parentElement.closest("mark.highlights-mark")) {
      return true;
    }

    if (node.parentElement.closest("[hidden], [aria-hidden='true']")) {
      return true;
    }

    let parent = node.parentElement;
    while (parent) {
      if (IGNORED_TAGS.has(parent.tagName)) {
        return true;
      }
      parent = parent.parentElement;
    }

    return false;
  }

  function collectTextNodes(root) {
    const textNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.parentElement) {
          return NodeFilter.FILTER_REJECT;
        }

        if (isIgnoredNode(node)) {
          return NodeFilter.FILTER_REJECT;
        }

        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        if (!isElementVisible(node.parentElement)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node;
    while ((node = walker.nextNode())) {
      textNodes.push({ node, text: node.nodeValue });
    }

    return textNodes;
  }

  function normalizeNodeText(text) {
    const normalized = [];
    const offsetMap = [];
    let lastWasSpace = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (/\s/.test(char)) {
        if (lastWasSpace) {
          continue;
        }
        normalized.push(" ");
        offsetMap.push(i);
        lastWasSpace = true;
        continue;
      }

      normalized.push(char);
      offsetMap.push(i);
      lastWasSpace = false;
    }

    let start = 0;
    let end = normalized.length;
    while (start < end && normalized[start] === " ") {
      start += 1;
    }
    while (end > start && normalized[end - 1] === " ") {
      end -= 1;
    }

    return {
      normalizedText: normalized.slice(start, end).join(""),
      offsetMap: offsetMap.slice(start, end),
    };
  }

  function buildCollapsedText(textNodes) {
    const segments = [];
    let collapsedText = "";
    let currentIndex = 0;

    for (const { node, text } of textNodes) {
      const { normalizedText, offsetMap } = normalizeNodeText(text);
      if (!normalizedText) {
        continue;
      }

      const needsSeparator =
        collapsedText.length > 0 && /\S$/.test(collapsedText) && /^\S/.test(normalizedText);
      if (needsSeparator) {
        collapsedText += " ";
        currentIndex += 1;
      }

      const segmentStart = currentIndex;
      collapsedText += normalizedText;
      currentIndex += normalizedText.length;
      const segmentEnd = currentIndex;

      segments.push({ node, start: segmentStart, end: segmentEnd, text: normalizedText, offsetMap });
    }

    return { collapsedText, segments };
  }

  const CITATION_PATTERN = /\[\s*(?:\d+\s*(?:[-–—]\s*\d+)?|citation needed|note)\s*\]/gi;

  function normalizeWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function cleanSentenceForMatch(value) {
    return normalizeWhitespace(String(value || "").replace(CITATION_PATTERN, ""));
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildNormalizedCollapsed(collapsedText) {
    const normalizedChars = [];
    const indexMap = [];
    let lastWasSpace = false;

    for (let i = 0; i < collapsedText.length; i += 1) {
      const rest = collapsedText.slice(i);
      const citation = rest.match(/^\[\s*(?:\d+\s*(?:[-–—]\s*\d+)?|citation needed|note)\s*\]/i);
      if (citation) {
        i += citation[0].length - 1;
        continue;
      }

      const char = collapsedText[i];
      if (/\s/.test(char)) {
        if (lastWasSpace) {
          continue;
        }
        normalizedChars.push(" ");
        indexMap.push(i);
        lastWasSpace = true;
        continue;
      }

      normalizedChars.push(char.toLowerCase());
      indexMap.push(i);
      lastWasSpace = false;
    }

    let start = 0;
    let end = normalizedChars.length;
    while (start < end && normalizedChars[start] === " ") {
      start += 1;
    }
    while (end > start && normalizedChars[end - 1] === " ") {
      end -= 1;
    }

    return {
      text: normalizedChars.slice(start, end).join(""),
      indexMap: indexMap.slice(start, end),
    };
  }

  function mapNormalizedRange(normStart, normEnd, indexMap, collapsedLength) {
    if (!indexMap.length || normStart >= normEnd) {
      return null;
    }

    const start = indexMap[Math.max(0, Math.min(normStart, indexMap.length - 1))];
    const endAnchor = indexMap[Math.max(0, Math.min(normEnd - 1, indexMap.length - 1))];
    const end = Math.min(collapsedLength, endAnchor + 1);

    if (end <= start) {
      return null;
    }

    return { start, end };
  }

  /**
   * Find sentence bounds in collapsedText coordinates (same space as segment mapping).
   */
  function findSentencePosition(sentence, collapsedText) {
    const trimmed = normalizeWhitespace(sentence);
    const cleaned = cleanSentenceForMatch(sentence);

    if ((!trimmed && !cleaned) || !collapsedText) {
      return null;
    }

    for (const needle of [trimmed, cleaned]) {
      if (!needle) {
        continue;
      }

      const directIndex = collapsedText.indexOf(needle);
      if (directIndex !== -1) {
        return { start: directIndex, end: directIndex + needle.length, method: "direct" };
      }

      const flexiblePattern = escapeRegExp(needle).replace(/\s+/g, "\\s+");
      const match = collapsedText.match(new RegExp(flexiblePattern, "i"));
      if (match && typeof match.index === "number") {
        return {
          start: match.index,
          end: match.index + match[0].length,
          method: "flexible",
        };
      }
    }

    const { text: normCollapsed, indexMap } = buildNormalizedCollapsed(collapsedText);
    for (const needle of [cleanSentenceForMatch(trimmed), cleanSentenceForMatch(cleaned)]) {
      if (!needle || needle.length < 20) {
        continue;
      }

      const normNeedle = needle.toLowerCase();
      const normIndex = normCollapsed.indexOf(normNeedle);
      if (normIndex !== -1) {
        const mapped = mapNormalizedRange(
          normIndex,
          normIndex + normNeedle.length,
          indexMap,
          collapsedText.length,
        );
        if (mapped) {
          return { ...mapped, method: "normalized" };
        }
      }

      const prefix = normNeedle.slice(0, Math.min(80, normNeedle.length));
      if (prefix.length >= 24) {
        const prefixIndex = normCollapsed.indexOf(prefix);
        if (prefixIndex !== -1) {
          const mapped = mapNormalizedRange(
            prefixIndex,
            Math.min(normCollapsed.length, prefixIndex + normNeedle.length),
            indexMap,
            collapsedText.length,
          );
          if (mapped) {
            return { ...mapped, method: "normalized-prefix" };
          }
        }
      }
    }

    return null;
  }

  function buildRangesFromSentenceIds(highlightIds, sentenceIndex, segments) {
    const ranges = [];

    for (const id of highlightIds) {
      const entry = sentenceIndex.byId.get(id);
      if (!entry) {
        console.warn("[Highlights] Unknown sentence id:", id);
        continue;
      }

      ranges.push({
        start: entry.start,
        end: entry.end,
        segments,
        sentence: entry.cleaned || entry.text,
        sentenceId: id,
        matchMethod: "sentence-id",
      });
    }

    return ranges;
  }

  function buildRangesFromTexts(highlightTexts, collapsedText, segments) {
    const ranges = [];

    for (const sentence of highlightTexts) {
      const match = findSentencePosition(sentence, collapsedText);
      console.log("[Highlights] match attempt", {
        sentence: sentence.slice(0, 100),
        found: Boolean(match),
        method: match?.method,
        start: match?.start,
        end: match?.end,
      });

      ranges.push({
        start: match?.start ?? null,
        end: match?.end ?? null,
        segments,
        sentence,
        matchMethod: match?.method ?? "none",
      });
    }

    return ranges;
  }

  function mapPositionToNode(position, segments, preferEnd) {
    if (segments.length === 0) {
      return null;
    }

    if (position <= segments[0].start) {
      return { node: segments[0].node, offset: 0 };
    }

    const lastSegment = segments[segments.length - 1];
    if (position >= lastSegment.end) {
      return {
        node: lastSegment.node,
        offset: lastSegment.node.nodeValue.length,
      };
    }

    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;
      const inSegment =
        position > segment.start && position < segment.end
          || (position === segment.start)
          || (position === segment.end && (preferEnd || isLast));

      if (!inSegment) {
        if (i + 1 < segments.length && position > segment.end && position < segments[i + 1].start) {
          return { node: segments[i + 1].node, offset: 0 };
        }
        continue;
      }

      const relative = Math.max(0, Math.min(position - segment.start, segment.offsetMap.length));
      if (relative >= segment.offsetMap.length) {
        return {
          node: segment.node,
          offset: segment.node.nodeValue.length,
        };
      }

      return { node: segment.node, offset: segment.offsetMap[relative] };
    }

    return {
      node: lastSegment.node,
      offset: lastSegment.node.nodeValue.length,
    };
  }

  function createDomRange(startPosition, endPosition, segments) {
    const startPoint = mapPositionToNode(startPosition, segments, false);
    const endPoint = mapPositionToNode(endPosition, segments, true);
    if (!startPoint || !endPoint) {
      return null;
    }

    const range = document.createRange();
    try {
      range.setStart(startPoint.node, startPoint.offset);
      range.setEnd(endPoint.node, endPoint.offset);
      if (range.collapsed) {
        return null;
      }
      return range;
    } catch {
      return null;
    }
  }

  function supportsCssCustomHighlight() {
    return typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";
  }

  function injectHighlightStyles() {
    if (document.getElementById("highlights-page-styles")) {
      return;
    }

    const link = document.createElement("link");
    link.id = "highlights-page-styles";
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("styles/highlights.css");
    document.head.appendChild(link);
  }

  function applyCssHighlightRanges(domRanges) {
    if (!supportsCssCustomHighlight() || domRanges.length === 0) {
      return 0;
    }

    try {
      injectHighlightStyles();
      const highlight = new Highlight();
      for (const range of domRanges) {
        highlight.add(range);
      }
      CSS.highlights.set(HIGHLIGHT_REGISTRY_KEY, highlight);
      return domRanges.length;
    } catch {
      return 0;
    }
  }

  function wrapTextNodePortion(textNode, startOffset, endOffset) {
    if (startOffset >= endOffset) {
      return null;
    }

    let target = textNode;
    const length = target.nodeValue.length;

    if (startOffset > 0) {
      target = target.splitText(startOffset);
    }

    const highlightLength = Math.min(endOffset - startOffset, target.nodeValue.length);
    if (highlightLength < target.nodeValue.length) {
      target.splitText(highlightLength);
    }

    const mark = document.createElement("mark");
    mark.className = "highlights-mark";
    target.parentNode.insertBefore(mark, target);
    mark.appendChild(target);
    return mark;
  }

  function applyMarkHighlights(domRanges) {
    injectHighlightStyles();
    let markCount = 0;

    const sortedRanges = domRanges.slice().sort((a, b) => {
      const pos = a.compareBoundaryPoints(Range.START_TO_END, b);
      return pos > 0 ? -1 : 1;
    });

    for (const range of sortedRanges) {
      if (
        range.startContainer === range.endContainer
        && range.startContainer.nodeType === Node.TEXT_NODE
      ) {
        if (wrapTextNodePortion(range.startContainer, range.startOffset, range.endOffset)) {
          markCount += 1;
        }
        continue;
      }
      const iterator = document.createNodeIterator(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          try {
            const subrange = range.cloneRange();
            if (!subrange.intersectsNode(node)) {
              return NodeFilter.FILTER_REJECT;
            }
          } catch {
            return NodeFilter.FILTER_REJECT;
          }
          if (isIgnoredNode(node)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const textNodes = [];
      let currentNode;
      while ((currentNode = iterator.nextNode())) {
        textNodes.push(currentNode);
      }

      for (const textNode of textNodes) {
        if (!textNode.parentNode || textNode.parentElement?.closest("mark.highlights-mark")) {
          continue;
        }

        const nodeRange = document.createRange();
        nodeRange.selectNodeContents(textNode);

        let startOffset = 0;
        let endOffset = textNode.nodeValue.length;

        if (range.compareBoundaryPoints(Range.START_TO_START, nodeRange) > 0) {
          startOffset = range.startContainer === textNode ? range.startOffset : textNode.nodeValue.length;
        }

        if (range.compareBoundaryPoints(Range.END_TO_END, nodeRange) < 0) {
          endOffset = range.endContainer === textNode ? range.endOffset : 0;
        }

        if (wrapTextNodePortion(textNode, startOffset, endOffset)) {
          markCount += 1;
        }
      }
    }

    return markCount;
  }

  function findBlockAncestor(node, root) {
    let element = node instanceof Element ? node : node.parentElement;
    while (element && element !== root) {
      if (element.matches(BLOCK_SELECTORS)) {
        return element;
      }
      if (element.tagName === "DIV" && element.innerText.trim().split(/\s+/).length >= 8) {
        return element;
      }
      element = element.parentElement;
    }
    return null;
  }

  function applyParagraphHighlights(domRanges, root) {
    injectHighlightStyles();
    const blocks = new Set();

    for (const range of domRanges) {
      const node =
        range.startContainer.nodeType === Node.TEXT_NODE
          ? range.startContainer
          : range.startContainer.childNodes[range.startOffset] || range.startContainer;
      const block = findBlockAncestor(node, root);
      if (block) {
        blocks.add(block);
      }
    }

    for (const block of blocks) {
      block.classList.add("highlights-paragraph");
    }

    return blocks;
  }

  function findParagraphForSentence(sentence, root) {
    const needle = cleanSentenceForMatch(sentence);
    if (!needle) {
      return null;
    }

    const candidates = root.querySelectorAll(BLOCK_SELECTORS);
    for (const block of candidates) {
      const blockText = cleanSentenceForMatch(block.innerText || "");
      if (blockText.includes(needle)) {
        return block;
      }

      const prefix = needle.slice(0, Math.min(64, needle.length));
      if (prefix.length >= 20 && blockText.includes(prefix)) {
        return block;
      }
    }

    return null;
  }

  function clearMarginGuides() {
    document.querySelectorAll(".highlights-margin-guide").forEach((el) => el.remove());
  }

  function applyMarginGuides(blocks) {
    clearMarginGuides();
    for (const block of blocks) {
      if (!(block instanceof HTMLElement)) {
        continue;
      }
      const rect = block.getBoundingClientRect();
      if (rect.height < 8) {
        continue;
      }

      const guide = document.createElement("div");
      guide.className = "highlights-margin-guide";
      guide.style.top = `${rect.top + window.scrollY}px`;
      guide.style.left = `${Math.max(4, rect.left + window.scrollX - 10)}px`;
      guide.style.height = `${rect.height}px`;
      document.body.appendChild(guide);
    }
  }

  function clearPreviousHighlights() {
    if (supportsCssCustomHighlight()) {
      CSS.highlights.delete(HIGHLIGHT_REGISTRY_KEY);
    }

    document.querySelectorAll("span.ai-highlight, span.highlights-phrase").forEach((span) => {
      const parent = span.parentNode;
      if (!parent) {
        return;
      }
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
      parent.normalize();
    });

    document.querySelectorAll("mark.highlights-mark").forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) {
        return;
      }
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    });

    document.querySelectorAll(".highlights-paragraph").forEach((el) => {
      el.classList.remove("highlights-paragraph", "highlights-paragraph-active");
    });

    clearMarginGuides();
  }

  /**
   * Hybrid highlight pipeline:
   * 1. CSS Custom Highlight API (no DOM mutation)
   * 2. <mark> per text node if API unavailable or zero visible effect
   * 3. Paragraph-level fallback for unmatched or failed ranges
   */
  function applyHighlights(highlightRanges, root) {
    const domRanges = [];
    const unmatchedSentences = [];

    for (const { start, end, segments, sentence } of highlightRanges) {
      if (start == null || end == null) {
        if (sentence) {
          unmatchedSentences.push(sentence);
        }
        continue;
      }

      const range = createDomRange(start, end, segments);
      if (range) {
        domRanges.push(range);
      } else if (sentence) {
        unmatchedSentences.push(sentence);
      }
    }

    let appliedCount = 0;
    let method = "none";
    const paragraphBlocks = new Set();

    if (domRanges.length > 0) {
      if (supportsCssCustomHighlight()) {
        appliedCount = applyCssHighlightRanges(domRanges);
        method = "css-highlight";
      } else {
        appliedCount = applyMarkHighlights(domRanges);
        method = "mark";
      }

      if (appliedCount === 0) {
        applyParagraphHighlights(domRanges, root).forEach((block) => paragraphBlocks.add(block));
        appliedCount = paragraphBlocks.size;
        method = "paragraph-fallback";
      }
    }

    for (const sentence of unmatchedSentences) {
      const block = findParagraphForSentence(sentence, root);
      if (block) {
        block.classList.add("highlights-paragraph");
        paragraphBlocks.add(block);
      }
    }

    if (paragraphBlocks.size > 0) {
      injectHighlightStyles();
      appliedCount = Math.max(appliedCount, paragraphBlocks.size);
      if (method === "none") {
        method = "paragraph";
      } else if (!method.includes("paragraph")) {
        method = `${method}+paragraph`;
      }
      applyMarginGuides(paragraphBlocks);
    }

    return {
      appliedCount,
      domRangeCount: domRanges.length,
      paragraphCount: paragraphBlocks.size,
      method,
      unmatchedSentences: unmatchedSentences.filter(
        (sentence) => !findParagraphForSentence(sentence, root),
      ),
    };
  }

  function scrollToPosition(position, segments) {
    const point = mapPositionToNode(position, segments, false);
    if (!point) {
      return false;
    }

    const element = point.node.parentElement;
    if (!element) {
      return false;
    }

    const block = findBlockAncestor(point.node, document.body) || element;
    block.classList.add("highlights-paragraph-active");
    block.scrollIntoView({ behavior: "smooth", block: "center" });

    window.setTimeout(() => {
      block.classList.remove("highlights-paragraph-active");
    }, 2400);

    return true;
  }

  function tryFindOnPage(query) {
    if (!query || typeof window.find !== "function") {
      return false;
    }

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }

    return window.find(query, false, false, true, false, true, false);
  }

  function isPdfViewer() {
    const pdfUrl = /\.pdf($|\?|#)/i.test(window.location.href);
    const pdfEmbed = document.querySelector("embed[type='application/pdf'], object[type='application/pdf']");
    const contentTypePdf = document.contentType === "application/pdf";
    return pdfUrl || pdfEmbed || contentTypePdf;
  }

  function buildPageIndex(root) {
    const textNodes = collectTextNodes(root);
    return buildCollapsedText(textNodes);
  }

  function getHighlightDiagnostics() {
    const cssSupported = supportsCssCustomHighlight();
    const markCount = document.querySelectorAll("mark.highlights-mark").length;
    const paragraphCount = document.querySelectorAll(".highlights-paragraph").length;
    let cssHighlightCount = 0;

    if (cssSupported && CSS.highlights.has(HIGHLIGHT_REGISTRY_KEY)) {
      const registry = CSS.highlights.get(HIGHLIGHT_REGISTRY_KEY);
      cssHighlightCount = registry ? registry.size : 0;
    }

    return {
      cssSupported,
      cssHighlightCount,
      markCount,
      paragraphCount,
      legacyAiHighlightCount: document.querySelectorAll("span.ai-highlight").length,
    };
  }

  window.HighlightsHelper = {
    collectTextNodes,
    buildCollapsedText,
    buildPageIndex,
    findSentencePosition,
    buildRangesFromSentenceIds,
    buildRangesFromTexts,
    mapPositionToNode,
    createDomRange,
    applyHighlights,
    clearPreviousHighlights,
    scrollToPosition,
    tryFindOnPage,
    isPdfViewer,
    findBlockAncestor,
    findParagraphForSentence,
    getHighlightDiagnostics,
    cleanSentenceForMatch,
  };
})();
