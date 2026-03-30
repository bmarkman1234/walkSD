const sanDiegoCenter = [-117.1611, 32.7157];

const metricSelect = document.getElementById("metric-select");
const roadsSlider = document.getElementById("roads-slider");
const modeHexBtn = document.getElementById("mode-hex");
const modeNeighborhoodBtn = document.getElementById("mode-neighborhood");
const hexStatsEl = document.getElementById("hex-stats");
const neighborhoodStatsEl = document.getElementById("neighborhood-stats");
const hexCardEl = document.getElementById("hex-card");
const neighborhoodCardEl = document.getElementById("neighborhood-card");

const state = {
  mode: "hex",
  hexFeatures: [],
  neighborhoodFeatures: [],
};

const colorExpressions = {
  score: [
    "match",
    ["to-number", ["get", "score"], 0],
    0, "#f0f0f0",
    1, "#56B4E9",
    2, "#009E73",
    3, "#E69F00",
    "#f0f0f0",
  ],
  grocery_count: [
    "step",
    ["to-number", ["get", "grocery_count"], 0],
    "#f0f0f0",
    1, "#90CAF9",
    3, "#42A5F5",
    6, "#1E88E5",
    10, "#0D47A1",
  ],
  park_count: [
    "step",
    ["to-number", ["get", "park_count"], 0],
    "#f0f0f0",
    1, "#B2DF8A",
    3, "#66BB6A",
    6, "#2E7D32",
    10, "#1B5E20",
  ],
  library_count: [
    "step",
    ["to-number", ["get", "library_count"], 0],
    "#f0f0f0",
    1, "#D1C4E9",
    2, "#9575CD",
    3, "#5E35B1",
    5, "#311B92",
  ],
};

function setMode(mode) {
  state.mode = mode;
  modeHexBtn.classList.toggle("is-active", mode === "hex");
  modeNeighborhoodBtn.classList.toggle("is-active", mode === "neighborhood");
  hexCardEl.classList.toggle("is-hidden", mode !== "hex");
  neighborhoodCardEl.classList.toggle("is-hidden", mode !== "neighborhood");
}

function setStats(el, rows) {
  el.innerHTML = rows
    .map(([key, value]) => `<div class="stat-key">${key}</div><div class="stat-value">${value}</div>`)
    .join("");
}

function formatNumber(value, decimals = 0) {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function centroidOfPolygonRing(ring) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  const safeArea = area / 2 || 1e-9;
  return [cx / (6 * safeArea), cy / (6 * safeArea)];
}

function featureCentroid(feature) {
  const geom = feature.geometry;
  if (!geom) return null;
  if (geom.type === "Point") return geom.coordinates;
  if (geom.type === "Polygon") return centroidOfPolygonRing(geom.coordinates[0]);
  if (geom.type === "MultiPolygon") return centroidOfPolygonRing(geom.coordinates[0][0]);
  return null;
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygonCoords(point, polygonCoords) {
  const inOuter = pointInRing(point, polygonCoords[0]);
  if (!inOuter) return false;
  for (let i = 1; i < polygonCoords.length; i += 1) {
    if (pointInRing(point, polygonCoords[i])) return false;
  }
  return true;
}

function pointInFeature(point, feature) {
  if (!point) return false;
  const geom = feature.geometry;
  if (!geom) return false;
  if (geom.type === "Polygon") return pointInPolygonCoords(point, geom.coordinates);
  if (geom.type === "MultiPolygon") {
    return geom.coordinates.some((poly) => pointInPolygonCoords(point, poly));
  }
  return false;
}

function findNeighborhoodNameForPoint(point) {
  const hit = state.neighborhoodFeatures.find((feature) => pointInFeature(point, feature));
  return hit?.properties?.cpname || "N/A";
}

function updateHexColor(metric) {
  const expression = colorExpressions[metric] || colorExpressions.score;
  if (map.getLayer("hex-fill")) {
    map.setPaintProperty("hex-fill", "fill-color", expression);
  }
}

function updateHexOpacity(opacity) {
  if (map.getLayer("hex-fill")) {
    map.setPaintProperty("hex-fill", "fill-opacity", opacity);
  }
}

function showHexDashboard(feature) {
  const p = feature.properties || {};
  const center = featureCentroid(feature);
  const neighborhood = findNeighborhoodNameForPoint(center);
  setStats(hexStatsEl, [
    ["Hex ID", p.hex_id ?? "N/A"],
    ["Neighborhood", neighborhood],
    ["Combined Score", p.score ?? 0],
    ["Groceries", p.grocery_count ?? 0],
    ["Parks", p.park_count ?? 0],
    ["Libraries", p.library_count ?? 0],
  ]);
}

function showNeighborhoodDashboard(feature) {
  const neighborhoodName = feature.properties?.cpname || "Selected neighborhood";
  const hexesInNeighborhood = state.hexFeatures.filter((hex) =>
    pointInFeature(hex._centroid, feature)
  );

  const hexCount = hexesInNeighborhood.length;
  const groceryTotal = hexesInNeighborhood.reduce(
    (sum, hex) => sum + Number(hex.properties?.grocery_count || 0),
    0
  );
  const parkTotal = hexesInNeighborhood.reduce(
    (sum, hex) => sum + Number(hex.properties?.park_count || 0),
    0
  );
  const libraryTotal = hexesInNeighborhood.reduce(
    (sum, hex) => sum + Number(hex.properties?.library_count || 0),
    0
  );
  const avgScore =
    hexCount === 0
      ? 0
      : hexesInNeighborhood.reduce((sum, hex) => sum + Number(hex.properties?.score || 0), 0) / hexCount;

  setStats(neighborhoodStatsEl, [
    ["Neighborhood", neighborhoodName],
    ["Hexes", formatNumber(hexCount)],
    ["Avg Combined Score", formatNumber(avgScore, 2)],
    ["Groceries (sum)", formatNumber(groceryTotal)],
    ["Parks (sum)", formatNumber(parkTotal)],
    ["Libraries (sum)", formatNumber(libraryTotal)],
  ]);
}

const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  center: sanDiegoCenter,
  zoom: 11,
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

setStats(hexStatsEl, [["Status", "Click a hex"]]);
setStats(neighborhoodStatsEl, [["Status", "Switch to Neighborhood mode and click a plan"]]);
setMode("hex");

map.on("load", async () => {
  const [hexData, neighborhoodData] = await Promise.all([
    fetch("./public/data/hex_scores.geojson").then((r) => r.json()),
    fetch("./public/data/community_plans.geojson").then((r) => r.json()),
  ]);

  state.hexFeatures = (hexData.features || []).map((f) => ({ ...f, _centroid: featureCentroid(f) }));
  state.neighborhoodFeatures = neighborhoodData.features || [];

  map.addSource("hex-scores", { type: "geojson", data: hexData });
  map.addSource("community-plans", { type: "geojson", data: neighborhoodData });

  map.addLayer({
    id: "community-plan-fill",
    type: "fill",
    source: "community-plans",
    paint: {
      "fill-color": "#ffd27f",
      "fill-opacity": 0.08,
    },
  });

  map.addLayer({
    id: "hex-fill",
    type: "fill",
    source: "hex-scores",
    paint: {
      "fill-color": colorExpressions.score,
      "fill-opacity": Number(roadsSlider.value),
    },
  });

  map.addLayer({
    id: "hex-outline",
    type: "line",
    source: "hex-scores",
    paint: {
      "line-color": "#27424c",
      "line-width": 0.45,
      "line-opacity": 0.45,
    },
  });

  map.addLayer({
    id: "community-plan-outline",
    type: "line",
    source: "community-plans",
    paint: {
      "line-color": "#a75400",
      "line-width": 2.2,
      "line-opacity": 0.95,
      "line-dasharray": [2, 1],
    },
  });

  updateHexColor(metricSelect.value);
});

map.on("click", "hex-fill", (event) => {
  if (state.mode !== "hex") return;

  const feature = event.features && event.features[0];
  if (!feature) return;

  const props = feature.properties || {};
  const html = `
    <strong>Hex ID:</strong> ${props.hex_id ?? "N/A"}<br>
    <strong>Combined Score:</strong> ${props.score ?? 0}<br>
    <strong>Grocery Count:</strong> ${props.grocery_count ?? 0}<br>
    <strong>Park Count:</strong> ${props.park_count ?? 0}<br>
    <strong>Library Count:</strong> ${props.library_count ?? 0}
  `;

  showHexDashboard(feature);

  new maplibregl.Popup()
    .setLngLat(event.lngLat)
    .setHTML(html)
    .addTo(map);
});

map.on("click", "community-plan-fill", (event) => {
  if (state.mode !== "neighborhood") return;
  const feature = event.features && event.features[0];
  if (!feature) return;
  showNeighborhoodDashboard(feature);
});

map.on("mouseenter", "hex-fill", () => {
  map.getCanvas().style.cursor = state.mode === "hex" ? "pointer" : "";
});

map.on("mouseleave", "hex-fill", () => {
  map.getCanvas().style.cursor = "";
});

map.on("mouseenter", "community-plan-fill", () => {
  map.getCanvas().style.cursor = state.mode === "neighborhood" ? "pointer" : "";
});

map.on("mouseleave", "community-plan-fill", () => {
  map.getCanvas().style.cursor = "";
});

metricSelect.addEventListener("change", (event) => updateHexColor(event.target.value));
roadsSlider.addEventListener("input", (event) => updateHexOpacity(Number(event.target.value)));
modeHexBtn.addEventListener("click", () => setMode("hex"));
modeNeighborhoodBtn.addEventListener("click", () => setMode("neighborhood"));
