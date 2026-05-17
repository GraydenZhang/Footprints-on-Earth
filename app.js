const DATA_URL = "./data/footprint_test_file.csv";
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const AMAP_TILE_HOSTS = [1, 2, 3, 4];
const EARTH_RADIUS_KM = 6371;
const MAX_PATH_GAP_SECONDS = 10 * 60 * 60;
const MAX_PATH_GAP_KM = 280;
const ROW_HEIGHT = 58;
const ROW_OVERSCAN = 8;
const REQUIRED_CSV_COLUMNS = ["dataTime", "longitude", "latitude"];
const DEFAULT_SCALE = 1;
const START_WITH_TIMELINE = new URLSearchParams(window.location.search).get("timeline") === "1";
const SETTINGS_KEY = "footprints-earth-settings-v2";
const AMAP_CREDENTIALS_KEY = "footprints-earth-amap-credentials-v1";
const SAVED_CSV_DB = "footprints-earth-data";
const SAVED_CSV_STORE = "files";
const SAVED_CSV_KEY = "last-csv";
const DEFAULT_SETTINGS = {
  mapMode: "globe",
  sources: {
    globe: "osm",
    flat: "osm",
  },
  connectDistantPath: false,
  pointScale: DEFAULT_SCALE,
  pathScale: DEFAULT_SCALE,
};
const $ = (selector) => document.querySelector(selector);

const els = {
  shell: $(".app-shell"),
  status: $("#statusText"),
  source: $("#sourceName"),
  pointCount: $("#pointCount"),
  visibleCount: $("#visibleCount"),
  dateRange: $("#dateRange"),
  distanceTotal: $("#distanceTotal"),
  visibleStart: $("#visibleStart"),
  visibleEnd: $("#visibleEnd"),
  timeStart: $("#timeStart"),
  timeEnd: $("#timeEnd"),
  pointsToggle: $("#pointsToggle"),
  pathToggle: $("#pathToggle"),
  gapPathToggle: $("#gapPathToggle"),
  pointOptions: $("#pointOptions"),
  pathOptions: $("#pathOptions"),
  pointSizeRange: $("#pointSizeRange"),
  pointSizeReset: $("#pointSizeReset"),
  pathWidthRange: $("#pathWidthRange"),
  pathWidthReset: $("#pathWidthReset"),
  autoFitToggle: $("#autoFitToggle"),
  loadFileButton: $("#loadFileButton"),
  restoreDemoButton: $("#restoreDemoButton"),
  fileInput: $("#fileInput"),
  fitButton: $("#fitButton"),
  settingsToggle: $("#settingsToggle"),
  settingsMenu: $("#settingsMenu"),
  mapModeButtons: $("#mapModeButtons"),
  globeSourceSection: $("#globeSourceSection"),
  globeSourceButtons: $("#globeSourceButtons"),
  flatSourceSection: $("#flatSourceSection"),
  flatSourceButtons: $("#flatSourceButtons"),
  amapKeyButton: $("#amapKeyButton"),
  amapModal: $("#amapModal"),
  amapKeyInput: $("#amapKeyInput"),
  amapSecretInput: $("#amapSecretInput"),
  amapSaveButton: $("#amapSaveButton"),
  amapCancelButton: $("#amapCancelButton"),
  amapHelpButton: $("#amapHelpButton"),
  amapHelpPanel: $("#amapHelpPanel"),
  timelineToggle: $("#timelineToggle"),
  timelinePanel: $("#timelinePanel"),
  yearList: $("#yearList"),
  monthList: $("#monthList"),
  dayList: $("#dayList"),
  pointList: $("#pointList"),
  dayPointCount: $("#dayPointCount"),
  dayLabel: $("#dayLabel"),
};

const emptyPoints = { type: "FeatureCollection", features: [] };
const emptyPath = { type: "FeatureCollection", features: [] };

const state = {
  map: null,
  mapReady: false,
  pendingFitAfterStyle: false,
  settings: loadSettings(),
  pendingAmapAction: null,
  points: [],
  filtered: [],
  listPoints: [],
  years: [],
  yearGroups: new Map(),
  monthsByYear: new Map(),
  monthGroups: new Map(),
  daysByYear: new Map(),
  daysByMonth: new Map(),
  dayGroups: new Map(),
  selectedYear: null,
  selectedMonthKey: null,
  selectedDayKey: null,
  hoveredDayKey: null,
  hoverContextYear: null,
  hoverContextMonthKey: null,
  view: { type: "all", key: null },
  selectedPoint: null,
  exactRange: null,
  timeMin: 0,
  timeMax: 0,
};

function init() {
  if (!window.maplibregl) {
    setStatus("地图库未加载", true);
    return;
  }

  applyAmapSecurityConfig();
  renderSettingsControls();
  setupMap();
  bindEvents();
  loadInitialCsv();
}

function createMapStyle() {
  const source = getTileSourceConfig(getActiveSource());
  const projection = state.settings.mapMode === "globe" ? "globe" : "mercator";

  const style = {
    version: 8,
    projection: { type: projection },
    sources: {
      basemap: {
        type: "raster",
        tiles: source.tiles,
        tileSize: 256,
        attribution: source.attribution,
      },
    },
    layers: [
      {
        id: "basemap",
        type: "raster",
        source: "basemap",
        paint: getRasterPaint(),
      },
    ],
  };

  return style;
}

function setupMap() {
  state.map = new maplibregl.Map({
    container: "map",
    style: createMapStyle(),
    center: [77, 38],
    zoom: 1.35,
    minZoom: 0.6,
    maxZoom: 18,
    antialias: true,
    attributionControl: false,
  });

  state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  state.map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");

  state.map.on("load", () => finishMapStyleLoad(true));
  state.map.on("style.load", () => finishMapStyleLoad(true));
  state.map.on("styledata", () => {
    if (!state.mapReady && state.map.isStyleLoaded()) finishMapStyleLoad(true);
  });
  window.setTimeout(() => finishMapStyleLoad(false), 350);
  window.setTimeout(() => finishMapStyleLoad(false), 1200);
}

function finishMapStyleLoad(force = false) {
  if (!state.map || (!force && !state.map.isStyleLoaded())) return;
  if (state.map.getSource("footprints")) {
    state.mapReady = true;
    refreshMapData();
    if (state.pendingFitAfterStyle && (state.filtered.length || state.points.length)) {
      fitPoints(state.filtered.length ? state.filtered : state.points, {
        allData: state.view.type === "all",
        scope: state.view.type,
      });
      state.pendingFitAfterStyle = false;
    }
    return;
  }
  if (state.map.setProjection) {
    try {
      state.map.setProjection({ type: state.settings.mapMode === "globe" ? "globe" : "mercator" });
    } catch (error) {
      console.warn("Projection update skipped", error);
    }
  }
  addFootprintLayers();
  state.mapReady = true;
  syncLayerVisibility();
  refreshMapData();
  if (state.pendingFitAfterStyle && (state.filtered.length || state.points.length)) {
    fitPoints(state.filtered.length ? state.filtered : state.points, {
      allData: state.view.type === "all",
      scope: state.view.type,
    });
    state.pendingFitAfterStyle = false;
  } else if (state.points.length && !state.filtered.length) {
    fitPoints(state.points, { allData: true });
  }
}

function getTileSourceConfig(source) {
  if (source === "amap") {
    return {
      tiles: getAmapTiles(),
      attribution: '&copy; <a href="https://lbs.amap.com/" target="_blank" rel="noopener">高德地图</a>',
    };
  }

  return {
    tiles: [OSM_TILES],
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  };
}

function getRasterPaint() {
  return {
    "raster-opacity": 0.94,
    "raster-saturation": -0.12,
    "raster-contrast": 0.03,
    "raster-brightness-max": 0.84,
  };
}

function getAmapTiles() {
  const { key } = getAmapCredentials();
  const keyParam = key ? `&key=${encodeURIComponent(key)}` : "";
  return AMAP_TILE_HOSTS.map(
    (host) =>
      `https://webrd0${host}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}${keyParam}`,
  );
}

function getActiveSource() {
  return state.settings.sources[state.settings.mapMode] ?? "osm";
}

function pointRadiusExpression(scale = state.settings.pointScale) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    2 * scale,
    5,
    2.5 * scale,
    10,
    3.2 * scale,
    14,
    4 * scale,
    16,
    4.8 * scale,
  ];
}

function pointStrokeWidthExpression(scale = state.settings.pointScale) {
  return ["interpolate", ["linear"], ["zoom"], 0, 0, 10, 0.35 * scale, 16, 0.7 * scale];
}

function pathWidthExpression(scale = state.settings.pathScale) {
  return ["interpolate", ["linear"], ["zoom"], 0, 3.4 * scale, 7, 4.2 * scale, 13, 5.8 * scale];
}

function pathShadowWidthExpression(scale = state.settings.pathScale) {
  return ["interpolate", ["linear"], ["zoom"], 0, 4.2 * scale, 7, 4.8 * scale, 13, 6 * scale];
}

function gapPathWidthExpression(scale = state.settings.pathScale) {
  return ["interpolate", ["linear"], ["zoom"], 0, 3.1 * scale, 7, 3.8 * scale, 13, 5.2 * scale];
}

function addFootprintLayers() {
  if (state.map.getSource("footprints")) return;

  state.map.addSource("footprints", { type: "geojson", data: emptyPoints });
  state.map.addSource("footprint-path", { type: "geojson", data: emptyPath });
  state.map.addSource("footprint-gap-path", { type: "geojson", data: emptyPath });
  state.map.addSource("selected-point", { type: "geojson", data: emptyPoints });

  state.map.addLayer({
    id: "footprint-path-shadow",
    type: "line",
    source: "footprint-path",
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "rgba(34, 10, 0, 0.38)",
      "line-opacity": 0.42,
      "line-width": pathShadowWidthExpression(),
    },
  });

  state.map.addLayer({
    id: "footprint-path",
    type: "line",
    source: "footprint-path",
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#ff2438",
      "line-opacity": 0.96,
      "line-width": pathWidthExpression(),
    },
  });

  state.map.addLayer({
    id: "footprint-gap-path",
    type: "line",
    source: "footprint-gap-path",
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#ff2438",
      "line-opacity": 0.5,
      "line-width": gapPathWidthExpression(),
    },
  });

  state.map.addLayer({
    id: "footprint-points",
    type: "circle",
    source: "footprints",
    paint: {
      "circle-color": "#f5c542",
      "circle-opacity": 0.92,
      "circle-radius": pointRadiusExpression(),
      "circle-stroke-color": "rgba(20, 14, 0, 0.42)",
      "circle-stroke-width": pointStrokeWidthExpression(),
    },
  });

  state.map.addLayer({
    id: "selected-point-halo",
    type: "circle",
    source: "selected-point",
    paint: {
      "circle-color": "rgba(245, 197, 66, 0.24)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 7, 12, 18, 16, 26],
      "circle-stroke-color": "rgba(255, 255, 255, 0.75)",
      "circle-stroke-width": 2,
    },
  });

  state.map.addLayer({
    id: "selected-point",
    type: "circle",
    source: "selected-point",
    paint: {
      "circle-color": "#f5c542",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 3, 12, 7, 16, 9],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });

  state.map.on("click", "footprint-points", (event) => {
    const feature = event.features?.[0];
    const index = Number(feature?.properties?.index);
    const point = state.points[index];
    if (point) selectPoint(point, { fly: true, syncDateLists: true });
  });

  state.map.on("mouseenter", "footprint-points", () => {
    state.map.getCanvas().style.cursor = "pointer";
  });
  state.map.on("mouseleave", "footprint-points", () => {
    state.map.getCanvas().style.cursor = "";
  });
}

function bindEvents() {
  els.loadFileButton.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", async () => {
    const file = els.fileInput.files?.[0];
    if (!file) return;
    try {
      setStatus("读取中");
      const text = await file.text();
      await saveLastCsv(file.name, text);
      ingestCsv(text, file.name, { fit: true });
    } catch (error) {
      console.error(error);
      setStatus("读取失败", true, getErrorMessage(error));
    }
  });

  els.restoreDemoButton.addEventListener("click", restoreDefaultDemo);
  els.fitButton.addEventListener("click", showAllData);
  els.settingsToggle.addEventListener("click", () => setSettingsOpen(els.settingsMenu.classList.contains("collapsed")));
  els.mapModeButtons.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button) return;
    setMapMode(button.dataset.mode);
  });
  els.globeSourceButtons.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-source]");
    if (!button) return;
    requestMapSource("globe", button.dataset.source);
  });
  els.flatSourceButtons.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-source]");
    if (!button) return;
    requestMapSource("flat", button.dataset.source);
  });
  els.amapKeyButton.addEventListener("click", () => openAmapModal());
  els.amapHelpButton.addEventListener("click", toggleAmapHelp);
  els.amapSaveButton.addEventListener("click", saveAmapCredentialsFromModal);
  els.amapCancelButton.addEventListener("click", closeAmapModal);
  els.amapModal.addEventListener("pointerdown", (event) => {
    if (event.target === els.amapModal) closeAmapModal();
  });
  els.timelineToggle.addEventListener("click", toggleTimeline);

  [els.timeStart, els.timeEnd].forEach((input) => {
    input.addEventListener("input", () => {
      state.view = { type: "range", key: null };
      state.exactRange = null;
      applyFilters({ fit: false });
      renderAllLists();
    });
  });

  els.pointsToggle.addEventListener("change", () => {
    syncSettingsConditionalControls();
    syncLayerVisibility();
  });
  els.pathToggle.addEventListener("change", () => {
    syncSettingsConditionalControls();
    syncLayerVisibility();
    refreshMapData();
  });
  els.gapPathToggle.addEventListener("change", () => {
    state.settings.connectDistantPath = els.gapPathToggle.checked;
    saveSettings();
    syncLayerVisibility();
    refreshMapData();
  });
  els.pointSizeRange.addEventListener("input", () => {
    state.settings.pointScale = normalizeScale(els.pointSizeRange.value);
    saveSettings();
    applyPaintScales();
  });
  els.pointSizeReset.addEventListener("click", () => {
    state.settings.pointScale = DEFAULT_SETTINGS.pointScale;
    saveSettings();
    renderSettingsControls();
    applyPaintScales();
  });
  els.pathWidthRange.addEventListener("input", () => {
    state.settings.pathScale = normalizeScale(els.pathWidthRange.value);
    saveSettings();
    applyPaintScales();
  });
  els.pathWidthReset.addEventListener("click", () => {
    state.settings.pathScale = DEFAULT_SETTINGS.pathScale;
    saveSettings();
    renderSettingsControls();
    applyPaintScales();
  });

  els.yearList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-year]");
    if (!button) return;
    selectYear(Number(button.dataset.year));
  });

  els.monthList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-month]");
    if (!button) return;
    selectMonth(button.dataset.month);
  });

  els.dayList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-day]");
    if (!button) return;
    selectDay(button.dataset.day);
  });
  els.dayList.addEventListener("pointerover", (event) => {
    const button = event.target.closest("button[data-day]");
    if (!button || !els.dayList.contains(button)) return;
    setTimelineHoverContext(button.dataset.day);
  });
  els.dayList.addEventListener("pointerleave", clearTimelineHoverContext);
  els.dayList.addEventListener("focusin", (event) => {
    const button = event.target.closest("button[data-day]");
    if (button) setTimelineHoverContext(button.dataset.day);
  });
  els.dayList.addEventListener("focusout", clearTimelineHoverContext);

  els.pointList.addEventListener("scroll", renderVirtualPointList);
  els.pointList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-index]");
    if (!button) return;
    const point = state.points[Number(button.dataset.index)];
    if (point) selectPoint(point, { fly: true, syncDateLists: true });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setSettingsOpen(false);
      closeAmapModal();
    }
  });

  window.addEventListener("pointerdown", (event) => {
    if (els.settingsMenu.classList.contains("collapsed")) return;
    if (event.target.closest(".settings-wrap")) return;
    setSettingsOpen(false);
  });

  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", async (event) => {
    event.preventDefault();
    const file = [...event.dataTransfer.files].find((item) => item.name.toLowerCase().endsWith(".csv"));
    if (!file) return;
    try {
      setStatus("读取中");
      const text = await file.text();
      await saveLastCsv(file.name, text);
      ingestCsv(text, file.name, { fit: true });
    } catch (error) {
      console.error(error);
      setStatus("读取失败", true, getErrorMessage(error));
    }
  });
}

async function loadInitialCsv() {
  try {
    const saved = await loadLastCsv();
    if (saved?.text) {
      ingestCsv(saved.text, `上次选择 ${saved.name}`, { fit: true, allData: true });
      return;
    }
  } catch (error) {
    console.warn("Saved CSV unavailable, falling back to demo", error);
  }
  loadDefaultCsv();
}

async function loadDefaultCsv(options = {}) {
  try {
    setStatus("加载中");
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    ingestCsv(await response.text(), "默认演示 data/footprint_test_file.csv", {
      fit: options.resetView ?? true,
      allData: true,
    });
  } catch (error) {
    console.error(error);
    els.source.textContent = "请选择 CSV";
    setStatus("待选择", true, getErrorMessage(error));
  }
}

function restoreDefaultDemo() {
  state.settings = getDefaultSettings();
  saveSettings();
  renderSettingsControls();
  setSettingsOpen(false);
  clearLastCsv();
  applyMapStyle({ fit: true });
  loadDefaultCsv({ resetView: true });
}

function openCsvDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(SAVED_CSV_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SAVED_CSV_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveLastCsv(name, text) {
  const db = await openCsvDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAVED_CSV_STORE, "readwrite");
    tx.objectStore(SAVED_CSV_STORE).put({ name, text, savedAt: Date.now() }, SAVED_CSV_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function loadLastCsv() {
  const db = await openCsvDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAVED_CSV_STORE, "readonly");
    const request = tx.objectStore(SAVED_CSV_STORE).get(SAVED_CSV_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function clearLastCsv() {
  try {
    const db = await openCsvDb();
    const tx = db.transaction(SAVED_CSV_STORE, "readwrite");
    tx.objectStore(SAVED_CSV_STORE).delete(SAVED_CSV_KEY);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  } catch {
    // Demo mode still works if browser storage is unavailable.
  }
}

function ingestCsv(text, label, options = {}) {
  const parsed = parseCsv(text);
  validateCsvColumns(parsed.headers);

  const normalized = parsed.rows.map(normalizePoint);
  const skipped = normalized.filter((point) => !point).length;
  const firstSkipped = skipped ? findFirstSkippedRow(parsed.rows) : null;
  const points = normalized
    .filter(Boolean)
    .sort((a, b) => a.time - b.time)
    .map((point, index, sorted) => ({
      ...point,
      index,
      normalizedTime:
        sorted.length <= 1 ? 0 : (point.time - sorted[0].time) / (sorted[sorted.length - 1].time - sorted[0].time),
    }));

  if (!points.length) {
    throw new Error("CSV 中没有可识别的 longitude / latitude / dataTime 数据。");
  }

  decoratePoints(points);
  state.points = points;
  state.selectedPoint = null;
  state.exactRange = null;
  state.timeMin = points[0].time;
  state.timeMax = points[points.length - 1].time;
  state.view = { type: "all", key: null };
  state.selectedYear = state.years[0] ?? null;
  state.selectedMonthKey = null;
  state.selectedDayKey = null;
  els.timeStart.value = "0";
  els.timeEnd.value = "1000";
  els.source.textContent = label;

  buildDateGroups(points);
  state.selectedYear = state.years[0] ?? null;
  state.hoveredDayKey = null;
  state.hoverContextYear = null;
  state.hoverContextMonthKey = null;
  renderAllLists();
  updateStats();
  applyFilters({ fit: options.fit ?? true, allData: options.allData ?? true });
  refreshSelectedPoint();
  if (START_WITH_TIMELINE) setTimelineOpen(true);
  setStatus(
    skipped ? `已加载，跳过 ${formatInt(skipped)} 行` : "已加载",
    false,
    firstSkipped ? `首个跳过行：第 ${firstSkipped.rowNumber} 行，${firstSkipped.reason}` : "",
  );
}

function parseCsv(text) {
  const clean = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    const next = clean[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift()?.map((name) => name.trim()) ?? [];
  return {
    headers,
    rows: rows.map((values) => Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ""]))),
  };
}

function validateCsvColumns(headers) {
  const missing = REQUIRED_CSV_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) {
    throw new Error(`CSV 缺少必需列：${missing.join(", ")}`);
  }
}

function normalizePoint(row, rawIndex) {
  const { lon, lat, time, reason } = validatePointRow(row);
  if (reason) return null;
  return {
    rawIndex,
    lon,
    lat,
    time,
    speed: numberFrom(row.speed),
    distance: numberFrom(row.distance),
    altitude: numberFrom(row.altitude),
    heading: numberFrom(row.heading),
  };
}

function validatePointRow(row) {
  const lon = numberFrom(row.longitude);
  const lat = numberFrom(row.latitude);
  const time = normalizeTimestamp(row.dataTime);
  if (time === null) return { reason: "dataTime 不是有效时间戳" };
  if (lon === null) return { reason: "longitude 不是有效经度" };
  if (lat === null) return { reason: "latitude 不是有效纬度" };
  if (lon < -180 || lon > 180) return { reason: "longitude 超出 -180 到 180 范围" };
  if (lat < -90 || lat > 90) return { reason: "latitude 超出 -90 到 90 范围" };
  return { lon, lat, time };
}

function findFirstSkippedRow(rows) {
  for (let index = 0; index < rows.length; index += 1) {
    const result = validatePointRow(rows[index]);
    if (result.reason) {
      return { rowNumber: index + 2, reason: result.reason };
    }
  }
  return null;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function decoratePoints(points) {
  for (const point of points) {
    const date = new Date(point.time * 1000);
    point.year = date.getFullYear();
    point.month = date.getMonth() + 1;
    point.day = date.getDate();
    point.monthKey = `${point.year}-${pad(point.month)}`;
    point.dayKey = `${point.monthKey}-${pad(point.day)}`;
    point.monthLabel = `${pad(point.month)}月`;
    point.dayLabel = `${pad(point.day)}日`;
    point.fullDayLabel = `${pad(point.month)}月${pad(point.day)}日`;
    point.timeLabel = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
}

function buildDateGroups(points) {
  const yearGroups = new Map();
  const monthGroups = new Map();
  const dayGroups = new Map();
  const monthsByYear = new Map();
  const daysByYear = new Map();
  const daysByMonth = new Map();

  for (const point of points) {
    ensureGroup(yearGroups, point.year, point.year, point).points.push(point);
    ensureGroup(monthGroups, point.monthKey, point.monthLabel, point).points.push(point);
    ensureGroup(dayGroups, point.dayKey, point.dayLabel, point).points.push(point);
  }

  for (const group of monthGroups.values()) {
    const year = group.points[0].year;
    if (!monthsByYear.has(year)) monthsByYear.set(year, []);
    monthsByYear.get(year).push(group);
  }

  for (const group of dayGroups.values()) {
    const first = group.points[0];
    if (!daysByYear.has(first.year)) daysByYear.set(first.year, []);
    if (!daysByMonth.has(first.monthKey)) daysByMonth.set(first.monthKey, []);
    daysByYear.get(first.year).push(group);
    daysByMonth.get(first.monthKey).push(group);
  }

  state.yearGroups = yearGroups;
  state.monthGroups = monthGroups;
  state.dayGroups = dayGroups;
  state.years = [...yearGroups.keys()].sort((a, b) => b - a);
  state.monthsByYear = sortGroupMap(monthsByYear, (a, b) => b.key.localeCompare(a.key));
  state.daysByYear = sortGroupMap(daysByYear, (a, b) => b.key.localeCompare(a.key));
  state.daysByMonth = sortGroupMap(daysByMonth, (a, b) => b.key.localeCompare(a.key));
}

function ensureGroup(map, key, label, point) {
  if (!map.has(key)) {
    map.set(key, {
      key,
      label: String(label),
      start: point.time,
      end: point.time,
      points: [],
    });
  }
  const group = map.get(key);
  group.start = Math.min(group.start, point.time);
  group.end = Math.max(group.end, point.time);
  return group;
}

function sortGroupMap(map, sorter) {
  return new Map([...map.entries()].map(([key, groups]) => [key, groups.sort(sorter)]));
}

function renderAllLists() {
  renderYearList();
  renderMonthList();
  renderDayList();
  renderPointList();
}

function renderYearList() {
  const fragment = document.createDocumentFragment();
  for (const year of state.years) {
    const group = state.yearGroups.get(year);
    const active = state.view.type !== "all" && state.selectedYear === year;
    const context = state.hoverContextYear === year;
    fragment.append(createTimeButton({
      className: `time-item${active ? " active" : ""}${context ? " context" : ""}`,
      dataset: { year },
      title: year,
      subtitle: `${formatInt(group.points.length)} 点`,
    }));
  }
  els.yearList.replaceChildren(fragment);
}

function renderMonthList() {
  const months = state.monthsByYear.get(state.selectedYear) ?? [];
  const fragment = document.createDocumentFragment();
  for (const month of months) {
    const context = state.hoverContextMonthKey === month.key;
    fragment.append(createTimeButton({
      className: `time-item${month.key === state.selectedMonthKey ? " active" : ""}${context ? " context" : ""}`,
      dataset: { month: month.key },
      title: month.label,
      subtitle: `${formatInt(month.points.length)} 点`,
    }));
  }
  els.monthList.replaceChildren(fragment);
}

function renderDayList() {
  const days = state.selectedMonthKey
    ? state.daysByMonth.get(state.selectedMonthKey) ?? []
    : state.daysByYear.get(state.selectedYear) ?? [];
  const fragment = document.createDocumentFragment();
  for (const day of days) {
    fragment.append(createTimeButton({
      className: `time-item${day.key === state.selectedDayKey ? " active" : ""}${day.key === state.hoveredDayKey ? " context" : ""}`,
      dataset: { day: day.key },
      title: day.points[0].dayLabel,
      subtitle: `${formatInt(day.points.length)} 点`,
    }));
  }
  els.dayList.replaceChildren(fragment);
}

function setTimelineHoverContext(dayKey) {
  const day = state.dayGroups.get(dayKey);
  const first = day?.points?.[0];
  if (!first) return;
  if (
    state.hoveredDayKey === dayKey &&
    state.hoverContextYear === first.year &&
    state.hoverContextMonthKey === first.monthKey
  ) {
    return;
  }
  state.hoveredDayKey = dayKey;
  state.hoverContextYear = first.year;
  state.hoverContextMonthKey = first.monthKey;
  renderTimelineContextHighlights();
}

function clearTimelineHoverContext() {
  if (!state.hoveredDayKey && !state.hoverContextYear && !state.hoverContextMonthKey) return;
  state.hoveredDayKey = null;
  state.hoverContextYear = null;
  state.hoverContextMonthKey = null;
  renderTimelineContextHighlights();
}

function renderTimelineContextHighlights() {
  els.yearList.querySelectorAll("button[data-year]").forEach((button) => {
    button.classList.toggle("context", Number(button.dataset.year) === state.hoverContextYear);
  });
  els.monthList.querySelectorAll("button[data-month]").forEach((button) => {
    button.classList.toggle("context", button.dataset.month === state.hoverContextMonthKey);
  });
  els.dayList.querySelectorAll("button[data-day]").forEach((button) => {
    button.classList.toggle("context", button.dataset.day === state.hoveredDayKey);
  });
}

function createTimeButton({ className, dataset, title, subtitle }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  Object.entries(dataset).forEach(([key, value]) => {
    button.dataset[key] = String(value);
  });
  button.innerHTML = `<strong>${title}</strong><span>${subtitle}</span>`;
  return button;
}

function renderPointList() {
  state.listPoints = state.filtered;
  els.dayPointCount.textContent = `数据点:${formatInt(state.listPoints.length)}`;
  els.dayLabel.textContent = getViewLabel();
  els.pointList.scrollTop = 0;
  renderVirtualPointList();
}

function renderVirtualPointList() {
  const points = state.listPoints;
  const list = els.pointList;
  const scrollTop = list.scrollTop;

  if (!points.length) {
    const empty = document.createElement("div");
    empty.className = "record-item";
    empty.textContent = "当前时间范围没有数据点";
    list.replaceChildren(empty);
    return;
  }

  const viewportHeight = list.clientHeight || 240;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - ROW_OVERSCAN);
  const end = Math.min(points.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + ROW_OVERSCAN);
  const spacer = document.createElement("div");
  spacer.className = "virtual-spacer";
  spacer.style.height = `${points.length * ROW_HEIGHT}px`;

  const windowEl = document.createElement("div");
  windowEl.className = "virtual-window";
  windowEl.style.transform = `translateY(${start * ROW_HEIGHT}px)`;

  for (let index = start; index < end; index += 1) {
    windowEl.append(createPointButton(points[index], index));
  }

  list.replaceChildren(spacer, windowEl);
  list.scrollTop = scrollTop;
}

function createPointButton(point, visibleIndex) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `record-item${state.selectedPoint?.index === point.index ? " active" : ""}`;
  button.dataset.index = String(point.index);
  button.innerHTML = `
    <span class="record-main">${visibleIndex + 1} ${point.timeLabel} (${point.lat.toFixed(4)},${point.lon.toFixed(4)})</span>
    <span class="record-meta">速度:${formatMaybe(point.speed, 1)} 海拔:${formatMaybe(point.altitude, 2)}</span>
  `;
  return button;
}

function selectYear(year) {
  const group = state.yearGroups.get(year);
  if (!group) return;
  state.selectedYear = year;
  state.selectedMonthKey = null;
  state.selectedDayKey = null;
  state.view = { type: "year", key: year };
  state.exactRange = { start: group.start, end: group.end };
  setTimeRange(group.start, group.end);
  renderAllLists();
  applyFilters({ fit: els.autoFitToggle.checked, allData: false });
}

function selectMonth(monthKey) {
  const group = state.monthGroups.get(monthKey);
  if (!group) return;
  const first = group.points[0];
  state.selectedYear = first.year;
  state.selectedMonthKey = monthKey;
  state.selectedDayKey = null;
  state.view = { type: "month", key: monthKey };
  state.exactRange = { start: group.start, end: group.end };
  setTimeRange(group.start, group.end);
  renderAllLists();
  applyFilters({ fit: els.autoFitToggle.checked, allData: false });
}

function selectDay(dayKey) {
  const group = state.dayGroups.get(dayKey);
  if (!group) return;
  const first = group.points[0];
  state.selectedYear = first.year;
  state.selectedMonthKey = first.monthKey;
  state.selectedDayKey = dayKey;
  state.view = { type: "day", key: dayKey };
  state.exactRange = { start: group.start, end: group.end };
  setTimeRange(group.start, group.end);
  renderAllLists();
  applyFilters({ fit: els.autoFitToggle.checked, allData: false });
}

function showAllData() {
  state.view = { type: "all", key: null };
  state.exactRange = null;
  state.selectedMonthKey = null;
  state.selectedDayKey = null;
  state.selectedYear = state.years[0] ?? null;
  setTimeRange(state.timeMin, state.timeMax);
  applyFilters({ fit: true, allData: true });
  renderAllLists();
  setTimelineOpen(false);
}

function setTimeRange(start, end) {
  els.timeStart.value = String(Math.round(timeToPercent(start)));
  els.timeEnd.value = String(Math.round(timeToPercent(end)));
}

function applyFilters({ fit, allData = false }) {
  const startT = state.exactRange?.start ?? percentToTime(Number(els.timeStart.value));
  const endT = state.exactRange?.end ?? percentToTime(Number(els.timeEnd.value));
  const minT = Math.min(startT, endT);
  const maxT = Math.max(startT, endT);
  state.filtered = state.points.filter((point) => point.time >= minT && point.time <= maxT);

  els.visibleStart.textContent = formatDateTime(minT);
  els.visibleEnd.textContent = formatDateTime(maxT);
  els.visibleCount.textContent = formatInt(state.filtered.length);

  if (!state.mapReady && fit) state.pendingFitAfterStyle = true;
  refreshMapData();
  if (fit) fitPoints(state.filtered.length ? state.filtered : state.points, { allData, scope: state.view.type });
  renderPointList();
}

function refreshMapData() {
  if (!state.mapReady) return;
  state.map.getSource("footprints")?.setData(pointsToGeoJson(state.filtered));
  state.map.getSource("footprint-path")?.setData(pointsToPathGeoJson(state.filtered));
  state.map
    .getSource("footprint-gap-path")
    ?.setData(els.gapPathToggle.checked ? pointsToGapPathGeoJson(state.filtered) : emptyPath);
  refreshSelectedPoint();
}

function refreshSelectedPoint() {
  if (!state.mapReady) return;
  state.map.getSource("selected-point")?.setData(state.selectedPoint ? pointsToGeoJson([state.selectedPoint]) : emptyPoints);
}

function pointsToGeoJson(points) {
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      properties: {
        index: point.index,
        time: point.time,
        dayKey: point.dayKey,
      },
      geometry: {
        type: "Point",
        coordinates: getDisplayCoordinate(point),
      },
    })),
  };
}

function pointsToPathGeoJson(points) {
  const segments = [];
  let segment = [];
  let previous = null;

  for (const point of points) {
    const connected = previous && !isPathGap(previous, point);

    if (!connected && segment.length > 1) segments.push(segment);
    if (!connected) segment = [];
    segment.push(getDisplayCoordinate(point));
    previous = point;
  }

  if (segment.length > 1) segments.push(segment);

  return pathSegmentsToGeoJson(segments);
}

function pointsToGapPathGeoJson(points) {
  const segments = [];
  let previous = null;

  for (const point of points) {
    if (previous && isPathGap(previous, point)) {
      segments.push([getDisplayCoordinate(previous), getDisplayCoordinate(point)]);
    }
    previous = point;
  }

  return pathSegmentsToGeoJson(segments);
}

function pathSegmentsToGeoJson(segments) {
  return {
    type: "FeatureCollection",
    features: segments.map((coordinates) => ({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates,
      },
    })),
  };
}

function isPathGap(previous, point) {
  return point.time - previous.time > MAX_PATH_GAP_SECONDS || haversineKm(previous, point) > MAX_PATH_GAP_KM;
}

function updateStats() {
  els.pointCount.textContent = formatInt(state.points.length);
  els.dateRange.textContent = `${formatShortDate(state.timeMin)} - ${formatShortDate(state.timeMax)}`;
  els.distanceTotal.textContent = `${formatNumber(computeTotalDistanceKm(state.points), 0)} km`;
}

function fitPoints(points, { allData = false, scope = state.view.type } = {}) {
  if (!state.mapReady || !points.length) return;
  if (points.length === 1) {
    state.map.flyTo({ center: getDisplayCoordinate(points[0]), zoom: 14, duration: 700 });
    return;
  }

  const bounds = new maplibregl.LngLatBounds();
  for (const point of points) bounds.extend(getDisplayCoordinate(point));

  state.map.fitBounds(bounds, {
    padding: getFitPadding(scope),
    maxZoom: getFitMaxZoom(points, { allData, scope }),
    duration: 800,
  });
}

function getFitPadding(scope) {
  if (window.innerWidth <= 980) {
    return { top: 190, bottom: 36, left: 32, right: 32 };
  }

  const controlRect = document.querySelector(".control-panel")?.getBoundingClientRect();
  const timelineRect = els.timelinePanel.classList.contains("collapsed") ? null : els.timelinePanel.getBoundingClientRect();
  const baseLeft = controlRect ? controlRect.right + 22 : 380;
  let left = baseLeft;

  if (timelineRect && (scope === "day" || scope === "range")) {
    left = Math.max(baseLeft, Math.min(timelineRect.right + 22, window.innerWidth * 0.36));
  }

  return {
    top: 110,
    bottom: 44,
    left,
    right: 56,
  };
}

function getFitMaxZoom(points, { allData, scope }) {
  if (allData || scope === "all" || scope === "year") return 3.4;
  if (scope === "month") return points.length > 12000 ? 8.6 : 10.2;
  if (scope === "day") return 13.2;
  return points.length > 2000 ? 8.8 : 12;
}

function selectPoint(point, { fly, syncDateLists }) {
  state.selectedPoint = point;
  if (syncDateLists) {
    state.selectedYear = point.year;
    state.selectedMonthKey = point.monthKey;
    state.selectedDayKey = point.dayKey;
  }
  renderYearList();
  renderMonthList();
  renderDayList();
  renderVirtualPointList();
  refreshSelectedPoint();

  if (fly) {
    state.map.flyTo({
      center: getDisplayCoordinate(point),
      zoom: Math.max(14.5, state.map.getZoom()),
      duration: 800,
      essential: true,
    });
  }
  scrollSelectedRecordIntoView();
}

function scrollSelectedRecordIntoView() {
  if (!state.selectedPoint || els.timelinePanel.classList.contains("collapsed")) return;
  const index = state.listPoints.findIndex((point) => point.index === state.selectedPoint.index);
  if (index < 0) return;
  els.pointList.scrollTop = Math.max(0, index * ROW_HEIGHT - (els.pointList.clientHeight || 240) / 2);
  renderVirtualPointList();
}

function toggleTimeline() {
  setTimelineOpen(els.timelinePanel.classList.contains("collapsed"));
}

function setTimelineOpen(isOpen) {
  els.timelinePanel.classList.toggle("collapsed", !isOpen);
  els.timelineToggle.textContent = isOpen ? "收起时间列表" : "时间列表";
  if (isOpen) renderVirtualPointList();
}

function setSettingsOpen(isOpen) {
  els.settingsMenu.classList.toggle("collapsed", !isOpen);
  els.settingsToggle.setAttribute("aria-expanded", String(isOpen));
}

function setMapMode(mode) {
  if (!["globe", "flat"].includes(mode) || state.settings.mapMode === mode) return;
  state.settings.mapMode = mode;
  saveSettings();
  renderSettingsControls();
  applyMapStyle({ fit: true });
}

function requestMapSource(mode, source) {
  if (!["globe", "flat"].includes(mode) || !["osm", "amap"].includes(source)) return;
  if (source === "amap" && !hasAmapCredentials()) {
    openAmapModal(() => setMapSource(mode, "amap"));
    return;
  }
  setMapSource(mode, source);
}

function setMapSource(mode, source) {
  state.settings.sources[mode] = source;
  saveSettings();
  applyAmapSecurityConfig();
  renderSettingsControls();
  if (state.settings.mapMode === mode) applyMapStyle({ fit: true });
}

function applyMapStyle({ fit }) {
  if (!state.map) return;
  state.mapReady = false;
  state.pendingFitAfterStyle = Boolean(fit);
  try {
    state.map.setStyle(createMapStyle(), { diff: false });
    window.setTimeout(() => {
      if (!state.mapReady && state.map.isStyleLoaded()) finishMapStyleLoad();
    }, 250);
    window.setTimeout(() => {
      if (!state.mapReady && state.map.isStyleLoaded()) finishMapStyleLoad();
    }, 900);
  } catch (error) {
    console.error(error);
    state.mapReady = true;
    state.pendingFitAfterStyle = false;
    setStatus("地图图源切换失败", true);
    refreshMapData();
  }
}

function applyPaintScales() {
  if (!state.mapReady) return;
  if (state.map.getLayer("footprint-points")) {
    state.map.setPaintProperty("footprint-points", "circle-radius", pointRadiusExpression());
    state.map.setPaintProperty("footprint-points", "circle-stroke-width", pointStrokeWidthExpression());
  }
  if (state.map.getLayer("footprint-path")) {
    state.map.setPaintProperty("footprint-path", "line-width", pathWidthExpression());
  }
  if (state.map.getLayer("footprint-path-shadow")) {
    state.map.setPaintProperty("footprint-path-shadow", "line-width", pathShadowWidthExpression());
  }
  if (state.map.getLayer("footprint-gap-path")) {
    state.map.setPaintProperty("footprint-gap-path", "line-width", gapPathWidthExpression());
  }
}

function renderSettingsControls() {
  els.gapPathToggle.checked = Boolean(state.settings.connectDistantPath);
  els.pointSizeRange.value = String(state.settings.pointScale);
  els.pathWidthRange.value = String(state.settings.pathScale);
  syncSettingsConditionalControls();
  els.mapModeButtons.querySelectorAll("button[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.settings.mapMode);
  });
  els.globeSourceSection.hidden = state.settings.mapMode !== "globe";
  els.flatSourceSection.hidden = state.settings.mapMode !== "flat";
  renderSourceButtons(els.globeSourceButtons, "globe");
  renderSourceButtons(els.flatSourceButtons, "flat");
}

function syncSettingsConditionalControls() {
  els.pointOptions.classList.toggle("collapsed", !els.pointsToggle.checked);
  els.pathOptions.classList.toggle("collapsed", !els.pathToggle.checked);
}

function renderSourceButtons(container, mode) {
  container.querySelectorAll("button[data-source]").forEach((button) => {
    button.classList.toggle("active", button.dataset.source === state.settings.sources[mode]);
  });
}

function openAmapModal(onSave = null) {
  const credentials = getAmapCredentials();
  state.pendingAmapAction = onSave;
  els.amapKeyInput.value = credentials.key;
  els.amapSecretInput.value = credentials.securityCode;
  els.amapModal.classList.remove("collapsed");
  els.amapModal.setAttribute("aria-hidden", "false");
  els.amapModal.querySelector(".modal-card")?.classList.remove("with-help");
  setTimeout(() => els.amapKeyInput.focus(), 0);
}

function closeAmapModal() {
  if (els.amapModal.classList.contains("collapsed")) return;
  els.amapModal.classList.add("collapsed");
  els.amapModal.setAttribute("aria-hidden", "true");
  state.pendingAmapAction = null;
}

function toggleAmapHelp() {
  els.amapModal.querySelector(".modal-card")?.classList.toggle("with-help");
}

function saveAmapCredentialsFromModal() {
  const key = els.amapKeyInput.value.trim();
  const securityCode = els.amapSecretInput.value.trim();
  if (!key || !securityCode) {
    setStatus("请填写高德 Key 和安全密钥", true);
    return;
  }
  localStorage.setItem(AMAP_CREDENTIALS_KEY, JSON.stringify({ key, securityCode }));
  applyAmapSecurityConfig();
  setStatus("已保存高德 Key");
  const pending = state.pendingAmapAction;
  closeAmapModal();
  if (pending) pending();
}

function getAmapCredentials() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AMAP_CREDENTIALS_KEY) ?? "{}");
    return {
      key: typeof parsed.key === "string" ? parsed.key : "",
      securityCode: typeof parsed.securityCode === "string" ? parsed.securityCode : "",
    };
  } catch {
    return { key: "", securityCode: "" };
  }
}

function hasAmapCredentials() {
  const credentials = getAmapCredentials();
  return Boolean(credentials.key && credentials.securityCode);
}

function applyAmapSecurityConfig() {
  const { securityCode } = getAmapCredentials();
  if (securityCode) {
    window._AMapSecurityConfig = { securityJsCode: securityCode };
  }
}

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return normalizeSettings(parsed);
  } catch {
    return getDefaultSettings();
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function normalizeSettings(value) {
  const mapMode = ["globe", "flat"].includes(value?.mapMode) ? value.mapMode : DEFAULT_SETTINGS.mapMode;
  const globe = ["osm", "amap"].includes(value?.sources?.globe) ? value.sources.globe : "osm";
  const flat = ["osm", "amap"].includes(value?.sources?.flat) ? value.sources.flat : "osm";
  const connectDistantPath =
    typeof value?.connectDistantPath === "boolean" ? value.connectDistantPath : DEFAULT_SETTINGS.connectDistantPath;
  const pointScale = normalizeScale(value?.pointScale, DEFAULT_SETTINGS.pointScale);
  const pathScale = normalizeScale(value?.pathScale, DEFAULT_SETTINGS.pathScale);
  return { mapMode, sources: { globe, flat }, connectDistantPath, pointScale, pathScale };
}

function getDefaultSettings() {
  return {
    mapMode: DEFAULT_SETTINGS.mapMode,
    sources: { ...DEFAULT_SETTINGS.sources },
    connectDistantPath: DEFAULT_SETTINGS.connectDistantPath,
    pointScale: DEFAULT_SETTINGS.pointScale,
    pathScale: DEFAULT_SETTINGS.pathScale,
  };
}

function normalizeScale(value, fallback = DEFAULT_SCALE) {
  const scale = Number.parseFloat(value);
  return Number.isFinite(scale) ? clamp(scale, 0.25, 4) : fallback;
}

function setLayerVisibility(layerId, visible) {
  if (!state.mapReady || !state.map.getLayer(layerId)) return;
  state.map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

function syncLayerVisibility() {
  setLayerVisibility("footprint-points", els.pointsToggle.checked);
  setLayerVisibility("footprint-path", els.pathToggle.checked);
  setLayerVisibility("footprint-path-shadow", els.pathToggle.checked);
  setLayerVisibility("footprint-gap-path", els.pathToggle.checked && els.gapPathToggle.checked);
}

function getViewLabel() {
  if (state.view.type === "year") return `${state.view.key}年`;
  if (state.view.type === "month") return `${state.view.key.replace("-", "年")}月`;
  if (state.view.type === "day") {
    const day = state.dayGroups.get(state.view.key);
    if (!day) return state.view.key;
    const first = day.points[0];
    return `${first.year}年${first.fullDayLabel}`;
  }
  if (state.view.type === "range") return "时间范围";
  return "全部数据";
}

function computeTotalDistanceKm(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (Number.isFinite(point.distance) && point.distance >= 0 && point.distance < 200000) {
      total += point.distance / 1000;
      continue;
    }
    const km = haversineKm(points[index - 1], point);
    if (km < 200) total += km;
  }
  return total;
}

function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function getDisplayCoordinate(point) {
  if (getActiveSource() !== "amap") return [point.lon, point.lat];
  return wgs84ToGcj02(point.lon, point.lat);
}

function wgs84ToGcj02(lon, lat) {
  if (isOutsideChina(lon, lat)) return [lon, lat];
  let dLat = transformLat(lon - 105, lat - 35);
  let dLon = transformLon(lon - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - 0.006693421622965943 * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((6335552.717000426 * 1) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180) / ((6378245 / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lon + dLon, lat + dLat];
}

function isOutsideChina(lon, lat) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let result = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  result += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  result += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  result += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return result;
}

function transformLon(x, y) {
  let result = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  result += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  result += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  result += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return result;
}

function percentToTime(percent) {
  return state.timeMin + ((state.timeMax - state.timeMin) * percent) / 1000;
}

function timeToPercent(time) {
  if (state.timeMax === state.timeMin) return 1000;
  return clamp(((time - state.timeMin) / (state.timeMax - state.timeMin)) * 1000, 0, 1000);
}

function numberFrom(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeTimestamp(value) {
  const raw = numberFrom(value);
  if (raw === null) return null;
  return raw > 1e12 ? Math.round(raw / 1000) : Math.round(raw);
}

function setStatus(text, isError = false, details = "") {
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
  if (details) els.status.title = details;
  else els.status.removeAttribute("title");
}

function formatShortDate(epochSeconds) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(epochSeconds * 1000));
}

function formatDateTime(epochSeconds) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(epochSeconds * 1000));
}

function formatInt(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
}

function formatMaybe(value, digits = 1) {
  return Number.isFinite(value) ? formatNumber(value, digits) : "--";
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

init();
