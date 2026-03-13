# Quickstart

This is the shortest path from clone to useful interaction.

## 1. Start the app

```bash
./run_demo.sh
```

`run_demo.sh` installs the host-native dependency set automatically. On Apple Silicon, that includes the Metal/MPS compute dependency.

Open `http://127.0.0.1:8000`.

## 2. Load a dataset

- In the **Data** panel, choose a dataset from the **Dataset** dropdown.
- Demo datasets are labeled with `[DEMO]`.
- For spherical workflows, pick `healpix-sky-time-nu-hd`.
- Or click **Load Data** to open the ingest flow for a local dataset path.
- Or drag and drop local `.h5`, `.hdf5`, `.fits`, `.fit`, `.fts`, or `.npz` files into the central viewer panel.
- In the ingest dialogs, choose combine-vs-separate for multi-file imports, review any HDF5 data-key selection, map axes in source order, then click **Commit Import**.

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
