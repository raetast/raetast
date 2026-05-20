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
const lifeBoxes = document.getElementById("life-boxes");
const weekTooltip = document.getElementById("week-tooltip");
const copyrightYear = document.getElementById("copyright-year");
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
const MAX_TOOLTIP_NOTABLES = 3;
const MIN_NOTABLE_SITELINKS = 1;
const NOTABLE_CACHE_PREFIX = "lifeClock:notables:v1:";
const NOTABLE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
let currentYearsDisplayed = 0;
const DAY_MS = 24 * 60 * 60 * 1000;
let lastGridStats = null;
let lastClockState = null;
let lastClockRatio = null;
let clockFaceImagePromise = null;
let lastDobDate = null;
let cachedLifeBoxSize = null;
let cachedLifeBoxGap = null;
const BASE_LIFE_BOX_SIZE = 15;
const BASE_LIFE_BOX_GAP = 2;
const CANVAS_FONT_FAMILY = '"Inter", "Helvetica Neue", Arial, sans-serif';
const PENDULUM_SWAY_DURATION_MS = 1000;
const PENDULUM_CENTER_OFFSET_MS = PENDULUM_SWAY_DURATION_MS / 2;
const MOBILE_NOTABLE_QUERY = "(max-width: 639px)";
const NON_DESKTOP_NOTABLE_QUERY = "(max-width: 1023px)";
let flipSettleTimer = null;
let flipStartTimer = null;
let clockMotionTimer = null;
let pendulumStartedAt = performance.now();
let pendingClockVisualState = null;
let lifeMapFillObserver = null;
// QA toggle: set window.QA_MODE in js/local-config.js or use ?qa=1.
const QA_MODE =
  window.QA_MODE === true ||
  new URLSearchParams(window.location.search).get("qa") === "1";
const QA_FAKE_DOB = "1985-04-24";

if (form) {
  // Use the in-app tooltip instead of browser-native validation bubbles.
  form.noValidate = true;
}

requestAnimationFrame(() => {
  pendulumStartedAt = performance.now();
  document.body.classList.add("is-pendulum-ready");
});

function matchesMediaQuery(query) {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
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

function updateResultHeadings() {
  if (lifeCalendarHeading) {
    lifeCalendarHeading.textContent = "My life map";
  }
}

function getCssVar(name, fallback) {
  const root = document.documentElement;
  const value = getComputedStyle(root).getPropertyValue(name);
  return value ? value.trim() : fallback;
}

function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawCanvasBackground(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = getCssVar("--page-bg", "#f7f5ef");
  ctx.fillRect(0, 0, width, height);
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

  lastClockState = {
    heading: "The Life Clock",
    readout,
    hourAngle: visualState.hourAngle,
    minuteAngle: visualState.minuteAngle,
    hours: visualState.hours,
    minutes: visualState.minutes,
  };
  lastClockRatio = ratio;
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
    window.scrollTo(0, 0);
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

  const currentlyHasResults = document.body.classList.contains("has-results");
  if (currentlyHasResults) return;

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
  if (totalYears === currentYearsDisplayed) return;
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
      const bandIndex = Math.floor((weekNumber - 1) / 10);
      if (bandIndex % 2 === 1) {
        box.classList.add("band-alt");
      }
      container.appendChild(box);
    }
  }
  lifeBoxes.appendChild(container);
  currentYearsDisplayed = totalYears;
  notableLifespansByWeek.forEach((people, globalWeek) => {
    markLoadedNotableWeek(globalWeek, people);
  });
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

function updateLifeGrid(ageYears, dobDate) {
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
  buildLifeBoxes(desiredYears);
  const showBeyond = agePosition.displayedWeeks > expectancyWeeks;
  const { boxSize, boxGap } = updateLifeBoxScale();
  const cellSize = boxSize + boxGap;
  const filledRows = Math.max(
    1,
    Math.ceil(agePosition.displayedWeeks / WEEKS_PER_YEAR)
  );
  const gradientHeight = filledRows * cellSize - boxGap;
  lifeGrid.classList.remove("is-fill-animated");

  Array.from(lifeBoxes.children).forEach((box, index) => {
    const rowIndex = Math.floor(index / WEEKS_PER_YEAR);
    const columnIndex = index % WEEKS_PER_YEAR;
    const globalWeekIndex = index + 1;
    box.hidden = false;
    box.style.removeProperty("--filled-grad-height");
    box.style.removeProperty("--filled-grad-offset");
    box.style.removeProperty("--life-fill-delay");
    box.classList.remove("filled", "beyond", "is-current-week");
    box.classList.add("upcoming");
    if (globalWeekIndex <= agePosition.displayedWeeks) {
      box.classList.remove("upcoming");
      box.classList.add("filled");
      box.style.setProperty(
        "--life-fill-delay",
        `${Math.min(1200, rowIndex * 18 + columnIndex * 3)}ms`
      );
      box.style.setProperty("--filled-grad-height", `${gradientHeight}px`);
      box.style.setProperty(
        "--filled-grad-offset",
        `${-rowIndex * cellSize}px`
      );
      if (globalWeekIndex === agePosition.displayedWeeks) {
        box.classList.add("is-current-week");
      }
    } else if (globalWeekIndex > expectancyWeeks) {
      if (!showBeyond) {
        box.hidden = true;
        return;
      }
      box.classList.remove("upcoming");
      box.classList.add("beyond");
    }
  });
  lifeGrid.hidden = false;
  lifeGrid.classList.add("is-visible");
  if (weeksLivedHeading) {
    weeksLivedHeading.textContent = `${weeksLived.toLocaleString()} weeks lived (${daysLived.toLocaleString()} days)`;
  }
  updateResultHeadings();
  lastGridStats = {
    weeksLived,
    daysLived,
    displayAgeYears: agePosition.ageYears,
    displayAgeWeek: agePosition.ageWeek,
    displayedWeeks: agePosition.displayedWeeks,
    expectancyWeeks,
    expectancyYears: expectancyYearsCapped,
    showBeyond,
    totalYears: desiredYears,
    title: lifeCalendarHeading
      ? lifeCalendarHeading.textContent
      : "My life map",
  };
  observeLifeMapFill();
  prefetchNotableLifespansForAge(agePosition.ageYears);
  // Intentionally skip print-specific scaling to avoid overriding UI sizing.
}

function updateLifeBoxScale() {
  if (!lifeBoxes) {
    return { boxSize: BASE_LIFE_BOX_SIZE, boxGap: BASE_LIFE_BOX_GAP };
  }
  const container =
    lifeBoxes.closest(".life-grid-inner") || lifeBoxes.parentElement;
  if (!container) {
    return { boxSize: BASE_LIFE_BOX_SIZE, boxGap: BASE_LIFE_BOX_GAP };
  }
  const availableWidth = container.clientWidth;
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
  return { boxSize, boxGap };
}

function hideTooltip() {
  if (weekTooltip) {
    weekTooltip.hidden = true;
  }
}

function createBaseCanvas() {
  const width = 1080;
  const height = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext("2d"), width, height };
}

function loadClockFaceImage() {
  if (!clockFaceImagePromise) {
    clockFaceImagePromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = "assets/clockbase.svg";
    });
  }
  return clockFaceImagePromise;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawTextWithSpacing(
  ctx,
  text,
  x,
  y,
  letterSpacingEm,
  fontSize,
  align = "left"
) {
  if (!text) return;
  const spacing = letterSpacingEm * fontSize;
  const glyphs = Array.from(text);
  const widths = glyphs.map((glyph) => ctx.measureText(glyph).width);
  const totalWidth =
    widths.reduce((sum, width) => sum + width, 0) +
    Math.max(0, glyphs.length - 1) * spacing;

  let startX = x;
  if (align === "center") {
    startX = x - totalWidth / 2;
  } else if (align === "right") {
    startX = x - totalWidth;
  }

  ctx.save();
  const previousAlign = ctx.textAlign;
  ctx.textAlign = "left";
  let cursorX = startX;
  glyphs.forEach((glyph, index) => {
    ctx.fillText(glyph, cursorX, y);
    cursorX += widths[index] + spacing;
  });
  ctx.textAlign = previousAlign;
  ctx.restore();
}

function measureTextWithSpacing(ctx, text, letterSpacingEm, fontSize) {
  if (!text) return 0;
  const spacing = letterSpacingEm * fontSize;
  const glyphs = Array.from(text);
  const widths = glyphs.map((glyph) => ctx.measureText(glyph).width);
  return (
    widths.reduce((sum, width) => sum + width, 0) +
    Math.max(0, glyphs.length - 1) * spacing
  );
}

function drawClockHand(ctx, cx, cy, angleDeg, length, width, color, fillColor) {
  const headInset = Math.max(10, Math.round(width * 0.8));
  const tipWidth = Math.max(4, Math.round(width * 0.22));
  const shoulderWidth = Math.max(6, Math.round(width * 0.9));
  const shoulderInset = width - shoulderWidth;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.translate(-width / 2, 0);

  const topY = -length;
  ctx.beginPath();
  ctx.moveTo((width - tipWidth) / 2, topY);
  ctx.lineTo((width + tipWidth) / 2, topY);
  ctx.lineTo(shoulderWidth, topY + headInset);
  ctx.lineTo(shoulderWidth, 0);
  ctx.lineTo(shoulderInset, 0);
  ctx.lineTo(shoulderInset, topY + headInset);
  ctx.closePath();

  ctx.fillStyle = color;
  ctx.fill();

  if (fillColor) {
    const inset = Math.max(2, Math.round(width * 0.34));
    const topStart = Math.min(length - 6, Math.max(8, Math.round(width)));
    const topEnd = Math.min(length - 2, Math.max(24, Math.round(width * 3)));

    ctx.beginPath();
    ctx.moveTo(inset, -length + topStart);
    ctx.lineTo(width - inset, -length + topStart);
    ctx.lineTo(width - inset, -length + topEnd);
    ctx.lineTo(inset, -length + topEnd);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  ctx.restore();
}

function drawDayNightIndicator(ctx, cx, cy, faceSize, hours, minutes) {
  if (typeof hours !== "number" || typeof minutes !== "number") return;
  const indicatorSize = faceSize * (130 / 400);
  const offsetY = faceSize * (100 / 400);
  const centerX = cx;
  const centerY = cy + offsetY;
  const radius = indicatorSize / 2;

  const angle = ((hours + minutes / 60) / 24) * 360 - 180;
  const segments = 120;
  const colors = [
    "#0b1426",
    "#143057",
    "#50bdec",
    "#8bdcff",
    "#50bdec",
    "#143057",
    "#0b1426",
  ];
  const colorStops = [0, 60, 150, 180, 210, 300, 360];

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((angle * Math.PI) / 180);

  const sweepRad = (150 * Math.PI) / 180;
  const arcInset = (Math.PI - sweepRad) / 2;
  const startAngle = Math.PI - arcInset;
  const endAngle = arcInset;
  ctx.beginPath();
  ctx.arc(0, 0, radius, startAngle, endAngle, false);
  ctx.closePath();
  ctx.clip();

  for (let i = 0; i < segments; i++) {
    const startDeg = (i / segments) * 360;
    const endDeg = ((i + 1) / segments) * 360;
    let color = colors[colors.length - 1];
    for (let j = 0; j < colorStops.length - 1; j++) {
      if (startDeg >= colorStops[j] && startDeg < colorStops[j + 1]) {
        color = colors[j];
        break;
      }
    }
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.fillStyle = color;
    ctx.arc(
      0,
      0,
      radius,
      (startDeg * Math.PI) / 180,
      (endDeg * Math.PI) / 180,
      false
    );
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = "rgba(255, 199, 0, 0.7)";
  const stars = [
    { x: -radius * 0.42, y: -radius * 0.28, r: 1.6 },
    { x: -radius * 0.22, y: -radius * 0.42, r: 1.2 },
    { x: -radius * 0.12, y: -radius * 0.18, r: 1 },
    { x: -radius * 0.3, y: -radius * 0.12, r: 0.8 },
  ];
  stars.forEach((star) => {
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  });

  const emojiFont = `${Math.round(
    radius * 0.38
  )}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.font = emojiFont;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.save();
  ctx.rotate((90 * Math.PI) / 180);
  ctx.fillText("🌞", radius * 0.45, 0);
  ctx.restore();

  ctx.save();
  ctx.rotate((-90 * Math.PI) / 180);
  ctx.fillText("🌜", -radius * 0.45, 0);
  ctx.restore();

  ctx.font = `${Math.round(
    radius * 0.26
  )}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.fillText("☁️", 0, -radius * 0.42);
  ctx.fillText("☁️", 0, -radius * 0.1);

  ctx.restore();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.16, 0, Math.PI * 2);
  ctx.fill();
}

async function buildClockShareCanvas(state) {
  if (!state) return null;
  const { canvas, ctx, width, height } = createBaseCanvas();
  const accent = getCssVar("--accent", "#33cc99");
  const accent2 = getCssVar("--accent-2", "#f97316");
  const text = getCssVar("--text", "#0f172a");
  drawCanvasBackground(ctx, width, height, 0.5);

  const headingX = width / 2;
  const headingY = 320;
  const headingLine1 = "My life";
  const headingLine2 = "time is";

  ctx.fillStyle = text;
  ctx.textAlign = "center";
  const headingFontSize = 200;
  const headingLetterSpacing = -0.02;
  const lineHeight = 200;
  ctx.font = `600 ${headingFontSize}px ${CANVAS_FONT_FAMILY}`;
  drawTextWithSpacing(
    ctx,
    headingLine1.trim(),
    headingX,
    headingY,
    headingLetterSpacing,
    headingFontSize,
    "center"
  );
  let readoutY = headingY + lineHeight;
  if (headingLine2) {
    drawTextWithSpacing(
      ctx,
      headingLine2.trim(),
      headingX,
      headingY + lineHeight,
      headingLetterSpacing,
      headingFontSize,
      "center"
    );
    readoutY = headingY + lineHeight * 2;
  }
  readoutY += 10;

  const readoutFontSize = 140;
  const readoutText = state.readout || "--:--";
  const hasReadoutPeriod = /\s(AM|PM)$/.test(readoutText);
  const readoutPaddingX = hasReadoutPeriod ? -90 : -30;
  const readoutPaddingTop = 10;
  const readoutPaddingBottom = 50;
  const readoutMetrics = ctx.measureText(readoutText);
  const readoutAscent =
    readoutMetrics.actualBoundingBoxAscent || readoutFontSize * 0.8;
  const readoutDescent =
    readoutMetrics.actualBoundingBoxDescent || readoutFontSize * 0.2;
  const readoutHeight = readoutAscent + readoutDescent;
  const readoutWidth = readoutMetrics.width;
  const readoutPillX = headingX - readoutWidth / 2 - readoutPaddingX;
  const readoutPillY = readoutY - readoutAscent - readoutPaddingTop;
  const readoutPillW = readoutWidth + readoutPaddingX * 2;
  const readoutPillH = readoutHeight + readoutPaddingTop + readoutPaddingBottom;

  ctx.fillStyle = text;
  drawRoundedRect(
    ctx,
    readoutPillX,
    readoutPillY,
    readoutPillW,
    readoutPillH,
    28
  );
  ctx.fill();

  ctx.fillStyle = getCssVar("--white", "#ffffff");
  ctx.font = `500 ${readoutFontSize}px ${CANVAS_FONT_FAMILY}`;
  ctx.fillText(readoutText, headingX, readoutY);
  ctx.textAlign = "start";

  const cx = width / 2;
  const cy = height / 2 + 340;
  const radius = 420;

  const faceSize = radius * 2;
  try {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    const faceImg = await loadClockFaceImage();
    ctx.drawImage(
      faceImg,
      cx - faceSize / 2,
      cy - faceSize / 2,
      faceSize,
      faceSize
    );
  } catch (err) {
    console.warn("Clock face image failed to load, using fallback:", err);
  }
  // drawDayNightIndicator(ctx, cx, cy, faceSize, state.hours, state.minutes);

  // Redraw hands on top of face
  const hourLength = radius * 0.5;
  const minuteLength = radius * 0.8;
  const handWidth = 24;
  const handFill = getCssVar("--accent-4", "#f26d7d");
  drawClockHand(
    ctx,
    cx,
    cy,
    state.hourAngle,
    hourLength,
    handWidth,
    text,
    handFill
  );
  drawClockHand(
    ctx,
    cx,
    cy,
    state.minuteAngle,
    minuteLength,
    handWidth,
    text,
    handFill
  );

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = text;
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.fillStyle = text;
  ctx.textAlign = "left";
  ctx.font = `500 55px ${CANVAS_FONT_FAMILY}`;
  const signatureUrl = "lifeclock.cc";
  const signatureTag = "#mylifeclock";
  ctx.fillText(signatureUrl, 60, height - 80);
  ctx.textAlign = "right";
  ctx.fillText(signatureTag, width - 60, height - 80);
  ctx.textAlign = "start";

  return canvas;
}

function buildGridShareCanvas(stats) {
  if (!stats) return null;
  const { canvas, ctx, width, height } = createBaseCanvas();
  const text = getCssVar("--text", "#0f172a");
  const mutedRgb = getCssVar("--muted-rgb", "164, 172, 182");
  const textRgb = getCssVar("--text-rgb", "15, 23, 42");
  const filledStart = getCssVar("--filled-grad-start", "#ffc8c8");
  const filledEnd = getCssVar("--filled-grad-end", "#0c59c4");
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const titleText = "My life map";

  ctx.fillStyle = text;
  const titleFontSize = 130;
  const titleLetterSpacing = -0.02;
  ctx.font = `600 ${titleFontSize}px ${CANVAS_FONT_FAMILY}`;
  const titleWidth = measureTextWithSpacing(
    ctx,
    titleText,
    titleLetterSpacing,
    titleFontSize
  );
  const contentTop = 20;
  const targetGridWidth = Math.min(width - 120, titleWidth);
  const gridTop = contentTop + 300;
  const baseSize = 14;
  const baseGap = 2;
  const availableHeight = height - gridTop - 100;
  const rowHeight = baseSize + baseGap;
  const baseGridWidth = WEEKS_PER_YEAR * (baseSize + baseGap) - baseGap;
  const decadeGap = 4;
  const decadeCount = Math.floor((stats.totalYears - 1) / 10);
  const availableHeightForRows = availableHeight - decadeCount * decadeGap;
  const scaleFromHeight =
    availableHeightForRows / (stats.totalYears * rowHeight);
  const scaleFromWidth = targetGridWidth / baseGridWidth;
  const scale = Math.min(1.4, scaleFromHeight, scaleFromWidth);
  const box = Math.max(8, baseSize * scale);
  const gap = baseGap * scale;
  const gridWidth = WEEKS_PER_YEAR * (box + gap) - gap;
  const startX = (width - gridWidth) / 2;
  const startY = gridTop;
  const gridHeight =
    stats.totalYears * (box + gap) - gap + decadeCount * decadeGap;
  const filledGradient = ctx.createLinearGradient(
    0,
    startY,
    0,
    startY + gridHeight
  );
  filledGradient.addColorStop(0, filledStart);
  filledGradient.addColorStop(1, filledEnd);
  const upcomingStroke = `rgba(${mutedRgb}, 0.5)`;
  const beyondStroke = `rgba(${textRgb}, 0.15)`;
  ctx.lineWidth = 1;
  drawTextWithSpacing(
    ctx,
    titleText,
    width / 2,
    contentTop + 160,
    titleLetterSpacing,
    titleFontSize,
    "center"
  );

  ctx.fillStyle = text;
  const statsFontSize = 55;
  const statsLetterSpacing = -0.02;
  ctx.font = `500 ${statsFontSize}px ${CANVAS_FONT_FAMILY}`;
  const statsY = contentTop + 240;
  drawTextWithSpacing(
    ctx,
    `${stats.weeksLived.toLocaleString()} weeks lived (${stats.daysLived.toLocaleString()} days)`,
    startX,
    statsY,
    statsLetterSpacing,
    statsFontSize,
    "left"
  );

  for (let year = 0; year < stats.totalYears; year++) {
    for (let week = 0; week < WEEKS_PER_YEAR; week++) {
      const globalWeek = year * WEEKS_PER_YEAR + week + 1;
      if (!stats.showBeyond && globalWeek > stats.expectancyWeeks) continue;
      const decadeOffset = Math.floor(year / 10) * decadeGap;
      const y = startY + year * (box + gap) + decadeOffset;
      const x = startX + week * (box + gap);
      if (globalWeek <= stats.weeksLived) {
        ctx.fillStyle = filledGradient;
        ctx.fillRect(x, y, box, box);
      } else if (globalWeek > stats.expectancyWeeks) {
        ctx.strokeStyle = beyondStroke;
        ctx.strokeRect(x, y, box, box);
      } else {
        ctx.strokeStyle = upcomingStroke;
        ctx.strokeRect(x, y, box, box);
      }
    }
  }

  ctx.fillStyle = text;
  ctx.font = `500 55px ${CANVAS_FONT_FAMILY}`;
  const signatureUrl = "lifeclock.cc";
  const signatureTag = "#mylifeclock";
  ctx.textAlign = "left";
  ctx.fillText(signatureUrl, 60, height - 80);
  ctx.textAlign = "right";
  ctx.fillText(signatureTag, width - 60, height - 80);
  ctx.textAlign = "start";

  return canvas;
}

async function saveImageFromCanvas(canvas, filename, text) {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        resolve("failed");
        return;
      }
      if (window.showSaveFilePicker) {
        await saveBlob(blob, filename, "image/png");
        resolve("picker");
        return;
      }
      const file = new File([blob], filename, { type: "image/png" });
      const payload = {
        files: [file],
        title: "Life snapshot",
        text: text || "My life snapshot",
      };
      if (navigator.share && navigator.canShare && navigator.canShare(payload)) {
        try {
          await navigator.share(payload);
          resolve("shared");
          return;
        } catch (err) {
          resolve("cancelled");
          return;
        }
      }
      await saveBlob(blob, filename, "image/png");
      resolve("downloaded");
    });
  });
}

async function shareCanvas(canvas, filename, button, text) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Failed to create image"));
        return;
      }
      const file = new File([blob], filename, { type: "image/png" });
      const payload = {
        files: [file],
        title: "Life snapshot",
        text: text || "My life snapshot",
      };

      try {
        if (!navigator.share || !navigator.canShare || !navigator.canShare(payload)) {
          resolve("unsupported");
          return;
        }
        await navigator.share(payload);
        resolve("shared");
      } catch (err) {
        resolve("cancelled");
      } finally {
        if (button) {
          button.disabled = false;
          button.classList.remove("loading");
        }
      }
    });
  });
}

function previewCanvas(canvas, target) {
  if (!canvas) return false;
  const holder = target || document.body;
  const existing = holder.querySelector(".share-preview");
  if (existing) {
    existing.remove();
    return false;
  }
  const img = document.createElement("img");
  img.className = "share-preview";
  img.src = canvas.toDataURL("image/png");
  img.alt = "Share preview";
  img.style.maxWidth = "100%";
  img.style.marginTop = "16px";
  holder.appendChild(img);
  if (holder.scrollIntoView)
    holder.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
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
  const data = await response.json();
  const entities = data && data.entities ? data.entities : {};
  return Object.values(entities).filter((entity) => !entity.missing);
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function addNotableIdsToWeeks(ids, peopleByWeek, seenIds) {
  const newIds = ids.filter((id) => {
    if (!id || seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
  const idBatches = chunkItems(newIds, WIKIDATA_ENTITY_BATCH_SIZE);
  const entityArrays = await Promise.all(
    idBatches.map((batch) => fetchWikidataEntities(batch))
  );
  entityArrays
    .flat()
    .map(normalizeWikidataEntity)
    .forEach((person) => mergePeopleByWeek(peopleByWeek, person));
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

async function loadNotableLifespansForAge(ageYears) {
  if (notableAgeRequests.has(ageYears)) {
    return notableAgeRequests.get(ageYears);
  }

  const cachedPeopleByWeek = readCachedPeopleByWeek(ageYears);
  if (cachedPeopleByWeek) {
    markLoadedNotableWeeks(cachedPeopleByWeek);
    return cachedPeopleByWeek;
  }

  const request = (async () => {
    const peopleByWeek = new Map();
    const seenIds = new Set();
    let continueToken = null;
    for (let pageIndex = 0; pageIndex < COMMONS_CATEGORY_PAGE_LIMIT; pageIndex++) {
      const page = await fetchCommonsAgeCategoryPage(ageYears, continueToken);
      await addNotableIdsToWeeks(page.ids, peopleByWeek, seenIds);
      limitPeopleByWeek(peopleByWeek);
      markLoadedNotableWeeks(peopleByWeek);
      if (peopleByWeek.size >= NOTABLE_WEEK_COVERAGE_TARGET) break;
      continueToken = page.continueToken;
      if (!continueToken) break;
    }
    limitPeopleByWeek(peopleByWeek);
    markLoadedNotableWeeks(peopleByWeek);
    cachePeopleByWeek(ageYears, peopleByWeek);
    return peopleByWeek;
  })();

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
      failedNotableLifespanWeeks.add(globalWeek);
      notableLifespanRequests.delete(globalWeek);
      console.warn("Failed to load notable lifespans from Wikidata:", err);
      throw err;
    });
  notableLifespanRequests.set(globalWeek, request);
  return request;
}

function positionWeekTooltip(event, box) {
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
  positionWeekTooltip({}, pinnedTooltipBox);
}

function appendTooltipStatus(text, isLoading = false) {
  const status = document.createElement("div");
  status.className = "week-tooltip-status";
  status.classList.toggle("is-loading", isLoading);
  status.textContent = text;
  weekTooltip.appendChild(status);
}

function prefetchNotableLifespansForAge(ageYears) {
  if (!Number.isFinite(ageYears)) return;
  loadNotableLifespansForAge(ageYears).catch((err) => {
    console.warn("Failed to preload notable lifespans from Wikidata:", err);
  });
}

function renderWeekTooltipContent(
  box,
  event,
  shouldPin,
  markers,
  showEmptyStatus = true
) {
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

  if (showEmptyStatus && markers.length === 0) {
    appendTooltipStatus("No notable lives here.");
  }

  weekTooltip.hidden = false;
  positionWeekTooltip(event, box);
}

function renderWeekTooltip(box, event, shouldPin = false) {
  const renderId = ++weekTooltipRenderId;
  const globalWeek = getBoxGlobalWeek(box);
  if (!isGlobalWeekLived(globalWeek)) {
    renderWeekTooltipContent(box, event, shouldPin, [], false);
    return;
  }

  if (notableLifespansByWeek.has(globalWeek)) {
    renderWeekTooltipContent(
      box,
      event,
      shouldPin,
      notableLifespansByWeek.get(globalWeek)
    );
    return;
  }

  if (failedNotableLifespanWeeks.has(globalWeek)) {
    renderWeekTooltipContent(box, event, shouldPin, [], false);
    appendTooltipStatus("Could not load notable lives.");
    positionWeekTooltip(event, box);
    return;
  }

  weekTooltip.classList.toggle("is-pinned", shouldPin);
  weekTooltip.replaceChildren();

  const ageLine = document.createElement("div");
  ageLine.className = "week-tooltip-age";
  ageLine.textContent = getBoxAgeLabel(box);
  weekTooltip.appendChild(ageLine);
  appendTooltipStatus("Loading notable lives...", true);

  weekTooltip.hidden = false;
  positionWeekTooltip(event, box);

  findNotableLifespansForBox(box)
    .then((markers) => {
      if (renderId !== weekTooltipRenderId) return;
      if (!shouldPin && hoveredWeekBox !== box) return;
      if (shouldPin && pinnedTooltipBox !== box) return;
      renderWeekTooltipContent(box, event, shouldPin, markers);
    })
    .catch(() => {
      if (renderId !== weekTooltipRenderId) return;
      if (!shouldPin && hoveredWeekBox !== box) return;
      if (shouldPin && pinnedTooltipBox !== box) return;
      renderWeekTooltipContent(box, event, shouldPin, [], false);
      appendTooltipStatus("Could not load notable lives.");
      positionWeekTooltip(event, box);
    });
}

function selectWeekBox(box) {
  if (selectedWeekBox && selectedWeekBox !== box) {
    selectedWeekBox.classList.remove("is-selected");
  }
  selectedWeekBox = box;
  selectedWeekBox.classList.add("is-selected");
  lifeBoxes.classList.add("has-selection");
}

function clearSelectedWeekBox() {
  if (selectedWeekBox) {
    selectedWeekBox.classList.remove("is-selected");
  }
  selectedWeekBox = null;
  lifeBoxes.classList.remove("has-selection");
}

function isPointerInsideBox(event, box) {
  if (!box) return false;
  const rect = box.getBoundingClientRect();
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

function isPointerInsideElement(event, element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
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
    if (!target || !target.dataset.week || !target.dataset.year) {
      hideHoverTooltip();
      return;
    }
    hoveredWeekBox = target;
    renderWeekTooltip(target, event);
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
    if (weekTooltip.hidden) return;
    syncHoverTooltipVisibility();
    if (weekTooltip.hidden) return;
    if (pinnedTooltipBox) {
      return;
    }
    const elementAtPointer = document.elementFromPoint(event.clientX, event.clientY);
    const boxAtPointer = elementAtPointer
      ? elementAtPointer.closest(".life-box")
      : null;
    if (!boxAtPointer || boxAtPointer !== hoveredWeekBox) {
      hideHoverTooltip();
    }
  });

  lifeBoxes.addEventListener("click", (event) => {
    const target = event.target.closest(".life-box");
    if (!target) return;
    if (pinnedTooltipBox && pinnedTooltipBox !== target) {
      unpinWeekTooltip();
      return;
    }
    pinnedTooltipBox = target;
    selectWeekBox(target);
    renderWeekTooltip(target, event, true);
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
    selectWeekBox(target);
    renderWeekTooltip(target, event, true);
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
  const ratio = ageYears / lifeExpectancyYears;
  const shouldDeferClockMotion = !document.body.classList.contains("has-results");
  if (shouldDeferClockMotion) {
    document.body.classList.add("is-flip-pending");
  }
  updateClock(ratio, { deferMotion: shouldDeferClockMotion });
  updateLifeGrid(ageYears, dobDate);
  flipFormShell(true);
  if (typeof window.updateSharePreviewOverlay === "function") {
    window.updateSharePreviewOverlay();
  }
}

function hideVisuals() {
  clockPanel.hidden = true;
  clockPanel.classList.remove("is-visible");
  lifeGrid.hidden = true;
  lifeGrid.classList.remove("is-visible");
  flipFormShell(false);
  hideTooltip();
  updateResultHeadings();
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

function applyQaDefaults() {
  if (!QA_MODE) return;
  syncDobValue();
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

async function saveBlob(blob, filename, mimeType) {
  if (!blob) return false;
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: mimeType === "application/pdf" ? "PDF file" : "PNG image",
            accept: { [mimeType]: [mimeType === "application/pdf" ? ".pdf" : ".png"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if (err && err.name === "AbortError") return true;
      console.warn("Save picker failed, falling back to download:", err);
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

function refreshLifeGridScale(shouldScaleForPrint = false) {
  if (!document.body.classList.contains("has-results")) return;
  if (!QA_MODE && !dobInput.value.trim()) return;
  if (lastDobDate) {
    updateLifeGrid(calculateAgeYears(lastDobDate), lastDobDate);
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setPrintBoxScale(shouldScaleForPrint);
    });
  });
}

function setPrintBoxScale(active) {
  if (!lifeGrid || !lifeBoxes) return;
  if (!active) {
    lifeBoxes.style.removeProperty("--life-box-size");
    lifeBoxes.style.removeProperty("--life-box-gap");
    if (lifeGrid) {
      lifeGrid.style.removeProperty("--life-grid-width");
    }
    return;
  }
  const cols = WEEKS_PER_YEAR;
  if (!cols) return;
  const container =
    lifeBoxes.closest(".life-grid-inner") || lifeBoxes.parentElement;
  const availableWidth =
    (container && container.clientWidth) ||
    document.documentElement.clientWidth ||
    lifeGrid.clientWidth;
  if (!availableWidth) return;
  const gapRatio = BASE_LIFE_BOX_GAP / BASE_LIFE_BOX_SIZE;
  const sizeFromWidth = availableWidth / (cols + (cols - 1) * gapRatio);
  const boxSize = Math.max(
    0.5,
    Math.min(BASE_LIFE_BOX_SIZE, sizeFromWidth)
  );
  const boxGap = boxSize * gapRatio;
  const gridWidth =
    WEEKS_PER_YEAR * (boxSize + boxGap) - boxGap;
  lifeBoxes.style.setProperty("--life-box-size", `${boxSize.toFixed(2)}px`);
  lifeBoxes.style.setProperty("--life-box-gap", `${boxGap.toFixed(2)}px`);
  if (lifeGrid) {
    lifeGrid.style.setProperty(
      "--life-grid-width",
      `${gridWidth.toFixed(2)}px`
    );
  }
}

if (typeof window.matchMedia === "function") {
  const printMedia = window.matchMedia("print");
  if (typeof printMedia.addEventListener === "function") {
    printMedia.addEventListener("change", (event) => {
      if (event.matches) {
        setTimeout(() => refreshLifeGridScale(true), 0);
      } else {
        refreshLifeGridScale(false);
      }
    });
  }
}

window.addEventListener("beforeprint", () => {
  if (lifeBoxes) {
    cachedLifeBoxSize = lifeBoxes.style.getPropertyValue("--life-box-size");
    cachedLifeBoxGap = lifeBoxes.style.getPropertyValue("--life-box-gap");
  }
  setTimeout(() => refreshLifeGridScale(true), 0);
});

window.addEventListener("afterprint", () => {
  if (lifeBoxes) {
    if (cachedLifeBoxSize) {
      lifeBoxes.style.setProperty("--life-box-size", cachedLifeBoxSize);
    } else {
      lifeBoxes.style.removeProperty("--life-box-size");
    }
    if (cachedLifeBoxGap) {
      lifeBoxes.style.setProperty("--life-box-gap", cachedLifeBoxGap);
    } else {
      lifeBoxes.style.removeProperty("--life-box-gap");
    }
  }
  setTimeout(() => {
    if (document.body.classList.contains("has-results") && lastDobDate) {
      updateLifeGrid(calculateAgeYears(lastDobDate), lastDobDate);
    } else {
      refreshLifeGridScale(false);
    }
  }, 200);
});

function guardShare(button) {
  if (!document.body.classList.contains("has-results")) {
    alert("Submit your info first to generate a share image.");
    return false;
  }
  if (button) {
    button.disabled = true;
    button.classList.add("loading");
  }
  return true;
}

function buildClockShareText(includeEmoji = false) {
  return buildSocialShareText(includeEmoji);
}

function buildGridShareText(includeEmoji = false) {
  return buildSocialShareText(includeEmoji);
}

function buildSocialShareText(includeEmoji = false) {
  const readout = lastClockState ? lastClockState.readout : "xx:xx";
  const weeks = lastGridStats ? lastGridStats.weeksLived.toLocaleString() : "—";
  const timeEmoji = includeEmoji ? "⏰ " : "";
  const weekEmoji = includeEmoji ? "📅 " : "";
  return (
    "My life stats right now:\n" +
    `${timeEmoji}${readout} · ${weekEmoji}Week ${weeks}\n` +
    "Check yours at https://lifeclock.cc\n" +
    "#mylifeclock"
  );
}

async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn("Clipboard write failed, falling back.", err);
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const ok = document.execCommand("copy");
  textarea.remove();
  return ok;
}

function openShareUrl(url) {
  window.open(url, "_blank", "noopener");
}

function toggleShareMenu(panel, forceOpen) {
  if (!panel) return;
  if (panel.dataset.static === "true") return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : panel.hidden;
  panel.hidden = !shouldOpen;
}

function handleShareMenuClick(event) {
  const button = event.target.closest(".share-menu-item");
  if (!button) return;
  const panel = button.closest(".share-menu-list");
  if (!panel) return;
  const source = panel.dataset.shareSource;
  const target = button.dataset.shareTarget;
  const shareUrl = encodeURIComponent(window.location.href);

  if (source === "clock") {
    if (!lastClockState) {
      alert("Nothing to share yet—try submitting first.");
      toggleShareMenu(panel, false);
      return;
    }
    buildClockShareCanvas(lastClockState).then((canvas) => {
      const shareText = encodeURIComponent(buildClockShareText(target === "x"));
      const filenameBase = "my";
      const clockFilename = `${filenameBase}-lifeclock.png`;
      if (target === "download") {
        saveImageFromCanvas(canvas, clockFilename, buildClockShareText(true));
      } else if (target === "share") {
        if (!guardShare(button)) return;
        shareCanvas(canvas, clockFilename, button, buildClockShareText(true)).then(
          (result) => {
            if (result === "unsupported") {
              alert("Sharing isn't supported on this device.");
            }
          }
        );
      } else if (target === "x") {
        openShareUrl(`https://twitter.com/intent/tweet?text=${shareText}`);
      } else if (target === "threads") {
        openShareUrl(`https://www.threads.net/intent/post?text=${shareText}`);
      }
    });
  } else if (source === "grid") {
    if (!lastGridStats) {
      alert("Nothing to share yet—try submitting first.");
      toggleShareMenu(panel, false);
      return;
    }
    const canvas = buildGridShareCanvas(lastGridStats);
    const shareText = encodeURIComponent(buildGridShareText(target === "x"));
    const filenameBase = "my";
    const gridFilename = `${filenameBase}-lifemap.png`;
    if (target === "download") {
      saveImageFromCanvas(canvas, gridFilename, buildGridShareText(true));
    } else if (target === "share") {
      if (!guardShare(button)) return;
      shareCanvas(canvas, gridFilename, button, buildGridShareText(true)).then(
        (result) => {
          if (result === "unsupported") {
            alert("Sharing isn't supported on this device.");
          }
        }
      );
    } else if (target === "x") {
      openShareUrl(`https://twitter.com/intent/tweet?text=${shareText}`);
    } else if (target === "threads") {
      openShareUrl(`https://www.threads.net/intent/post?text=${shareText}`);
    }
  }
  toggleShareMenu(panel, false);
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
    updateLifeBoxScale();
  }
});

updateResultHeadings();
if (copyrightYear) {
  const startYear = 2025;
  const currentYear = new Date().getFullYear();
  copyrightYear.textContent =
    currentYear > startYear ? `${startYear} - ${currentYear}` : String(startYear);
}
initShareTitleWave();

if (QA_MODE && !document.body.classList.contains("has-results")) {
  applyQaDefaults();
  renderFromDob(dobInput.value);
}
