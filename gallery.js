(() => {
  "use strict";

  const grid = document.getElementById("photo-grid");
  if (!grid) return;

  const cards = Array.from(grid.querySelectorAll(".photo-card[data-category]"));
  const filters = document.getElementById("gallery-filters");
  const filterButtons = filters ? Array.from(filters.querySelectorAll("button[data-filter]")) : [];
  const status = document.getElementById("gallery-status");
  let activeFilter = "all";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let revealObserver = null;

  function revealCard(card, delay = 0) {
    card.style.setProperty("--reveal-delay", `${delay}ms`);
    card.classList.remove("is-reveal-pending");
    card.classList.add("is-revealed");
    revealObserver?.unobserve(card);
  }

  function revealAllCards() {
    revealObserver?.disconnect();
    revealObserver = null;
    cards.forEach((card) => revealCard(card));
  }

  // Cards stay visible unless scroll reveals are supported and motion is welcome.
  if ("IntersectionObserver" in window && !reducedMotion.matches) {
    try {
      revealObserver = new IntersectionObserver((entries) => {
        const entering = entries.filter((entry) => entry.isIntersecting && !entry.target.hidden)
          .sort((first, second) => first.boundingClientRect.top - second.boundingClientRect.top ||
            first.boundingClientRect.left - second.boundingClientRect.left);
        entering.forEach((entry, index) => revealCard(entry.target, Math.min(index * 40, 120)));
      }, { threshold: 0.06, rootMargin: "0px 0px -20px 0px" });
      cards.forEach((card) => {
        card.classList.add("is-reveal-pending");
        revealObserver.observe(card);
      });
    } catch {
      revealAllCards();
    }
  }

  grid.addEventListener("focusin", (event) => {
    const card = event.target.closest(".photo-card");
    if (card && grid.contains(card)) revealCard(card);
  });

  const handleMotionChange = (event) => {
    if (event.matches) revealAllCards();
  };
  if (typeof reducedMotion.addEventListener === "function") {
    reducedMotion.addEventListener("change", handleMotionChange);
  } else if (typeof reducedMotion.addListener === "function") {
    reducedMotion.addListener(handleMotionChange);
  }

  function visibleLinks() {
    return cards.filter((card) => !card.hidden)
      .map((card) => card.querySelector("a.photo-link"))
      .filter(Boolean);
  }

  function applyFilter(filter) {
    activeFilter = filter;
    cards.forEach((card) => {
      card.hidden = filter !== "all" && card.dataset.category !== filter;
    });
    filterButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
    });
    grid.classList.toggle("is-filtered", filter !== "all");

    // Each category selection starts a fresh reveal, including previously seen photos.
    if (revealObserver) {
      revealObserver.disconnect();
      revealObserver.takeRecords();
      cards.forEach((card) => {
        card.style.setProperty("--reveal-delay", "0ms");
        card.classList.remove("is-revealed");
        card.classList.add("is-reveal-pending");
      });
      // Commit the hidden starting frame before the observer reveals the new layout.
      void grid.offsetHeight;
      cards.forEach((card) => {
        if (!card.hidden) revealObserver.observe(card);
      });
    }

    if (status) {
      const count = cards.filter((card) => !card.hidden).length;
      const label = filterButtons.find((button) => button.dataset.filter === filter)?.textContent.trim();
      status.textContent = filter === "all"
        ? `${count} photos to explore`
        : `${count} ${count === 1 ? "photo" : "photos"} · ${label || filter}`;
    }
  }

  if (filters && filterButtons.length) {
    filters.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-filter]");
      if (!button || !filters.contains(button)) return;
      applyFilter(button.dataset.filter);
    });
    applyFilter("all");
    filters.hidden = false;
  }

  const viewer = document.getElementById("photo-viewer");
  const viewerImage = document.getElementById("viewer-image");
  const viewerCaption = document.getElementById("viewer-caption");
  const viewerCounter = document.getElementById("viewer-counter");
  const closeButton = document.getElementById("viewer-close");
  const previousButton = document.getElementById("viewer-prev");
  const nextButton = document.getElementById("viewer-next");

  // Normal image links remain usable if native dialogs are unavailable.
  if (!viewer || typeof viewer.showModal !== "function" || !viewerImage ||
      !viewerCaption || !viewerCounter || !closeButton || !previousButton || !nextButton) return;

  let currentLinks = [];
  let currentIndex = 0;
  let openingLink = null;
  let touchStart = null;

  function displayPhoto(index) {
    if (!currentLinks.length) return;
    currentIndex = (index + currentLinks.length) % currentLinks.length;
    const link = currentLinks[currentIndex];
    const thumbnail = link.querySelector("img");
    const title = link.dataset.title || link.closest(".photo-card")?.querySelector("figcaption h3")?.textContent.trim() || thumbnail?.alt || "El Malecón gallery";

    viewerImage.alt = thumbnail?.alt || title;
    viewerImage.src = link.href;
    viewerCaption.textContent = title;
    viewerCounter.textContent = `${currentIndex + 1} / ${currentLinks.length}`;
    previousButton.disabled = currentLinks.length < 2;
    nextButton.disabled = currentLinks.length < 2;
  }

  grid.addEventListener("click", (event) => {
    const link = event.target.closest("a.photo-link");
    if (!link || !grid.contains(link) || event.button !== 0 || event.metaKey ||
        event.ctrlKey || event.shiftKey || event.altKey) return;

    currentLinks = visibleLinks();
    const index = currentLinks.indexOf(link);
    if (index === -1) return;

    event.preventDefault();
    openingLink = link;
    displayPhoto(index);
    viewer.showModal();
    document.body.classList.add("gallery-viewer-open");
    closeButton.focus({ preventScroll: true });
  });

  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    viewer.close();
  });
  previousButton.addEventListener("click", (event) => {
    event.stopPropagation();
    displayPhoto(currentIndex - 1);
  });
  nextButton.addEventListener("click", (event) => {
    event.stopPropagation();
    displayPhoto(currentIndex + 1);
  });

  viewer.addEventListener("keydown", (event) => {
    if (!viewer.open || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      const button = event.key === "ArrowLeft" ? previousButton : nextButton;
      button.click();
    }
    // Escape retains the dialog's native cancel and focus behavior.
  });

  let backdropPress = false;
  function outsideDialog(event) {
    if (event.target !== viewer) return false;
    const bounds = viewer.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom;
  }
  viewer.addEventListener("pointerdown", (event) => {
    backdropPress = outsideDialog(event);
  });
  viewer.addEventListener("click", (event) => {
    if (backdropPress && outsideDialog(event)) viewer.close();
    backdropPress = false;
  });
  viewer.addEventListener("pointercancel", () => { backdropPress = false; });

  viewerImage.draggable = false;
  viewerImage.addEventListener("touchstart", (event) => {
    touchStart = event.touches.length === 1
      ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
      : null;
  }, { passive: true });
  viewerImage.addEventListener("touchmove", (event) => {
    if (event.touches.length !== 1) touchStart = null;
  }, { passive: true });
  viewerImage.addEventListener("touchend", (event) => {
    if (!touchStart || !viewer.open || event.changedTouches.length !== 1) {
      touchStart = null;
      return;
    }
    const deltaX = event.changedTouches[0].clientX - touchStart.x;
    const deltaY = event.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(deltaX) >= 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      (deltaX > 0 ? previousButton : nextButton).click();
    }
  }, { passive: true });
  viewerImage.addEventListener("touchcancel", () => { touchStart = null; }, { passive: true });

  viewer.addEventListener("close", () => {
    document.body.classList.remove("gallery-viewer-open");
    touchStart = null;
    backdropPress = false;
    if (openingLink?.isConnected && !openingLink.closest(".photo-card")?.hidden) {
      openingLink.focus({ preventScroll: true });
    } else {
      filterButtons.find((button) => button.dataset.filter === activeFilter)?.focus({ preventScroll: true });
    }
  });

  if (typeof addCarouselWaterPhysics === "function") {
    addCarouselWaterPhysics(previousButton, -1);
    addCarouselWaterPhysics(nextButton, 1);
  }
})();
