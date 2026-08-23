(() => {
  "use strict";

  const INSTANCE_KEY = "__zenSidebarAutoWidth";
  const WIDTH_MARKER = "zen-auto-sidebar-width";
  const WIDTH_PROPERTY = "--zen-auto-sidebar-content-width";

  // Sine can reload user scripts without restarting the browser.
  window[INSTANCE_KEY]?.destroy();

  const state = {
    destroyed: false,
    running: false,
    timer: 0,
    toolbox: null,
    originalWidth: null,
    observers: [],
    listeners: [],
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
    state.observers.forEach((observer) => observer.disconnect());
    state.listeners.forEach((remove) => remove());

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

    function px(value) {
      const number = Number.parseFloat(value);
      return Number.isFinite(number) ? number : 0;
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

    async function waitForUnderflow() {
      for (let attempt = 0; attempt < 24; attempt += 1) {
        if (state.destroyed) return false;
        lockOverflow();
        window.dispatchEvent(new Event("resize"));
        await sleep(25);
        if (!overflowedPersistentButtons().length) return true;
      }
      return false;
    }

    async function resetOverflowManager() {
      const overflowManager = topBar.overflowable;
      if (
        typeof overflowManager?.uninit !== "function" ||
        typeof overflowManager?.init !== "function"
      ) {
        return false;
      }

      overflowManager.uninit();
      try {
        for (let attempt = 0; attempt < 40; attempt += 1) {
          if (state.destroyed) return false;
          lockOverflow();
          if (!overflowedPersistentButtons().length) return true;
          await sleep(25);
        }
        return false;
      } finally {
        overflowManager.init();
      }
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

      try {
        lockOverflow();

        // Break the circular fit-content calculation: make the actual toolbox
        // wide first, then let OverflowableToolbar return every protected item.
        applySidebarWidth(window.innerWidth, false);
        await afterLayout();

        if (!(await waitForUnderflow())) {
          await resetOverflowManager();
          await afterLayout();
        }

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
        state.running = false;
      }
    }

    function schedule() {
      if (state.destroyed || state.running) return;
      clearTimeout(state.timer);
      state.timer = window.setTimeout(calculate, 100);
    }

    addObserver(new MutationObserver(schedule), customizationTarget, {
      childList: true,
    });
    addObserver(new MutationObserver(schedule), toolbox, {
      attributes: true,
      attributeFilter: ["zen-sidebar-expanded"],
    });

    addListener(window, "aftercustomization", schedule);
    addListener(window, "sizemodechange", schedule);
    addListener(window, "resize", (event) => {
      // Zen and OverflowableToolbar also dispatch synthetic resize events.
      if (event.isTrusted) schedule();
    });

    if (window.matchMedia) {
      const densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      addListener(densityQuery, "change", schedule);
    }

    await calculate();
  }

  init().catch((error) => console.error("[Zen Auto Width]", error));
})();
