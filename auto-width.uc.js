(() => {
  "use strict";

  const INSTANCE_KEY = "__zenSidebarAutoWidth";
  const WIDTH_MARKER = "zen-auto-sidebar-width";
  const WIDTH_PROPERTY = "--zen-auto-sidebar-content-width";
  const LOADING_MODE_PREF = "zen-sidebar-auto-width-loading-indicator";
  const LOADING_MODE_RELOAD = 1;
  const LOADING_MODE_RING = 2;
  const LOADING_SPIN_DURATION = 800;
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
    loadingAnimation: null,
    loadingFinishAnimation: null,
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
    const stopReload = document.getElementById("stop-reload-button");
    const reloadButton = document.getElementById("reload-button");
    const stopButton = document.getElementById("stop-button");
    const controlsContainer = document.querySelector(
      ".titlebar-buttonbox-container",
    );

    function setupLoadingIndicator() {
      if (
        !navigator.platform.startsWith("Win") ||
        !stopReload ||
        !reloadButton ||
        !stopButton
      ) {
        return () => {};
      }

      const prefService =
        globalThis.Services?.prefs ??
        ChromeUtils.importESModule(
          "resource://gre/modules/Services.sys.mjs",
        ).Services.prefs;

      const glyph = document.createElement("span");
      glyph.className = "zen-auto-loading-glyph";
      glyph.setAttribute("aria-hidden", "true");
      stopReload.append(glyph);

      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      );
      let wasLoading = false;
      let mode = LOADING_MODE_RELOAD;

      function cancelAnimation(property) {
        state[property]?.cancel();
        state[property] = null;
      }

      function renderedAngle() {
        const transform = getComputedStyle(glyph).transform;
        if (!transform || transform === "none") return 0;

        try {
          const matrix = new DOMMatrixReadOnly(transform);
          const degrees = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
          return (degrees + 360) % 360;
        } catch {
          return 0;
        }
      }

      function hideGlyph() {
        cancelAnimation("loadingAnimation");
        cancelAnimation("loadingFinishAnimation");
        stopReload.removeAttribute("zen-auto-loading-active");
        stopReload.removeAttribute("zen-auto-loading-finishing");
        glyph.style.removeProperty("transform");
      }

      function syncLoadingIcon() {
        const reloadVisual = reloadButton.querySelector(
          ":scope > .toolbarbutton-icon",
        );
        const buttonStyle = getComputedStyle(reloadButton);
        const visualStyle = reloadVisual
          ? getComputedStyle(reloadVisual)
          : buttonStyle;
        const buttonImage = buttonStyle.listStyleImage;
        const visualImage = visualStyle.listStyleImage;
        const image =
          buttonImage && buttonImage !== "none" ? buttonImage : visualImage;
        const color =
          visualStyle.fill && CSS.supports("color", visualStyle.fill)
            ? visualStyle.fill
            : visualStyle.color;

        if (image && image !== "none") {
          stopReload.style.setProperty("--zen-auto-loading-image", image);
        } else {
          stopReload.style.removeProperty("--zen-auto-loading-image");
        }
        if (color && CSS.supports("color", color)) {
          stopReload.style.setProperty("--zen-auto-loading-color", color);
        } else {
          stopReload.style.removeProperty("--zen-auto-loading-color");
        }
        stopReload.style.setProperty(
          "--zen-auto-loading-opacity",
          visualStyle.fillOpacity || "1",
        );
        stopReload.style.setProperty(
          "--zen-auto-loading-element-opacity",
          visualStyle.opacity || "1",
        );
      }

      function startLoading() {
        syncLoadingIcon();
        const startAngle = stopReload.hasAttribute(
          "zen-auto-loading-finishing",
        )
          ? renderedAngle()
          : 0;

        cancelAnimation("loadingAnimation");
        cancelAnimation("loadingFinishAnimation");
        stopReload.removeAttribute("zen-auto-loading-finishing");
        stopReload.setAttribute("zen-auto-loading-active", "true");
        glyph.style.transform = `rotate(${startAngle}deg)`;

        if (reducedMotion.matches) return;
        state.loadingAnimation = glyph.animate(
          [
            { transform: `rotate(${startAngle}deg)` },
            { transform: `rotate(${startAngle + 360}deg)` },
          ],
          {
            duration: LOADING_SPIN_DURATION,
            iterations: Infinity,
            easing: "linear",
          },
        );
      }

      function finishLoading() {
        // Firefox has already revealed (and may temporarily disable) Reload by
        // the time the mutation observer runs, so also match its final color.
        syncLoadingIcon();
        const angle = renderedAngle();
        cancelAnimation("loadingAnimation");
        stopReload.removeAttribute("zen-auto-loading-active");

        // The old ring is a different shape, so only the reused reload SVG can
        // visually settle into the native reload icon at its original angle.
        if (
          mode !== LOADING_MODE_RELOAD ||
          reducedMotion.matches ||
          angle < 0.5 ||
          angle > 359.5
        ) {
          hideGlyph();
          return;
        }

        stopReload.setAttribute("zen-auto-loading-finishing", "true");
        const remaining = 360 - angle;
        const angularVelocity = 360 / LOADING_SPIN_DURATION;
        const preferredDuration = 140 + (remaining / 360) * 240;
        const longestMonotonicDuration = (3 * remaining) / angularVelocity;
        const duration = Math.min(
          preferredDuration,
          longestMonotonicDuration,
        );
        const normalizedStartVelocity = Math.min(
          3,
          (angularVelocity * duration) / remaining,
        );
        const firstControlY = normalizedStartVelocity / 3;
        const animation = glyph.animate(
          [
            { transform: `rotate(${angle}deg)` },
            { transform: "rotate(360deg)" },
          ],
          {
            duration,
            // With the X control points at 1/3 and 2/3, this cubic is a
            // time-domain Hermite curve. Its first derivative matches the
            // endless spin and its last derivative is zero, avoiding both a
            // speed jump at handoff and a hard stop at the reload angle.
            easing:
              `cubic-bezier(0.333333, ${firstControlY}, 0.666667, 1)`,
            fill: "forwards",
          },
        );
        state.loadingFinishAnimation = animation;
        animation.onfinish = () => {
          if (state.loadingFinishAnimation !== animation) return;
          state.loadingFinishAnimation = null;
          animation.cancel();
          stopReload.removeAttribute("zen-auto-loading-finishing");
          glyph.style.removeProperty("transform");
        };
      }

      function syncLoadingState() {
        const isLoading = reloadButton.hasAttribute("displaystop");
        if (isLoading === wasLoading) return;
        wasLoading = isLoading;
        if (isLoading) startLoading();
        else finishLoading();
      }

      function applyLoadingMode() {
        try {
          mode = prefService.getIntPref(
            LOADING_MODE_PREF,
            LOADING_MODE_RELOAD,
          );
        } catch {
          mode = LOADING_MODE_RELOAD;
        }
        if (mode !== LOADING_MODE_RING) mode = LOADING_MODE_RELOAD;
        stopReload.setAttribute(
          "zen-auto-loading-mode",
          mode === LOADING_MODE_RING ? "ring" : "reload",
        );
        syncLoadingIcon();
        if (stopReload.hasAttribute("zen-auto-loading-finishing")) {
          hideGlyph();
        }
      }

      const loadingObserver = new MutationObserver(syncLoadingState);
      addObserver(loadingObserver, reloadButton, {
        attributes: true,
        attributeFilter: ["displaystop"],
      });
      addListener(
        stopReload,
        "zen-auto-sync-loading-icon",
        syncLoadingIcon,
      );

      const prefObserver = { observe: applyLoadingMode };
      prefService.addObserver(LOADING_MODE_PREF, prefObserver);
      addListener(reducedMotion, "change", () => {
        if (wasLoading) startLoading();
        else hideGlyph();
      });

      applyLoadingMode();
      if (reloadButton.hasAttribute("displaystop")) {
        wasLoading = true;
        startLoading();
      }

      return () => {
        prefService.removeObserver(LOADING_MODE_PREF, prefObserver);
        hideGlyph();
        stopReload.removeAttribute("zen-auto-loading-mode");
        stopReload.style.removeProperty("--zen-auto-loading-image");
        stopReload.style.removeProperty("--zen-auto-loading-color");
        stopReload.style.removeProperty("--zen-auto-loading-opacity");
        stopReload.style.removeProperty("--zen-auto-loading-element-opacity");
        glyph.remove();
      };
    }

    const destroyLoadingIndicator = setupLoadingIndicator();
    state.restorers.push(destroyLoadingIndicator);

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

      // At a narrow sidebar width the flex row compresses its buttons. Reading
      // those compressed rectangles makes each recalculation add only a few
      // pixels, producing a visible staircase toward the final width. Disable
      // flex growth and shrinking synchronously so this pass sees the row's
      // intrinsic size. The original inline declarations are restored before
      // the browser can paint or deliver a resize/overflow notification.
      const originalFlex = children.map((child) => [
        child,
        child.style.getPropertyValue("flex-grow"),
        child.style.getPropertyPriority("flex-grow"),
        child.style.getPropertyValue("flex-shrink"),
        child.style.getPropertyPriority("flex-shrink"),
      ]);

      try {
        for (const child of children) {
          child.style.setProperty("flex-grow", "0", "important");
          child.style.setProperty("flex-shrink", "0", "important");
        }

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
      } finally {
        for (const [
          child,
          growValue,
          growPriority,
          shrinkValue,
          shrinkPriority,
        ] of originalFlex) {
          if (growValue) {
            child.style.setProperty("flex-grow", growValue, growPriority);
          } else {
            child.style.removeProperty("flex-grow");
          }
          if (shrinkValue) {
            child.style.setProperty("flex-shrink", shrinkValue, shrinkPriority);
          } else {
            child.style.removeProperty("flex-shrink");
          }
        }
      }
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
          stopReload?.dispatchEvent(
            new CustomEvent("zen-auto-sync-loading-icon"),
          );
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
