"""Build scored walkability hexes for San Diego."""

from pathlib import Path

import duckdb
import geopandas as gpd


def main() -> None:
    # Paths.
    project_root = Path(__file__).resolve().parents[1]
    data_raw_dir = project_root / "data_raw"
    hexes_path = project_root / "data_raw" / "hexes.geojson"
    groceries_path = project_root / "data_raw" / "groceries.geojson"
    parks_path = project_root / "data_raw" / "parks.geojson"
    libraries_path = project_root / "data_raw" / "libraries.geojson"
    community_plans_path = project_root / "public" / "data" / "community_plans.geojson"
    output_path = project_root / "public" / "data" / "hex_scores.geojson"

    # Find San Diego boundary file uploaded to data_raw.
    boundary_candidates = sorted(data_raw_dir.glob("*boundary*.geojson"))
    boundary_candidates = [p for p in boundary_candidates if "san_diego" in p.stem.lower()] or boundary_candidates
    if not boundary_candidates:
        print("Error: Could not find a boundary GeoJSON in data_raw (expected *boundary*.geojson).")
        raise SystemExit(1)
    boundary_path = boundary_candidates[0]

    # Check required input files.
    required = [hexes_path, groceries_path, parks_path, libraries_path]
    missing = [p for p in required if not p.exists()]
    if missing:
        print("Error: Missing required input files:")
        for path in missing:
            print(f"- {path}")
        raise SystemExit(1)

    # Load GeoJSON files with GeoPandas.
    hexes = gpd.read_file(hexes_path)
    boundary = gpd.read_file(boundary_path)
    groceries = gpd.read_file(groceries_path)
    parks = gpd.read_file(parks_path)
    libraries = gpd.read_file(libraries_path)

    # Check empty layers.
    if hexes.empty:
        print(f"Error: No features found in {hexes_path}")
        raise SystemExit(1)
    if boundary.empty:
        print(f"Error: No features found in {boundary_path}")
        raise SystemExit(1)
    if groceries.empty:
        print(f"Error: No features found in {groceries_path}")
        raise SystemExit(1)
    if parks.empty:
        print(f"Error: No features found in {parks_path}")
        raise SystemExit(1)
    if libraries.empty:
        print(f"Error: No features found in {libraries_path}")
        raise SystemExit(1)

    # Reproject everything for meter-based distance checks.
    hexes = hexes.to_crs(epsg=26911)
    boundary = boundary.to_crs(epsg=26911)
    groceries = groceries.to_crs(epsg=26911)
    parks = parks.to_crs(epsg=26911)
    libraries = libraries.to_crs(epsg=26911)

    # Keep only polygon hexes.
    is_polygon = hexes.geometry.geom_type.isin(["Polygon", "MultiPolygon"])
    if not is_polygon.all():
        print(f"Warning: Dropping {(~is_polygon).sum()} non-polygon hex features.")
    hexes = hexes[is_polygon].copy()
    if hexes.empty:
        print("Error: No polygon hex features left after filtering.")
        raise SystemExit(1)

    # Clip hexes to the San Diego city boundary.
    boundary = boundary[boundary.geometry.notna() & ~boundary.geometry.is_empty].copy()
    if boundary.empty:
        print(f"Error: Boundary geometry is empty after cleanup: {boundary_path}")
        raise SystemExit(1)
    city_boundary = boundary.union_all()
    hexes = gpd.clip(hexes, city_boundary)
    if hexes.empty:
        print("Error: No hexes remain after clipping to the city boundary.")
        raise SystemExit(1)

    # Optional extra filter: keep hexes whose centroids fall inside community plans.
    # This removes water/outside-neighborhood hexes that can remain in city boundary data.
    if community_plans_path.exists():
        community_plans = gpd.read_file(community_plans_path).to_crs(epsg=26911)
        community_plans = community_plans[
            community_plans.geometry.notna() & ~community_plans.geometry.is_empty
        ].copy()
        if not community_plans.empty:
            plans_union = community_plans.union_all()
            hex_centroids_for_filter = hexes.geometry.centroid
            hexes = hexes[hex_centroids_for_filter.within(plans_union)].copy()
            if hexes.empty:
                print("Error: No hexes remain after community plan filtering.")
                raise SystemExit(1)
        else:
            print(f"Warning: Community plans file is empty: {community_plans_path}")
    else:
        print(f"Warning: Community plans file not found, skipping plan filter: {community_plans_path}")

    # Drop missing/empty geometries.
    hexes = hexes[hexes.geometry.notna() & ~hexes.geometry.is_empty].copy()
    groceries = groceries[groceries.geometry.notna() & ~groceries.geometry.is_empty].copy()
    parks = parks[parks.geometry.notna() & ~parks.geometry.is_empty].copy()
    libraries = libraries[libraries.geometry.notna() & ~libraries.geometry.is_empty].copy()

    # Create hex IDs and centroid points (used for distance checks).
    hexes = hexes.reset_index(drop=True)
    hexes["hex_id"] = hexes.index
    hex_points = hexes[["hex_id", "geometry"]].copy()
    hex_points["geometry"] = hex_points.geometry.centroid

    # Convert service layers to points if they are not already points.
    for layer in [groceries, parks, libraries]:
        not_points = layer.geometry.geom_type != "Point"
        if not_points.any():
            layer.loc[not_points, "geometry"] = layer.loc[not_points, "geometry"].centroid

    # Build simple WKB tables for DuckDB spatial SQL.
    hex_tbl = hex_points[["hex_id"]].copy()
    hex_tbl["geom_wkb"] = hex_points.geometry.to_wkb()

    groceries_tbl = groceries.reset_index(drop=True)[["geometry"]].copy()
    groceries_tbl["id"] = groceries_tbl.index
    groceries_tbl["geom_wkb"] = groceries_tbl.geometry.to_wkb()
    groceries_tbl = groceries_tbl[["id", "geom_wkb"]]

    parks_tbl = parks.reset_index(drop=True)[["geometry"]].copy()
    parks_tbl["id"] = parks_tbl.index
    parks_tbl["geom_wkb"] = parks_tbl.geometry.to_wkb()
    parks_tbl = parks_tbl[["id", "geom_wkb"]]

    libraries_tbl = libraries.reset_index(drop=True)[["geometry"]].copy()
    libraries_tbl["id"] = libraries_tbl.index
    libraries_tbl["geom_wkb"] = libraries_tbl.geometry.to_wkb()
    libraries_tbl = libraries_tbl[["id", "geom_wkb"]]

    # Connect to DuckDB and load spatial extension.
    con = duckdb.connect()
    ext_dir = project_root / ".duckdb_extensions"
    ext_dir.mkdir(parents=True, exist_ok=True)
    ext_dir_sql = str(ext_dir).replace("\\", "/")
    con.execute(f"SET extension_directory='{ext_dir_sql}';")
    try:
        con.execute("LOAD spatial;")
    except Exception:
        try:
            con.execute("INSTALL spatial;")
            con.execute("LOAD spatial;")
        except Exception as exc:
            print("Error: Could not load DuckDB spatial extension.")
            print(f"Details: {exc}")
            raise SystemExit(1)

    con.register("hexes_tbl", hex_tbl)
    con.register("groceries_tbl", groceries_tbl)
    con.register("parks_tbl", parks_tbl)
    con.register("libraries_tbl", libraries_tbl)

    # Count nearby services from each hex centroid.
    counts = con.execute(
        """
        WITH grocery_counts AS (
            SELECT
                h.hex_id,
                COUNT(g.id) AS grocery_count
            FROM hexes_tbl h
            LEFT JOIN groceries_tbl g
                ON ST_DWithin(
                    ST_GeomFromWKB(h.geom_wkb),
                    ST_GeomFromWKB(g.geom_wkb),
                    800
                )
            GROUP BY h.hex_id
        ),
        park_counts AS (
            SELECT
                h.hex_id,
                COUNT(p.id) AS park_count
            FROM hexes_tbl h
            LEFT JOIN parks_tbl p
                ON ST_DWithin(
                    ST_GeomFromWKB(h.geom_wkb),
                    ST_GeomFromWKB(p.geom_wkb),
                    800
                )
            GROUP BY h.hex_id
        ),
        library_counts AS (
            SELECT
                h.hex_id,
                COUNT(l.id) AS library_count
            FROM hexes_tbl h
            LEFT JOIN libraries_tbl l
                ON ST_DWithin(
                    ST_GeomFromWKB(h.geom_wkb),
                    ST_GeomFromWKB(l.geom_wkb),
                    1200
                )
            GROUP BY h.hex_id
        )
        SELECT
            h.hex_id,
            COALESCE(g.grocery_count, 0) AS grocery_count,
            COALESCE(p.park_count, 0) AS park_count,
            COALESCE(l.library_count, 0) AS library_count
        FROM hexes_tbl h
        LEFT JOIN grocery_counts g ON h.hex_id = g.hex_id
        LEFT JOIN park_counts p ON h.hex_id = p.hex_id
        LEFT JOIN library_counts l ON h.hex_id = l.hex_id
        ORDER BY h.hex_id;
        """
    ).df()

    # Join counts back to polygons and calculate final score.
    scored = hexes.merge(counts, on="hex_id", how="left")
    scored["grocery_count"] = scored["grocery_count"].fillna(0).astype(int)
    scored["park_count"] = scored["park_count"].fillna(0).astype(int)
    scored["library_count"] = scored["library_count"].fillna(0).astype(int)
    scored["score"] = (
        (scored["grocery_count"] > 0).astype(int)
        + (scored["park_count"] > 0).astype(int)
        + (scored["library_count"] > 0).astype(int)
    )

    # Save output in EPSG:4326.
    output_path.parent.mkdir(parents=True, exist_ok=True)
    scored.to_crs(epsg=4326).to_file(output_path, driver="GeoJSON")
    print(f"Saved {len(scored)} scored hexes to {output_path}")


if __name__ == "__main__":
    main()
