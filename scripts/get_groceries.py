"""Download grocery-related OSM features for San Diego and save as GeoJSON."""

from pathlib import Path

import osmnx as ox


def main() -> None:
    # Target area and OSM tags for grocery-related shops.
    place_name = "San Diego, California, USA"
    tags = {"shop": ["supermarket", "convenience", "grocery"]}

    # Download matching OSM features as a GeoDataFrame.
    gdf = ox.features_from_place(place_name, tags=tags)

    if gdf.empty:
        print("Saved 0 features to data/groceries.geojson")
        return

    # Keep useful attributes when present, plus geometry.
    preferred_columns = [
        "name",
        "shop",
        "brand",
        "operator",
        "addr:street",
        "addr:housenumber",
        "addr:city",
        "addr:postcode",
    ]
    keep_columns = [col for col in preferred_columns if col in gdf.columns]
    groceries = gdf[keep_columns + ["geometry"]].copy()

    # Convert all geometries to points via centroids in a projected CRS.
    projected = groceries.to_crs(groceries.estimate_utm_crs())
    projected["geometry"] = projected.geometry.centroid

    # Export as EPSG:4326 GeoJSON.
    groceries_points = projected.to_crs(epsg=4326)
    project_root = Path(__file__).resolve().parents[1]
    output_path = project_root / "data" / "groceries.geojson"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    groceries_points.to_file(output_path, driver="GeoJSON")

    print(f"Saved {len(groceries_points)} features to {output_path}")


if __name__ == "__main__":
    main()
