const sanDiegoCenter = [-117.1611, 32.7157];

const metricSelect = document.getElementById("metric-select");
const emphasisSlider = document.getElementById("emphasis-slider");
const modeHexBtn = document.getElementById("mode-hex");
const modeCommunityBtn = document.getElementById("mode-community");
const hexStatsEl = document.getElementById("hex-stats");
const communityStatsEl = document.getElementById("community-stats");
const hexCardEl = document.getElementById("hex-card");
const communityCardEl = document.getElementById("community-card");

const state = {
  mode: "hex",
  hexFeatures: [],
  communityFeatures: [],
  groceryPoints: [],
  parkPoints: [],
  libraryPoints: [],
  communityFlashIntervalId: null,
  communityFlashTimeoutId: null,
  hexFlashIntervalId: null,
  hexFlashTimeoutId: null,
};

const communityPalette = [
  "#E69F00",
  "#56B4E9",
  "#009E73",
  "#CC79A7",
  "#0072B2",
  "#D55E00",
  "#F0E442",
  "#8C510A",
  "#5AB4AC",
  "#7B3294",
];

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
  modeCommunityBtn.classList.toggle("is-active", mode === "community");
  hexCardEl.classList.toggle("is-hidden", mode !== "hex");
  communityCardEl.classList.toggle("is-hidden", mode !== "community");

  if (mode === "hex" && map.getLayer("community-plan-selected")) {
    if (state.communityFlashIntervalId) {
      clearInterval(state.communityFlashIntervalId);
      state.communityFlashIntervalId = null;
    }
    if (state.communityFlashTimeoutId) {
      clearTimeout(state.communityFlashTimeoutId);
      state.communityFlashTimeoutId = null;
    }
    map.setFilter("community-plan-selected", ["==", ["get", "cpcode"], -99999]);
  }

  if (mode === "community" && map.getLayer("hex-selected")) {
    if (state.hexFlashIntervalId) {
      clearInterval(state.hexFlashIntervalId);
      state.hexFlashIntervalId = null;
    }
    if (state.hexFlashTimeoutId) {
      clearTimeout(state.hexFlashTimeoutId);
      state.hexFlashTimeoutId = null;
    }
    map.setFilter("hex-selected", ["==", ["get", "hex_id"], -99999]);
  }
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

function getFeatureBounds(feature) {
  const geom = feature.geometry;
  if (!geom) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function visitCoords(coords) {
    if (typeof coords[0] === "number") {
      const [x, y] = coords;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      return;
    }
    coords.forEach(visitCoords);
  }

  visitCoords(geom.coordinates);
  if (!Number.isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}

function getBoundsForFeatureCollection(features) {
  if (!features || features.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const feature of features) {
    const bounds = getFeatureBounds(feature);
    if (!bounds) continue;
    minX = Math.min(minX, bounds[0][0]);
    minY = Math.min(minY, bounds[0][1]);
    maxX = Math.max(maxX, bounds[1][0]);
    maxY = Math.max(maxY, bounds[1][1]);
  }

  if (!Number.isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}

function findCommunityNameForPoint(point) {
  const hit = state.communityFeatures.find((feature) => pointInFeature(point, feature));
  return hit?.properties?.cpname || "N/A";
}

function findCommunityFeatureForPoint(point) {
  return state.communityFeatures.find((feature) => pointInFeature(point, feature)) || null;
}

function updateHexColor(metric) {
  const expression = colorExpressions[metric] || colorExpressions.score;
  if (map.getLayer("hex-fill")) {
    map.setPaintProperty("hex-fill", "fill-color", expression);
  }
}

function updateLayerEmphasis(value) {
  const t = Math.max(0, Math.min(100, Number(value))) / 100;

  // Right side (t=1): hexes are strongest.
  // Left side  (t=0): community boundaries are strongest.
  const hexOpacity = 0.2 + (0.95 - 0.2) * t;
  const communityFillOpacity = 0.32 + (0.08 - 0.32) * t;
  const communityOutlineWidth = 1.6 + (0.85 - 1.6) * t;
  const communityOutlineOpacity = 1.0 + (0.75 - 1.0) * t;

  if (map.getLayer("hex-fill")) {
    map.setPaintProperty("hex-fill", "fill-opacity", hexOpacity);
  }
  if (map.getLayer("community-plan-fill")) {
    map.setPaintProperty("community-plan-fill", "fill-opacity", communityFillOpacity);
  }
  if (map.getLayer("community-plan-outline")) {
    map.setPaintProperty("community-plan-outline", "line-width", communityOutlineWidth);
    map.setPaintProperty("community-plan-outline", "line-opacity", communityOutlineOpacity);
  }
}

function flashSelectedCommunity(cpcode) {
  if (!map.getLayer("community-plan-selected")) return;

  if (state.communityFlashIntervalId) {
    clearInterval(state.communityFlashIntervalId);
    state.communityFlashIntervalId = null;
  }
  if (state.communityFlashTimeoutId) {
    clearTimeout(state.communityFlashTimeoutId);
    state.communityFlashTimeoutId = null;
  }

  map.setFilter("community-plan-selected", ["==", ["get", "cpcode"], cpcode]);
  map.setPaintProperty("community-plan-selected", "line-opacity", 1);

  let visible = true;
  state.communityFlashIntervalId = setInterval(() => {
    visible = !visible;
    map.setPaintProperty("community-plan-selected", "line-opacity", visible ? 1 : 0.2);
  }, 160);

  state.communityFlashTimeoutId = setTimeout(() => {
    if (state.communityFlashIntervalId) {
      clearInterval(state.communityFlashIntervalId);
      state.communityFlashIntervalId = null;
    }
    map.setPaintProperty("community-plan-selected", "line-opacity", 1);
    state.communityFlashTimeoutId = null;
  }, 1250);
}

function flashSelectedHex(hexId) {
  if (!map.getLayer("hex-selected")) return;

  if (state.hexFlashIntervalId) {
    clearInterval(state.hexFlashIntervalId);
    state.hexFlashIntervalId = null;
  }
  if (state.hexFlashTimeoutId) {
    clearTimeout(state.hexFlashTimeoutId);
    state.hexFlashTimeoutId = null;
  }

  map.setFilter("hex-selected", ["==", ["get", "hex_id"], hexId]);
  map.setPaintProperty("hex-selected", "line-opacity", 1);

  let visible = true;
  state.hexFlashIntervalId = setInterval(() => {
    visible = !visible;
    map.setPaintProperty("hex-selected", "line-opacity", visible ? 1 : 0.2);
  }, 160);

  state.hexFlashTimeoutId = setTimeout(() => {
    if (state.hexFlashIntervalId) {
      clearInterval(state.hexFlashIntervalId);
      state.hexFlashIntervalId = null;
    }
    map.setPaintProperty("hex-selected", "line-opacity", 1);
    state.hexFlashTimeoutId = null;
  }, 1250);
}

function showHexDashboard(feature) {
  const p = feature.properties || {};
  const center = featureCentroid(feature);
  const community = findCommunityNameForPoint(center);
  setStats(hexStatsEl, [
    ["Hex ID", p.hex_id ?? "N/A"],
    ["Community Plan", community],
    ["Combined Score", p.score ?? 0],
    ["Grocery/Convenience", p.grocery_count ?? 0],
    ["Parks", p.park_count ?? 0],
    ["Libraries", p.library_count ?? 0],
  ]);
}

function showCommunityDashboard(feature) {
  const communityName = feature.properties?.cpname || "Selected community";
  const hexesInCommunity = state.hexFeatures.filter((hex) =>
    pointInFeature(hex._centroid, feature)
  );
  const scoreTotal = hexesInCommunity.reduce(
    (sum, hex) => sum + Number(hex.properties?.score || 0),
    0
  );
  const groceryTotal = state.groceryPoints.reduce(
    (sum, point) => sum + (pointInFeature(point, feature) ? 1 : 0),
    0
  );
  const parkTotal = state.parkPoints.reduce(
    (sum, point) => sum + (pointInFeature(point, feature) ? 1 : 0),
    0
  );
  const libraryTotal = state.libraryPoints.reduce(
    (sum, point) => sum + (pointInFeature(point, feature) ? 1 : 0),
    0
  );

  const hexCount = hexesInCommunity.length;
  const averageScore = hexCount > 0 ? scoreTotal / hexCount : 0;
  setStats(communityStatsEl, [
    ["Community", communityName],
    ["Hexes", formatNumber(hexCount)],
    ["Average Score", formatNumber(averageScore, 2)],
    ["Total Grocery/Convenience", formatNumber(groceryTotal)],
    ["Total Parks", formatNumber(parkTotal)],
    ["Total Libraries", formatNumber(libraryTotal)],
  ]);
}

const map = new maplibregl.Map({
  container: "map",
  attributionControl: false,
  style: {
    version: 8,
    sources: {
      "osm-raster": {
        type: "raster",
        tiles: [
          "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [
      {
        id: "osm-raster",
        type: "raster",
        source: "osm-raster",
        minzoom: 0,
        maxzoom: 19,
        paint: {
          // Make the basemap cleaner so road structure stands out more.
          "raster-saturation": -0.85,
          "raster-contrast": 0.2,
          "raster-brightness-min": 0.15,
          "raster-brightness-max": 0.95,
        },
      },
    ],
  },
  center: sanDiegoCenter,
  zoom: 11,
});

map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(
  new maplibregl.AttributionControl({
    compact: true,
    customAttribution:
      '<a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a>',
  })
);

setStats(hexStatsEl, [["Status", "Click a hex"]]);
setStats(communityStatsEl, [["Status", "Switch to Community mode and click a plan"]]);
setMode("hex");

map.on("load", async () => {
  const [hexData, communityData, cityBoundaryData, groceriesData, parksData, librariesData] = await Promise.all([
    fetch("./data/hex_scores.geojson").then((r) => r.json()),
    fetch("./data/community_plans.geojson").then((r) => r.json()),
    fetch("./data/san_diego_boundary.geojson").then((r) => r.json()),
    fetch("./data/groceries.geojson").then((r) => r.json()),
    fetch("./data/parks.geojson").then((r) => r.json()),
    fetch("./data/libraries.geojson").then((r) => r.json()),
  ]);

  state.hexFeatures = (hexData.features || []).map((f) => ({ ...f, _centroid: featureCentroid(f) }));
  state.groceryPoints = (groceriesData.features || [])
    .map((feature) => featureCentroid(feature))
    .filter((point) => Array.isArray(point));
  state.parkPoints = (parksData.features || [])
    .map((feature) => featureCentroid(feature))
    .filter((point) => Array.isArray(point));
  state.libraryPoints = (librariesData.features || [])
    .map((feature) => featureCentroid(feature))
    .filter((point) => Array.isArray(point));
  state.communityFeatures = (communityData.features || []).map((feature, idx) => ({
    ...feature,
    properties: {
      ...(feature.properties || {}),
      plan_color: communityPalette[idx % communityPalette.length],
      plan_index: idx,
    },
  }));
  communityData.features = state.communityFeatures;

  map.addSource("hex-scores", { type: "geojson", data: hexData });
  map.addSource("community-plans", { type: "geojson", data: communityData });
  map.addSource("city-boundary", { type: "geojson", data: cityBoundaryData });

  map.addLayer({
    id: "city-boundary-outline",
    type: "line",
    source: "city-boundary",
    paint: {
      "line-color": "#1a1a1a",
      "line-width": 1.8,
      "line-opacity": 0.8,
    },
  });

  map.addLayer({
    id: "community-plan-fill",
    type: "fill",
    source: "community-plans",
    paint: {
      "fill-color": ["get", "plan_color"],
      "fill-opacity": 0.08,
    },
  });

  map.addLayer({
    id: "hex-fill",
    type: "fill",
    source: "hex-scores",
    paint: {
      "fill-color": colorExpressions.score,
      "fill-opacity": 0.95,
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
    id: "hex-selected",
    type: "line",
    source: "hex-scores",
    filter: ["==", ["get", "hex_id"], -99999],
    paint: {
      "line-color": "#000000",
      "line-width": 3.2,
      "line-opacity": 1,
    },
  });

  map.addLayer({
    id: "community-plan-outline",
    type: "line",
    source: "community-plans",
    paint: {
      "line-color": "#2a2a2a",
      "line-width": 0.85,
      "line-opacity": 0.75,
    },
  });

  map.addLayer({
    id: "community-plan-selected",
    type: "line",
    source: "community-plans",
    filter: ["==", ["get", "cpcode"], -99999],
    paint: {
      "line-color": "#000000",
      "line-width": 3.2,
      "line-opacity": 1,
    },
  });

  updateHexColor(metricSelect.value);
  updateLayerEmphasis(emphasisSlider.value);

  const cityBounds = getBoundsForFeatureCollection(cityBoundaryData.features || []);
  if (cityBounds) {
    const isMobile = window.innerWidth <= 800;
    map.fitBounds(cityBounds, {
      padding: isMobile
        ? { top: 22, bottom: 22, left: 22, right: 22 }
        : { top: 30, bottom: 30, left: 320, right: 30 },
      duration: 0,
      maxZoom: 12.2,
    });
  }
});

map.on("click", "hex-fill", (event) => {
  if (state.mode !== "hex") return;

  const feature = event.features && event.features[0];
  if (!feature) return;

  const props = feature.properties || {};
  const center = featureCentroid(feature);
  const communityFeature = findCommunityFeatureForPoint(center);
  const communityPlanName = communityFeature?.properties?.cpname || "N/A";
  const html = `
    <strong>Hex ID:</strong> ${props.hex_id ?? "N/A"}<br>
    <strong>Community Plan:</strong> ${communityPlanName}<br>
    <strong>Combined Score:</strong> ${props.score ?? 0}<br>
    <strong>Grocery/Convenience Count:</strong> ${props.grocery_count ?? 0}<br>
    <strong>Park Count:</strong> ${props.park_count ?? 0}<br>
    <strong>Library Count:</strong> ${props.library_count ?? 0}
  `;

  showHexDashboard(feature);
  if (props.hex_id !== undefined && props.hex_id !== null) {
    flashSelectedHex(props.hex_id);
  }
  if (communityFeature?.properties?.cpcode !== undefined) {
    flashSelectedCommunity(communityFeature.properties.cpcode);
  }

  new maplibregl.Popup()
    .setLngLat(event.lngLat)
    .setHTML(html)
    .addTo(map);
});

map.on("click", "community-plan-fill", (event) => {
  if (state.mode !== "community") return;
  const feature = event.features && event.features[0];
  if (!feature) return;

  flashSelectedCommunity(feature.properties?.cpcode);
  const bounds = getFeatureBounds(feature);
  if (bounds) {
    const isMobile = window.innerWidth <= 800;
    map.fitBounds(bounds, {
      padding: isMobile
        ? { top: 24, bottom: 24, left: 24, right: 24 }
        : { top: 40, bottom: 40, left: 320, right: 40 },
      duration: 700,
      maxZoom: 13.5,
    });
  }

  showCommunityDashboard(feature);
});

map.on("mouseenter", "hex-fill", () => {
  map.getCanvas().style.cursor = state.mode === "hex" ? "pointer" : "";
});

map.on("mouseleave", "hex-fill", () => {
  map.getCanvas().style.cursor = "";
});

map.on("mouseenter", "community-plan-fill", () => {
  map.getCanvas().style.cursor = state.mode === "community" ? "pointer" : "";
});

map.on("mouseleave", "community-plan-fill", () => {
  map.getCanvas().style.cursor = "";
});

metricSelect.addEventListener("change", (event) => updateHexColor(event.target.value));
emphasisSlider.addEventListener("input", (event) => updateLayerEmphasis(event.target.value));
modeHexBtn.addEventListener("click", () => setMode("hex"));
modeCommunityBtn.addEventListener("click", () => setMode("community"));
