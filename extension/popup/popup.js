/* ────────────────────────────────────────────────────────
 *  Highlights — popup.js
 *  Handles webpage analysis, PDF upload, and PDF URL flows.
 * ──────────────────────────────────────────────────────── */

const BACKEND_PDF_URL = "http://127.0.0.1:8000/analyze-pdf";
const BACKEND_PDF_URL_URL = "http://127.0.0.1:8000/analyze-pdf-url";

// ── DOM references ──────────────────────────────────────

const analyzeButton = document.getElementById("analyze");
const analyzePdfButton = document.getElementById("analyze-pdf");
const pdfFileInput = document.getElementById("pdf-file");
const pdfFileNameLabel = document.getElementById("pdf-file-name");
const pdfPickerLabel = document.getElementById("pdf-picker-label");
const statusNode = document.getElementById("status");

const tabWebpage = document.getElementById("tab-webpage");
const tabPdf = document.getElementById("tab-pdf");
const panelWebpage = document.getElementById("panel-webpage");
const panelPdf = document.getElementById("panel-pdf");

// ── Helpers ─────────────────────────────────────────────

function setStatus(message) {
  statusNode.textContent = message;
}

/**
 * Returns true when the URL looks like a PDF resource.
 * Matches explicit .pdf extension, Chrome's built-in PDF viewer URL pattern,
 * and arXiv PDF routes.
 */
function isPdfUrl(url) {
  if (!url) return false;
  // Direct .pdf link (with optional query / hash)
  if (/\.pdf($|\?|#)/i.test(url)) return true;
  // Common PDF paths
  if (/\/pdf\//i.test(url)) return true;
  // Chrome internal PDF viewer wraps the real URL
  if (/^chrome-extension:\/\/[a-z]+\/.*viewer\.html\?.*file=/i.test(url)) return true;
  if (/^chrome-extension:\/\/[a-z]+\/.*index\.html\?.*src=/i.test(url)) return true;
  return false;
}

/**
 * Resolves the true PDF URL from Chrome's internal PDF viewer wrapper URL.
 */
function resolvePdfUrl(url) {
  try {
    const parsed = new URL(url);

    if (
      parsed.protocol === "chrome-extension:" &&
      parsed.searchParams.has("src")
    ) {
      return decodeURIComponent(parsed.searchParams.get("src"));
    }
    
    if (
      parsed.protocol === "chrome-extension:" &&
      parsed.searchParams.has("file")
    ) {
      return decodeURIComponent(parsed.searchParams.get("file"));
    }

    return url;
  } catch (error) {
    return url;
  }
}

function describeScriptingError(error, tabUrl) {
  const message = String(error?.message || error);

  if (message.includes("Cannot access") || message.includes("extensions gallery")) {
    if (/^(chrome|edge|brave|vivaldi):\/\//i.test(tabUrl || "")) {
      return "Browser pages (chrome://, etc.) cannot be analyzed. Open a normal website tab.";
    }
    if ((tabUrl || "").startsWith("chrome-extension://")) {
      return "Extension pages cannot be analyzed. Open a normal website tab.";
    }
    return "This page cannot be analyzed. Try a regular http(s) article and click the extension icon first.";
  }

  if (message.includes("files") && message.includes("func")) {
    return "Extension configuration error. Reload the extension and try again.";
  }

  return `Unable to analyze: ${message}`;
}

// ── Tab switching ───────────────────────────────────────

function switchTab(activeTab) {
  const isWebpage = activeTab === "webpage";

  tabWebpage.classList.toggle("active", isWebpage);
  tabWebpage.setAttribute("aria-selected", String(isWebpage));
  tabPdf.classList.toggle("active", !isWebpage);
  tabPdf.setAttribute("aria-selected", String(!isWebpage));

  panelWebpage.classList.toggle("hidden", !isWebpage);
  panelPdf.classList.toggle("hidden", isWebpage);

  setStatus(
    isWebpage
      ? "Click Analyze to extract the most important sentences from the current page."
      : "Select a PDF file to analyze its content.",
  );
}

tabWebpage.addEventListener("click", () => switchTab("webpage"));
tabPdf.addEventListener("click", () => switchTab("pdf"));

// ── Shared: mount PDF results into sidebar ──────────────

/**
 * Build a pageData object from a PDF backend response and
 * inject the sidebar panel into the given tab.
 *
 * Shared by both the "PDF upload" and "PDF URL" flows so
 * we never duplicate sidebar mounting logic.
 */
async function mountPdfResult(result, tabId) {
  const highlights = Array.isArray(result.highlights)
    ? result.highlights.map((h) =>
        typeof h === "string" ? h : h?.text || "",
      ).filter(Boolean)
    : [];

  const metrics = result.metrics || {};

  const pageData = {
    title: result.file_name || "PDF Document",
    wordCount: result.word_count || 0,
    readingTime: metrics.original_read_time || Math.max(1, Math.ceil((result.word_count || 0) / 225)),
    reducedReadingTime: metrics.highlights_read_time || 1,
    highlightCount: highlights.length,
    isPdf: true,
    summary: result.summary || "No summary returned.",
    highlights,
    topSentences: highlights,
    highlightObjects: [],
    highlightIds: [],
    metrics,
  };

  // Inject panel-ui.js (no page highlighting for PDFs)
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "content/highlighter.js",
      "content/panel-ui.js",
    ],
  });

  const [{ result: mountResult }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (data) => {
      const panelUI = window.HighlightsPanelUI;
      if (!panelUI || typeof panelUI.mount !== "function") {
        return { ok: false, reason: "panel-ui-missing" };
      }

      try {
        await panelUI.mount(data, {
          // Navigate is a no-op for PDFs since we cannot
          // highlight inside a PDF viewer.
          onNavigate: () => {},
        });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          reason: "mount-error",
          message: err?.message || String(err),
        };
      }
    },
    args: [pageData],
  });

  if (!mountResult?.ok) {
    throw new Error(mountResult?.message || mountResult?.reason || "Failed to display results");
  }

  return { highlights, pageData };
}

// ── PDF URL analysis ────────────────────────────────────

/**
 * Send the tab's PDF URL to /analyze-pdf-url and display
 * results in the sidebar.  Called automatically when the
 * user clicks "Analyze Page" on a PDF tab.
 */
async function analyzePdfFromUrl(tabUrl, tabId) {
  const resolvedPdfUrl = resolvePdfUrl(tabUrl);
  
  console.log("[Highlights] Current tab URL:", tabUrl);
  console.log("[Highlights] PDF detected:", isPdfUrl(tabUrl));
  console.log("[Highlights] Resolved PDF URL:", resolvedPdfUrl);

  setStatus("Downloading and analyzing PDF from URL…");

  const response = await fetch(BACKEND_PDF_URL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: resolvedPdfUrl }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Backend returned ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  console.log("[Highlights] PDF URL analysis completed", result);

  const { highlights } = await mountPdfResult(result, tabId);

  const pageCount = result.page_count || "?";
  const wordCount = result.word_count || 0;
  setStatus(
    `PDF analyzed — ${pageCount} pages, ${wordCount.toLocaleString()} words, ${highlights.length} highlight(s). See the panel on the page.`,
  );
}

// ── Webpage analysis ────────────────────────────────────

analyzeButton.addEventListener("click", async () => {
  analyzeButton.disabled = true;
  setStatus("Running analysis on the active page...");

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab || typeof tab.id !== "number") {
      throw new Error("No active tab detected.");
    }

    const tabId = tab.id;
    const tabUrl = tab.url || "";

    // ── PDF URL detection ───────────────────────────────
    // Open the custom PDF viewer in a new tab for PDF URLs or Chrome viewer URLs
    if (isPdfUrl(tabUrl)) {
      const resolved = resolvePdfUrl(tabUrl);
      const viewerUrl = chrome.runtime.getURL("pdf_viewer/viewer.html?src=" + encodeURIComponent(resolved));
      chrome.tabs.create({ url: viewerUrl });
      setStatus("Opening custom PDF viewer...");
      return;
    }

    if (/^(chrome|edge|brave|vivaldi):\/\//i.test(tabUrl)) {
      setStatus(describeScriptingError(new Error("Cannot access"), tabUrl));
      return;
    }

    // ── Normal webpage analysis ─────────────────────────
    // Chrome does not allow `files` and `func` in the same executeScript call.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "content/highlighter.js",
        "content/sentence-index.js",
        "content/api.js",
        "content/panel-ui.js",
        "content/content.js",
      ],
    });

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (typeof window.__highlightsRunAnalysis !== "function") {
          return { ok: false, reason: "analysis-unavailable" };
        }
        try {
          return await window.__highlightsRunAnalysis();
        } catch (err) {
          return {
            ok: false,
            reason: "error",
            message: err && err.message ? err.message : String(err),
          };
        }
      },
    });

    if (!result?.ok) {
      const detail = result?.message || result?.reason || "unknown error";
      setStatus(`Analysis failed (${detail}).`);
      return;
    }

    if (result.isPdf) {
      setStatus("PDF analyzed — summary and section links are in the side panel.");
    } else if (result.highlights?.appliedCount > 0) {
      setStatus(`Done — ${result.highlights.appliedCount} highlight(s) visible on the page.`);
    } else {
      setStatus("Analysis complete — see the Highlights panel on the page.");
    }
  } catch (error) {
    console.error("[Highlights] Analysis failed", error);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const msg = String(error?.message || error);
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      setStatus("Backend unavailable — start the server: uvicorn app:app --reload");
    } else {
      setStatus(describeScriptingError(error, tab?.url));
    }
  } finally {
    analyzeButton.disabled = false;
  }
});

// ── PDF file picker ─────────────────────────────────────

pdfFileInput.addEventListener("change", () => {
  const file = pdfFileInput.files[0];

  if (file) {
    pdfFileNameLabel.textContent = file.name;
    pdfPickerLabel.classList.add("has-file");
    analyzePdfButton.disabled = false;
    setStatus(`Selected: ${file.name}`);
  } else {
    pdfFileNameLabel.textContent = "Choose a PDF file…";
    pdfPickerLabel.classList.remove("has-file");
    analyzePdfButton.disabled = true;
  }
});

// ── PDF file upload ─────────────────────────────────────

analyzePdfButton.addEventListener("click", async () => {
  const file = pdfFileInput.files[0];

  // ── Guard: no file selected ───────────────────────────
  if (!file) {
    setStatus("Please select a PDF file first.");
    return;
  }

  // ── Guard: wrong file type ────────────────────────────
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    setStatus("Invalid file type — only .pdf files are supported.");
    return;
  }

  analyzePdfButton.disabled = true;
  setStatus("Uploading and analyzing PDF…");
  console.log("[Highlights] Uploading PDF...");

  try {
    // ── Send PDF to backend via FormData ─────────────────
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(BACKEND_PDF_URL, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const result = await response.json();
    console.log("[Highlights] PDF analysis completed", result);

    // ── Mount sidebar on the active tab ──────────────────
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab || typeof tab.id !== "number") {
      throw new Error("No active tab detected to show results.");
    }

    const { highlights } = await mountPdfResult(result, tab.id);

    const pageCount = result.page_count || "?";
    const wordCount = result.word_count || 0;
    setStatus(
      `PDF analyzed — ${pageCount} pages, ${wordCount.toLocaleString()} words, ${highlights.length} highlight(s). See the panel on the page.`,
    );
  } catch (error) {
    console.error("[Highlights] PDF analysis failed", error);

    // ── Friendly error messages ─────────────────────────
    const msg = String(error?.message || error);

    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      setStatus("Backend unavailable — start the server: uvicorn app:app --reload");
    } else if (msg.includes("status")) {
      setStatus(`Upload failed — ${msg}`);
    } else {
      setStatus(`PDF analysis failed: ${msg}`);
    }
  } finally {
    analyzePdfButton.disabled = false;
  }
});
