# Anonymous fixtures

`anonymous.sav` is a deliberately minimal, source-shaped synthetic character fixture for offline browser acceptance. It contains no real character name, coordinates, world name, equipment, or copied private save content. It is not claimed to be a playable game save. Its unknown field must survive native TRANSFER preview/export.

The unit tests also construct malformed, older-version, large-integer, multi-submap and nested-state fixtures inline. Real version-33 regression is opt-in via `CDDA_PRIVATE_SAVE_DIR`; it checks the private tree's hashes before/after but never copies private files into this repository. See the main README for the invocation and the compatibility report for sanitized counts.
