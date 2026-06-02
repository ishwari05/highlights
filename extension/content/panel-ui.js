/**
 * Highlights sidebar — Shadow DOM shell (isolated from host page CSS).
 */
(function () {
  const HOST_ID = "highlights-root";
  const PANEL_CSS_URL = "styles/panel.css";
  const FONT_CSS_URL =
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap";

  const INSIGHT_COLORS = [
    { bg: "#e8f1ff", fg: "#3b6bdb" },
    { bg: "#e8f7ef", fg: "#2d8a56" },
    { bg: "#fff3e8", fg: "#c76b1d" },
    { bg: "#f3edff", fg: "#7c5cbf" },
    { bg: "#e8f6f8", fg: "#2a8f9c" },
  ];

  let activeHost = null;
  let activeShadow = null;
  let themeMediaQuery = null;
  let themeMediaListener = null;

  function svgIcon(paths, viewBox = "0 0 24 24") {
    return `<svg class="hl-icon" viewBox="${viewBox}" width="16" height="16" aria-hidden="true" focusable="false">${paths}</svg>`;
  }

  const ICONS = {
    close: svgIcon('<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>'),
    book: svgIcon(
      '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v13A2.5 2.5 0 0 1 16.5 21h-9A2.5 2.5 0 0 1 5 18.5v-13z" stroke="currentColor" stroke-width="1.75" fill="none"/><path d="M8 6h8M8 10h6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>',
    ),
    bolt: svgIcon(
      '<path d="M13 2L5 14h6l-1 8 8-12h-6l1-8z" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linejoin="round"/>',
    ),
    star: svgIcon(
      '<path d="M12 3.5l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7L12 3.5z" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linejoin="round"/>',
    ),
    copy: svgIcon(
      '<rect x="8" y="8" width="11" height="13" rx="2" stroke="currentColor" stroke-width="1.75" fill="none"/><path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.75" fill="none"/>',
    ),
    download: svgIcon(
      '<path d="M12 4v10M8 11l4 4 4-4" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 19h14" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>',
    ),
    chevron: svgIcon(
      '<path d="M10 8l4 4-4 4" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    ),
    settings: svgIcon(
      '<circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="1.75" fill="none"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>',
    ),
    moon: svgIcon(
      '<path d="M20 14.5A7.5 7.5 0 0 1 9.5 4 6.5 6.5 0 1 0 20 14.5z" stroke="currentColor" stroke-width="1.75" fill="none"/>',
    ),
    sun: svgIcon(
      '<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.75" fill="none"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>',
    ),
    spark: svgIcon(
      '<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linejoin="round"/>',
    ),
  };

  function getStoredTheme() {
    try {
      const stored = localStorage.getItem("highlights-panel-theme");
      if (stored === "light" || stored === "dark") {
        return stored;
      }
    } catch {
      /* ignore */
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function setStoredTheme(theme) {
    try {
      localStorage.setItem("highlights-panel-theme", theme);
    } catch {
      /* ignore */
    }
  }

  async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.status}`);
    }
    return response.text();
  }

  async function injectShadowStyles(shadowRoot) {
    const panelUrl = chrome.runtime.getURL(PANEL_CSS_URL);
    let panelCss = await fetchText(panelUrl);

    let fontCss = "";
    try {
      fontCss = await fetchText(FONT_CSS_URL);
    } catch {
      fontCss = "";
    }

    panelCss = panelCss.replace(/^@import[^;]+;/gm, "");

    const style = document.createElement("style");
    style.setAttribute("data-highlights-styles", "panel");
    style.textContent = `${fontCss}\n${panelCss}`;
    shadowRoot.appendChild(style);
  }

  function getOrCreateHost() {
    let host = document.getElementById(HOST_ID);
    if (host) {
      host.remove();
    }

    host = document.createElement("div");
    host.id = HOST_ID;
    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: "open" });
    activeHost = host;
    activeShadow = shadowRoot;
    return { host, shadowRoot };
  }

  function trapScroll(panel, scrollRegion) {
    const stopBubble = (event) => event.stopPropagation();
    panel.addEventListener("wheel", stopBubble, { passive: true, capture: true });
    panel.addEventListener("touchmove", stopBubble, { passive: true, capture: true });

    scrollRegion.addEventListener(
      "wheel",
      (event) => {
        const atTop = scrollRegion.scrollTop <= 0;
        const atBottom =
          scrollRegion.scrollTop + scrollRegion.clientHeight >= scrollRegion.scrollHeight - 1;
        if (
          (atTop && event.deltaY < 0) ||
          (atBottom && event.deltaY > 0)
        ) {
          event.preventDefault();
        }
        event.stopPropagation();
      },
      { passive: false },
    );
  }

  function buildMarkdown(data) {
    const lines = [
      `# ${data.title || "Untitled"}`,
      "",
      `> ${data.readingTime} min read · ${data.highlightCount} key insights`,
      "",
      "## Summary",
      "",
      data.summary || "",
      "",
      "## Key Insights",
      "",
    ];

    const highlights = data.topSentences || data.highlights || [];
    highlights.forEach((sentence, index) => {
      lines.push(`${index + 1}. ${sentence}`, "");
    });

    return lines.join("\n").trim();
  }

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      if (button) {
        const original = button.textContent;
        button.textContent = "Copied!";
        window.setTimeout(() => {
          button.textContent = original;
        }, 1600);
      }
      return true;
    } catch {
      return false;
    }
  }

  function downloadMarkdown(filename, content) {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function applyTheme(panel, theme) {
    panel.dataset.theme = theme;
    const themeBtn = panel.querySelector(".hl-theme-toggle");
    if (themeBtn) {
      themeBtn.innerHTML = theme === "dark" ? ICONS.sun : ICONS.moon;
      themeBtn.setAttribute(
        "aria-label",
        theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
      );
    }
  }

  function bindThemeToggle(panel) {
    const themeBtn = panel.querySelector(".hl-theme-toggle");
    if (!themeBtn) {
      return;
    }

    themeBtn.addEventListener("click", () => {
      const next = panel.dataset.theme === "dark" ? "light" : "dark";
      setStoredTheme(next);
      applyTheme(panel, next);
    });

    if (themeMediaQuery) {
      themeMediaQuery.removeEventListener("change", themeMediaListener);
    }

    themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    themeMediaListener = (event) => {
      try {
        const stored = localStorage.getItem("highlights-panel-theme");
        if (stored === "light" || stored === "dark") {
          return;
        }
      } catch {
        /* ignore */
      }
      applyTheme(panel, event.matches ? "dark" : "light");
    };
    themeMediaQuery.addEventListener("change", themeMediaListener);
  }

  function createMetaCell(icon, value, label) {
    const cell = document.createElement("div");
    cell.className = "hl-meta-cell";

    const iconWrap = document.createElement("div");
    iconWrap.className = "hl-meta-icon";
    iconWrap.innerHTML = icon;

    const valueEl = document.createElement("div");
    valueEl.className = "hl-meta-value";
    valueEl.textContent = value;

    const labelEl = document.createElement("div");
    labelEl.className = "hl-meta-label";
    labelEl.textContent = label;

    cell.appendChild(iconWrap);
    cell.appendChild(valueEl);
    cell.appendChild(labelEl);
    return cell;
  }

  function createInsightCard(sentence, index, onNavigate) {
    const colors = INSIGHT_COLORS[index % INSIGHT_COLORS.length];
    const card = document.createElement("button");
    card.type = "button";
    card.className = "hl-insight-card";

    const badge = document.createElement("span");
    badge.className = "hl-insight-badge";
    badge.textContent = String(index + 1);
    badge.style.backgroundColor = colors.bg;
    badge.style.color = colors.fg;

    const text = document.createElement("span");
    text.className = "hl-insight-text";
    text.textContent = sentence;

    const chevron = document.createElement("span");
    chevron.className = "hl-insight-chevron";
    chevron.innerHTML = ICONS.chevron;

    card.appendChild(badge);
    card.appendChild(text);
    card.appendChild(chevron);
    card.addEventListener("click", () => onNavigate(sentence));

    return card;
  }

  function createPanelShell(data) {
    const panel = document.createElement("div");
    panel.className = "hl-panel";
    panel.setAttribute("role", "complementary");
    panel.setAttribute("aria-label", "Highlights reading assistant");

    const theme = getStoredTheme();
    applyTheme(panel, theme);

    const header = document.createElement("header");
    header.className = "hl-header";

    const brand = document.createElement("div");
    brand.className = "hl-brand";
    brand.innerHTML = `${ICONS.spark}<span>Highlights</span>`;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "hl-close";
    closeBtn.setAttribute("aria-label", "Close highlights panel");
    closeBtn.innerHTML = ICONS.close;
    closeBtn.addEventListener("click", () => close(panel));

    header.appendChild(brand);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const metrics = data.metrics || {};
    const meta = document.createElement("div");
    meta.className = "hl-meta-grid";
    meta.appendChild(
      createMetaCell(
        ICONS.book,
        `${metrics.original_read_time ?? data.readingTime} min read`,
        "Original article",
      ),
    );
    meta.appendChild(
      createMetaCell(
        ICONS.bolt,
        `${metrics.highlights_read_time ?? data.reducedReadingTime ?? data.readingTime} min read`,
        metrics.time_saved != null ? `Saves ${metrics.time_saved} min` : "With Highlights",
      ),
    );
    const insightLabel =
      metrics.confidence && metrics.coverage_score != null
        ? `${metrics.confidence} · ${metrics.coverage_score}%`
        : "Key insights";
    meta.appendChild(
      createMetaCell(ICONS.star, String(data.highlightCount ?? 0), insightLabel),
    );
    panel.appendChild(meta);

    const scroll = document.createElement("div");
    scroll.className = "hl-scroll";

    return { panel, scroll, theme };
  }

  function revealPanel(panel) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => panel.classList.add("is-visible"));
    });
  }

  async function mountLoading(meta) {
    unmount();

    const { shadowRoot } = getOrCreateHost();
    await injectShadowStyles(shadowRoot);

    const { panel, scroll, theme } = createPanelShell(meta);

    const statusSection = document.createElement("section");
    statusSection.className = "hl-section";

    const statusHead = document.createElement("div");
    statusHead.className = "hl-section-head";
    statusHead.innerHTML = "<h2>Summary</h2>";
    statusSection.appendChild(statusHead);

    const loadingText = document.createElement("p");
    loadingText.className = "hl-loading";
    loadingText.textContent = "Analyzing article...";
    statusSection.appendChild(loadingText);
    scroll.appendChild(statusSection);

    panel.appendChild(scroll);
    shadowRoot.appendChild(panel);
    bindThemeToggle(panel);
    applyTheme(panel, theme);
    trapScroll(panel, scroll);
    revealPanel(panel);

    return panel;
  }

  async function mountError(message, meta) {
    unmount();

    const { shadowRoot } = getOrCreateHost();
    await injectShadowStyles(shadowRoot);

    const { panel, scroll, theme } = createPanelShell(meta);

    const errorSection = document.createElement("section");
    errorSection.className = "hl-section";

    const errorHead = document.createElement("div");
    errorHead.className = "hl-section-head";
    errorHead.innerHTML = "<h2>Summary</h2>";
    errorSection.appendChild(errorHead);

    const errorText = document.createElement("p");
    errorText.className = "hl-error";
    errorText.textContent = message;
    errorSection.appendChild(errorText);
    scroll.appendChild(errorSection);

    panel.appendChild(scroll);
    shadowRoot.appendChild(panel);
    bindThemeToggle(panel);
    applyTheme(panel, theme);
    trapScroll(panel, scroll);
    revealPanel(panel);

    return panel;
  }

  async function mount(data, callbacks) {
    unmount();

    const { shadowRoot } = getOrCreateHost();
    await injectShadowStyles(shadowRoot);

    const { panel, scroll, theme } = createPanelShell(data);
    const topSentences = data.topSentences || data.highlights || [];

    if (data.isPdf) {
      const banner = document.createElement("div");
      banner.className = "hl-banner";
      banner.textContent =
        "PDF mode — highlights can't be painted in Chrome's viewer. Use insight cards to search the document when supported.";
      scroll.appendChild(banner);
    }

    const summarySection = document.createElement("section");
    summarySection.className = "hl-section";

    const summaryHead = document.createElement("div");
    summaryHead.className = "hl-section-head";
    summaryHead.innerHTML = "<h2>Summary</h2>";

    const copySummaryBtn = document.createElement("button");
    copySummaryBtn.type = "button";
    copySummaryBtn.className = "hl-icon-btn";
    copySummaryBtn.setAttribute("aria-label", "Copy summary");
    copySummaryBtn.innerHTML = ICONS.copy;
    copySummaryBtn.addEventListener("click", () => {
      copyText(data.summary || "", copySummaryBtn);
    });
    summaryHead.appendChild(copySummaryBtn);
    summarySection.appendChild(summaryHead);

    const summaryText = document.createElement("p");
    summaryText.className = "hl-summary";
    summaryText.textContent = data.summary || "No summary available for this page.";
    summarySection.appendChild(summaryText);
    scroll.appendChild(summarySection);

    const insightsSection = document.createElement("section");
    insightsSection.className = "hl-section";

    const insightsHead = document.createElement("div");
    insightsHead.className = "hl-section-head";
    insightsHead.innerHTML = "<h2>Key Insights</h2>";
    insightsSection.appendChild(insightsHead);

    const insightsList = document.createElement("div");
    insightsList.className = "hl-insights-list";

    if (topSentences.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hl-empty";
      empty.textContent = "No key passages were found on this page.";
      insightsSection.appendChild(empty);
    } else {
      topSentences.forEach((sentence, index) => {
        insightsList.appendChild(
          createInsightCard(sentence, index, callbacks.onNavigate),
        );
      });
      insightsSection.appendChild(insightsList);
    }

    scroll.appendChild(insightsSection);

    const actionsSection = document.createElement("section");
    actionsSection.className = "hl-section hl-section--actions";

    const actionsHead = document.createElement("div");
    actionsHead.className = "hl-section-head";
    actionsHead.innerHTML = "<h2>Actions</h2>";
    actionsSection.appendChild(actionsHead);

    const actionsRow = document.createElement("div");
    actionsRow.className = "hl-actions-row";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "hl-action-btn";
    copyBtn.innerHTML = `${ICONS.copy}<span>Copy Summary</span>`;
    copyBtn.addEventListener("click", () => copyText(data.summary || "", copyBtn));

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "hl-action-btn";
    exportBtn.innerHTML = `${ICONS.download}<span>Export Markdown</span>`;
    exportBtn.addEventListener("click", () => {
      const markdown = buildMarkdown(data);
      const slug = (data.title || "highlights")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);
      downloadMarkdown(`${slug || "highlights"}.md`, markdown);
    });

    actionsRow.appendChild(copyBtn);
    actionsRow.appendChild(exportBtn);
    actionsSection.appendChild(actionsRow);
    scroll.appendChild(actionsSection);

    panel.appendChild(scroll);

    const footer = document.createElement("footer");
    footer.className = "hl-footer";

    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.className = "hl-footer-btn";
    settingsBtn.setAttribute("aria-label", "Settings");
    settingsBtn.innerHTML = ICONS.settings;
    settingsBtn.addEventListener("click", () => {
      copyText("Highlights extension — settings coming soon.");
    });

    const credit = document.createElement("span");
    credit.className = "hl-footer-credit";
    credit.textContent = "Made with ♥ by Highlights";

    const themeBtn = document.createElement("button");
    themeBtn.type = "button";
    themeBtn.className = "hl-footer-btn hl-theme-toggle";

    footer.appendChild(settingsBtn);
    footer.appendChild(credit);
    footer.appendChild(themeBtn);
    panel.appendChild(footer);

    shadowRoot.appendChild(panel);
    bindThemeToggle(panel);
    applyTheme(panel, theme);
    trapScroll(panel, scroll);
    revealPanel(panel);

    return panel;
  }

  function close(panel) {
    if (!panel) {
      unmount();
      return;
    }

    panel.classList.remove("is-visible");
    panel.classList.add("is-closing");

    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 360;
    window.setTimeout(() => unmount(), duration);
  }

  function unmount() {
    if (themeMediaQuery && themeMediaListener) {
      themeMediaQuery.removeEventListener("change", themeMediaListener);
      themeMediaListener = null;
    }

    const host = document.getElementById(HOST_ID);
    if (host) {
      host.remove();
    }

    activeHost = null;
    activeShadow = null;
  }

  window.HighlightsPanelUI = {
    HOST_ID,
    mount,
    mountLoading,
    mountError,
    close,
    unmount,
    buildMarkdown,
  };
})();
