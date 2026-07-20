import json
import struct
import unittest
from pathlib import Path


VISUALIZER = Path(__file__).resolve().parents[1]
MAP_PATH = VISUALIZER / "data" / "map.json"
CATALOG_PATH = VISUALIZER / "assets" / "catalog.json"
DEMO_REPLAY_PATH = VISUALIZER / "data" / "demo.json"
SUPPORTED_KINDS = {
    "road",
    "rail",
    "crosswalk",
    "venue",
    "building",
    "label",
    "decor",
    "sprite",
}


def png_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        signature = handle.read(24)
    if signature[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError(f"Not a PNG file: {path}")
    return struct.unpack(">II", signature[16:24])


class MapDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.map = json.loads(MAP_PATH.read_text(encoding="utf-8"))
        cls.catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        cls.demo_replay = json.loads(DEMO_REPLAY_PATH.read_text(encoding="utf-8"))

    def test_map_schema_and_unique_ids(self):
        self.assertEqual(self.map["schemaVersion"], 2)
        self.assertEqual(self.map["world"], {"width": 240, "height": 360, "unit": "m", "grid": 1})
        layer_ids = [layer["id"] for layer in self.map["layers"]]
        object_ids = [item["id"] for item in self.map["objects"]]
        self.assertEqual(len(layer_ids), len(set(layer_ids)))
        self.assertEqual(len(object_ids), len(set(object_ids)))

    def test_simulation_building_mapping_is_complete_and_bijective(self):
        expected = {
            "culture_reading_building_01": "cultural",
            "food_building_01": "dining",
            "central_park_01": "central-park",
            "central_plaza_01": "night-market",
            "multipurpose_event_center_01": "performance",
            "bar_building_01": "bar",
            "game_entertainment_building_01": "entertainment",
            "sports_building_01": "sports",
            "night_school_building_01": "night-school",
        }
        mappings = self.map["simulation"]["buildingMappings"]
        display_only = set(self.map["simulation"]["displayOnlyObjectIds"])
        self.assertEqual(mappings, expected)
        self.assertEqual(len(mappings.values()), len(set(mappings.values())))
        self.assertEqual(display_only, set())
        self.assertFalse(set(mappings.values()) & display_only)
        semantic_ids = {
            item["id"] for item in self.map["objects"] if item["kind"] in {"venue", "building"}
        }
        self.assertEqual(semantic_ids, set(mappings.values()) | {"central-park-south"})

    def test_night_school_occupies_the_south_east_learning_block(self):
        night_school = next(item for item in self.map["objects"] if item["id"] == "night-school")
        self.assertGreaterEqual(night_school["x"], 160)
        self.assertGreaterEqual(night_school["y"], 230)
        self.assertGreaterEqual(night_school["height"], 70)

    def test_demo_replay_is_self_contained(self):
        agents = {agent["id"] for agent in self.demo_replay["agents"]}
        self.assertTrue(agents)
        self.assertTrue(self.demo_replay["frames"])
        for frame in self.demo_replay["frames"]:
            for agent in frame["agents"]:
                with self.subTest(step=frame["step"], agent=agent["id"]):
                    self.assertIn(agent["id"], agents)
                    self.assertGreaterEqual(agent["x"], 0)
                    self.assertGreaterEqual(agent["y"], 0)
                    self.assertLessEqual(agent["x"], 100)
                    self.assertLessEqual(agent["y"], 100)
        for event in self.demo_replay["events"]:
            with self.subTest(event=event["id"]):
                self.assertIn(event["source"], agents)
                self.assertIn(event["target"], agents)

    def test_objects_reference_layers_and_stay_in_bounds(self):
        layers = {layer["id"] for layer in self.map["layers"]}
        world = self.map["world"]
        for item in self.map["objects"]:
            with self.subTest(item=item["id"]):
                self.assertIn(item["layer"], layers)
                self.assertIn(item["kind"], SUPPORTED_KINDS)
                self.assertGreater(item["width"], 0)
                self.assertGreater(item["height"], 0)
                self.assertGreaterEqual(item["x"], 0)
                self.assertGreaterEqual(item["y"], 0)
                self.assertLessEqual(item["x"] + item["width"], world["width"] + 1e-6)
                self.assertLessEqual(item["y"] + item["height"], world["height"] + 1e-6)
                if item.get("shape", {}).get("type") == "polygon":
                    points = item["shape"]["points"]
                    self.assertGreaterEqual(len(points), 3)
                    self.assertTrue(all(0 <= coordinate <= 100 for point in points for coordinate in point))

    def test_reference_map_matches_the_nine_facility_plan(self):
        expected = {
            "cultural",
            "dining",
            "night-school",
            "night-market",
            "central-park",
            "performance",
            "bar",
            "entertainment",
            "sports",
            "central-park-south",
        }
        actual = {item["id"] for item in self.map["objects"] if item["kind"] == "venue"}
        self.assertEqual(actual, expected)
        facilities = {item["id"]: item for item in self.map["objects"] if item["kind"] == "venue"}
        self.assertIn("COMMUNITY PLAZA", facilities["night-market"]["label"]["en"])
        self.assertIn("SPORTS + PERFORMANCE", facilities["performance"]["label"]["en"])

    def test_asset_atlases_match_catalog_geometry(self):
        self.assertEqual(self.catalog["schemaVersion"], 1)
        pack_ids = [pack["id"] for pack in self.catalog["packs"]]
        self.assertEqual(len(pack_ids), len(set(pack_ids)))
        for pack in self.catalog["packs"]:
            with self.subTest(pack=pack["id"]):
                relative = pack["src"].removeprefix("./assets/")
                atlas = VISUALIZER / "assets" / relative
                self.assertTrue(atlas.is_file(), atlas)
                expected_width = pack["columns"] * pack["tileSize"] + (pack["columns"] - 1) * pack["spacing"]
                expected_height = pack["rows"] * pack["tileSize"] + (pack["rows"] - 1) * pack["spacing"]
                self.assertEqual(png_dimensions(atlas), (expected_width, expected_height))
                self.assertEqual(pack["count"], pack["columns"] * pack["rows"])
                license_path = atlas.parent / "License.txt"
                self.assertTrue(license_path.is_file(), license_path)
                self.assertIn("CC0", license_path.read_text(encoding="utf-8", errors="replace"))

    def test_sprite_references_resolve(self):
        packs = {pack["id"]: pack for pack in self.catalog["packs"]}
        for item in self.map["objects"]:
            if item["kind"] != "sprite":
                continue
            with self.subTest(item=item["id"]):
                pack = packs[item["asset"]["packId"]]
                self.assertGreaterEqual(item["asset"]["tileIndex"], 0)
                self.assertLess(item["asset"]["tileIndex"], pack["count"])

    def test_viewer_no_longer_contains_hardcoded_map_objects(self):
        html = (VISUALIZER / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="map-layer"', html)
        self.assertNotIn("district-plan", html)
        self.assertNotIn("venue-cultural", html)
        self.assertNotIn("crosswalk-nw", html)


if __name__ == "__main__":
    unittest.main()
