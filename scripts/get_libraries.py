"""Download library features for San Diego and save as GeoJSON."""

from pathlib import Path

import osmnx as ox


def main() -> None:
    # Target area and OSM tag for libraries.
    place_name = "San Diego, California, USA"
    tags = {"amenity": "library"}

    # Download matching OSM features as a GeoDataFrame.
    gdf = ox.features_from_place(place_name, tags=tags)

    if gdf.empty:
        print("Saved 0 features to data_raw/libraries.geojson")
        return

    # Keep useful attributes when present, plus geometry.
    preferred_columns = [
        "name",
        "amenity",
        "operator",
        "brand",
        "opening_hours",
        "wikidata",
    ]
    keep_columns = [col for col in preferred_columns if col in gdf.columns]
    libraries = gdf[keep_columns + ["geometry"]].copy()

    # Convert all geometries to points via centroids in a projected CRS.
    projected = libraries.to_crs(libraries.estimate_utm_crs())
    projected["geometry"] = projected.geometry.centroid

    # Export as EPSG:4326 GeoJSON.
    library_points = projected.to_crs(epsg=4326)
    project_root = Path(__file__).resolve().parents[1]
    output_path = project_root / "data_raw" / "libraries.geojson"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    library_points.to_file(output_path, driver="GeoJSON")

    print(f"Saved {len(library_points)} features to {output_path}")


if __name__ == "__main__":
    main()
