# walkSD

`walkSD` is a static web map that visualizes walkability across San Diego using hexagons.

## What the App Does

- Loads scored hex polygons from `data/hex_scores.geojson`
- Colors hexes by a selected metric:
  - Combined Score
  - Grocery/Convenience Count
  - Park Count
  - Library Count
- Shows community plan polygons and boundaries
- Lets users click:
  - a hex for local values
  - a neighborhood for aggregated stats
- Includes a layer emphasis slider to prioritize either hex visibility or community boundaries

## How Scoring Works

Each hex gets:

- `grocery_count`: services within 800m
- `park_count`: services within 800m
- `library_count`: services within 1200m
- `score` (Combined Score): +1 for each non-zero service type (range 0-3)

## Data + Processing Flow

1. `scripts/get_groceries.py` downloads grocery/convenience features from OSM.
2. `scripts/get_parks.py` downloads park features from OSM.
3. `scripts/get_libraries.py` downloads library features from OSM.
4. `scripts/build.py`:
   - loads input GeoJSON files from `data/`
   - reprojects to EPSG:26911 for distance analysis
   - uses DuckDB Spatial to count nearby services by hex centroid
   - calculates Combined Score
   - writes output to `data/hex_scores.geojson`

## Main Packages Used

- **MapLibre GL JS**: browser map rendering
- **OSMnx**: OpenStreetMap feature download
- **GeoPandas**: geospatial file IO + geometry operations
- **DuckDB + spatial extension**: fast spatial counting logic
- **Shapely**: geometry operations (via GeoPandas stack)
- **Fiona / Pyogrio**: GeoJSON/vector IO backends

## Project Structure

- `index.html` - app page
- `style.css` - app styles
- `app.js` - map + interaction logic
- `data/` - all GeoJSON inputs/outputs
- `scripts/` - Python data pipeline scripts

## Run Locally

Serve with a local static server (do not open with `file://`):

```powershell
python -m http.server 8000
```

Then open:

- `http://localhost:8000/`

