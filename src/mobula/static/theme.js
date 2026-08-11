(function initializeMobulaTheme() {
  "use strict";

  const STORAGE_KEY = "mobula.appearance";
  const PREFER_DARK = "(prefers-color-scheme: dark)";
  const THEMES = new Set(["light", "system", "dark"]);

  function storedPreference() {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      return THEMES.has(value) ? value : "system";
    } catch (_error) {
      return "system";
    }
  }

  function resolvedTheme(preference) {
    if (preference === "light" || preference === "dark") return preference;
    return window.matchMedia(PREFER_DARK).matches ? "dark" : "light";
  }

  function applyTheme(preference, persist = false) {
    const normalized = THEMES.has(preference) ? preference : "system";
    const resolved = resolvedTheme(normalized);
    const root = document.documentElement;
    root.dataset.themePreference = normalized;
    root.dataset.resolveTheme = resolved === "light" ? "bright" : "dark";
    root.style.colorScheme = resolved;
    for (const button of document.querySelectorAll("[data-theme-choice]")) {
      button.setAttribute("aria-pressed", String(button.dataset.themeChoice === normalized));
    }
    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, normalized);
      } catch (_error) {
        // A private or restricted browsing context may decline persistence.
      }
    }
    window.dispatchEvent(
      new CustomEvent("mobula:themechange", {
        detail: { preference: normalized, resolved },
      })
    );
  }

  const preference = storedPreference();
  applyTheme(preference);

  const systemTheme = window.matchMedia(PREFER_DARK);
  systemTheme.addEventListener("change", () => {
    if (document.documentElement.dataset.themePreference === "system") applyTheme("system");
  });

  window.addEventListener("DOMContentLoaded", () => {
    const control = document.getElementById("themeControl");
    if (!control) return;
    applyTheme(document.documentElement.dataset.themePreference || "system");
    control.addEventListener("click", (event) => {
      const button = event.target.closest("[data-theme-choice]");
      if (button) applyTheme(button.dataset.themeChoice, true);
    });
  });

  window.mobulaTheme = Object.freeze({
    get preference() {
      return document.documentElement.dataset.themePreference || "system";
    },
    get resolved() {
      return document.documentElement.dataset.resolveTheme === "bright" ? "light" : "dark";
    },
    set: (value) => applyTheme(value, true),
  });
})();
