# FromUnknown2Lover UI

Standalone, static-first UI module for replaying the spatial encounters in the
FromUnknown2Lover research prototype. It runs entirely in the browser: no
account, API, database, or simulation runtime is required.

The published module deliberately includes only the synthetic demo replay and
editable map. Research-run exports and their source archives remain in the
parent research repository so that a public demo site does not republish
participant-like dialogue traces or experimental artifacts.

## Use

Open the deployed site, or serve this directory locally:

```sh
npm run dev
```

The three browser surfaces are:

- `index.html` — encounter replay, timeline, relationship evidence, and map.
- `editor.html` — local-only map editor; drafts are stored in browser storage.
- `characters.html` — local-only character appearance editor.

Use **Import replay JSON** on the replay page to load an exported run locally.
The file is parsed in the browser and is never uploaded by this module.

The replay view also includes **Relation Pulse**: select an Agent to see their
current dyads' aggregated familiarity, trust, and mutual-attraction minimum as
three stepwise lines. Short markers above affected Agents show changes between
adjacent observed steps. They are a navigational overview only, not a
continuous emotional trajectory or a substitute for dyad-level analysis.

## Development and verification

The module has no package dependencies. Node 20+ is required for the unit
tests; Python 3 is used only for static map validation.

```sh
npm test
npm run check:map
```

Every push to `main` runs those checks and publishes the static directory to
GitHub Pages. The workflow deploys only after checks pass.

## Data and asset boundaries

- `data/demo.json` and `data/map.json` are public demo data.
- Real replay JSON, export archives, and parser scripts are intentionally not
  shipped in this repository.
- Kenney RPG Urban and Tiny Town assets are CC0. Their source and licence
  records are retained under `assets/`.

## License

MIT for this module's code and original content. Third-party assets keep their
own licence notices.
