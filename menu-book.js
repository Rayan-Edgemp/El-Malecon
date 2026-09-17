(() => {
  const viewer = document.querySelector(".menu-book");
  if (!viewer) return;

  // Explicit order: the source filenames use different capitalization and spellings.
  const pages = [
    ["El Malecon Cover Page 1 copy.webp", "Menu cover"],
    ["Page 2 El Malacon copy.webp", "Welcome to El Malecón"],
    ["EL MALACON PAGE 3 copy.webp", "Appetizers, empanadas, wings and botanas"],
    ["El malacon page 4  copy.webp", "Camarones, salads, ceviches and aguachiles"],
    ["el malacon page 5 copy.webp", "Tacos, quesabirria, platillos and parrilladas"],
    ["EL MELACON PAGE 6 copy.webp", "Burgers, molcajetes, kids menu and seafood cocktails"],
    ["el malacon page 7 copy.webp", "Sushi"],
    ["page 8 drink page copy.webp", "Drinks and aguas frescas"]
  ].map(([file, title], index) => ({
    source: `Images/WebP/${encodeURIComponent(file)}`,
    preview: `assets/menu/page-${index + 1}.webp`,
    title,
    number: index + 1
  }));
  const spreads = [[0], [1, 2], [3, 4], [5, 6], [7]];
  const previous = viewer.querySelector(".menu-book-prev");
  const next = viewer.querySelector(".menu-book-next");
  const left = viewer.querySelector(".menu-book-page--left");
  const right = viewer.querySelector(".menu-book-page--right");
  const front = viewer.querySelector(".menu-book-face--front");
  const back = viewer.querySelector(".menu-book-face--back");
  const leaf = viewer.querySelector(".menu-book-leaf");
  const track = viewer.querySelector(".menu-book-track");
  const stage = viewer.querySelector(".menu-book-stage");
  const status = viewer.querySelector(".menu-book-status");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const cached = new Map();
  let spreadIndex = 0;
  // Clicks advance the requested position immediately, even while earlier
  // transitions are still painting. Each job owns one step through the book.
  let requestedIndex = 0;
  const pending = [];
  const activeWaves = [];
  let starting = false;
  let settling = false;
  let queueTimer;
  let generation = 0;
  let busy = false;
  let finishTimer;
  let curlFrame;
  const paperRenderers = new Map();
  let activeTurn = null;

  function boundaryTurn(from, destination) {
    const lower = Math.min(from, destination);
    const upper = Math.max(from, destination);
    if (lower === 0 && upper === 1) {
      return { edge: "front", pages: [0, 1], stationary: 2, destination, forward: destination > from };
    }
    if (lower === spreads.length - 2 && upper === spreads.length - 1) {
      return { edge: "back", pages: [6, 7], stationary: 5, destination, forward: destination > from };
    }
    return null;
  }

  function coverShift(progress) {
    const center = Math.max(0, Math.min(1, (progress - .12) / .88));
    return -25 * Math.pow(1 - center, 3);
  }

  function drawPaper(elapsed) {
    activeTurn.elapsed = elapsed;
    const { forward, edge, renderer, waterScene } = activeTurn;
    const progress = forward ? elapsed : 1 - elapsed;
    const shift = edge === "front" ? coverShift(progress) : -coverShift(1 - progress);
    track.style.transform = `translateX(${shift}%)`;
    if (waterScene) waterScene.draw(shift, renderer);
    const extent = renderer.draw(progress, renderer.width * shift / 100);
    viewer.style.setProperty("--curl-shadow-width", `${extent * 100}%`);
    viewer.style.setProperty("--curl-shadow-opacity", (Math.sin(Math.PI * progress) * .24).toFixed(3));
  }

  function clearTurn() {
    clearTimeout(finishTimer);
    cancelAnimationFrame(curlFrame);
    const completed = activeTurn;
    activeTurn = null;
    if (completed) {
      if (completed.waterScene) {
        completed.waterScene.dispose();
        completed.renderer.restoreFace(completed.waterScene.faceIndex);
      }
      completed.renderer.clear();
      completed.renderer.canvas.classList.remove("is-active");
    }
    track.style.removeProperty("transform");
    viewer.style.removeProperty("--curl-shadow-width");
    viewer.style.removeProperty("--curl-shadow-opacity");
    viewer.classList.remove("is-turning");
    viewer.classList.remove("is-paper-wave");
    delete viewer.dataset.turn;
    return completed;
  }

  function finishTurn() {
    const completed = clearTurn();
    if (!completed) return;
    // A closing sheet supersedes its earlier waves. Their late callbacks must
    // never reopen a spread after the single page has settled.
    if (completed.closing) {
      for (const wave of activeWaves.splice(0)) {
        cancelAnimationFrame(wave.frame);
        clearTimeout(wave.timer);
        wave.renderer.dispose();
        wave.underlay?.dispose();
      }
      viewer.classList.remove("is-waving");
    }
    render(completed.destination);
    if (activeWaves[0]?.done) {
      finishWave(activeWaves[0]);
      return;
    }
    pumpQueue();
  }

  async function turnPaperCover(turn, token) {
    try {
      let renderer = paperRenderers.get(turn.edge);
      if (!renderer) {
        const images = await Promise.all(turn.pages.map(prepare));
        if (token !== generation) return false;
        renderer = await window.ElMaleconPaper.create(stage, images, () => {
          // A late callback from an old context must not clear its replacement.
          if (paperRenderers.get(turn.edge) !== renderer) return;
          if (activeTurn?.renderer === renderer) finishTurn();
          renderer.dispose();
          paperRenderers.delete(turn.edge);
        }, turn.pages);
        if (token !== generation) {
          renderer.dispose();
          return false;
        }
        paperRenderers.set(turn.edge, renderer);
      }
      if (token !== generation || motion.matches) return false;
      const closing = spreads[turn.destination].length === 1;
      const baseImages = closing && activeWaves.length
        ? await Promise.all(spreads[spreadIndex].map(prepare)) : null;
      if (token !== generation || motion.matches) return false;
      renderer.resize();
      activeTurn = { ...turn, closing, renderer };
      if (baseImages && activeWaves.length) {
        activeTurn.waterScene = paperWaterScene(turn, baseImages, activeWaves);
        viewer.classList.add("is-paper-wave");
      }
      setPage(turn.edge === "front" ? right : left, turn.stationary);
      viewer.dataset.turn = turn.edge;
      drawPaper(0);
      [leaf, left, right].forEach((page) => {
        page.inert = true;
        page.setAttribute("aria-hidden", "true");
      });
      renderer.canvas.classList.add("is-active");
      viewer.classList.add("is-turning");
    } catch (error) {
      if (token !== generation) return false;
      clearTurn();
      paperRenderers.get(turn.edge)?.dispose();
      paperRenderers.delete(turn.edge);
      // Animation support must never stop navigation through the menu.
      console.warn("Showing the menu without its cover animation.", error);
      return false;
    }
    const cssDuration = getComputedStyle(viewer).getPropertyValue("--book-opening-time").trim();
    const parsedDuration = parseFloat(cssDuration);
    const duration = Number.isFinite(parsedDuration) && parsedDuration > 0
      ? parsedDuration * (cssDuration.endsWith("ms") ? 1 : 1000) : 1450;
    const started = performance.now();
    const animate = (now) => {
      if (!activeTurn) return;
      const progress = Math.min(1, (now - started) / duration);
      try {
        drawPaper(progress);
        if (progress < 1) curlFrame = requestAnimationFrame(animate);
        else finishTurn();
      } catch {
        finishTurn();
        paperRenderers.get(turn.edge)?.dispose();
        paperRenderers.delete(turn.edge);
      }
    };
    curlFrame = requestAnimationFrame(animate);
    finishTimer = setTimeout(finishTurn, duration + 300);
    return true;
  }

  function finishWave(completed) {
    if (!activeWaves.includes(completed)) return;
    completed.done = true;
    cancelAnimationFrame(completed.frame);
    clearTimeout(completed.timer);
    // A wave feeding either face of a curl must keep its canvas until the paper
    // settles. Finishing that wave cannot snap the curl to its final position.
    if (activeTurn?.closing || activeTurn?.waterScene) return;
    // Keep completed layers until every older layer can be committed in order.
    // A later callback must never restore an earlier spread over a newer one.
    if (!activeWaves[0].done) return;
    if (activeTurn) finishTurn();
    while (activeWaves[0]?.done) {
      const wave = activeWaves.shift();
      // Promote the already-painted images instead of loading them into new
      // nodes when their overlay disappears (which can flash on first use).
      wave.renderer.commitPages([left, right]);
      render(wave.destination);
      wave.renderer.dispose();
      wave.underlay?.dispose();
    }
    viewer.classList.toggle("is-waving", activeWaves.length > 0);
    updateControls();
    pumpQueue();
  }

  async function finishTransition() {
    const token = ++generation;
    const destination = requestedIndex;
    clearTimeout(queueTimer);
    pending.length = 0;
    starting = false;
    settling = true;
    clearTurn();
    for (const wave of activeWaves.splice(0)) {
      cancelAnimationFrame(wave.frame);
      clearTimeout(wave.timer);
      wave.renderer.dispose();
      wave.underlay?.dispose();
    }
    viewer.classList.remove("is-waving");
    updateControls();
    try {
      await Promise.all(spreads[destination].map(prepare));
      if (token !== generation) return;
      render(destination);
    } catch {
      if (token !== generation) return;
      requestedIndex = spreadIndex;
      pending.length = 0;
    } finally {
      if (token === generation) {
        settling = false;
        updateControls();
        pumpQueue();
      }
    }
  }

  async function waveSpread(destination, direction, images, token) {
    if (motion.matches) return false;
    let renderer, wave;
    try {
      // Use the logical preceding spread even when another wave is still running.
      const previousImages = await Promise.all(spreads[destination - direction].map(prepare));
      const olderWaves = activeWaves.slice();
      let underlay;
      if (olderWaves.some((older) => older.direction !== direction)) {
        const baseIndex = olderWaves[0].destination - olderWaves[0].direction;
        const baseImages = await Promise.all(spreads[baseIndex].map(prepare));
        const layers = await Promise.all(olderWaves.map(async (older) => ({
          wave: older, images: await Promise.all(spreads[older.destination].map(prepare))
        })));
        underlay = { baseImages, layers };
      }
      renderer = await window.ElMaleconWave.create(stage, images, direction, previousImages);
      if (token !== generation || motion.matches) {
        renderer.dispose();
        return false;
      }
      wave = { destination, direction, renderer };
      // Every later opposing wave absorbs the older water at contact. Keep the
      // reveal layers in click order, so returning print always has priority.
      activeWaves.push(wave);
      for (let i = 0; i < activeWaves.length; i++) {
        const older = activeWaves[i];
        older.renderer.setDominantWaves(activeWaves.slice(i + 1)
          .filter((newer) => newer.direction !== older.direction)
          .map((newer) => newer.renderer));
      }
      if (underlay) {
        // The old print in the drying patch must match the actual mixed scene,
        // not assume the previous wave already revealed its entire destination.
        wave.underlay = waveUnderlay(underlay.baseImages, underlay.layers);
        renderer.setUnderlaySource(wave.underlay.canvas);
      }
      // The second cover click starts water immediately in page coordinates.
      // Newer queued waves use this same live list, so they follow the paper too.
      if (activeTurn && !activeTurn.closing && !activeTurn.waterScene &&
          activeTurn.destination === destination - direction) {
        activeTurn.waterScene = paperWaterScene(activeTurn, previousImages, activeWaves);
        viewer.classList.add("is-paper-wave");
        drawPaper(activeTurn.elapsed);
      }
      [left, right].forEach((page) => {
        page.inert = true;
        page.setAttribute("aria-hidden", "true");
      });
      viewer.classList.add("is-waving");
      const cssDuration = getComputedStyle(viewer).getPropertyValue("--book-wave-time").trim();
      const parsedDuration = parseFloat(cssDuration);
      const duration = Number.isFinite(parsedDuration) && parsedDuration > 0
        ? parsedDuration * (cssDuration.endsWith("ms") ? 1 : 1000) : 1700;
      const started = performance.now();
      wave.started = started;
      wave.spacing = window.ElMaleconWave.separationDelay(duration);
      const animate = (now) => {
        if (!activeWaves.includes(wave)) return;
        const progress = Math.min(1, (now - started) / duration);
        try {
          wave.underlay?.draw();
          renderer.draw(progress);
          if (progress < 1) wave.frame = requestAnimationFrame(animate);
          else finishWave(wave);
        } catch {
          finishWave(wave);
        }
      };
      wave.animate = animate;
      wave.frame = requestAnimationFrame(animate);
      // Sample dominant bodies first in each frame. Older particles then test
      // contact against the newer sheet's current movement, not a stale mask.
      for (const older of activeWaves.slice(0, -1).reverse()) {
        if (older.done) continue;
        cancelAnimationFrame(older.frame);
        older.frame = requestAnimationFrame(older.animate);
      }
      wave.timer = setTimeout(() => finishWave(wave), duration + 300);
      return true;
    } catch (error) {
      if (wave) {
        const index = activeWaves.indexOf(wave);
        if (index !== -1) activeWaves.splice(index, 1);
      }
      renderer?.dispose();
      wave?.underlay?.dispose();
      console.warn("Showing the next spread without its wave transition.", error);
      return false;
    }
  }

  function prepare(index) {
    if (!cached.has(index)) {
      const image = new Image();
      image.src = pages[index].preview;
      const ready = image.decode().then(() => image).catch((error) => {
        cached.delete(index);
        throw error;
      });
      cached.set(index, ready);
    }
    return cached.get(index);
  }

  function setPage(link, index) {
    const page = pages[index];
    link.href = page.source;
    link.setAttribute("aria-label", `Enlarge page ${page.number}: ${page.title}`);
    const image = link.querySelector("img");
    const source = new URL(page.preview, document.baseURI).href;
    if (image.src !== source) image.src = page.preview;
    image.alt = `Page ${page.number} — ${page.title}`;
  }

  function updateControls() {
    busy = starting || settling || pending.length > 0 || !!activeTurn || activeWaves.length > 0;
    // Bound clicks against the end of the queue, not the last painted spread.
    previous.setAttribute("aria-disabled", String(requestedIndex === 0));
    next.setAttribute("aria-disabled", String(requestedIndex === spreads.length - 1));
    viewer.setAttribute("aria-busy", String(busy));
    const cover = spreadIndex === 0;
    const last = spreadIndex === spreads.length - 1;
    for (const [page, hidden] of [[leaf, !cover], [left, cover], [right, cover || last]]) {
      page.inert = busy || hidden;
      page.setAttribute("aria-hidden", String(busy || hidden));
    }
  }

  function render(index) {
    spreadIndex = index;
    const spread = spreads[index];
    const isCover = index === 0;
    const isLast = spread.length === 1 && !isCover;
    viewer.dataset.view = isCover ? "cover" : isLast ? "last" : "spread";
    leaf.inert = !isCover;
    leaf.setAttribute("aria-hidden", String(!isCover));
    left.inert = isCover;
    right.inert = isCover || isLast;
    left.setAttribute("aria-hidden", String(isCover));
    right.setAttribute("aria-hidden", String(isCover || isLast));
    if (!isCover) {
      setPage(left, spread[0]);
      if (spread.length > 1) setPage(right, spread[1]);
    }
    status.textContent = isCover ? "Cover · 1 of 8" : isLast ? "Page 8 of 8 · Drinks" :
      `Pages ${spread[0] + 1}–${spread[1] + 1} of 8`;
    updateControls();
    // Warm the next two steps so a second click can follow the opening curl.
    spreads.slice(index + 1, index + 3).flat().forEach((page) => prepare(page).catch(() => {}));
  }

  function navigate(direction) {
    const destination = requestedIndex + direction;
    if (destination < 0 || destination >= spreads.length) return;
    pending.push({ from: requestedIndex, destination, direction });
    requestedIndex = destination;
    spreads[destination].forEach((page) => prepare(page).catch(() => {}));
    updateControls();
    pumpQueue();
  }

  function paperWaterScene(turn, baseImages, waves) {
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    const half = Math.max(1, Math.round(stage.clientWidth * scale / 2));
    const height = Math.max(1, Math.round(stage.clientHeight * scale));
    const width = half * 2;
    const makeCanvas = (w) => {
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = height;
      return canvas;
    };
    const composite = makeCanvas(width), face = makeCanvas(half), stationary = makeCanvas(width);
    const ctx = composite.getContext("2d"), faceCtx = face.getContext("2d"), stationaryCtx = stationary.getContext("2d");
    const turningHalf = turn.edge === "front" ? 0 : 1;
    const faceIndex = turn.edge === "front" ? 1 : 0;
    const stationaryHalf = 1 - turningHalf;
    stationary.className = "menu-book-paper-water";
    stationary.setAttribute("aria-hidden", "true");
    stage.appendChild(stationary);
    return {
      faceIndex,
      draw(shift, renderer) {
        ctx.fillStyle = "#f5ead4"; ctx.fillRect(0, 0, width, height);
        baseImages.forEach((image, i) => {
          const size = Math.min(half / image.naturalWidth, height / image.naturalHeight);
          const w = image.naturalWidth * size, h = image.naturalHeight * size;
          ctx.drawImage(image, i * half + (half - w) / 2, (height - h) / 2, w, h);
        });
        for (const wave of waves) ctx.drawImage(wave.renderer.canvas, 0, 0, width, height);
        faceCtx.clearRect(0, 0, half, height);
        faceCtx.drawImage(composite, turningHalf * half, 0, half, height, 0, 0, half, height);
        renderer.setFaceSource(faceIndex, face);
        stationaryCtx.clearRect(0, 0, width, height);
        stationaryCtx.drawImage(composite, stationaryHalf * half, 0, half, height,
          stationaryHalf * half + width * shift / 100, 0, half, height);
      },
      dispose() {
        stationary.remove();
        composite.width = face.width = stationary.width = 0;
      }
    };
  }

  function waveUnderlay(baseImages, layers) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    // Keep the last committed older destination as the base after its renderer
    // is disposed. Later overlays still supply their partially revealed pages.
    let base = baseImages;
    return {
      canvas,
      draw() {
        const scale = Math.min(window.devicePixelRatio || 1, 1.5);
        const width = Math.max(2, Math.round(stage.clientWidth * scale));
        const height = Math.max(1, Math.round(stage.clientHeight * scale));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        for (const layer of layers) {
          if (layer.wave.renderer.disposed) base = layer.images;
        }
        ctx.fillStyle = "#f5ead4"; ctx.fillRect(0, 0, width, height);
        base.forEach((image, i) => {
          const size = Math.min(width / 2 / image.naturalWidth, height / image.naturalHeight);
          const w = image.naturalWidth * size, h = image.naturalHeight * size;
          ctx.drawImage(image, i * width / 2 + (width / 2 - w) / 2, (height - h) / 2, w, h);
        });
        for (const { wave } of layers) {
          if (!wave.renderer.disposed) ctx.drawImage(wave.renderer.canvas, 0, 0, width, height);
        }
      },
      dispose() { canvas.width = 0; }
    };
  }

  async function pumpQueue() {
    clearTimeout(queueTimer);
    if (starting || settling || !pending.length) return;
    const job = pending[0];
    const turn = boundaryTurn(job.from, job.destination);
    if (activeTurn || activeWaves.length) {
      // A closing curl can consume the latest wave immediately. A returning
      // spread wave can also start now, even against an unfinished older wave.
      const closingWave = turn && spreads[job.destination].length === 1 &&
        !activeTurn && activeWaves.at(-1)?.destination === job.from;
      if ((turn && !closingWave) || activeTurn?.closing ||
          (activeTurn && !activeTurn.waterScene && activeTurn.destination !== job.from)) return;
      const latest = activeWaves[activeWaves.length - 1];
      const wait = latest && !closingWave && latest.direction === job.direction
        ? latest.started + latest.spacing - performance.now() : 0;
      if (wait > 0) {
        queueTimer = setTimeout(pumpQueue, wait);
        return;
      }
    }
    pending.shift();
    starting = true;
    const token = generation;
    updateControls();
    try {
      const pageIndexes = turn ? [...turn.pages, turn.stationary] : spreads[job.destination];
      const images = await Promise.all(pageIndexes.map(prepare));
      if (token !== generation) return;
      const animated = !motion.matches && (turn
        ? await turnPaperCover(turn, token)
        : await waveSpread(job.destination, job.direction, images, token));
      if (token !== generation) return;
      if (!animated) {
        // If animation support fails, finish older steps before showing this one.
        finishTurn();
        [...activeWaves].forEach(finishWave);
        render(job.destination);
      }
    } catch {
      if (token !== generation) return;
      pending.length = 0;
      requestedIndex = activeWaves[activeWaves.length - 1]?.destination ?? activeTurn?.destination ?? spreadIndex;
      status.textContent = "This page couldn’t load. Try the arrow again, or download the menu.";
    } finally {
      if (token === generation) {
        starting = false;
        updateControls();
        pumpQueue();
      }
    }
  }

  setPage(front, 0);
  setPage(back, 1);
  back.inert = true;
  back.setAttribute("aria-hidden", "true");
  previous.addEventListener("click", () => navigate(-1));
  next.addEventListener("click", () => navigate(1));
  [previous, next].forEach((button) => {
    button.disabled = false;
    button.addEventListener("click", (event) => {
      if (button.getAttribute("aria-disabled") === "true") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  });
  // Settle cleanly if the user rotates their phone during the turn.
  window.addEventListener("resize", finishTransition);
  motion.addEventListener("change", (event) => {
    if (event.matches) finishTransition();
  });
  viewer.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      (event.key === "ArrowLeft" ? previous : next).click();
    }
  });

  let touchStart = null;
  let ignoreClickUntil = 0;
  stage.addEventListener("touchstart", (event) => {
    touchStart = event.touches.length === 1
      ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
  }, { passive: true });
  stage.addEventListener("touchmove", (event) => {
    if (event.touches.length !== 1) touchStart = null;
  }, { passive: true });
  stage.addEventListener("touchend", (event) => {
    if (!touchStart || !event.changedTouches.length) return;
    const x = event.changedTouches[0].clientX - touchStart.x;
    const y = event.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(x) > 50 && Math.abs(x) > Math.abs(y) * 1.5) {
      ignoreClickUntil = performance.now() + 500;
      (x > 0 ? previous : next).click();
    }
  }, { passive: true });
  stage.addEventListener("touchcancel", () => { touchStart = null; }, { passive: true });
  stage.addEventListener("click", (event) => {
    if (busy || performance.now() < ignoreClickUntil) event.preventDefault();
  }, true);

  if (typeof addCarouselWaterPhysics === "function") {
    addCarouselWaterPhysics(previous, -1);
    addCarouselWaterPhysics(next, 1);
  }
  previous.hidden = false;
  next.hidden = false;
  render(0);
  // Decode the water before a double-click asks for the first wave.
  window.ElMaleconWave?.prepare().catch(() => {});
})();
