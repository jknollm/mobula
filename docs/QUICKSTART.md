# Quickstart

This is the shortest path from clone to useful interaction.

## 1. Start the app

```bash
./run_demo.sh
```

Open `http://127.0.0.1:8000`.

## 2. Load a dataset

- In the **Data** panel, choose a dataset from the **Dataset** dropdown.
- Demo datasets are labeled with `[DEMO]`.
- For spherical workflows, pick `healpix-sky-time-nu-hd`.
- Or click **Load Data** to select a local `.h5`, `.hdf5`, `.fits`, `.fit`, `.fts`, or `.zarr` dataset.
- Or drag and drop a local `.h5`, `.hdf5`, `.fits`, `.fit`, or `.fts` file into the central viewer panel.

## 3. Inspect slices

- In **Spatial**, keep **Slice** mode enabled.
- Choose plane: `XY`, `YZ`, or `ZX`.
- Drag on the image in **Inspect** mode to select a region.
- Use **Zoom** mode for box zoom.
- Use mouse wheel to zoom. Use `Alt+drag` or right-drag to pan.

## 4. Explore other axes

- Use **Temporal** and **Spectral** navigator graphs to change frame index.
- Click **Play** in axis panels for playback.
- In **Data**, change **Sample Mode** (`Mean`, `STD`, `Samples`, `rel. uncertainty`).

## 5. Switch to 3D

- In **Spatial**, toggle from **Slice** to **Volume**.
- Adjust volume controls (`Quality`, `Render Mode`, transfer function, opacity/gamma/cutoff).

## 6. Polarization workflow

- In **Polarization**, choose `I`, `Q`, `U`, `V`.
- Toggle **EVPA** (available in `XY` slice mode with polarization data).
- Use derived modes: `Fractional Pol`, `Magnetic Field Angle`, `Linear Pol`, `Circular Pol`.

## 7. Use API docs

Open `http://127.0.0.1:8000/docs` for interactive endpoint testing.
