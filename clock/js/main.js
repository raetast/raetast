const dobInput = document.getElementById("dob");
const form = document.getElementById("dob-form");
const dobErrorTooltip = document.getElementById("dob-error");
const clockPanel = document.getElementById("clock-panel");
const hourHand = document.getElementById("hour-hand");
const minuteHand = document.getElementById("minute-hand");
const dayNightDisk = document.getElementById("day-night-disk");
const clockCaption = document.getElementById("clock-caption");
const weeksLivedHeading = document.getElementById("weeks-lived-heading");
const lifeCalendarHeading = document.getElementById("life-calendar-heading");
const lifeGrid = document.getElementById("life-grid");
const lifeGridGlass = lifeGrid?.querySelector(".life-grid-glass");
const lifeBoxes = document.getElementById("life-boxes");
const lifeGridInner = lifeGrid.querySelector(".life-grid-inner");
const weekTooltip = document.getElementById("week-tooltip");
const resultsSharePanel = document.getElementById("results-share-panel");

const today = new Date();
today.setHours(0, 0, 0, 0);
const MAX_AGE_YEARS = 123;
const minAllowedYear = today.getFullYear() - MAX_AGE_YEARS;
const minAllowedDate = new Date(`${minAllowedYear}-01-01T00:00:00`);

const lifeExpectancyYears = 100;
const EXPECTANCY_SOURCE = "100-year lifespan map";
const MAX_YEARS_DISPLAYED = 123;
const WEEKS_PER_YEAR = 52;
const COMMONS_API_ENDPOINT = "https://commons.wikimedia.org/w/api.php";
const WIKIDATA_API_ENDPOINT = "https://www.wikidata.org/w/api.php";
const COMMONS_MEMBERS_PER_PAGE = 250;
const COMMONS_CATEGORY_PAGE_LIMIT = 8;
const NOTABLE_WEEK_COVERAGE_TARGET = 48;
const WIKIDATA_ENTITY_BATCH_SIZE = 50;
const NOTABLE_BATCH_CONCURRENCY = 4;
const NOTABLE_PREFETCH_CONCURRENCY = 2;
const NOTABLE_HOVER_DELAY_MS = 140;
const NOTABLE_WORK_BUDGET_MS = 6;
const MAX_TOOLTIP_NOTABLES = 3;
const MIN_NOTABLE_SITELINKS = 1;
const NOTABLE_CACHE_PREFIX = "lifeClock:notables:v1:";
const NOTABLE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
let currentYearsDisplayed = 0;
const DAY_MS = 24 * 60 * 60 * 1000;
let lastGridStats = null;
let lastClockState = null;
let lastDobDate = null;
const BASE_LIFE_BOX_SIZE = 15;
const BASE_LIFE_BOX_GAP = 2;
const PENDULUM_SWAY_DURATION_MS = 1000;
const PENDULUM_CENTER_OFFSET_MS = PENDULUM_SWAY_DURATION_MS / 2;
const MOBILE_NOTABLE_QUERY = "(max-width: 639px)";
const NON_DESKTOP_NOTABLE_QUERY = "(max-width: 1023px)";
const printMedia = window.matchMedia("print");
let lifeGridScaleFrame = null;
let printGridScale = false;
let flipSettleTimer = null;
let flipStartTimer = null;
let clockMotionTimer = null;
let pendulumStartedAt = performance.now();
let pendingClockVisualState = null;
let lifeMapFillObserver = null;
let lifeGlassCutoutFrame = null;
let lifeGlassGeometry = null;
let lifeGlassMaskUrl = null;
let lifeGlassMaskRevision = 0;
let notableHoverTimer = null;
// QA toggle: set window.QA_MODE before this script loads or use ?qa=1.
const QA_MODE =
  window.QA_MODE === true ||
  new URLSearchParams(window.location.search).get("qa") === "1";
const QA_FAKE_DOB = "1985-04-24";

requestAnimationFrame(() => {
  pendulumStartedAt = performance.now();
  document.body.classList.add("is-pendulum-ready");
});

function matchesMediaQuery(query) {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

function createResultsAtmosphere() {
  const source = document.querySelector(".clock-atmosphere-field");
  if (!source) return null;

  const field = source.cloneNode(true);
  const identifiers = new Map();
  field.querySelectorAll("[id]").forEach((element) => {
    const original = element.id;
    element.id = `results-${original}`;
    identifiers.set(original, element.id);
  });
  field.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      let value = attribute.value;
      identifiers.forEach((replacement, original) => {
        value = value.replaceAll(`url(#${original})`, `url(#${replacement})`);
      });
      if (value !== attribute.value) element.setAttribute(attribute.name, value);
    });
  });

  const backdrop = document.createElement("div");
  backdrop.className = "clock-results-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas");
  canvas.className = "clock-results-particles";
  backdrop.append(field, canvas);
  document.body.prepend(backdrop);

  function updateSceneSize() {
    const stage = document.querySelector(".clock-flip-stage");
    const size = stage.clientWidth;
    if (!size || !backdrop.clientWidth || !backdrop.clientHeight) return;
    backdrop.style.setProperty("--scene-size", `${size}px`);
    backdrop.style.setProperty("--scene-x", backdrop.clientWidth / size);
    backdrop.style.setProperty("--scene-y", backdrop.clientHeight / size);
  }
  new ResizeObserver(updateSceneSize).observe(backdrop);
  updateSceneSize();

  const aurora = field.querySelector(".clock-atmosphere-aurora");
  return { field, aurora, canvas };
}

function syncAtmosphereTime(source, destination) {
  const times = new Map(source.getAnimations({ subtree: true }).map((animation) => [
    animation.animationName, animation.currentTime,
  ]));
  destination.getAnimations({ subtree: true }).forEach((animation) => {
    const time = times.get(animation.animationName);
    if (typeof time === "number") animation.currentTime = time;
  });
  destination.querySelector("svg").setCurrentTime(source.querySelector("svg").getCurrentTime());
}

function initClockAtmosphere() {
  const canvas = document.querySelector(".clock-atmosphere-particles");
  const context = canvas?.getContext("2d");
  if (!context) return;

  const aurora = document.querySelector(".clock-atmosphere-aurora");
  const landingField = document.querySelector(".clock-atmosphere-field");
  const resultsAtmosphere = createResultsAtmosphere();
  const resultsContext = resultsAtmosphere?.canvas.getContext("2d");
  let showingResults = false;
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const particles = Array.from({ length: 180 }, () => ({
    x: Math.random(),
    y: Math.random(),
    radius: 0.35 + Math.random() * 0.95,
    opacity: 0.18 + Math.random() * 0.4,
    speed: 0.15 + Math.random() * 0.25,
    phase: Math.random() * Math.PI * 2,
  }));
  let width = 0;
  let height = 0;
  let circleRadius = 0;
  let count = 0;
  let resultsWidth = 0;
  let resultsHeight = 0;
  let resultsCount = 0;
  let frame = null;
  let lastTime = 0;
  let time = 0;

  function paintSurface(target, areaWidth, areaHeight, total, haloRadius = null) {
    if (!areaWidth || !areaHeight) return;
    target.clearRect(0, 0, areaWidth, areaHeight);
    target.shadowColor = "rgba(235, 229, 251, 0.4)";
    if (haloRadius === null) target.fillStyle = "rgb(235, 229, 251)";
    for (let index = 0; index < total; index += 1) {
      const particle = particles[index];
      // Motes stay in their own space while the pendulum and background move.
      const x = particle.x + Math.sin(time * particle.speed + particle.phase) * 0.016 +
        Math.sin(time * 0.11 + particle.phase) * 0.009;
      const y = particle.y + Math.cos(time * particle.speed * 0.7 + particle.phase) * 0.02;
      const edge = haloRadius === null
        ? Math.max(0, Math.min(1, x * 20, (1 - x) * 20, y * 20, (1 - y) * 20))
        : Math.max(0, Math.min(1,
          (0.98 - Math.hypot((x - 0.5) * 2, (y - 0.5) * 2)) / 0.18
        ));
      if (haloRadius !== null) {
        const distance = Math.hypot((x - 0.5) * areaWidth, (y - 0.5) * areaHeight);
        const halo = Math.max(0, Math.min(1, (distance - haloRadius + 18) / 36));
        target.fillStyle = `rgb(${Math.round(235 - halo * 130)}, ${Math.round(229 - halo * 130)}, ${Math.round(251 - halo * 125)})`;
      }
      target.globalAlpha = particle.opacity * (0.75 + Math.sin(time * 0.45 + particle.phase) * 0.25) * edge;
      target.shadowBlur = particle.radius > 1.1 ? 4 : 0;
      target.beginPath();
      target.arc(x * areaWidth, y * areaHeight, particle.radius, 0, Math.PI * 2);
      target.fill();
    }
    target.globalAlpha = 1;
    target.shadowBlur = 0;
  }

  function paint(delta = 0) {
    time += delta;
    if (showingResults && resultsContext) {
      paintSurface(resultsContext, resultsWidth, resultsHeight, resultsCount);
    } else {
      paintSurface(context, width, height, count, circleRadius);
    }
  }

  function animate(timestamp) {
    if (!lastTime || timestamp - lastTime >= 1000 / 30) {
      paint(lastTime ? Math.min((timestamp - lastTime) / 1000, 0.05) : 0);
      lastTime = timestamp;
    }
    frame = requestAnimationFrame(animate);
  }

  function sync() {
    const hasResults = document.body.classList.contains("has-results");
    if (resultsAtmosphere && hasResults !== showingResults) {
      syncAtmosphereTime(
        hasResults ? landingField : resultsAtmosphere.field,
        hasResults ? resultsAtmosphere.field : landingField
      );
      showingResults = hasResults;
    }
    const motionAllowed = !motionPreference.matches && !document.hidden;
    if (resultsAtmosphere) {
      if (hasResults && motionAllowed) resultsAtmosphere.aurora.unpauseAnimations();
      else resultsAtmosphere.aurora.pauseAnimations();
    }
    const landingActive = motionAllowed && !hasResults &&
      !["is-flipping", "is-flip-pending"].some((name) => document.body.classList.contains(name));
    if (landingActive) aurora?.unpauseAnimations();
    else aurora?.pauseAnimations();
    const active = motionAllowed && (hasResults || landingActive);
    if (active && frame === null) {
      frame = requestAnimationFrame(animate);
    } else if (!active) {
      cancelAnimationFrame(frame);
      frame = null;
      lastTime = 0;
      paint();
    }
  }

  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    circleRadius = canvas.parentElement.clientWidth / 2;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    count = Math.min(80, Math.max(36, Math.round(width * 0.14)));
    if (resultsContext) {
      resultsWidth = resultsAtmosphere.canvas.clientWidth;
      resultsHeight = resultsAtmosphere.canvas.clientHeight;
      resultsAtmosphere.canvas.width = Math.round(resultsWidth * scale);
      resultsAtmosphere.canvas.height = Math.round(resultsHeight * scale);
      resultsContext.setTransform(scale, 0, 0, scale, 0, 0);
      resultsCount = Math.min(particles.length, Math.max(70, Math.round(resultsWidth * resultsHeight / 7000)));
    }
    paint();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  if (resultsAtmosphere) resizeObserver.observe(resultsAtmosphere.canvas);
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("visibilitychange", sync);
  motionPreference.addEventListener("change", sync);
  resize();
  sync();
}

function shouldUseHoverNotableTooltips() {
  return (
    !matchesMediaQuery(NON_DESKTOP_NOTABLE_QUERY) &&
    matchesMediaQuery("(hover: hover) and (pointer: fine)")
  );
}

function shouldUseCompactLifeCopy() {
  return matchesMediaQuery(MOBILE_NOTABLE_QUERY);
}

function calculateAgeYears(dateValue) {
  const birth = new Date(dateValue);
  const diffMs = today - birth;
  const diffDays = diffMs / DAY_MS;
  return diffDays / 365.2425;
}

function weeksLivedFromDob(dobDate) {
  return Math.floor((today - dobDate) / (7 * DAY_MS));
}

function daysLivedFromDob(dobDate) {
  return Math.floor((today - dobDate) / DAY_MS);
}

function getAnniversaryDate(birthDate, year) {
  const anniversary = new Date(birthDate);
  anniversary.setFullYear(year, birthDate.getMonth(), birthDate.getDate());
  anniversary.setHours(0, 0, 0, 0);
  return anniversary;
}

function getAgePosition(birthDate, referenceDate) {
  let ageYears = referenceDate.getFullYear() - birthDate.getFullYear();
  let lastBirthday = getAnniversaryDate(birthDate, referenceDate.getFullYear());
  if (referenceDate < lastBirthday) {
    ageYears -= 1;
    lastBirthday = getAnniversaryDate(birthDate, referenceDate.getFullYear() - 1);
  }
  const daysSinceBirthday = Math.max(
    0,
    Math.floor((referenceDate - lastBirthday) / DAY_MS)
  );
  const ageWeek = Math.min(
    WEEKS_PER_YEAR,
    Math.floor(daysSinceBirthday / 7) + 1
  );
  const displayedWeeks = ageYears * WEEKS_PER_YEAR + ageWeek;
  return { ageYears, ageWeek, displayedWeeks };
}

const notableLifespansByWeek = new Map();
const notableLifespanRequests = new Map();
const notableAgeRequests = new Map();
const failedNotableLifespanWeeks = new Set();
const notableBatchQueue = [];
let activeNotableBatches = 0;
let notableEntityWorker = null;
let notableWorkerUnavailable = false;
let notableWorkerJobId = 0;
const notableWorkerJobs = new Map();
const notablePrefetchQueue = new Set();
let activeNotablePrefetches = 0;
let notableRowsObserver = null;
let notablePrefetchEnabled = false;

function getEffectiveDobValue(value) {
  const trimmed = value ? value.trim() : "";
  return QA_MODE && !trimmed ? QA_FAKE_DOB : trimmed;
}

function parseDob(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  ) {
    date.setHours(0, 0, 0, 0);
    return date;
  }
  return null;
}

function getDobValidation(value) {
  const dobValue = getEffectiveDobValue(value);
  const digits = dobValue.replace(/\D/g, "");
  if (!dobValue) {
    return { date: null, message: "Enter your date of birth." };
  }
  if (digits.length < 8 || dobValue.length !== 10) {
    return { date: null, message: "Use YYYY-MM-DD." };
  }
  const parsed = parseDob(dobValue);
  if (!parsed) {
    return { date: null, message: "Enter a real calendar date." };
  }
  if (parsed > today) {
    return { date: null, message: "Date of birth cannot be in the future." };
  }
  if (parsed < minAllowedDate) {
    return {
      date: null,
      message: `Enter a date from ${minAllowedYear} onward.`,
    };
  }
  return { date: parsed, message: "" };
}

function showDobError(message) {
  if (!dobInput || !dobErrorTooltip) return;
  dobErrorTooltip.textContent = message;
  dobErrorTooltip.hidden = false;
  dobInput.setAttribute("aria-invalid", "true");
}

function hideDobError() {
  if (!dobInput || !dobErrorTooltip) return;
  dobErrorTooltip.hidden = true;
  dobErrorTooltip.textContent = "";
  dobInput.removeAttribute("aria-invalid");
}

function formatDobInput(value) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  const year = digits.slice(0, 4);
  const month = digits.slice(4, 6);
  const day = digits.slice(6, 8);
  let formatted = year;
  if (digits.length >= 4) formatted += "-";
  if (month) formatted += month;
  if (digits.length >= 6) formatted += "-";
  if (day) formatted += day;
  return formatted;
}

function setDobValueFromDigits(digits, cursorDigitCount = digits.length) {
  const nextValue = formatDobInput(digits);
  dobInput.value = nextValue;
  let nextSelection = nextValue.length;
  if (cursorDigitCount < digits.length) {
    let seenDigits = 0;
    nextSelection = 0;
    while (nextSelection < nextValue.length) {
      if (/\d/.test(nextValue[nextSelection])) {
        seenDigits += 1;
      }
      nextSelection += 1;
      if (seenDigits >= cursorDigitCount) break;
    }
    if (nextValue[nextSelection] === "-") nextSelection += 1;
  }
  dobInput.setSelectionRange(nextSelection, nextSelection);
}

function handleDobBoundaryBackspace(event) {
  if (!dobInput || event.inputType !== "deleteContentBackward") return;
  const start = dobInput.selectionStart;
  const end = dobInput.selectionEnd;
  if (start === null || end === null || start !== end) return;
  if (dobInput.value[start - 1] !== "-") return;
  event.preventDefault();
  const digitsBeforeHyphen = dobInput.value.slice(0, start - 1).replace(/\D/g, "");
  const digitsAfterHyphen = dobInput.value.slice(start).replace(/\D/g, "");
  const nextDigits =
    digitsBeforeHyphen.slice(0, -1) + digitsAfterHyphen;
  setDobValueFromDigits(nextDigits, Math.max(0, digitsBeforeHyphen.length - 1));
  syncDobValue();
}

function syncDobValue() {
  if (!dobInput) return;
  const previousValue = dobInput.value;
  const previousSelection = dobInput.selectionStart;
  const formatted = formatDobInput(dobInput.value);
  if (formatted !== dobInput.value) {
    const digitsBeforeCursor = previousValue
      .slice(0, previousSelection || previousValue.length)
      .replace(/\D/g, "").length;
    dobInput.value = formatted;
    let nextSelection = formatted.length;
    if (digitsBeforeCursor < 8) {
      let seenDigits = 0;
      nextSelection = 0;
      while (nextSelection < formatted.length) {
        if (/\d/.test(formatted[nextSelection])) {
          seenDigits += 1;
        }
        nextSelection += 1;
        if (seenDigits >= digitsBeforeCursor) {
          break;
        }
      }
      if (formatted[nextSelection] === "-") nextSelection += 1;
    }
    dobInput.setSelectionRange(nextSelection, nextSelection);
  }
  dobInput.setCustomValidity("");
  const validation = getDobValidation(dobInput.value);
  if (validation.message) {
    dobInput.setCustomValidity(validation.message);
    return;
  }
  hideDobError();
}

function formatClockReadoutText(hours, minutes, dayOffset) {
  const dayLabel = dayOffset > 0 ? `Day ${dayOffset + 1}, ` : "";
  const hh = hours.toString().padStart(2, "0");
  const mm = minutes.toString().padStart(2, "0");
  return `${dayLabel}${hh}:${mm}`;
}

function getClockVisualState(ratio) {
  const nonNegativeRatio = Math.max(0, ratio);
  const totalMinutes = nonNegativeRatio * 24 * 60;
  const dayOffset = Math.floor(totalMinutes / (24 * 60));
  const minutesInCurrentDay = totalMinutes - dayOffset * 24 * 60;
  const hours = Math.floor(minutesInCurrentDay / 60);
  const minutes = Math.floor(minutesInCurrentDay % 60);

  const hourAngle = (hours % 12) * 30 + minutes * 0.5;
  const minuteAngle = minutes * 6;
  const dayAngle = ((hours + minutes / 60) / 24) * 360 - 90;

  return {
    dayOffset,
    dayAngle,
    hourAngle,
    minuteAngle,
    hours,
    minutes,
  };
}

function applyClockVisualState(state) {
  if (!state) return;
  hourHand.style.transform = `translate(-50%, 0) rotate(${state.hourAngle}deg)`;
  minuteHand.style.transform = `translate(-50%, 0) rotate(${state.minuteAngle}deg)`;
  if (dayNightDisk) {
    dayNightDisk.style.setProperty("--day-night-rotation", `${state.dayAngle}deg`);
  }
}

function resetClockVisualState() {
  document.body.classList.add("is-clock-motion-reset");
  applyClockVisualState({
    hourAngle: 0,
    minuteAngle: 0,
    dayAngle: 0,
  });
  void hourHand.offsetWidth;
  requestAnimationFrame(() => {
    document.body.classList.remove("is-clock-motion-reset");
  });
}

function animatePendingClockVisualState() {
  if (!pendingClockVisualState) return;
  const state = pendingClockVisualState;
  pendingClockVisualState = null;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      applyClockVisualState(state);
    });
  });
}

function updateClock(ratio, options = {}) {
  const visualState = getClockVisualState(ratio);

  if (options.deferMotion) {
    pendingClockVisualState = visualState;
    resetClockVisualState();
  } else {
    pendingClockVisualState = null;
    applyClockVisualState(visualState);
  }

  const readout = formatClockReadoutText(
    visualState.hours,
    visualState.minutes,
    visualState.dayOffset
  );
  const beyondNote =
    visualState.dayOffset > 0 ? "Beyond average life expectancy. " : "";
  if (shouldUseCompactLifeCopy()) {
    clockCaption.textContent =
      `${beyondNote}Visualization based on a ${lifeExpectancyYears}-year lifespan.`;
  } else {
    clockCaption.innerHTML =
      `${beyondNote}Visualization based on a ${lifeExpectancyYears}-year lifespan. (${EXPECTANCY_SOURCE}) ` +
      `Inspired by Tim Urban's "Your Life in Weeks" from Wait But Why. ` +
      `Lifespan references from <a href="https://www.wikidata.org/" target="_blank" rel="noopener">Wikidata</a> and ` +
      `<a href="https://www.wikipedia.org/" target="_blank" rel="noopener">Wikipedia</a>.`;
  }
  clockPanel.hidden = false;
  clockPanel.classList.add("is-visible");

  lastClockState = { readout };
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function delayUntilPendulumCenter() {
  if (prefersReducedMotion()) return 0;
  const elapsed = performance.now() - pendulumStartedAt;
  const phase = elapsed % PENDULUM_SWAY_DURATION_MS;
  const delay =
    (PENDULUM_CENTER_OFFSET_MS - phase + PENDULUM_SWAY_DURATION_MS) %
    PENDULUM_SWAY_DURATION_MS;
  return delay < 40 ? 0 : delay;
}

function applyFlipFormShell(enableResults) {
  const currentlyHasResults = document.body.classList.contains("has-results");
  if (enableResults === currentlyHasResults) return;

  window.clearTimeout(flipSettleTimer);
  window.clearTimeout(clockMotionTimer);
  if (enableResults) {
    document.body.scrollTo(0, 0);
    document.body.focus({ preventScroll: true });
  }
  document.body.classList.remove("is-flip-pending");
  document.body.classList.toggle("is-flipping", enableResults);
  document.body.classList.toggle("has-results", enableResults);
  if (enableResults) {
    clockMotionTimer = window.setTimeout(() => {
      animatePendingClockVisualState();
    }, 1050);
    flipSettleTimer = window.setTimeout(() => {
      document.body.classList.remove("is-flipping");
      // Measure after the map enters layout and page scrolling is restored.
      updateLifeGrid(lastDobDate);
    }, 1700);
  } else {
    document.body.classList.remove("is-flipping");
    window.clearTimeout(clockMotionTimer);
    window.clearTimeout(flipStartTimer);
    pendingClockVisualState = null;
  }
}

function flipFormShell(enableResults) {
  window.clearTimeout(flipStartTimer);
  if (!enableResults) {
    document.body.classList.remove("is-flip-pending");
    applyFlipFormShell(false);
    return;
  }
  if (document.body.classList.contains("has-results")) return;
  document.body.classList.add("is-flip-pending");
  const delay = delayUntilPendulumCenter();
  if (delay === 0) {
    applyFlipFormShell(true);
    return;
  }
  flipStartTimer = window.setTimeout(() => {
    applyFlipFormShell(true);
  }, delay);
}

function buildLifeBoxes(totalYears) {
  if (totalYears === currentYearsDisplayed) return false;
  lifeBoxes.innerHTML = "";
  const container = document.createDocumentFragment();
  for (let year = 1; year <= totalYears; year++) {
    for (let week = 0; week < WEEKS_PER_YEAR; week++) {
      const box = document.createElement("div");
      box.className = "life-box upcoming";
      box.dataset.year = String(year);
      const weekNumber = week + 1;
      box.dataset.week = String(weekNumber);
      if (year > 1 && (year - 1) % 10 === 0) {
        box.classList.add("decade-start");
      }
      container.appendChild(box);
    }
  }
  lifeBoxes.appendChild(container);
  currentYearsDisplayed = totalYears;
  return true;
}

function observeLifeMapFill() {
  if (!lifeGrid) return;
  if (!("IntersectionObserver" in window)) {
    lifeGrid.classList.add("is-fill-animated");
    return;
  }
  if (!lifeMapFillObserver) {
    lifeMapFillObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-fill-animated");
          lifeMapFillObserver.unobserve(entry.target);
        });
      },
      {
        threshold: 0.28,
        rootMargin: "0px 0px -8% 0px",
      }
    );
  }
  lifeMapFillObserver.unobserve(lifeGrid);
  lifeMapFillObserver.observe(lifeGrid);
}

function updateLifeGrid(dobDate) {
  const wasHidden = lifeGrid.hidden;
  const weeksLived = weeksLivedFromDob(dobDate);
  const daysLived = daysLivedFromDob(dobDate);
  const agePosition = getAgePosition(dobDate, today);
  const expectancyYearsCapped = Math.min(
    lifeExpectancyYears,
    MAX_YEARS_DISPLAYED
  );
  const expectancyWeeks = Math.floor(expectancyYearsCapped * WEEKS_PER_YEAR);
  const desiredYears = Math.min(
    Math.max(
      Math.ceil(expectancyYearsCapped),
      agePosition.ageYears + 1
    ),
    MAX_YEARS_DISPLAYED
  );
  const rebuilt = buildLifeBoxes(desiredYears);
  const nextWeeks = Math.min(agePosition.displayedWeeks, lifeBoxes.children.length);
  const previousWeeks = Math.min(lastGridStats?.displayedWeeks || 0, lifeBoxes.children.length);
  const changed = rebuilt || nextWeeks !== previousWeeks;
  lifeGrid.hidden = false;
  updateLifeBoxScale();

  if (changed) {
    unpinWeekTooltip();
    // Touch only cells whose lived/future state changed.
    const start = rebuilt ? 0 : Math.min(previousWeeks, nextWeeks);
    const end = rebuilt ? lifeBoxes.children.length : Math.max(previousWeeks, nextWeeks);
    for (let index = start; index < end; index += 1) {
      const box = lifeBoxes.children[index];
      const state = index < nextWeeks ? "filled" : index < expectancyWeeks ? "upcoming" : "beyond";
      if (!box.classList.contains(state)) {
        box.classList.remove("filled", "upcoming", "beyond");
        box.classList.add(state);
      }
    }
  }
  lifeGrid.classList.add("is-visible");
  if (weeksLivedHeading) {
    weeksLivedHeading.textContent = `${weeksLived.toLocaleString()} weeks lived (${daysLived.toLocaleString()} days)`;
  }
  lastGridStats = { weeksLived, displayedWeeks: agePosition.displayedWeeks };
  if (changed || wasHidden) {
    lifeGrid.classList.remove("is-fill-animated");
    observeLifeMapFill();
    // Restore prefetched dots after creating cells or changing the lived range.
    markLoadedNotableWeeks(notableLifespansByWeek);
    observeNotableRows();
  }
  prefetchNotableLifespansForAge(agePosition.ageYears);
  scheduleLifeGlassCutouts();
}

function updateLifeBoxScale() {
  const availableWidth = lifeGridInner.clientWidth;
  const baseGridWidth =
    WEEKS_PER_YEAR * (BASE_LIFE_BOX_SIZE + BASE_LIFE_BOX_GAP) -
    BASE_LIFE_BOX_GAP;
  const sizeStep = 0.5;
  let boxSize = BASE_LIFE_BOX_SIZE;
  let boxGap = BASE_LIFE_BOX_GAP;

  if (availableWidth < baseGridWidth) {
    const scale = availableWidth / baseGridWidth;
    boxGap = Math.max(
      sizeStep,
      Math.floor((BASE_LIFE_BOX_GAP * scale) / sizeStep) * sizeStep
    );
    let maxSize =
      (availableWidth - (WEEKS_PER_YEAR - 1) * boxGap) / WEEKS_PER_YEAR;
    if (maxSize < sizeStep) {
      boxGap = 0;
      maxSize = availableWidth / WEEKS_PER_YEAR;
    }
    boxSize = Math.max(
      sizeStep,
      Math.min(
        BASE_LIFE_BOX_SIZE,
        Math.floor(maxSize / sizeStep) * sizeStep
      )
    );
  }

  const gridWidth = WEEKS_PER_YEAR * (boxSize + boxGap) - boxGap;
  lifeBoxes.style.setProperty("--life-box-size", `${boxSize.toFixed(2)}px`);
  lifeBoxes.style.setProperty("--life-box-gap", `${boxGap.toFixed(2)}px`);
  if (lifeGrid) {
    lifeGrid.style.setProperty("--life-grid-width", `${gridWidth}px`);
  }
  scheduleLifeGlassCutouts();
}

function scheduleLifeGlassCutouts() {
  if (lifeGlassCutoutFrame !== null) return;
  lifeGlassCutoutFrame = requestAnimationFrame(updateLifeGlassCutouts);
}

function updateLifeGlassCutouts() {
  lifeGlassCutoutFrame = null;
  if (!lifeGridGlass || !lifeBoxes || lifeGrid.hidden || printMedia.matches) return;
  const filledCount = Math.min(getLivedGlobalWeekLimit(), lifeBoxes.children.length);
  const firstFilled = filledCount ? lifeBoxes.firstElementChild : null;
  const width = lifeGrid.clientWidth;
  const height = lifeGrid.clientHeight;
  if (!firstFilled || !width || !height) {
    lifeGlassMaskRevision += 1;
    lifeGridGlass.style.removeProperty("mask-image");
    if (lifeGlassMaskUrl) URL.revokeObjectURL(lifeGlassMaskUrl);
    lifeGlassMaskUrl = null;
    lifeGlassGeometry = null;
    return;
  }

  const panelRect = lifeGrid.getBoundingClientRect();
  const boxesRect = lifeBoxes.getBoundingClientRect();
  const gridStyle = getComputedStyle(lifeBoxes);
  const cellStyle = getComputedStyle(firstFilled);
  const size = parseFloat(cellStyle.width);
  const columnGap = parseFloat(gridStyle.columnGap) || 0;
  const rowGap = parseFloat(gridStyle.rowGap) || 0;
  const radius = Math.min(parseFloat(cellStyle.borderTopLeftRadius) || 0, size / 2);
  const decadeStart = lifeBoxes.querySelector(".decade-start");
  const decadeGap = decadeStart ? parseFloat(getComputedStyle(decadeStart).marginTop) || 0 : 0;
  const left = boxesRect.left - panelRect.left - lifeGrid.clientLeft;
  const top = boxesRect.top - panelRect.top - lifeGrid.clientTop;
  const n = (value) => Math.round(value * 1000) / 1000;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const geometry = [width, height, left, top, size, columnGap, rowGap, radius, decadeGap, filledCount, scale]
    .map(n).join("|");
  if (geometry === lifeGlassGeometry) return;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(scale, scale);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = "destination-out";
  context.beginPath();
  // Rasterize once: a cached alpha mask avoids a complex live backdrop clip.
  for (let index = 0; index < filledCount; index += 1) {
    const row = Math.floor(index / WEEKS_PER_YEAR);
    const column = index % WEEKS_PER_YEAR;
    const x = left + column * (size + columnGap);
    const y = top + row * (size + rowGap) + Math.floor(row / 10) * decadeGap;
    context.roundRect(x, y, size, size, radius);
  }
  context.fill();
  lifeGlassGeometry = geometry;
  const revision = ++lifeGlassMaskRevision;
  canvas.toBlob(async (blob) => {
    if (revision !== lifeGlassMaskRevision) return;
    if (!blob) {
      lifeGlassGeometry = null;
      return;
    }
    const url = URL.createObjectURL(blob);
    const mask = new Image();
    mask.src = url;
    try {
      await mask.decode();
    } catch {
      URL.revokeObjectURL(url);
      if (revision === lifeGlassMaskRevision) lifeGlassGeometry = null;
      return;
    }
    if (revision !== lifeGlassMaskRevision) {
      URL.revokeObjectURL(url);
      return;
    }
    lifeGridGlass.style.maskImage = `url("${url}")`;
    if (lifeGlassMaskUrl) URL.revokeObjectURL(lifeGlassMaskUrl);
    lifeGlassMaskUrl = url;
  });
}

if (lifeGrid && typeof ResizeObserver === "function") {
  new ResizeObserver(scheduleLifeGlassCutouts).observe(lifeGrid);
}

function cancelNotableHover() {
  if (notableHoverTimer !== null) {
    clearTimeout(notableHoverTimer);
    notableHoverTimer = null;
  }
}

function hideTooltip() {
  cancelNotableHover();
  if (weekTooltip) {
    weekTooltip.hidden = true;
  }
}

let pinnedTooltipBox = null;
let selectedWeekBox = null;
let hoveredWeekBox = null;
let lastPointerX = null;
let lastPointerY = null;
let weekTooltipRenderId = 0;

function getBoxAgeLabel(box) {
  const years = Math.max(0, Number(box.dataset.year || 1) - 1);
  const weeks = Number(box.dataset.week || 1);
  return `At age ${years}, week ${weeks}`;
}

function getBoxGlobalWeek(box) {
  const year = Number(box.dataset.year || 1);
  const week = Number(box.dataset.week || 1);
  return (year - 1) * WEEKS_PER_YEAR + week;
}

function getBoxAgeYears(box) {
  return Math.max(0, Number(box.dataset.year || 1) - 1);
}

function parseWikidataDate(value) {
  if (!value) return null;
  const datePart = String(value).replace(/^\+/, "").split("T")[0];
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function getFirstTimeClaim(entity, property) {
  const claims = entity && entity.claims && entity.claims[property];
  if (!Array.isArray(claims)) return null;
  const claim =
    claims.find((item) => item.rank === "preferred") ||
    claims.find((item) => item.rank !== "deprecated");
  return (
    claim &&
    claim.mainsnak &&
    claim.mainsnak.datavalue &&
    claim.mainsnak.datavalue.value &&
    claim.mainsnak.datavalue.value.time
  );
}

function getEnwikiUrl(entity) {
  const title =
    entity &&
    entity.sitelinks &&
    entity.sitelinks.enwiki &&
    entity.sitelinks.enwiki.title;
  return title
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`
    : null;
}

function getSitelinkCount(entity) {
  if (Number.isFinite(entity?.sitelinkCount)) return entity.sitelinkCount;
  return entity && entity.sitelinks
    ? Object.keys(entity.sitelinks).length
    : 0;
}

function getEntityEnglishLabel(entity) {
  return (
    entity &&
    entity.labels &&
    entity.labels.en &&
    entity.labels.en.value
  );
}

function getEntityEnglishDescription(entity) {
  return (
    entity &&
    entity.descriptions &&
    entity.descriptions.en &&
    entity.descriptions.en.value
  );
}

function simplifyPersonDescription(description) {
  if (!description) return "";
  return description
    .replace(/\s*\([^)]*\d{3,4}[^)]*\)/g, "")
    .replace(/\s*,\s*\d{3,4}\s*-\s*\d{3,4}\s*$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.;,\s]+$/g, "")
    .trim();
}

function normalizeWikidataEntity(entity) {
  const born = parseWikidataDate(getFirstTimeClaim(entity, "P569"));
  const died = parseWikidataDate(getFirstTimeClaim(entity, "P570"));
  if (!born || !died) return null;
  const position = getAgePosition(born, died);
  const url = getEnwikiUrl(entity);
  const sitelinks = getSitelinkCount(entity);
  if (!url) return null;
  if (sitelinks < MIN_NOTABLE_SITELINKS) return null;
  return {
    name: getEntityEnglishLabel(entity),
    url,
    role: simplifyPersonDescription(getEntityEnglishDescription(entity)),
    sitelinks,
    globalWeek: position.displayedWeeks,
  };
}

function mergePeopleByWeek(peopleByWeek, person) {
  if (!person || !person.name || !person.url) return;
  if (!peopleByWeek.has(person.globalWeek)) {
    peopleByWeek.set(person.globalWeek, []);
  }
  const people = peopleByWeek.get(person.globalWeek);
  if (!people.some((item) => item.url === person.url)) {
    people.push({
      name: person.name,
      url: person.url,
      role: person.role,
      sitelinks: person.sitelinks,
    });
  }
}

function getBoxByGlobalWeek(globalWeek) {
  if (!lifeBoxes || !globalWeek) return null;
  return lifeBoxes.children[globalWeek - 1] || null;
}

function getLivedGlobalWeekLimit() {
  return lastGridStats && Number.isFinite(lastGridStats.displayedWeeks)
    ? lastGridStats.displayedWeeks
    : 0;
}

function isGlobalWeekLived(globalWeek) {
  const limit = getLivedGlobalWeekLimit();
  return limit > 0 && globalWeek <= limit;
}

function isBoxLived(box) {
  return isGlobalWeekLived(getBoxGlobalWeek(box));
}

function markLoadedNotableWeek(globalWeek, people) {
  const box = getBoxByGlobalWeek(globalWeek);
  if (!box) return;
  box.classList.toggle(
    "has-loaded-notables",
    isGlobalWeekLived(globalWeek) && Array.isArray(people) && people.length > 0
  );
}

function markLoadedNotableWeeks(peopleByWeek) {
  peopleByWeek.forEach((people, globalWeek) => {
    markLoadedNotableWeek(globalWeek, people);
  });
}

function getNotableCacheKey(ageYears) {
  return `${NOTABLE_CACHE_PREFIX}${ageYears}`;
}

function cachePeopleByWeek(ageYears, peopleByWeek) {
  if (!peopleByWeek || !peopleByWeek.size) return;
  try {
    const weeks = Array.from(peopleByWeek.entries()).map(
      ([globalWeek, people]) => [
        globalWeek,
        people.map(({ name, url, role, sitelinks }) => ({
          name,
          url,
          role,
          sitelinks,
        })),
      ]
    );
    localStorage.setItem(
      getNotableCacheKey(ageYears),
      JSON.stringify({ cachedAt: Date.now(), weeks })
    );
  } catch (err) {
    // Cache failures should never block tooltip data.
  }
}

function readCachedPeopleByWeek(ageYears) {
  try {
    const raw = localStorage.getItem(getNotableCacheKey(ageYears));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (
      !cached ||
      !Array.isArray(cached.weeks) ||
      Date.now() - Number(cached.cachedAt || 0) > NOTABLE_CACHE_TTL_MS
    ) {
      localStorage.removeItem(getNotableCacheKey(ageYears));
      return null;
    }
    const peopleByWeek = new Map();
    cached.weeks.forEach(([globalWeek, people]) => {
      const week = Number(globalWeek);
      if (!Number.isFinite(week) || !Array.isArray(people)) return;
      const validPeople = people.filter(
        (person) => person && person.name && person.url
      );
      if (!validPeople.length) return;
      peopleByWeek.set(week, validPeople.slice(0, MAX_TOOLTIP_NOTABLES));
      notableLifespansByWeek.set(
        week,
        validPeople.slice(0, MAX_TOOLTIP_NOTABLES)
      );
    });
    return peopleByWeek.size ? peopleByWeek : null;
  } catch (err) {
    return null;
  }
}

async function fetchCommonsAgeCategoryPage(ageYears, continueToken) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "categorymembers",
    gcmtitle: `Category:${ageYears}-year-old_deaths`,
    gcmnamespace: "14",
    gcmlimit: String(COMMONS_MEMBERS_PER_PAGE),
    prop: "pageprops",
    origin: "*",
  });
  if (continueToken) {
    params.set("gcmcontinue", continueToken);
  }
  const response = await fetch(`${COMMONS_API_ENDPOINT}?${params}`);
  if (!response.ok) {
    throw new Error(`Commons request failed: ${response.status}`);
  }
  const data = await response.json();
  const pages = data && data.query && data.query.pages ? data.query.pages : {};
  return {
    ids: Object.values(pages)
      .map((page) => page.pageprops && page.pageprops.wikibase_item)
      .filter(Boolean),
    continueToken:
      data && data.continue && data.continue.gcmcontinue
        ? data.continue.gcmcontinue
        : null,
  };
}

function getNotableEntityWorker() {
  if (notableWorkerUnavailable) return null;
  if (notableEntityWorker) return notableEntityWorker;
  try {
    notableEntityWorker = new Worker("js/notables-worker.js?v=1", { name: "life-clock-notables" });
    notableEntityWorker.onmessage = ({ data }) => {
      const job = notableWorkerJobs.get(data.id);
      if (!job) return;
      notableWorkerJobs.delete(data.id);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data.entities);
    };
    notableEntityWorker.onerror = (event) => {
      event.preventDefault();
      notableWorkerUnavailable = true;
      notableEntityWorker.terminate();
      notableEntityWorker = null;
      notableWorkerJobs.forEach((job) => job.reject(new Error("Entity worker unavailable")));
      notableWorkerJobs.clear();
    };
  } catch {
    notableWorkerUnavailable = true;
    return null;
  }
  return notableEntityWorker;
}

async function parseWikidataEntities(json) {
  const worker = getNotableEntityWorker();
  if (worker) {
    try {
      return await new Promise((resolve, reject) => {
        const id = ++notableWorkerJobId;
        notableWorkerJobs.set(id, { resolve, reject });
        try {
          worker.postMessage({ id, json });
        } catch (error) {
          notableWorkerJobs.delete(id);
          reject(error);
        }
      });
    } catch (error) {
      if (!notableWorkerUnavailable) throw error;
    }
  }
  // Keep local file previews and browsers without workers functional.
  const data = JSON.parse(json);
  return Object.values(data?.entities || {}).filter((entity) => entity && !entity.missing);
}

async function fetchWikidataEntities(ids) {
  if (!ids.length) return [];
  const params = new URLSearchParams({
    action: "wbgetentities",
    format: "json",
    ids: ids.join("|"),
    props: "labels|descriptions|claims|sitelinks",
    languages: "en",
    origin: "*",
  });
  const response = await fetch(`${WIKIDATA_API_ENDPOINT}?${params}`);
  if (!response.ok) {
    throw new Error(`Wikidata entities request failed: ${response.status}`);
  }
  return parseWikidataEntities(await response.text());
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function drainNotableBatches() {
  while (activeNotableBatches < NOTABLE_BATCH_CONCURRENCY && notableBatchQueue.length) {
    const focusedBox = pinnedTooltipBox || hoveredWeekBox;
    const focusedAge = focusedBox ? getBoxAgeYears(focusedBox) : null;
    const priorityIndex = notableBatchQueue.findIndex((job) => job.ageYears === focusedAge);
    const [job] = notableBatchQueue.splice(priorityIndex < 0 ? 0 : priorityIndex, 1);
    activeNotableBatches += 1;
    Promise.resolve().then(job.load).then(job.resolve, job.reject).finally(() => {
      activeNotableBatches -= 1;
      drainNotableBatches();
    });
  }
}

function enqueueNotableBatch(ageYears, load) {
  return new Promise((resolve, reject) => {
    notableBatchQueue.push({ ageYears, load, resolve, reject });
    drainNotableBatches();
  });
}

function yieldNotableWork() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function addNotableIdsToWeeks(ids, peopleByWeek, seenIds, ageYears) {
  const newIds = ids.filter((id) => {
    if (!id || seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
  const idBatches = chunkItems(newIds, WIKIDATA_ENTITY_BATCH_SIZE);
  await Promise.all(idBatches.map((batch) => enqueueNotableBatch(ageYears, async () => {
    const entities = await fetchWikidataEntities(batch);
    let sliceStarted = performance.now();
    for (const entity of entities) {
      mergePeopleByWeek(peopleByWeek, normalizeWikidataEntity(entity));
      if (performance.now() - sliceStarted >= NOTABLE_WORK_BUDGET_MS) {
        await yieldNotableWork();
        sliceStarted = performance.now();
      }
    }
    publishNotablePeople(peopleByWeek);
    // Let pointer events and rendering run before the next response is processed.
    await yieldNotableWork();
  })));
}

function limitPeopleByWeek(peopleByWeek) {
  peopleByWeek.forEach((people, globalWeek) => {
    const limitedPeople = people
      .sort((a, b) => (b.sitelinks || 0) - (a.sitelinks || 0))
      .slice(0, MAX_TOOLTIP_NOTABLES);
    notableLifespansByWeek.set(globalWeek, limitedPeople);
    peopleByWeek.set(globalWeek, limitedPeople);
  });
}

function publishNotablePeople(peopleByWeek) {
  limitPeopleByWeek(peopleByWeek);
  markLoadedNotableWeeks(peopleByWeek);
  const box = pinnedTooltipBox || hoveredWeekBox;
  if (!box || !isBoxLived(box)) return;
  if (!pinnedTooltipBox && notableHoverTimer !== null) return;
  const people = peopleByWeek.get(getBoxGlobalWeek(box));
  if (people?.length) {
    renderWeekTooltipContent(box, Boolean(pinnedTooltipBox), people);
  }
}

async function loadNotableLifespansForAge(ageYears) {
  notablePrefetchQueue.delete(ageYears);
  if (notableAgeRequests.has(ageYears)) {
    return notableAgeRequests.get(ageYears);
  }

  const cachedPeopleByWeek = readCachedPeopleByWeek(ageYears);
  if (cachedPeopleByWeek) {
    markLoadedNotableWeeks(cachedPeopleByWeek);
    notableAgeRequests.set(ageYears, Promise.resolve(cachedPeopleByWeek));
    return cachedPeopleByWeek;
  }

  const request = (async () => {
    const peopleByWeek = new Map();
    const seenIds = new Set();
    let page = await fetchCommonsAgeCategoryPage(ageYears, null);
    for (let pageIndex = 0; pageIndex < COMMONS_CATEGORY_PAGE_LIMIT; pageIndex++) {
      // Overlap the next category page with entity downloads, keeping only one
      // page ahead. Capture failures immediately to avoid unhandled rejections.
      const nextPage = page.continueToken && pageIndex + 1 < COMMONS_CATEGORY_PAGE_LIMIT
        ? fetchCommonsAgeCategoryPage(ageYears, page.continueToken).then(
          (value) => ({ value }), (error) => ({ error })
        )
        : null;
      await addNotableIdsToWeeks(page.ids, peopleByWeek, seenIds, ageYears);
      if (peopleByWeek.size >= NOTABLE_WEEK_COVERAGE_TARGET || !nextPage) break;
      const result = await nextPage;
      if (result.error) throw result.error;
      page = result.value;
    }
    cachePeopleByWeek(ageYears, peopleByWeek);
    return peopleByWeek;
  })().catch((error) => {
    notableAgeRequests.delete(ageYears);
    throw error;
  });

  notableAgeRequests.set(ageYears, request);
  return request;
}

async function fetchNotableLifespansForBox(box) {
  if (!isBoxLived(box)) return [];
  const peopleByWeek = await loadNotableLifespansForAge(getBoxAgeYears(box));
  return peopleByWeek.has(getBoxGlobalWeek(box))
    ? peopleByWeek.get(getBoxGlobalWeek(box)).slice(0, MAX_TOOLTIP_NOTABLES)
    : [];
}

async function findNotableLifespansForBox(box) {
  const globalWeek = getBoxGlobalWeek(box);
  if (notableLifespansByWeek.has(globalWeek)) {
    return notableLifespansByWeek.get(globalWeek);
  }
  if (notableLifespanRequests.has(globalWeek)) {
    return notableLifespanRequests.get(globalWeek);
  }
  failedNotableLifespanWeeks.delete(globalWeek);
  const request = fetchNotableLifespansForBox(box)
    .then((people) => {
      notableLifespansByWeek.set(globalWeek, people);
      markLoadedNotableWeek(globalWeek, people);
      notableLifespanRequests.delete(globalWeek);
      return people;
    })
    .catch((err) => {
      notableLifespanRequests.delete(globalWeek);
      const people = notableLifespansByWeek.get(globalWeek);
      if (people?.length) return people;
      failedNotableLifespanWeeks.add(globalWeek);
      console.warn("Failed to load notable lifespans from Wikidata:", err);
      throw err;
    });
  notableLifespanRequests.set(globalWeek, request);
  return request;
}

function positionWeekTooltip(box) {
  const viewportPadding = 8;
  const tooltipWidth = weekTooltip.offsetWidth || 0;
  const rect = box.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const top = rect.bottom + 22;

  const minLeft = viewportPadding;
  const maxLeft = window.innerWidth - tooltipWidth - viewportPadding;
  const desiredLeft = centerX - tooltipWidth / 2;
  const left = Math.max(minLeft, Math.min(desiredLeft, maxLeft));
  weekTooltip.style.left = `${left}px`;
  weekTooltip.style.top = `${top}px`;
  weekTooltip.style.setProperty(
    "--tooltip-arrow-left",
    `${Math.max(12, Math.min(centerX - left, tooltipWidth - 12))}px`
  );
}

function repositionPinnedTooltip() {
  if (!pinnedTooltipBox || weekTooltip.hidden) return;
  positionWeekTooltip(pinnedTooltipBox);
}

function prefetchNotableLifespansForAge(ageYears) {
  if (!Number.isInteger(ageYears) || ageYears < 0 || ageYears > MAX_AGE_YEARS) return;
  if (notableAgeRequests.has(ageYears)) return;
  notablePrefetchQueue.add(ageYears);
  drainNotablePrefetches();
}

function drainNotablePrefetches() {
  while (notablePrefetchEnabled && activeNotablePrefetches < NOTABLE_PREFETCH_CONCURRENCY && notablePrefetchQueue.size) {
    const ageYears = notablePrefetchQueue.values().next().value;
    notablePrefetchQueue.delete(ageYears);
    if (notableAgeRequests.has(ageYears)) continue;
    activeNotablePrefetches += 1;
    loadNotableLifespansForAge(ageYears).catch((err) => {
      console.warn("Failed to preload notable lifespans from Wikidata:", err);
    }).finally(() => {
      activeNotablePrefetches -= 1;
      drainNotablePrefetches();
    });
  }
}

function observeNotableRows() {
  notableRowsObserver?.disconnect();
  notablePrefetchQueue.clear();
  if (!("IntersectionObserver" in window)) return;
  if (!notableRowsObserver) {
    notableRowsObserver = new IntersectionObserver((entries) => {
      // Queue visible rows before the rows just outside the viewport.
      const distanceFromViewport = ({ boundingClientRect: rect }) =>
        Math.max(0, -rect.bottom, rect.top - window.innerHeight);
      entries.sort((a, b) => distanceFromViewport(a) - distanceFromViewport(b)
        || a.boundingClientRect.top - b.boundingClientRect.top);
      entries.forEach((entry) => {
        const ageYears = getBoxAgeYears(entry.target);
        if (entry.isIntersecting) {
          if (!notableAgeRequests.has(ageYears)) notablePrefetchQueue.add(ageYears);
        } else {
          notablePrefetchQueue.delete(ageYears);
        }
      });
      drainNotablePrefetches();
    }, { rootMargin: "240px 0px" });
  }
  // One observed cell represents each year; only lived rows need biographies.
  for (let index = 0; index < getLivedGlobalWeekLimit(); index += WEEKS_PER_YEAR) {
    const box = lifeBoxes.children[index];
    if (box) notableRowsObserver.observe(box);
  }
}

function renderWeekTooltipContent(box, shouldPin, markers) {
  if (!isBoxLived(box) || !markers.length) {
    if (shouldPin) unpinWeekTooltip();
    else hideTooltip();
    return;
  }

  if (shouldPin) selectWeekBox(box);
  weekTooltip.classList.toggle("is-pinned", shouldPin);
  weekTooltip.replaceChildren();

  const ageLine = document.createElement("div");
  ageLine.className = "week-tooltip-age";
  ageLine.textContent = getBoxAgeLabel(box);
  weekTooltip.appendChild(ageLine);

  markers.forEach((marker) => {
    const personLine = document.createElement("div");
    personLine.className = "week-tooltip-person-line";

    const link = document.createElement("a");
    link.className = "week-tooltip-person-name";
    link.href = marker.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = marker.name;
    personLine.appendChild(link);

    if (marker.role) {
      const separator = document.createElement("span");
      separator.className = "week-tooltip-separator";
      separator.textContent = " • ";
      personLine.appendChild(separator);

      const roleSpan = document.createElement("span");
      roleSpan.className = "week-tooltip-role";
      roleSpan.textContent = marker.role;
      personLine.appendChild(roleSpan);
    }

    weekTooltip.appendChild(personLine);
  });

  weekTooltip.hidden = false;
  positionWeekTooltip(box);
}

function renderWeekTooltip(box, shouldPin = false) {
  cancelNotableHover();
  const renderId = ++weekTooltipRenderId;
  const globalWeek = getBoxGlobalWeek(box);
  if (!isGlobalWeekLived(globalWeek)) {
    renderWeekTooltipContent(box, shouldPin, []);
    return;
  }

  if (notableLifespansByWeek.has(globalWeek)) {
    renderWeekTooltipContent(
      box,
      shouldPin,
      notableLifespansByWeek.get(globalWeek)
    );
    return;
  }

  if (failedNotableLifespanWeeks.has(globalWeek)) {
    renderWeekTooltipContent(box, shouldPin, []);
    return;
  }

  // Keep the map quiet until there is actual person information to show.
  hideTooltip();

  findNotableLifespansForBox(box)
    .then((markers) => {
      if (renderId !== weekTooltipRenderId) return;
      if (!shouldPin && hoveredWeekBox !== box) return;
      if (shouldPin && pinnedTooltipBox !== box) return;
      renderWeekTooltipContent(box, shouldPin, markers);
    })
    .catch(() => {
      if (renderId !== weekTooltipRenderId) return;
      if (!shouldPin && hoveredWeekBox !== box) return;
      if (shouldPin && pinnedTooltipBox !== box) return;
      renderWeekTooltipContent(box, shouldPin, []);
    });
}

function selectWeekBox(box) {
  if (selectedWeekBox && selectedWeekBox !== box) {
    selectedWeekBox.classList.remove("is-selected");
  }
  selectedWeekBox = box;
  selectedWeekBox.classList.add("is-selected");
}

function clearSelectedWeekBox() {
  if (selectedWeekBox) {
    selectedWeekBox.classList.remove("is-selected");
  }
  selectedWeekBox = null;
}

function hideHoverTooltip() {
  hoveredWeekBox = null;
  hideTooltip();
}

function rememberPointer(event) {
  if (typeof event.clientX !== "number" || typeof event.clientY !== "number") {
    return;
  }
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
}

function getBoxAtLastPointer() {
  if (lastPointerX === null || lastPointerY === null) return null;
  const element = document.elementFromPoint(lastPointerX, lastPointerY);
  return element ? element.closest(".life-box") : null;
}

function syncHoverTooltipVisibility() {
  if (pinnedTooltipBox || weekTooltip.hidden) return;
  if (!hoveredWeekBox || getBoxAtLastPointer() !== hoveredWeekBox) {
    hideHoverTooltip();
  }
}

function hideHoverTooltipIfUnpinned() {
  if (!pinnedTooltipBox) {
    hideHoverTooltip();
  }
}

function unpinWeekTooltip() {
  pinnedTooltipBox = null;
  hoveredWeekBox = null;
  clearSelectedWeekBox();
  weekTooltip.classList.remove("is-pinned");
  hideTooltip();
}

if (weekTooltip && lifeBoxes) {
  lifeBoxes.addEventListener("pointerover", (event) => {
    if (!shouldUseHoverNotableTooltips()) return;
    if (pinnedTooltipBox) return;
    rememberPointer(event);
    const target = event.target.closest(".life-box");
    if (!target || !target.dataset.week || !target.dataset.year || !isBoxLived(target)) {
      hideHoverTooltip();
      return;
    }
    hoveredWeekBox = target;
    cancelNotableHover();
    if (notableLifespansByWeek.has(getBoxGlobalWeek(target))) {
      renderWeekTooltip(target);
    } else {
      notableHoverTimer = setTimeout(() => {
        notableHoverTimer = null;
        if (hoveredWeekBox === target && !pinnedTooltipBox) renderWeekTooltip(target);
      }, NOTABLE_HOVER_DELAY_MS);
    }
  });

  lifeBoxes.addEventListener("pointerout", (event) => {
    if (!shouldUseHoverNotableTooltips()) return;
    if (pinnedTooltipBox) return;
    rememberPointer(event);
    const target = event.target.closest(".life-box");
    if (!target) return;
    const nextBox = event.relatedTarget
      ? event.relatedTarget.closest(".life-box")
      : null;
    if (nextBox === target) return;
    hideHoverTooltip();
  });

  window.addEventListener("pointermove", (event) => {
    rememberPointer(event);
    if (!shouldUseHoverNotableTooltips()) {
      if (!pinnedTooltipBox) hideHoverTooltip();
      return;
    }
    if (weekTooltip.hidden || pinnedTooltipBox) return;
    syncHoverTooltipVisibility();
  });

  lifeBoxes.addEventListener("click", (event) => {
    const target = event.target.closest(".life-box");
    if (!target) return;
    if (pinnedTooltipBox && pinnedTooltipBox !== target) {
      unpinWeekTooltip();
      return;
    }
    pinnedTooltipBox = target;
    renderWeekTooltip(target, true);
  });

  lifeBoxes.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target.closest(".life-box");
    if (!target) return;
    event.preventDefault();
    if (pinnedTooltipBox && pinnedTooltipBox !== target) {
      unpinWeekTooltip();
      return;
    }
    pinnedTooltipBox = target;
    renderWeekTooltip(target, true);
  });

  lifeBoxes.addEventListener("pointerleave", () => {
    if (!pinnedTooltipBox) {
      hideHoverTooltip();
    }
  });

  lifeBoxes.addEventListener("mouseleave", () => {
    if (!pinnedTooltipBox) {
      hideHoverTooltip();
    }
  });

  window.addEventListener(
    "scroll",
    () => {
      if (!pinnedTooltipBox) {
        hideHoverTooltip();
        return;
      }
      repositionPinnedTooltip();
    },
    true
  );

  window.addEventListener(
    "wheel",
    (event) => {
      rememberPointer(event);
      if (!pinnedTooltipBox) {
        hideHoverTooltip();
      }
    },
    { passive: true }
  );

  window.addEventListener("resize", () => {
    if (pinnedTooltipBox) {
      repositionPinnedTooltip();
      return;
    }
    hideHoverTooltipIfUnpinned();
  });
  window.addEventListener("blur", hideHoverTooltipIfUnpinned);

  weekTooltip.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  window.addEventListener("click", (event) => {
    if (
      pinnedTooltipBox &&
      !weekTooltip.contains(event.target) &&
      !pinnedTooltipBox.contains(event.target)
    ) {
      unpinWeekTooltip();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && pinnedTooltipBox) {
      unpinWeekTooltip();
    }
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  syncDobValue();
  renderFromDob(dobInput.value);
});

function renderFromDob(value) {
  const validation = getDobValidation(value);
  if (validation.message) {
    showDobError(validation.message);
    dobInput.focus();
    return;
  }
  hideDobError();
  const dobDate = validation.date;
  const ageYears = calculateAgeYears(dobDate);
  lastDobDate = dobDate;
  // Use the flip animation to warm the current age and the start of the map.
  notablePrefetchEnabled = true;
  prefetchNotableLifespansForAge(getAgePosition(dobDate, today).ageYears);
  prefetchNotableLifespansForAge(0);
  const ratio = ageYears / lifeExpectancyYears;
  const shouldDeferClockMotion = !document.body.classList.contains("has-results");
  if (shouldDeferClockMotion) {
    document.body.classList.add("is-flip-pending");
  }
  updateClock(ratio, { deferMotion: shouldDeferClockMotion });
  if (!shouldDeferClockMotion) {
    updateLifeGrid(dobDate);
  }
  flipFormShell(true);
}

function hideVisuals() {
  notablePrefetchEnabled = false;
  notablePrefetchQueue.clear();
  notableRowsObserver?.disconnect();
  clockPanel.hidden = true;
  clockPanel.classList.remove("is-visible");
  lifeGrid.hidden = true;
  lifeGrid.classList.remove("is-visible");
  flipFormShell(false);
  unpinWeekTooltip();
}

if (dobInput) {
  dobInput.addEventListener("beforeinput", handleDobBoundaryBackspace);

  dobInput.addEventListener("input", () => {
    syncDobValue();
    if (dobErrorTooltip && !dobErrorTooltip.hidden) {
      const validation = getDobValidation(dobInput.value);
      if (validation.message) {
        showDobError(validation.message);
      } else {
        hideDobError();
      }
    }
    if (!QA_MODE && !dobInput.value) {
      hideVisuals();
    }
  });
}

function reRenderIfHasResults() {
  if (!document.body.classList.contains("has-results")) return;
  if (!QA_MODE && !dobInput.value.trim()) return;
  renderFromDob(dobInput.value);
}

if (dobInput) {
  dobInput.addEventListener("change", () => {
    syncDobValue();
    if (dobErrorTooltip && !dobErrorTooltip.hidden) {
      const validation = getDobValidation(dobInput.value);
      if (validation.message) {
        showDobError(validation.message);
      } else {
        hideDobError();
      }
    }
    reRenderIfHasResults();
  });
}

function refreshLifeGridScale(forPrint = false) {
  if (!document.body.classList.contains("has-results") || lifeGrid.hidden) return;
  printGridScale = forPrint;
  if (lifeGridScaleFrame !== null) return;
  lifeGridScaleFrame = requestAnimationFrame(() => {
    lifeGridScaleFrame = null;
    if (!document.body.classList.contains("has-results") || lifeGrid.hidden) return;
    if (!printGridScale) {
      updateLifeBoxScale();
      return;
    }
    const availableWidth = lifeGridInner.clientWidth;
    if (!availableWidth) return;
    const gapRatio = BASE_LIFE_BOX_GAP / BASE_LIFE_BOX_SIZE;
    const boxSize = Math.max(0.5, Math.min(BASE_LIFE_BOX_SIZE,
      availableWidth / (WEEKS_PER_YEAR + (WEEKS_PER_YEAR - 1) * gapRatio)));
    const boxGap = boxSize * gapRatio;
    lifeBoxes.style.setProperty("--life-box-size", `${boxSize.toFixed(2)}px`);
    lifeBoxes.style.setProperty("--life-box-gap", `${boxGap.toFixed(2)}px`);
    lifeGrid.style.setProperty("--life-grid-width",
      `${WEEKS_PER_YEAR * (boxSize + boxGap) - boxGap}px`);
  });
}

printMedia.addEventListener("change", (event) => refreshLifeGridScale(event.matches));
window.addEventListener("beforeprint", () => refreshLifeGridScale(true));
window.addEventListener("afterprint", () => refreshLifeGridScale(false));

function buildSocialShareText(includeEmoji = false) {
  const readout = lastClockState ? lastClockState.readout : "xx:xx";
  const weeks = lastGridStats ? lastGridStats.weeksLived.toLocaleString() : "—";
  const timeEmoji = includeEmoji ? "⏰ " : "";
  const weekEmoji = includeEmoji ? "📅 " : "";
  return (
    "My life stats right now:\n" +
    `${timeEmoji}${readout} · ${weekEmoji}Week ${weeks}\n` +
    "Check yours at https://raetast.com/clock/\n" +
    "#thelifeclock"
  );
}

function openShareUrl(url) {
  window.open(url, "_blank", "noopener");
}

function handleShareMenuClick(event) {
  const button = event.target.closest(".share-menu-item");
  if (!button || !lastClockState || !lastGridStats) return;
  const target = button.dataset.shareTarget;
  if (target !== "x" && target !== "threads") return;
  const shareText = encodeURIComponent(buildSocialShareText(target === "x"));
  const endpoint = target === "x"
    ? "https://twitter.com/intent/tweet?text="
    : "https://www.threads.net/intent/post?text=";
  openShareUrl(endpoint + shareText);
}

if (resultsSharePanel) {
  resultsSharePanel.addEventListener("click", handleShareMenuClick);
}

function initShareTitleWave() {
  const title = document.querySelector(".results-share-title");
  if (!title) return;

  const text = title.textContent ? title.textContent.trim() : "";
  if (!text) return;

  title.setAttribute("aria-label", text);
  title.textContent = "";
  title.classList.add("is-wave");

  Array.from(text).forEach((char, index) => {
    const span = document.createElement("span");
    span.className = "wave-letter";
    span.style.setProperty("--char-index", index);
    span.textContent = char === " " ? "\u00a0" : char;
    span.setAttribute("aria-hidden", "true");
    title.appendChild(span);
  });
}

window.addEventListener("resize", () => {
  if (document.body.classList.contains("has-results")) {
    hideHoverTooltipIfUnpinned();
    refreshLifeGridScale(printMedia.matches);
  }
});

initShareTitleWave();
initClockAtmosphere();

if (QA_MODE && !document.body.classList.contains("has-results")) {
  renderFromDob(dobInput.value);
}
