# FromUnknown2Lover UI

Standalone, static-first UI module for replaying the spatial encounters in the
FromUnknown2Lover research prototype. It runs entirely in the browser: no
account, API, database, or simulation runtime is required.

The published module includes three complete packed AgentSociety encounter
replays on a shared editable map. Select the compact `E-A / E-B / E-C` labels
in the UI; each source-backed replay covers 50 Agents across 14 observed steps.

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

- `data/experiment-e-a.json`, `experiment-e-b.json`, and
  `experiment-e-c.json` are the public experiment replays; E-C is the default.
  Each companion `.summary.json` records coverage and audit facts.
- `data/agent-society-latest-snapshot.json` and `data/demo.json` remain
  available as alternatives; raw export archives and parser scripts stay in the
  parent research repository.
- Kenney RPG Urban and Tiny Town assets are CC0. Their source and licence
  records are retained under `assets/`.

## License

MIT for this module's code and original content. Third-party assets keep their
own licence notices.
