/* ────────────────────────────────────────────────────────
 *  Highlights PDF Viewer — viewer.js
 *  Controls query param resolution, rendering pipeline,
 *  and right-side AI Analysis Panel integration.
 * ──────────────────────────────────────────────────────── */

(function () {
  console.log("PDF Viewer Loaded");

  // ── CONSTANTS ───────────────────────────────────────────
  const BACKEND_ANALYSIS_URL = "http://127.0.0.1:8000/analyze-pdf-url";

  // ── DOM References ──────────────────────────────────────
  const pdfNameEl = document.getElementById("pdf-name");
  const pdfContainer = document.getElementById("pdf-container");
  const currentPageEl = document.getElementById("current-page");
  const totalPagesEl = document.getElementById("total-pages");
  const downloadBtn = document.getElementById("btn-download");
  const debugBtn = document.getElementById("btn-debug");
  const statusCard = document.getElementById("status-card");
  const statusTitle = document.getElementById("status-title");
  const statusDesc = document.getElementById("status-desc");
  const pdfUrlDisplay = document.getElementById("pdf-url-display");

  // AI Panel Elements
  const panelLoading = document.getElementById("panel-loading");
  const panelError = document.getElementById("panel-error");
  const panelErrorDesc = document.getElementById("panel-error-desc");
  const panelContent = document.getElementById("panel-content");
  const panelDocTitle = document.getElementById("panel-doc-title");
  const panelDocMeta = document.getElementById("panel-doc-meta");
  const metricOriginal = document.getElementById("metric-original");
  const metricHighlighted = document.getElementById("metric-highlighted");
  const metricSaved = document.getElementById("metric-saved");
  const metricCoverage = document.getElementById("metric-coverage");
  const metricConfidence = document.getElementById("metric-confidence");
  const panelSummaryContent = document.getElementById("panel-summary-content");
  const panelHighlightsList = document.getElementById("panel-highlights-list");
  const btnRetryAnalysis = document.getElementById("btn-retry-analysis");

  // ── State ───────────────────────────────────────────────
  let pdfUrl = "";
  let isDebugMode = false;
  let totalWordCount = 0;
  let analysisHighlights = null;
  let isPdfRendered = false;

  // ── Initialize ──────────────────────────────────────────
  function init() {
    // 1. Resolve source URL from query params
    const params = new URLSearchParams(window.location.search);
    pdfUrl = params.get("src");

    if (!pdfUrl) {
      showError("Missing PDF Source", "Please provide a valid PDF source URL using the 'src' parameter.");
      showPanelError("Missing PDF Source", "Provide a source URL with '?src=...' in the address bar.");
      return;
    }

    console.log("[Highlights] Resolved PDF URL:", pdfUrl);
    pdfUrlDisplay.textContent = pdfUrl;

    // Extract file name for display
    let filename = "document.pdf";
    try {
      const decodedUrl = decodeURIComponent(pdfUrl);
      const urlObj = new URL(decodedUrl);
      filename = urlObj.pathname.split("/").pop() || "document.pdf";
      pdfNameEl.textContent = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
    } catch {
      pdfNameEl.textContent = "document.pdf";
    }
    panelDocTitle.textContent = pdfNameEl.textContent;

    // Enable download link if URL is standard
    if (pdfUrl.startsWith("http")) {
      downloadBtn.disabled = false;
      downloadBtn.onclick = () => window.open(pdfUrl, "_blank");
    }

    // 2. Setup Debug Mode Toggle
    setupDebugMode();

    // 3. Setup Retry Button for Analysis Panel
    if (btnRetryAnalysis) {
      btnRetryAnalysis.addEventListener("click", () => {
        runAIAnalysis(pdfUrl);
      });
    }

    // 4. Render PDF in parallel
    loadAndRenderPDF();

    // 5. Run AI Analysis
    runAIAnalysis(pdfUrl);
  }

  // ── Error Helper (Left PDF View) ────────────────────────
  function showError(title, message) {
    statusCard.classList.add("error");
    statusTitle.textContent = title;
    statusDesc.textContent = message;
    
    // Hide spinner
    const spinner = statusCard.querySelector(".spinner-container");
    if (spinner) spinner.style.display = "none";
    
    // Disable toolbar actions
    downloadBtn.disabled = true;
    if (debugBtn) debugBtn.disabled = true;
  }

  // ── Debug Mode Setup ────────────────────────────────────
  function setupDebugMode() {
    if (!debugBtn) return;
    
    debugBtn.disabled = false;
    debugBtn.addEventListener("click", () => {
      isDebugMode = !isDebugMode;
      debugBtn.classList.toggle("active", isDebugMode);
      
      const textLayers = document.querySelectorAll(".text-layer");
      textLayers.forEach(layer => {
        layer.classList.toggle("debug-mode", isDebugMode);
      });
      
      console.log(`[Highlights] Debug Mode ${isDebugMode ? "Enabled" : "Disabled"}`);
    });
  }

  // ── PDF Loading Entrypoint ──────────────────────────────
  async function loadAndRenderPDF() {
    if (typeof pdfjsLib !== "undefined") {
      try {
        await renderWithPdfJs();
      } catch (err) {
        console.error("PDF.js rendering failed:", err);
        showError("PDF rendering failed", `Error loading PDF via PDF.js: ${err.message}`);
      }
    } else {
      console.warn("PDF.js (pdfjsLib) not loaded in this environment. Falling back to high-fidelity mock pages.");
      renderMockPDF();
    }
  }

  // ── PDF.js Actual Rendering ─────────────────────────────
  async function renderWithPdfJs() {
    statusTitle.textContent = "Fetching PDF document...";
    
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
    }

    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    const pdf = await loadingTask.promise;
    
    // Update toolbar page count
    totalPagesEl.textContent = pdf.numPages;
    currentPageEl.textContent = "1";
    
    // Hide loading card
    statusCard.style.display = "none";
    
    // Render first 10 pages for view
    const pagesToRender = Math.min(pdf.numPages, 10);
    for (let pageNum = 1; pageNum <= pagesToRender; pageNum++) {
      await renderPage(pdf, pageNum);
    }

    isPdfRendered = true;
    tryApplyHighlights();
  }

  async function renderPage(pdf, pageNum) {
    const page = await pdf.getPage(pageNum);
    const scale = 1.5;
    const viewport = page.getViewport({ scale });

    // Create wrapper page-container
    const pageContainer = document.createElement("div");
    pageContainer.className = "page-container";
    pageContainer.id = `page-${pageNum}`;
    pageContainer.style.width = `${viewport.width}px`;
    pageContainer.style.height = `${viewport.height}px`;

    // 1. Canvas Layer
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    pageContainer.appendChild(canvas);

    const canvasContext = canvas.getContext("2d");
    const renderContext = {
      canvasContext,
      viewport
    };
    await page.render(renderContext).promise;

    // 2. Text Layer Overlay
    const textLayer = document.createElement("div");
    textLayer.className = "text-layer";
    if (isDebugMode) textLayer.classList.add("debug-mode");
    pageContainer.appendChild(textLayer);

    const textContent = await page.getTextContent();
    
    // Iterate over items and append positioned spans
    textContent.items.forEach(item => {
      const span = document.createElement("span");
      span.textContent = item.str;

      // Extract transform matrix and map it to viewport coordinates
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
      
      span.style.fontFamily = item.fontName || "sans-serif";
      span.style.fontSize = `${fontHeight}px`;
      span.style.transform = `matrix(${tx[0]}, ${tx[1]}, ${tx[2]}, ${tx[3]}, ${tx[4]}, ${tx[5] - fontHeight})`;
      
      textLayer.appendChild(span);
    });

    pdfContainer.appendChild(pageContainer);
  }

  // ── High-Fidelity Mock PDF Rendering ────────────────────
  function renderMockPDF() {
    totalPagesEl.textContent = "3";
    currentPageEl.textContent = "1";
    statusCard.style.display = "none";

    const mockPages = [
      {
        pageNum: 1,
        title: "Introduction to Agentic Intelligence Systems",
        paragraphs: [
          "Large language models (LLMs) have evolved from static prediction engines into proactive, autonomous agents. By utilizing tools, environments, and multi-agent systems, agents are capable of solving complex software engineering tasks.",
          "In this paper, we explore the design of Antigravity, a highly specialized coder assistant designed by Google DeepMind. Antigravity employs advanced reasoning loops, recursive tool refinement, and localized repository context (KIs) to address complex tasks.",
          "A fundamental component of agentic workflows is the integration of visual and textual overlays, such as custom PDF document parsers and highlights overlays that allow rapid scanning and validation of generated knowledge bases."
        ]
      },
      {
        pageNum: 2,
        title: "Methodology and Multi-Agent Orchestration",
        paragraphs: [
          "Our system architecture consists of a primary controller agent operating alongside specialized sandboxed browser subagents and terminal executables.",
          "The interaction model utilizes asynchronous scheduling to bypass long-running compile loops, allowing the master agent to run verification packages in parallel.",
          "Results indicate a 43% reduction in time-to-delivery when using localized knowledge items (KIs) to seed initial repository constraints and code conventions."
        ]
      },
      {
        pageNum: 3,
        title: "Experimental Evaluation and Results",
        paragraphs: [
          "We evaluated the helper on 150 legacy codebases requiring complex API migrations. Table 1 outlines our comparative analysis showing robust accuracy.",
          "Future work will focus on integrating custom PDF highlights overlays that directly project the model's high-scoring spans onto client-side viewport render layers."
        ]
      }
    ];

    mockPages.forEach(pageData => {
      const width = 800;
      const height = 1100;

      const pageContainer = document.createElement("div");
      pageContainer.className = "page-container";
      pageContainer.id = `page-${pageData.pageNum}`;
      pageContainer.style.width = `${width}px`;
      pageContainer.style.height = `${height}px`;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      pageContainer.appendChild(canvas);

      const ctx = canvas.getContext("2d");
      
      // Draw background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 2;
      ctx.strokeRect(10, 10, width - 20, height - 20);

      ctx.fillStyle = "#111827";
      ctx.font = "bold 24px sans-serif";
      ctx.fillText(pageData.title, 60, 80);

      ctx.fillStyle = "#4b5563";
      ctx.font = "italic 12px sans-serif";
      ctx.fillText(`Section ${pageData.pageNum} | Highlights System Documentation`, 60, 110);
      
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(60, 125);
      ctx.lineTo(width - 60, 125);
      ctx.stroke();

      ctx.fillStyle = "#374151";
      ctx.font = "14px sans-serif";
      
      let yOffset = 160;
      pageData.paragraphs.forEach(pText => {
        const lines = wrapText(ctx, pText, width - 120);
        lines.forEach(line => {
          ctx.fillText(line, 60, yOffset);
          yOffset += 24;
        });
        yOffset += 16;
      });

      // Text Layer
      const textLayer = document.createElement("div");
      textLayer.className = "text-layer";
      if (isDebugMode) textLayer.classList.add("debug-mode");
      pageContainer.appendChild(textLayer);

      let domYOffset = 160;
      
      const titleSpan = document.createElement("span");
      titleSpan.textContent = pageData.title;
      titleSpan.style.fontFamily = "sans-serif";
      titleSpan.style.fontWeight = "bold";
      titleSpan.style.fontSize = "24px";
      titleSpan.style.transform = `matrix(1, 0, 0, 1, 60, ${80 - 24})`;
      textLayer.appendChild(titleSpan);

      const subSpan = document.createElement("span");
      subSpan.textContent = `Section ${pageData.pageNum} | Highlights System Documentation`;
      subSpan.style.fontSize = "12px";
      subSpan.style.fontStyle = "italic";
      subSpan.style.transform = `matrix(1, 0, 0, 1, 60, ${110 - 12})`;
      textLayer.appendChild(subSpan);

      pageData.paragraphs.forEach(pText => {
        const lines = wrapText(ctx, pText, width - 120);
        lines.forEach(line => {
          const span = document.createElement("span");
          span.textContent = line;
          span.style.fontSize = "14px";
          span.style.transform = `matrix(1, 0, 0, 1, 60, ${domYOffset - 14})`;
          textLayer.appendChild(span);
          domYOffset += 24;
        });
        domYOffset += 16;
      });

      pdfContainer.appendChild(pageContainer);
    });

    window.addEventListener("scroll", updateCurrentPageDisplay);

    isPdfRendered = true;
    tryApplyHighlights();
  }

  function wrapText(ctx, text, maxWidth) {
    const words = text.split(" ");
    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = ctx.measureText(currentLine + " " + word).width;
      if (width < maxWidth) {
        currentLine += " " + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);
    return lines;
  }

  function updateCurrentPageDisplay() {
    const pages = document.querySelectorAll(".page-container");
    const scrollPos = window.scrollY + window.innerHeight / 2;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const offsetTop = page.offsetTop;
      const offsetHeight = page.offsetHeight;

      if (scrollPos >= offsetTop && scrollPos < offsetTop + offsetHeight) {
        currentPageEl.textContent = i + 1;
        break;
      }
    }
  }

  // ── AI Analysis Panel Integration ───────────────────────

  async function runAIAnalysis(url) {
    console.log("[Highlights PDF] Starting analysis");
    showPanelLoading();

    try {
      const response = await fetch(BACKEND_ANALYSIS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: url }),
      });

      if (!response.ok) {
        throw new Error(`HTTP Error status: ${response.status}`);
      }

      const result = await response.json();
      console.log("[Highlights PDF] Analysis complete", result);
      
      renderPanelContent(result);
    } catch (err) {
      console.error("[Highlights PDF] Analysis failed:", err);
      showPanelError("Analysis Failed", `Error calling backend highlighting API: ${err.message || err}`);
    }
  }

  function showPanelLoading() {
    panelLoading.classList.remove("hidden");
    panelError.classList.add("hidden");
    panelContent.classList.add("hidden");
  }

  function showPanelError(title, desc) {
    panelLoading.classList.add("hidden");
    panelError.classList.remove("hidden");
    panelContent.classList.add("hidden");

    const errorTitle = panelError.querySelector("h3");
    if (errorTitle) errorTitle.textContent = title;
    if (panelErrorDesc) panelErrorDesc.textContent = desc;
    
    console.log("[Highlights PDF] Analysis failed");
  }

  function renderPanelContent(data) {
    panelLoading.classList.add("hidden");
    panelError.classList.add("hidden");
    panelContent.classList.remove("hidden");

    // 1. Update Title and Metadata
    if (data.file_name) {
      panelDocTitle.textContent = data.file_name;
    }
    const pageDisplayVal = data.page_count || "--";
    const wordDisplayVal = data.word_count ? data.word_count.toLocaleString() : "--";
    panelDocMeta.textContent = `${pageDisplayVal} pages • ${wordDisplayVal} words`;
    
    totalWordCount = data.word_count || 0;

    // 2. Render Metrics
    renderMetrics(data.metrics, data.word_count);

    // 3. Render Summary
    renderSummary(data.summary);

    // 4. Render Highlights
    renderHighlightsList(data.highlights);

    // 5. Store for Text-Layer Application
    analysisHighlights = data.highlights;
    tryApplyHighlights();
  }

  function tryApplyHighlights() {
    if (!analysisHighlights || !isPdfRendered || typeof window.HighlightsHelper === "undefined") {
      return;
    }
    
    console.log("[Highlights PDF] Both PDF and Analysis loaded. Applying highlights...");
    
    // Clear any previous highlights first
    window.HighlightsHelper.clearPreviousHighlights();

    // Extract sentences from highlight data
    const sentencesToHighlight = analysisHighlights.map(item => {
      if (typeof item === "string") return item;
      return item && typeof item === "object" ? item.text : "";
    }).filter(text => text && text.trim().length > 0);

    if (sentencesToHighlight.length === 0) return;

    // Build index scoped to the pdfContainer and apply highlights
    const pageIndex = window.HighlightsHelper.buildPageIndex(pdfContainer);
    const ranges = window.HighlightsHelper.buildRangesFromTexts(sentencesToHighlight, pageIndex.collapsedText, pageIndex.segments);
    const results = window.HighlightsHelper.applyHighlights(ranges, pdfContainer);
    
    console.log(`[Highlights PDF] Applied highlights:`, results);
  }

  function renderMetrics(metrics, wordCount) {
    // Falls back to computing word-count times if backend variables are missing
    const fallbackOriginal = Math.max(1, Math.ceil((wordCount || 3000) / 225));
    const fallbackHighlight = Math.max(1, Math.ceil(fallbackOriginal * 0.35));
    const fallbackSaved = Math.round((1 - fallbackHighlight / fallbackOriginal) * 100);

    const metricsData = metrics || {};

    // original_read_time
    const origTime = metricsData.original_read_time || fallbackOriginal;
    metricOriginal.textContent = `${origTime} min`;

    // highlights_read_time
    const hlTime = metricsData.highlights_read_time || fallbackHighlight;
    metricHighlighted.textContent = `${hlTime} min`;

    // time_saved
    let savedVal = metricsData.time_saved !== undefined ? metricsData.time_saved : fallbackSaved;
    if (savedVal > 0 && savedVal <= 1) {
      savedVal = Math.round(savedVal * 100);
    }
    metricSaved.textContent = `${savedVal}%`;

    // coverage_score
    let coverageVal = metricsData.coverage_score !== undefined ? metricsData.coverage_score : "--";
    if (coverageVal > 0 && coverageVal <= 1) {
      coverageVal = Math.round(coverageVal * 100);
    }
    metricCoverage.textContent = coverageVal !== "--" ? `${coverageVal}%` : "--";

    // confidence
    let confidenceVal = metricsData.confidence !== undefined ? metricsData.confidence : "--";
    if (confidenceVal > 0 && confidenceVal <= 1) {
      confidenceVal = Math.round(confidenceVal * 100);
    }
    metricConfidence.textContent = confidenceVal !== "--" ? `${confidenceVal}%` : "--";
  }

  function renderSummary(summary) {
    panelSummaryContent.innerHTML = "";
    if (!summary) {
      panelSummaryContent.textContent = "No summary available for this document.";
      return;
    }

    const lines = summary.split("\n");
    let hasBullets = false;
    let listContainer = null;

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const isBullet = trimmed.startsWith("-") || trimmed.startsWith("*") || trimmed.startsWith("•");

      if (isBullet) {
        if (!hasBullets) {
          listContainer = document.createElement("ul");
          panelSummaryContent.appendChild(listContainer);
          hasBullets = true;
        }
        const bulletItem = document.createElement("li");
        // Strip the bullet marker
        const textContentStr = trimmed.replace(/^[-*•]\s*/, "");
        bulletItem.textContent = textContentStr;
        listContainer.appendChild(bulletItem);
      } else {
        if (hasBullets) {
          hasBullets = false;
          listContainer = null;
        }
        const para = document.createElement("p");
        para.textContent = trimmed;
        panelSummaryContent.appendChild(para);
      }
    });
  }

  function renderHighlightsList(highlights) {
    panelHighlightsList.innerHTML = "";
    if (!highlights || !Array.isArray(highlights) || highlights.length === 0) {
      panelHighlightsList.textContent = "No highlight cards generated.";
      return;
    }

    // Normalize format to support raw strings and objects
    const normalized = highlights.map((item, idx) => {
      if (typeof item === "string") {
        return { text: item, score: null, id: idx };
      } else if (item && typeof item === "object") {
        return {
          text: item.text || "",
          score: typeof item.score === "number" ? item.score : null,
          id: item.id !== undefined ? item.id : idx
        };
      }
      return null;
    }).filter(item => item && item.text);

    normalized.forEach(item => {
      const card = document.createElement("div");
      card.className = "highlight-card";

      const textEl = document.createElement("div");
      textEl.className = "highlight-text";
      textEl.textContent = item.text;
      card.appendChild(textEl);

      if (item.score !== null) {
        const footer = document.createElement("div");
        footer.className = "highlight-footer";

        const badge = document.createElement("span");
        const rawScore = item.score;
        // If score is a percentage represented as a value between 0 and 1
        const scorePercent = Math.round(rawScore <= 1 ? rawScore * 100 : rawScore);
        const scoreDisplayVal = rawScore <= 1 ? rawScore.toFixed(2) : (rawScore / 100).toFixed(2);

        badge.className = `score-badge ${scorePercent >= 75 ? "high" : "medium"}`;
        
        // Render check-mark svg alongside score
        badge.innerHTML = `
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-right: 2px;"><path d="M20 6L9 17l-5-5"/></svg>
          <span>Score: ${scoreDisplayVal} (${scorePercent}%)</span>
        `;
        
        footer.appendChild(badge);
        card.appendChild(footer);
      }

      panelHighlightsList.appendChild(card);
    });
  }

  // Start initialization on DOM load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
