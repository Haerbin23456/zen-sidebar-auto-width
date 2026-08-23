(() => {
  "use strict";

  const INSTANCE_KEY = "__zenSidebarAutoWidth";
  const WIDTH_MARKER = "zen-auto-sidebar-width";
  const WIDTH_PROPERTY = "--zen-auto-sidebar-content-width";
  const CONTROL_THEME_PROPERTIES = [
    "--zen-auto-window-control-width",
    "--zen-auto-window-control-height",
    "--zen-auto-window-control-radius",
    "--zen-auto-window-control-outer-padding",
    "--zen-auto-window-controls-offset-y",
    "--zen-auto-window-control-color",
  ];

  // Sine can reload user scripts without restarting the browser.
  window[INSTANCE_KEY]?.destroy();

  const state = {
    destroyed: false,
    running: false,
    timer: 0,
    themeTimer: 0,
    themeRunning: false,
    toolbox: null,
    originalWidth: null,
    observers: [],
    listeners: [],
    restorers: [],
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const afterLayout = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );

  async function waitForElement(id) {
    for (let attempt = 0; attempt < 100 && !state.destroyed; attempt += 1) {
      const element = document.getElementById(id);
      if (element) return element;
      await sleep(50);
    }
    return null;
  }

  function addListener(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    state.listeners.push(() => target.removeEventListener(type, listener, options));
  }

  function addObserver(observer, target, options) {
    observer.observe(target, options);
    state.observers.push(observer);
  }

  function restoreToolboxWidth(toolbox, originalWidth) {
    toolbox.removeAttribute(WIDTH_MARKER);
    toolbox.style.removeProperty(WIDTH_PROPERTY);

    const { styleValue, stylePriority, attributeValue } = originalWidth;
    if (styleValue) {
      toolbox.style.setProperty("width", styleValue, stylePriority);
    } else {
      toolbox.style.removeProperty("width");
    }

    if (attributeValue === null) toolbox.removeAttribute("width");
    else toolbox.setAttribute("width", attributeValue);
  }

  function destroy() {
    state.destroyed = true;
    clearTimeout(state.timer);
    clearTimeout(state.themeTimer);
    state.observers.forEach((observer) => observer.disconnect());
    state.listeners.forEach((remove) => remove());
    state.restorers.forEach((restore) => restore());

    const toolbox = state.toolbox;
    if (toolbox && state.originalWidth) {
      restoreToolboxWidth(toolbox, state.originalWidth);
    }

    delete window[INSTANCE_KEY];
  }

  window[INSTANCE_KEY] = { destroy };

  async function init() {
    const [toolbox, topBar, customizationTarget] = await Promise.all([
      waitForElement("navigator-toolbox"),
      waitForElement("zen-sidebar-top-buttons"),
      waitForElement("zen-sidebar-top-buttons-customization-target"),
    ]);

    if (state.destroyed) return;
    if (!toolbox || !topBar || !customizationTarget) {
      console.warn("[Zen Auto Width] Required Zen sidebar elements were not found.");
      return;
    }

    state.toolbox = toolbox;
    state.originalWidth = {
      styleValue: toolbox.style.getPropertyValue("width"),
      stylePriority: toolbox.style.getPropertyPriority("width"),
      attributeValue: toolbox.getAttribute("width"),
    };

    const persistentButtonIds = [
      "PanelUI-button",
      "back-button",
      "forward-button",
      "stop-reload-button",
    ];
    const separator = document.getElementById("zen-sidebar-top-buttons-separator");
    const controlsContainer = document.querySelector(
      ".titlebar-buttonbox-container",
    );

    if (controlsContainer) {
      const originalThemeProperties = CONTROL_THEME_PROPERTIES.map(
        (property) => [
          property,
          controlsContainer.style.getPropertyValue(property),
          controlsContainer.style.getPropertyPriority(property),
        ],
      );
      state.restorers.push(() => {
        for (const [property, value, priority] of originalThemeProperties) {
          if (value) controlsContainer.style.setProperty(property, value, priority);
          else controlsContainer.style.removeProperty(property);
        }
      });
    }

    // Let Zen and third-party themes treat the caption controls as regular
    // toolbar buttons. Their glyphs remain Firefox's native ::before content;
    // the class is used for shared theme tokens and interaction rules.
    for (const button of document.querySelectorAll(".titlebar-button")) {
      if (!button.classList.contains("toolbarbutton-1")) {
        button.classList.add("toolbarbutton-1");
        state.restorers.push(() => button.classList.remove("toolbarbutton-1"));
      }
    }

    function px(value) {
      const number = Number.parseFloat(value);
      return Number.isFinite(number) ? number : 0;
    }

    function visibleReferenceButton() {
      for (const id of [
        "reload-button",
        "stop-button",
        "back-button",
        "forward-button",
        "PanelUI-menu-button",
      ]) {
        const button = document.getElementById(id);
        const visual = button?.querySelector(
          ":scope > :is(.toolbarbutton-icon, .toolbarbutton-badge-stack)",
        );
        if (
          button &&
          visual &&
          !button.matches(":hover") &&
          button.getBoundingClientRect().width > 0 &&
          visual.getBoundingClientRect().width > 0
        ) {
          return { button, visual };
        }
      }
      return null;
    }

    async function syncWindowControlTheme() {
      if (state.destroyed || state.themeRunning || !controlsContainer) return;

      const reference = visibleReferenceButton();
      const targetVisual = controlsContainer.querySelector(
        ".titlebar-button > .toolbarbutton-icon",
      );
      if (!reference || !targetVisual) return;

      state.themeRunning = true;
      try {
        // Measure the theme's real neighboring button rather than assuming it
        // uses Firefox's generic toolbar tokens. Themes such as Nebula target
        // navigation IDs directly and deliberately exclude caption controls.
        const referenceButtonRect = reference.button.getBoundingClientRect();
        const referenceVisualRect = reference.visual.getBoundingClientRect();
        const referenceStyle = getComputedStyle(reference.visual);
        const referenceGlyphColor =
          referenceStyle.fill && CSS.supports("color", referenceStyle.fill)
            ? referenceStyle.fill
            : referenceStyle.color;
        const outerPadding = Math.max(
          0,
          (referenceButtonRect.width - referenceVisualRect.width) / 2,
        );
        const previousOffset = px(
          controlsContainer.style.getPropertyValue(
            "--zen-auto-window-controls-offset-y",
          ),
        );

        controlsContainer.style.setProperty(
          "--zen-auto-window-control-width",
          `${referenceVisualRect.width}px`,
        );
        controlsContainer.style.setProperty(
          "--zen-auto-window-control-height",
          `${referenceVisualRect.height}px`,
        );
        controlsContainer.style.setProperty(
          "--zen-auto-window-control-radius",
          referenceStyle.borderRadius,
        );
        controlsContainer.style.setProperty(
          "--zen-auto-window-control-outer-padding",
          `${outerPadding}px`,
        );
        controlsContainer.style.setProperty(
          "--zen-auto-window-control-color",
          referenceGlyphColor,
        );

        await afterLayout();
        if (state.destroyed) return;

        const updatedReferenceRect = reference.visual.getBoundingClientRect();
        const targetRect = targetVisual.getBoundingClientRect();
        const referenceCenter =
          updatedReferenceRect.top + updatedReferenceRect.height / 2;
        const targetCenterWithoutOurOffset =
          targetRect.top + targetRect.height / 2 - previousOffset;
        const offsetY =
          Math.round((referenceCenter - targetCenterWithoutOurOffset) * 2) / 2;

        controlsContainer.style.setProperty(
          "--zen-auto-window-controls-offset-y",
          `${offsetY}px`,
        );
        console.info(
          `[Zen Auto Width] Window controls synced to ${reference.button.id}: ` +
            `${referenceVisualRect.width}x${referenceVisualRect.height}px, ` +
            `radius ${referenceStyle.borderRadius}, color ${referenceGlyphColor}, ` +
            `offset ${offsetY}px`,
        );
      } finally {
        state.themeRunning = false;
      }
    }

    function lockOverflow() {
      for (const id of persistentButtonIds) {
        document.getElementById(id)?.setAttribute("overflows", "false");
      }
    }

    function overflowedPersistentButtons() {
      return persistentButtonIds
        .map((id) => document.getElementById(id))
        .filter((element) => element?.hasAttribute("overflowedItem"));
    }

    function applySidebarWidth(contentWidth, persistAttribute = true) {
      const width = Math.max(1, Math.ceil(contentWidth));
      const value = `${width}px`;

      toolbox.setAttribute(WIDTH_MARKER, "true");
      toolbox.style.setProperty(WIDTH_PROPERTY, value);

      // This is the same width path Zen initializes and its splitter updates.
      toolbox.style.setProperty("width", value);
      if (persistAttribute) toolbox.setAttribute("width", value);

      return width;
    }

    async function pauseOverflowManagerForRecovery() {
      if (!overflowedPersistentButtons().length) return null;

      const overflowManager = topBar.overflowable;
      if (
        typeof overflowManager?.uninit !== "function" ||
        typeof overflowManager?.init !== "function"
      ) {
        return null;
      }

      // Firefox's public lifecycle path calls OverflowableToolbar.#disable(),
      // aborting pending checks and returning existing overflow items without
      // leaving its private bookkeeping out of sync. Keep it paused until the
      // final sidebar width has been applied.
      overflowManager.uninit();
      try {
        for (let attempt = 0; attempt < 40; attempt += 1) {
          if (state.destroyed) return overflowManager;
          lockOverflow();
          if (!overflowedPersistentButtons().length) break;
          await sleep(25);
        }
      } catch (error) {
        overflowManager.init();
        throw error;
      }

      return overflowManager;
    }

    function requiredTargetOuterWidth() {
      const targetStyle = getComputedStyle(customizationTarget);
      const children = Array.from(customizationTarget.children).filter((child) => {
        if (child === separator) return false;
        const style = getComputedStyle(child);
        return (
          style.display !== "none" &&
          style.visibility !== "collapse" &&
          (style.position === "static" || style.position === "relative")
        );
      });

      const childrenWidth = children.reduce((total, child) => {
        const style = getComputedStyle(child);
        return (
          total +
          child.getBoundingClientRect().width +
          px(style.marginLeft) +
          px(style.marginRight)
        );
      }, 0);

      const gap = px(targetStyle.columnGap);
      const gapsWidth = Math.max(0, children.length - 1) * gap;

      return (
        childrenWidth +
        gapsWidth +
        px(targetStyle.paddingLeft) +
        px(targetStyle.paddingRight) +
        px(targetStyle.borderLeftWidth) +
        px(targetStyle.borderRightWidth)
      );
    }

    function calculateToolboxContentWidth() {
      const toolboxContentWidth = px(getComputedStyle(toolbox).width);
      const targetAvailableWidth = customizationTarget.getBoundingClientRect().width;
      const targetRequiredWidth = requiredTargetOuterWidth();

      // Keep all non-target toolbox and toolbar chrome exactly as laid out by Zen.
      return Math.ceil(
        toolboxContentWidth - targetAvailableWidth + targetRequiredWidth + 2,
      );
    }

    async function calculate() {
      if (state.destroyed || state.running) return;
      if (toolbox.getAttribute("zen-sidebar-expanded") !== "true") return;

      state.running = true;
      let pausedOverflowManager = null;

      try {
        lockOverflow();
        pausedOverflowManager = await pauseOverflowManagerForRecovery();
        await afterLayout();

        if (overflowedPersistentButtons().length) {
          console.warn(
            "[Zen Auto Width] Some protected buttons could not be restored.",
          );
          restoreToolboxWidth(toolbox, state.originalWidth);
          return;
        }

        const requiredContentWidth = calculateToolboxContentWidth();
        const appliedWidth = applySidebarWidth(requiredContentWidth);

        lockOverflow();
        window.dispatchEvent(new Event("resize"));
        await afterLayout();

        console.info(
          `[Zen Auto Width] Sidebar content width: ${appliedWidth}px; ` +
            `outer width: ${Math.ceil(toolbox.getBoundingClientRect().width)}px`,
        );
      } finally {
        // Re-enable overflow only after the exact width and protected-item
        // attributes are in place. Its first check then sees a stable layout.
        try {
          pausedOverflowManager?.init();
        } finally {
          state.running = false;
        }
      }
    }

    function schedule() {
      if (state.destroyed) return;
      clearTimeout(state.timer);
      state.timer = window.setTimeout(calculate, 100);
    }

    function scheduleThemeSync() {
      if (state.destroyed) return;
      clearTimeout(state.themeTimer);
      state.themeTimer = window.setTimeout(async () => {
        try {
          await syncWindowControlTheme();
          schedule();
        } catch (error) {
          console.error("[Zen Auto Width] Theme sync failed:", error);
        }
      }, 100);
    }

    function scheduleAll() {
      scheduleThemeSync();
      schedule();
    }

    // Do not observe customizationTarget child mutations: Firefox itself moves
    // items in and out of this node during overflow/underflow, so observing it
    // creates a measurement feedback loop. aftercustomization covers real edits.
    addObserver(new MutationObserver(scheduleAll), toolbox, {
      attributes: true,
      attributeFilter: ["zen-sidebar-expanded"],
    });
    addObserver(new MutationObserver(scheduleThemeSync), document.documentElement, {
      attributes: true,
    });
    if (document.head) {
      addObserver(new MutationObserver(scheduleThemeSync), document.head, {
        childList: true,
      });
    }

    addListener(window, "aftercustomization", scheduleAll);
    addListener(window, "sizemodechange", scheduleAll);
    addListener(window, "resize", (event) => {
      // Zen and OverflowableToolbar also dispatch synthetic resize events.
      if (event.isTrusted) scheduleAll();
    });

    if (window.matchMedia) {
      const densityQuery = window.matchMedia(
        `(resolution: ${window.devicePixelRatio}dppx)`,
      );
      addListener(densityQuery, "change", scheduleAll);
    }

    await syncWindowControlTheme();
    await calculate();
  }

  init().catch((error) => console.error("[Zen Auto Width]", error));
})();
