const sanDiegoCenter = [-117.1611, 32.7157];

const map = new maplibregl.Map({
  container: "map",
  style: "https://demotiles.maplibre.org/style.json",
  center: sanDiegoCenter,
  zoom: 11,
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

new maplibregl.Marker({ color: "#1f8f6a" })
  .setLngLat(sanDiegoCenter)
  .setPopup(new maplibregl.Popup().setText("Downtown San Diego"))
  .addTo(map);
