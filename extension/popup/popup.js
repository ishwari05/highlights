const analyzeButton = document.getElementById("analyze");
const statusNode = document.getElementById("status");

function setStatus(message) {
  statusNode.textContent = message;
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

    if (/^(chrome|edge|brave|vivaldi):\/\//i.test(tabUrl)) {
      setStatus(describeScriptingError(new Error("Cannot access"), tabUrl));
      return;
    }

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
    console.error(error);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    setStatus(describeScriptingError(error, tab?.url));
  } finally {
    analyzeButton.disabled = false;
  }
});
