(() => {
  "use strict";

  const INSTANCE_KEY = "__zenSidebarAutoWidth";
  const root = document.documentElement;

  // Sine can reload user scripts without restarting the browser.
  window[INSTANCE_KEY]?.destroy();

  const state = {
    destroyed: false,
    running: false,
    timer: 0,
    observers: [],
    listeners: [],
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  function destroy() {
    state.destroyed = true;
    clearTimeout(state.timer);
    state.observers.forEach((observer) => observer.disconnect());
    state.listeners.forEach((remove) => remove());
    root.style.removeProperty("--zen-auto-sidebar-min-width");
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

    const persistentButtonIds = [
      "PanelUI-button",
      "back-button",
      "forward-button",
      "stop-reload-button",
    ];

    function lockOverflow() {
      for (const id of persistentButtonIds) {
        document.getElementById(id)?.setAttribute("overflows", "false");
      }
    }

    const afterLayout = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );

    async function calculate() {
      if (state.destroyed) return;
      if (state.running) return;
      if (toolbox.getAttribute("zen-sidebar-expanded") !== "true") return;

      state.running = true;

      try {
        lockOverflow();

        const extraWidth = Math.max(
          0,
          toolbox.getBoundingClientRect().width - topBar.getBoundingClientRect().width,
        );

        // Temporarily expand the sidebar so Firefox can move overflowed items back.
        root.style.setProperty("--zen-auto-sidebar-min-width", `${window.innerWidth}px`);
        window.dispatchEvent(new Event("resize"));

        for (let attempt = 0; attempt < 12; attempt += 1) {
          if (state.destroyed) return;
          lockOverflow();
          window.dispatchEvent(new Event("resize"));
          await sleep(25);
        }

        const measuredProperties = ["width", "min-width", "max-width"];
        const previousValues = Object.fromEntries(
          measuredProperties.map((property) => [
            property,
            {
              value: topBar.style.getPropertyValue(property),
              priority: topBar.style.getPropertyPriority(property),
            },
          ]),
        );

        try {
          topBar.style.setProperty("width", "max-content", "important");
          topBar.style.setProperty("min-width", "max-content", "important");
          topBar.style.setProperty("max-width", "none", "important");
          await afterLayout();

          const requiredWidth =
            Math.ceil(topBar.getBoundingClientRect().width + extraWidth) + 1;

          if (Number.isFinite(requiredWidth) && requiredWidth > 0) {
            root.style.setProperty(
              "--zen-auto-sidebar-min-width",
              `${requiredWidth}px`,
            );
            console.info(`[Zen Auto Width] Sidebar width: ${requiredWidth}px`);
          }
        } finally {
          for (const property of measuredProperties) {
            const { value, priority } = previousValues[property];
            if (value) topBar.style.setProperty(property, value, priority);
            else topBar.style.removeProperty(property);
          }
        }

        lockOverflow();
        window.dispatchEvent(new Event("resize"));
      } finally {
        state.running = false;
      }
    }

    function schedule() {
      // Ignore mutations and synthetic resize events caused by our own measurement.
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
    addListener(window, "resize", schedule);

    if (window.matchMedia) {
      const densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      addListener(densityQuery, "change", schedule);
    }

    await calculate();
  }

  init().catch((error) => console.error("[Zen Auto Width]", error));
})();
