console.log("Website loaded");

if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

function resetScrollToTop() {
  window.scrollTo(0, 0);
  lastScrollY = 0;
  upwardScrollDistance = 0;
}

const siteTop = document.querySelector(".site-top");
const logoBar = document.querySelector(".logo-bar");
const mainNav = document.querySelector(".main-nav");
const heroTitle = document.querySelector(".hero-title");
const aboutPageHero = document.querySelector(".about-page-hero");

let collapsePoint = 0;
let lastScrollY = window.scrollY;
// HEADER SETTING: pixels to scroll upward before the full header expands.
// Increase for less sensitivity; decrease to expand sooner. Downward scroll collapses immediately.
const HEADER_EXPAND_DISTANCE = 102;
let upwardScrollDistance = 0;

function lockExpandedDockSize() {
  if (!siteTop) return;

  siteTop.style.removeProperty("--dock-height");
}

function calculateCollapsePoint() {
  if (!siteTop || !logoBar || !mainNav) return;

  siteTop.classList.remove("is-collapsed");
  lockExpandedDockSize();

  /* About page: change the header after passing the About hero */
  if (aboutPageHero) {
    collapsePoint =
      aboutPageHero.getBoundingClientRect().bottom + window.scrollY;

    return;
  }

  /* Home page: preserve the existing behavior */
  if (heroTitle) {
    const expandedHeaderHeight =
      logoBar.offsetHeight + mainNav.offsetHeight;

    const heroTitleTop =
      heroTitle.getBoundingClientRect().top + window.scrollY;

    collapsePoint = heroTitleTop - expandedHeaderHeight;
  }
}

function updateHeaderState(force = false) {
  if (!siteTop) return;

  // Ignore elastic overscroll at either end so a bounce cannot reverse the header.
  const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const currentScrollY = Math.max(0, Math.min(window.scrollY, maxScrollY));
  const scrollDifference = currentScrollY - lastScrollY;

  const isPastHeroBorder =
  currentScrollY > 0 && currentScrollY >= collapsePoint;
  siteTop.classList.toggle("is-past-hero-border", isPastHeroBorder);

  if (currentScrollY <= 0) {
    siteTop.classList.remove("is-collapsed");
    upwardScrollDistance = 0;
  } else if (force === true) {
    siteTop.classList.add("is-collapsed");
    upwardScrollDistance = 0;
  } else if (scrollDifference > 0) {
    siteTop.classList.add("is-collapsed");
    upwardScrollDistance = 0;
  } else if (scrollDifference < 0) {
    upwardScrollDistance -= scrollDifference;
    if (upwardScrollDistance >= HEADER_EXPAND_DISTANCE) {
      siteTop.classList.remove("is-collapsed");
    }
  }

  lastScrollY = currentScrollY;
}

resetScrollToTop();

window.addEventListener("load", () => {
  resetScrollToTop();
  calculateCollapsePoint();
  updateHeaderState(true);
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    resetScrollToTop();
    calculateCollapsePoint();
    updateHeaderState(true);
  }
});

window.addEventListener("resize", () => {
  calculateCollapsePoint();
  updateHeaderState(true);
});

let headerScrollTicking = false;

window.addEventListener("scroll", () => {
  if (headerScrollTicking) return;

  headerScrollTicking = true;
  requestAnimationFrame(() => {
    updateHeaderState();
    headerScrollTicking = false;
  });
}, { passive: true });

const menuToggle = document.querySelector(".menu-toggle");
const menuOverlay = document.querySelector(".menu-overlay");
const menuClose = document.querySelector(".menu-close");
const overlayLinks = document.querySelectorAll(".overlay-nav a");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let lastMenuTrigger = null;

if (menuToggle && menuOverlay) {
  const setMenuState = (isOpen) => {
    document.body.classList.toggle("menu-open", isOpen);
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuOverlay.setAttribute("aria-hidden", String(!isOpen));
  };

  const openMenu = () => {
    lastMenuTrigger = document.activeElement;
    setMenuState(true);
    (menuClose || overlayLinks[0])?.focus();
  };

  const closeMenu = () => {
    if (!document.body.classList.contains("menu-open")) return;

    setMenuState(false);
    (lastMenuTrigger || menuToggle).focus();
  };

  menuToggle.addEventListener("click", () => {
    if (document.body.classList.contains("menu-open")) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  if (menuClose) {
    menuClose.addEventListener("click", closeMenu);
  }

  overlayLinks.forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  menuOverlay.addEventListener("click", (event) => {
    if (event.target === menuOverlay) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });
}

const experienceCarousel = document.querySelector(".experience-carousel");
const experienceTrack = document.querySelector(".experience-track");
const experienceTitle = document.querySelector(".experience-title");
const experienceDescription = document.querySelector(".experience-description");
const experienceCount = document.querySelector(".experience-count");
const experiencePrev = document.querySelector(".experience-prev");
const experienceNext = document.querySelector(".experience-next");

if (
  experienceCarousel &&
  experienceTrack &&
  experienceTitle &&
  experienceDescription &&
  experienceCount &&
  experiencePrev &&
  experienceNext
) {
  const realSlides = Array.from(
    experienceTrack.querySelectorAll(".experience-slide")
  );
  
  // Two clones are needed on each end:
  // one centered slide and one visible neighboring slide.
  const cloneBuffer = Math.min(2, realSlides.length);
  
  function createExperienceClone(slide) {
    const clone = slide.cloneNode(true);
  
    clone.classList.remove("is-active");
    clone.classList.add("is-clone");
    clone.setAttribute("aria-hidden", "true");
  
    return clone;
  }
  
  const leadingClones = realSlides
    .slice(-cloneBuffer)
    .map(createExperienceClone);
  
  const trailingClones = realSlides
    .slice(0, cloneBuffer)
    .map(createExperienceClone);
  
  experienceTrack.prepend(...leadingClones);
  experienceTrack.append(...trailingClones);
  
  const allSlides = Array.from(
    experienceTrack.querySelectorAll(".experience-slide")
  );
  
  let currentPosition = cloneBuffer;
  let autoSlideTimer = null;
  let isMoving = false;
  let isHovering = false;

  function getRealIndex() {
    return (
      (currentPosition - cloneBuffer + realSlides.length) %
      realSlides.length
    );
  }

  function centerCurrentSlide(animate = true) {
    const activeSlide = allSlides[currentPosition];

    if (!animate) {
      experienceTrack.classList.add("no-transition");
    } else {
      experienceTrack.classList.remove("no-transition");
    }

    allSlides.forEach((slide, index) => {
      slide.classList.toggle("is-active", index === currentPosition);
    });

    const realIndex = getRealIndex();
    const realSlide = realSlides[realIndex];

    experienceTitle.textContent = realSlide.dataset.title || "";
    experienceDescription.textContent = realSlide.dataset.description || "";
    experienceCount.textContent = `${realIndex + 1} / ${realSlides.length}`;

    const carouselCenter = experienceCarousel.clientWidth / 2;
    const slideCenter = activeSlide.offsetLeft + activeSlide.offsetWidth / 2;
    const trackOffset = slideCenter - carouselCenter;

    experienceTrack.style.transform = `translate3d(${-trackOffset}px, 0, 0)`;

    if (!animate) {
      // Lock the invisible clone reset into place.
      experienceTrack.getBoundingClientRect();
    
      // Wait until the reset has actually been painted,
      // then restore normal sliding.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          experienceTrack.classList.remove("no-transition");
          isMoving = false;
        });
      });
    }
  }

  function goToSlide(position) {
    if (isMoving) return;

    isMoving = true;
    currentPosition = position;
    centerCurrentSlide(true);
  }

  function nextSlide() {
    goToSlide(currentPosition + 1);
  }

  function prevSlide() {
    goToSlide(currentPosition - 1);
  }

  function startAutoSlide() {
    stopAutoSlide();

    if (!isHovering) {
      autoSlideTimer = window.setInterval(nextSlide, 5000);
    }
  }

  function stopAutoSlide() {
    if (autoSlideTimer) {
      window.clearInterval(autoSlideTimer);
      autoSlideTimer = null;
    }
  }

  experienceTrack.addEventListener("transitionend", (event) => {
    if (
      event.target !== experienceTrack ||
      event.propertyName !== "transform"
    ) {
      return;
    }
  
    if (currentPosition >= cloneBuffer + realSlides.length) {
      currentPosition -= realSlides.length;
      centerCurrentSlide(false);
      return;
    }
  
    if (currentPosition < cloneBuffer) {
      currentPosition += realSlides.length;
      centerCurrentSlide(false);
      return;
    }
  
    isMoving = false;
  });

  experienceNext.addEventListener("click", () => {
    nextSlide();
    startAutoSlide();
  });

  experiencePrev.addEventListener("click", () => {
    prevSlide();
    startAutoSlide();
  });

  experienceCarousel.addEventListener("mouseenter", () => {
    isHovering = true;
    stopAutoSlide();
  });

  experienceCarousel.addEventListener("mouseleave", () => {
    isHovering = false;
    startAutoSlide();
  });

  window.addEventListener("resize", () => {
    requestAnimationFrame(() => centerCurrentSlide(false));
  });

  window.addEventListener("load", () => {
    setTimeout(() => {
      centerCurrentSlide(false);
      startAutoSlide();
    }, 50);
  });

  centerCurrentSlide(false);
  startAutoSlide();
}

/* Scroll reveal engine is initialized after page-specific widgets. */

/* Review slider */
const reviews = [
  {
    name: "Liz A.",
    source: "On Google",
    text: "The sushi is delicious 🍣 😊, they are very friendly, and the service is amazing. My girls love the food here, but it’s more for adults or young people."
  },
  {
    name: "Ignacia B.",
    source: "On Google",
    text: "The best of the best. The food was delicious and the service was excellent. They were very kind to me. Thanks, guys. I’ll be back tomorrow."
  },
  {
    name: "Ana C.",
    source: "On Google",
    text: "Food was great, me and my fiancé got the empanadas, aguachiles and a sushi roll. Everything was a 10/10, definitely would recommend."
  }
];

const reviewTrack = document.querySelector(".review-track");
const reviewPrev = document.querySelector(".review-prev");
const reviewNext = document.querySelector(".review-next");

let currentReview = 1;
let reviewIsMoving = false;

if (reviewTrack && reviewPrev && reviewNext) {
  // Clone the last and first reviews so the track can cross either edge
  // before snapping invisibly back to the matching real review.
  const loopedReviews = [reviews[reviews.length - 1], ...reviews, reviews[0]];

  reviewTrack.innerHTML = loopedReviews.map((review) => `
    <article class="review-slide">
      <p class="review-name">${review.name}</p>
      <p class="review-source">${review.source}</p>

      <div class="review-content">
        <span class="review-quote-mark review-quote-left">“</span>
        <p class="review-text">${review.text}</p>
        <span class="review-quote-mark review-quote-right">”</span>
      </div>
    </article>
  `).join("");

  function moveReviewSlider(animate = true) {
    if (!animate) {
      reviewTrack.style.transition = "none";
    }

    reviewTrack.style.transform = `translateX(-${currentReview * 100}%)`;

    if (!animate) {
      reviewTrack.offsetHeight;
      reviewTrack.style.transition = "";
    }
  }

  reviewNext.addEventListener("click", () => {
    if (reviewIsMoving) return;

    reviewIsMoving = true;
    currentReview += 1;
    moveReviewSlider();
  });

  reviewPrev.addEventListener("click", () => {
    if (reviewIsMoving) return;

    reviewIsMoving = true;
    currentReview -= 1;
    moveReviewSlider();
  });

  reviewTrack.addEventListener("transitionend", (event) => {
    if (event.target !== reviewTrack || event.propertyName !== "transform") return;

    if (currentReview === reviews.length + 1) {
      currentReview = 1;
      moveReviewSlider(false);
    } else if (currentReview === 0) {
      currentReview = reviews.length;
      moveReviewSlider(false);
    }

    reviewIsMoving = false;
  });

  moveReviewSlider(false);
}

/* The same water button works with a mouse, touchscreen, or keyboard. */
function addCarouselWaterPhysics(button, direction) {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const water = document.createElement("span");
  const waterSvg = document.createElementNS(svgNamespace, "svg");
  const waterPath = document.createElementNS(svgNamespace, "path");
  let arrow = button.querySelector(".review-arrow");

  if (!arrow) {
    arrow = document.createElement("span");
    arrow.textContent = button.textContent.trim();
    button.replaceChildren(arrow);
  }

  arrow.classList.add("water-arrow");
  arrow.setAttribute("aria-hidden", "true");
  button.classList.add("water-button", direction < 0 ? "water-button--prev" : "water-button--next");
  water.className = "button-water";
  water.setAttribute("aria-hidden", "true");
  waterSvg.setAttribute("viewBox", "0 0 100 100");
  waterSvg.setAttribute("preserveAspectRatio", "none");
  waterPath.setAttribute("class", "button-water-fill");
  waterSvg.appendChild(waterPath);
  water.appendChild(waterSvg);
  button.prepend(water);

  const state = {
    displacement: 0,
    velocity: 0,
    time: 0,
    lastTime: 0,
    frameId: null,
    dismissTimer: null,
    hovering: false
  };

  function drawWaterSurface() {
    const points = [];
    const rippleStrength = Math.min(
      4.5,
      Math.abs(state.velocity) * 0.58 + Math.abs(state.displacement) * 2.2
    );

    for (let index = 0; index <= 24; index += 1) {
      const progress = index / 24;
      const x = progress * 100;
      const tilt = state.displacement * 24 * (progress * 2 - 1);
      const travelingWave =
        Math.sin(progress * Math.PI * 2 + state.time * 8.5 * direction) * 0.65 +
        Math.sin(progress * Math.PI * 4 - state.time * 6.2 * direction) * 0.22;
      const y = Math.max(18, Math.min(80, 47 + tilt + rippleStrength * travelingWave));
      points.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
    }

    waterPath.setAttribute("d", `M ${points.join(" L ")} L 100 100 L 0 100 Z`);
  }

  function stopWater() {
    if (state.frameId !== null) cancelAnimationFrame(state.frameId);
    state.displacement = 0;
    state.velocity = 0;
    state.time = 0;
    state.lastTime = 0;
    state.frameId = null;
    drawWaterSurface();
  }

  function deactivate() {
    clearTimeout(state.dismissTimer);
    state.dismissTimer = null;
    button.classList.remove("is-water-active");
    stopWater();
  }

  function activate() {
    clearTimeout(state.dismissTimer);
    state.dismissTimer = null;
    button.classList.add("is-water-active");
  }

  function hasKeyboardFocus() {
    return button.matches(":focus-visible");
  }

  function simulateWater(now) {
    const deltaTime = Math.min((now - state.lastTime) / 1000, 0.032);
    state.lastTime = now;
    state.time += deltaTime;

    // Damped harmonic motion preserves the original directional slosh.
    state.velocity += (-46 * state.displacement - 3.7 * state.velocity) * deltaTime;
    state.displacement += state.velocity * deltaTime;
    drawWaterSurface();

    const hasSettled = state.time > 0.9 &&
      Math.abs(state.displacement) < 0.002 && Math.abs(state.velocity) < 0.015;
    if (hasSettled || state.time > 4) {
      stopWater();
      return;
    }

    state.frameId = requestAnimationFrame(simulateWater);
  }

  function addImpulse() {
    if (prefersReducedMotion.matches) return;
    state.velocity = Math.max(-5, Math.min(5, state.velocity + direction * 3.2));
    state.time = 0;
    if (state.frameId === null) {
      state.lastTime = performance.now();
      state.frameId = requestAnimationFrame(simulateWater);
    }
  }

  button.addEventListener("pointerenter", (event) => {
    // A finger enters/leaves on every tap; that must not reset the water.
    if (event.pointerType !== "mouse") return;
    state.hovering = true;
    activate();
  });

  button.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "mouse") return;
    state.hovering = false;
    if (!hasKeyboardFocus()) deactivate();
  });

  button.addEventListener("focus", () => {
    if (hasKeyboardFocus()) activate();
  });

  button.addEventListener("blur", () => {
    if (!state.hovering) deactivate();
  });

  // Native click covers touch, mouse, Enter and Space. Keep it independent
  // of carousel movement locks so rapid clicks still add water impulses.
  button.addEventListener("click", () => {
    activate();
    addImpulse();
    if (!state.hovering && !hasKeyboardFocus()) {
      state.dismissTimer = setTimeout(deactivate, 2600);
    }
  });

  prefersReducedMotion.addEventListener("change", stopWater);
  drawWaterSurface();
}

document.querySelectorAll(".review-prev, .experience-prev").forEach((button) => {
  addCarouselWaterPhysics(button, -1);
});
document.querySelectorAll(".review-next, .experience-next").forEach((button) => {
  addCarouselWaterPhysics(button, 1);
});

function revealItems(items, stagger = 80, initialDelay = 0) {
  items.forEach((item, index) => {
    item.style.setProperty("--reveal-delay", `${initialDelay + index * stagger}ms`);
    item.classList.add("is-visible");
  });
}

function initScrollRevealEngine() {
  const revealTargets = [
    {
      root: ".intro-section",
      children: ".intro-reveal-title, .intro-reveal-content, .intro-reveal-image",
      stagger: 140,
      delay: 40
    },
    {
      root: ".specialties-section",
      children: ".specialties-reveal-title, .specialties-reveal-content, .specialties-reveal-image",
      stagger: 130,
      delay: 40
    },
    {
      root: ".hours-section",
      children: ".hours-reveal-left, .hours-reveal-fade, .hours-reveal-right",
      stagger: 140,
      delay: 40
    },
    {
      root: ".menu-section",
      children: ".menu-reveal-heading, .menu-reveal-content, .menu-row",
      stagger: 70,
      delay: 20
    },
    {
      root: ".gallery-section",
      children: ".gallery-reveal-heading, .gallery-item, .gallery-view-more",
      stagger: 78,
      delay: 30
    },
    {
      root: ".experience-carousel-section",
      children: ".experience-info",
      stagger: 170,
      delay: 80
    },
    {
      root: ".reviews-section",
      children: ".review-shell",
      stagger: 80,
      delay: 40
    },
    {
      root: ".contact-info-section",
      children: ".contact-info-copy, .contact-visit-card",
      stagger: 150,
      delay: 40
    },
    {
      root: ".about-page-hero",
      self: true,
      children: ".about-page-breadcrumb, .about-page-title",
      stagger: 90,
      delay: 20
    },
    {
      root: ".menu-pdf-section",
      children: ".menu-pdf-heading-row, .menu-pdf-document",
      stagger: 140,
      delay: 40
    },
    {
      root: ".site-footer",
      children: ".footer-logo-link, .footer-nav, .footer-details",
      stagger: 90,
      delay: 20
    }
  ];

  const allRevealNodes = [];

  revealTargets.forEach((group) => {
    document.querySelectorAll(group.root).forEach((root) => {
      const items = group.children
        ? Array.from(root.querySelectorAll(group.children))
        : [];

      if (group.self) {
        items.unshift(root);
      }

      items.forEach((item) => allRevealNodes.push(item));
    });
  });

  if (prefersReducedMotion.matches) {
    document.documentElement.classList.add("reduce-motion");
    allRevealNodes.forEach((item) => item.classList.add("is-visible"));
    document.querySelectorAll(".reviews-section").forEach((section) => {
      section.classList.add("reviews-section-visible");
    });
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const group = entry.target.__revealGroup;
        const root = entry.target;
        const items = group.self
          ? [root, ...Array.from(root.querySelectorAll(group.children || ""))]
          : Array.from(root.querySelectorAll(group.children));

        revealItems(items, group.stagger, group.delay);

        if (root.classList.contains("reviews-section")) {
          root.classList.add("reviews-section-visible");
        }

        observer.unobserve(root);
      });
    },
    {
      threshold: 0.12,
      rootMargin: "0px 0px -8% 0px"
    }
  );

  revealTargets.forEach((group) => {
    document.querySelectorAll(group.root).forEach((root) => {
      root.__revealGroup = group;
      observer.observe(root);
    });
  });
}

initScrollRevealEngine();
