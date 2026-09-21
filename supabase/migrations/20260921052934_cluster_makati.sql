-- PAWME V1 — the launch cluster. This is configuration, not seed data, so it
-- belongs in a migration and ships to production.
--
-- Decision (2026-09-21): Ayala Triangle centroid, 3.5 km radius, MAKATI ONLY —
-- BGC / Taguig explicitly excluded.
--
-- A radius cannot do that alone: BGC High Street is ~3.0 km from the centroid,
-- inside the circle. So the cluster is "within the radius AND inside the Makati
-- city boundary". The boundary below is OpenStreetMap relation 103716 (Makati,
-- current limits — the EMBO barangays transferred to Taguig in 2023 are outside
-- it), simplified to ~90 m. Vertices are (lng, lat).
-- Boundary data © OpenStreetMap contributors, ODbL 1.0.
--
-- To move or resize the cluster: update this one row. To launch another city
-- later: insert another row.
insert into public.ranking_config (cluster_id, name, centroid_lat, centroid_lng, radius_m, grid_m, boundary)
values (
  'makati',
  'Makati',
  14.5566,
  121.0234,
  3500,
  500,
  polygon '(
      (120.9987708,14.5617554),(121.0016121,14.5525711),(121.0089767,14.5483419),
      (121.0088975,14.5403062),(121.0129683,14.5391236),(121.0131339,14.5329911),
      (121.0117984,14.530121),(121.0157353,14.5309442),(121.0168275,14.5296505),
      (121.0242339,14.5311429),(121.0306719,14.534868),(121.0336962,14.5340421),
      (121.0383532,14.5363843),(121.0397429,14.5398622),(121.0460129,14.5419183),
      (121.0416106,14.5558332),(121.0421091,14.5592305),(121.0471407,14.5570823),
      (121.0500718,14.5626759),(121.0478731,14.5650437),(121.0471328,14.5684046),
      (121.0339341,14.567539),(121.0175848,14.5795004)
  )'
)
on conflict (cluster_id) do nothing;
