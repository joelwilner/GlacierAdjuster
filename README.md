# Toe & Moraine Mapper

A static web page (Leaflet) for two hand-mapping tasks:

1. **Adjust GLACIMONTIS toes** so that they sit where the geomorphology says the glacier ended.
2. **Label ICE-D:ALPINE moraine boulders** as terminal, between, lateral or unsure.

It covers the whole GLACIMONTIS catalog (16,618 toes on 10,088 outlines) and 9,388 ICE-D:ALPINE moraine samples. Base layers are Esri's World Hillshade (the "World Hillshade" layer in QGIS), a DEM stretched to the view, and satellite imagery. The DEM and the elevation readout are computed in the browser from AWS Terrain Tiles.

## Using it

- **Move a toe.** Click a toe, then drag the orange ring. A toe may go anywhere, on or off its outline.
- **Delete or reset a toe.** Select the toe, then click *Delete* or *Reset*. Reset puts it back where GLACIMONTIS placed it.
- **Add a missed toe.** Click *Add toe*, then click on the map. The toe belongs to the nearest outline within 3 km.
- **Label a boulder.** Click the boulder and choose a label. Tick *all … at this site* to label the whole site at once.
- **Undo** removes the last edit or label.
- **Go to** takes a toe key (`3953022-1`), an ICE-D site or sample name, or `lat, lon`.
- **Saving.** Edits are kept in this browser between sessions. Click *Toe edits CSV* and *Boulder labels CSV* often. Each file holds everything so far, so send the newest pair. *Load CSV…* continues on another computer or browser.

Outlines appear from zoom 9 upward.

## Publishing (GitHub Pages)

```bash
cd /Users/jwilne03/paleoclimate_ICE-D/toe-mapper
git init -b main
git add .
git commit -m "Toe & Moraine Mapper"
```

1. Create an empty **public** repository on github.com. Pages on a private repository needs a paid plan.
2. Push this folder to it, using the commands GitHub shows for an existing repository.
3. In the repository, go to *Settings → Pages → Build and deployment*. Choose *Deploy from a branch*, then `main` and `/ (root)`.

The site appears at `https://<your-user>.github.io/<repo>/` after a minute. `.nojekyll` makes Pages serve the files as they are.

## Data and model hand-off (MATLAB, in `glacierpaleoclimate`)

| step | command |
|---|---|
| refresh `data/` (catalog or ICE-D cache changed) | `paleobo.webExport()` then commit and push |
| bring the student's CSVs into the model | `paleobo.webImport({'toe_edits_….csv', 'boulder_labels_….csv'})` |
| preview an import without changing anything | `paleobo.webImport(files, 'DryRun', true)` |

**What `webImport` does**

- **Toe edits** go into `sites/tongue_edits.csv` (via `paleobo.gmEdits`) as free toes at the student's exact coordinates. `gmTongues`, `gmPrepare` and `hpcPrepare` then use them.
- **Added toes** get the student's key `R-sN`, which becomes the next `R-mN`.
- **Re-importing is safe.** A newer cumulative CSV applies only its new rows. A ledger in `sites/web_import_ledger.csv` records what has been applied.
- **Boulder labels** accumulate in `sites/iced_boulder_labels.csv`. The latest label of each sample is returned.

The "original" toes are the GLACIMONTIS detector's own. Edits made in the MATLAB app are not shown on the page. A *Reset* imported from the page also clears earlier MATLAB edits of that toe.

Attribution: outlines from GLACIMONTIS, boulders from ICE-D:ALPINE (version2.ice-d.org/alpine), hillshade and imagery from Esri, and elevation from AWS Terrain Tiles (Mapzen).
