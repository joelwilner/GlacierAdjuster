// Toe & Moraine Mapper: adjust GLACIMONTIS toes, label ICE-D:ALPINE moraine boulders.
// Everything is kept in this browser (localStorage) and downloaded as CSV.
'use strict';

const OUTLINE_ZOOM = 9;          // outlines load from this zoom
const ADD_RADIUS_M = 3000;       // an added toe belongs to the nearest outline within this
const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const KEYS = { edits: 'tm.toeEdits.v1', labels: 'tm.labels.v1', saved: 'tm.saved.v1' };
const LABELS = [['terminal', 'Terminal', '#1f6feb'], ['between', 'Between', '#f2c200'],
                ['lateral', 'Lateral', '#d7301f'], ['unsure', 'Unsure', '#9b59b6']];
const LABEL_COLOR = Object.fromEntries(LABELS.map(l => [l[0], l[2]]));

const S = {
  meta: null, toes: null, iced: null,
  tileSet: new Set(), tilesLoaded: new Set(), outlines: new Map(),
  edits: [], labels: [], state: new Map(), labelOf: new Map(),
  sel: null, mode: 'select', handle: null, toeLayers: new Map(), sampleLayers: new Map(),
};

// ---------------------------------------------------------------- storage
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { msg('Could not save in this browser - download the CSVs now.'); return false; } }
function persist() { lsSet(KEYS.edits, S.edits); lsSet(KEYS.labels, S.labels); counts(); }
function msg(t) { document.getElementById('msg').textContent = t || ''; }
function now() { return new Date().toISOString(); }      // ms: an action's rows share it, two actions never do

// ---------------------------------------------------------------- map and layers
const map = L.map('map', { preferCanvas: true, worldCopyJump: true, maxZoom: 18 }).setView([35, 10], 3);
const canvas = L.canvas({ padding: 0.3, tolerance: 5 });

const demReady = new Map();      // 'z/x/y' -> Float32Array of elevations (m)
const demPending = new Map();
function demTile(z, x, y) {
  const k = z + '/' + x + '/' + y;
  if (demReady.has(k)) return Promise.resolve(demReady.get(k));
  if (demPending.has(k)) return demPending.get(k);
  const p = new Promise((res, rej) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, 256, 256).data, e = new Float32Array(65536);
      for (let i = 0; i < 65536; i++) e[i] = d[4 * i] * 256 + d[4 * i + 1] + d[4 * i + 2] / 256 - 32768;
      demReady.set(k, e); demPending.delete(k);
      if (demReady.size > 600) demReady.delete(demReady.keys().next().value);
      res(e);
    };
    img.onerror = () => { demPending.delete(k); rej(new Error('tile')); };
    img.src = TERRAIN.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  });
  demPending.set(k, p);
  return p;
}
function tileLat(y, z) { const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return 180 / Math.PI * Math.atan(Math.sinh(n)); }

const RAMP = [[0, [44, 123, 182]], [0.15, [96, 168, 98]], [0.35, [196, 214, 128]], [0.55, [234, 200, 120]],
              [0.75, [178, 120, 70]], [0.9, [150, 130, 120]], [1, [250, 250, 250]]];
function rampColor(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const a = RAMP[i - 1], b = RAMP[i], f = (t - a[0]) / (b[0] - a[0]);
      return [0, 1, 2].map(j => a[1][j] + f * (b[1][j] - a[1][j]));
    }
  }
  return RAMP[RAMP.length - 1][1];
}
const demRange = { lo: 0, hi: 4000 };

const Relief = L.GridLayer.extend({
  options: { maxNativeZoom: 15, maxZoom: 18 },
  createTile: function (c, done) {
    const t = document.createElement('canvas'); t.width = t.height = 256;
    demTile(c.z, c.x, c.y).then(e => { this.paint(t, e, c); done(null, t); }).catch(err => done(err, t));
    return t;
  },
  paint: function (t, e, c) {
    const g = t.getContext('2d'), im = g.createImageData(256, 256), d = im.data;
    const span = Math.max(demRange.hi - demRange.lo, 1);
    for (let i = 0; i < 65536; i++) {
      let rgb;
      if (e[i] <= 0 && demRange.lo > 0) rgb = [170, 200, 225];
      else rgb = rampColor((e[i] - demRange.lo) / span);
      d[4 * i] = rgb[0]; d[4 * i + 1] = rgb[1]; d[4 * i + 2] = rgb[2]; d[4 * i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  },
});
// Esri World Hillshade (QGIS's "World Hillshade"): lidar/3DEP where there is
// some, ~30 m elsewhere; real tiles to zoom 16, a no-data placeholder beyond
const hill = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 18, maxNativeZoom: 16, attribution: 'Hillshade: Esri, USGS, NGA, NASA, CGIAR, Intermap and others' });
const dem = new Relief();
const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 18, maxNativeZoom: 17, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics' });
hill.addTo(map);

const gOutlines = L.layerGroup().addTo(map);
const gToes = L.layerGroup().addTo(map);
const gIced = L.layerGroup().addTo(map);
const gLinks = L.layerGroup().addTo(map);
L.control.layers({ 'Hillshade': hill, 'DEM (stretched to view)': dem, 'Satellite': sat },
  { 'GLACIMONTIS outlines': gOutlines, 'GLACIMONTIS toes': gToes, 'ICE-D:ALPINE boulders': gIced },
  { collapsed: false, position: 'topright' }).addTo(map);
L.control.scale({ imperial: false }).addTo(map);
map.attributionControl.addAttribution('Elevation: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a> · Outlines: GLACIMONTIS · Boulders: <a href="https://version2.ice-d.org/alpine/">ICE-D:ALPINE</a>');

// elevation tiles for the view, whatever the base layer: the readout under
// the cursor and each edit's elevM come from them
function viewDem() {
  const z = Math.min(Math.round(map.getZoom()), 15), b = map.getBounds();
  const t0 = map.project(b.getNorthWest(), z).divideBy(256).floor(), t1 = map.project(b.getSouthEast(), z).divideBy(256).floor();
  const n = Math.pow(2, z), jobs = [];
  for (let x = t0.x; x <= t1.x; x++) for (let y = Math.max(0, t0.y); y <= Math.min(n - 1, t1.y); y++)
    jobs.push(demTile(z, ((x % n) + n) % n, y).catch(() => null));
  return Promise.all(jobs);
}
// the DEM's colours span the elevations in view
function stretchDem() {
  const p = viewDem();
  if (!map.hasLayer(dem)) return;
  p.then(arr => {
    const v = [];
    arr.forEach(e => { if (e) for (let i = 0; i < 65536; i += 37) v.push(e[i]); });
    if (!v.length) return;
    v.sort((a, b) => a - b);
    const lo = v[Math.floor(0.02 * (v.length - 1))], hi = v[Math.floor(0.98 * (v.length - 1))];
    if (Math.abs(lo - demRange.lo) < 1 && Math.abs(hi - demRange.hi) < 1) return;
    demRange.lo = lo; demRange.hi = Math.max(hi, lo + 10);
    dem.redraw(); legend();
  });
}
map.on('moveend', stretchDem);
map.whenReady(stretchDem);
map.on('baselayerchange', () => { stretchDem(); legend(); });

// elevation under the cursor, from tiles already fetched
map.on('mousemove', ev => {
  const z = Math.min(Math.round(map.getZoom()), 15), p = map.project(ev.latlng, z);
  const n = Math.pow(2, z), x = Math.floor(p.x / 256), y = Math.floor(p.y / 256);
  const e = demReady.get(z + '/' + (((x % n) + n) % n) + '/' + y);
  let txt = ev.latlng.lat.toFixed(5) + ', ' + ev.latlng.lng.toFixed(5);
  if (e) txt += '   ' + Math.round(e[(Math.floor(p.y) - y * 256) * 256 + (Math.floor(p.x) - x * 256)]) + ' m';
  if (map.getZoom() < OUTLINE_ZOOM) txt += '   (zoom in for outlines)';
  document.getElementById('status').textContent = txt;
});
function elevAt(ll) {
  const z = Math.min(Math.round(map.getZoom()), 15), p = map.project(ll, z);
  const n = Math.pow(2, z), x = Math.floor(p.x / 256), y = Math.floor(p.y / 256);
  const e = demReady.get(z + '/' + (((x % n) + n) % n) + '/' + y);
  return e ? Math.round(e[(Math.floor(p.y) - y * 256) * 256 + (Math.floor(p.x) - x * 256)]) : null;
}

function legend() {
  let h = 'Toes: <i style="background:#00d9ff"></i>dated <i style="background:#bbb"></i>undated ' +
    '<i style="background:#e8630a"></i>edited<br>Boulders: ' +
    LABELS.map(l => '<i style="background:' + l[2] + '"></i>' + l[1]).join(' ') +
    ' <i style="background:#fff"></i>unlabelled';
  if (map.hasLayer(dem)) {
    const stops = RAMP.map(r => 'rgb(' + r[1].join(',') + ') ' + (100 * r[0]) + '%').join(',');
    h += '<br>' + Math.round(demRange.lo) + ' m<span class="bar" style="background:linear-gradient(90deg,' + stops + ')"></span>' + Math.round(demRange.hi) + ' m';
  }
  document.getElementById('legend').innerHTML = h;
}

// ---------------------------------------------------------------- outlines (tiled)
function decodeParts(parts) {
  return parts.map(p => {
    const out = []; let la = 0, lo = 0;
    for (let i = 0; i < p.length; i += 2) { la += p[i]; lo += p[i + 1]; out.push([la / 1e5, lo / 1e5]); }
    return out;
  });
}
function loadTiles() {
  if (!S.meta || map.getZoom() < OUTLINE_ZOOM) return;
  const deg = S.meta.tileDeg, b = map.getBounds().pad(0.2);
  const wrap = lon => ((lon + 180) % 360 + 360) % 360 - 180;
  const iy0 = Math.floor((b.getSouth() + 90) / deg), iy1 = Math.floor((b.getNorth() + 90) / deg);
  const ix0 = Math.floor((wrap(b.getWest()) + 180) / deg), ix1 = Math.floor((wrap(b.getEast()) + 180) / deg);
  const nx = Math.round(360 / deg), want = [];
  for (let iy = iy0; iy <= iy1; iy++) {
    for (let ix = ix0; ; ix = (ix + 1) % nx) {
      want.push('t_' + iy + '_' + ix);
      if (ix === ix1 || want.length > 400) break;
    }
  }
  want.filter(k => S.tileSet.has(k) && !S.tilesLoaded.has(k)).forEach(k => {
    S.tilesLoaded.add(k);
    fetch('data/tiles/' + k + '.json').then(r => r.json()).then(list => {
      list.forEach(o => {
        if (S.outlines.has(o.i)) return;
        const parts = decodeParts(o.p);
        const lyr = L.polygon(parts, {
          renderer: canvas, interactive: false, fill: false, weight: 1.4,
          color: o.d ? '#00d9ff' : '#c8c8c8', dashArray: o.c ? '5 4' : null,
        }).addTo(gOutlines);
        S.outlines.set(o.i, { id: o.i, parts, layer: lyr, bounds: lyr.getBounds() });
      });
      if (S.sel) showSel();
    }).catch(() => S.tilesLoaded.delete(k));
  });
}
map.on('moveend', loadTiles);

// nearest point on an outline, and whether (lat, lon) is inside it
function nearestOn(o, lat, lon) {
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 111320;
  let best = { d: Infinity, lat: NaN, lon: NaN }, inside = false;
  o.parts.forEach(P => {
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      const ax = (a[1] - lon) * kx, ay = (a[0] - lat) * ky, bx = (b[1] - lon) * kx, by = (b[0] - lat) * ky;
      const abx = bx - ax, aby = by - ay, l2 = abx * abx + aby * aby;
      let t = l2 > 0 ? -(ax * abx + ay * aby) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + t * abx, py = ay + t * aby, d = Math.hypot(px, py);
      if (d < best.d) best = { d, lat: lat + py / ky, lon: lon + px / kx };
      if ((a[0] > lat) !== (b[0] > lat) && lon < a[1] + (lat - a[0]) * (b[1] - a[1]) / (b[0] - a[0])) inside = !inside;
    }
  });
  best.inside = inside;
  return best;
}

// ---------------------------------------------------------------- toes
// markers shrink when zoomed out, where there are thousands in view
function zr() { const z = map.getZoom(); return z < 5 ? 0.45 : z < 8 ? 0.7 : 1; }
let zrLast = null;
map.on('zoomend', () => {
  if (!S.toes || zr() === zrLast) return;
  zrLast = zr();
  S.toeLayers.forEach((m, k) => m.setRadius(toeStyle(k).radius));
  S.sampleLayers.forEach((m, id) => m.setRadius(sampleStyle(id).radius));
});
function toeRow(k) { const i = S.toes.index.get(k); return i === undefined ? null : S.toes.rows[i]; }
function rebuildState() {
  S.state = new Map();
  S.edits.forEach(e => {
    if (e.op === 'add') S.state.set(e.key, { lat: +e.lat, lon: +e.lon, added: true, regionId: +e.regionId });
    else if (e.op === 'move') { const s = S.state.get(e.key) || {}; S.state.set(e.key, Object.assign(s, { lat: +e.lat, lon: +e.lon, deleted: false })); }
    else if (e.op === 'delete') { const s = S.state.get(e.key) || {}; s.deleted = true; S.state.set(e.key, s); }
    else if (e.op === 'restore') S.state.delete(e.key);
  });
  S.labelOf = new Map();
  S.labels.forEach(l => { if (l.label) S.labelOf.set(+l.sampleId, l.label); else S.labelOf.delete(+l.sampleId); });
}
function toePos(k) {
  const s = S.state.get(k), r = toeRow(k);
  if (s && isFinite(s.lat)) return [s.lat, s.lon];
  return r ? [r[1], r[2]] : null;
}
function toeStyle(k) {
  const r = toeRow(k), s = S.state.get(k);
  if (s && s.deleted) return { radius: 4 * zr(), color: '#ff4040', weight: 1.5, fillOpacity: 0, dashArray: '2 2' };
  if (s) return { radius: 6 * zr(), color: '#fff', weight: 1.5, fillColor: '#e8630a', fillOpacity: 1 };
  return { radius: 5 * zr(), color: '#111', weight: 1, fillOpacity: 1,
           fillColor: r[5] === 1 ? '#00d9ff' : '#bbbbbb' };
}
function drawToe(k) {
  const pos = toePos(k); if (!pos) return;
  let m = S.toeLayers.get(k);
  if (!m) {
    m = L.circleMarker(pos, Object.assign({ renderer: canvas, bubblingMouseEvents: false }, toeStyle(k)));
    m.on('click', () => { if (S.mode === 'select') select(k); });
    m.addTo(gToes); S.toeLayers.set(k, m);
  } else { m.setLatLng(pos); m.setStyle(toeStyle(k)); }
}
function drawLinks() {
  gLinks.clearLayers();
  S.state.forEach((s, k) => {
    const r = toeRow(k);
    if (!r || s.added || s.deleted || !isFinite(s.lat)) return;
    L.polyline([[r[1], r[2]], [s.lat, s.lon]], { renderer: canvas, color: '#e8630a', weight: 1.5, dashArray: '3 3', interactive: false }).addTo(gLinks);
    L.circleMarker([r[1], r[2]], { renderer: canvas, radius: 3, color: '#e8630a', weight: 1, fillOpacity: 0, interactive: false }).addTo(gLinks);
  });
}

function record(op, k, lat, lon) {
  const r = toeRow(k), s = S.state.get(k);
  const rid = r ? r[0] : s ? s.regionId : +k.split('-')[0];
  let snap = { lat: '', lon: '', d: '' };
  if (op === 'move' || op === 'add') {
    const o = S.outlines.get(rid);
    if (o) { const n = nearestOn(o, lat, lon); snap = { lat: n.lat, lon: n.lon, d: (n.inside ? -1 : 1) * n.d }; }
  }
  const z = (op === 'move' || op === 'add') ? elevAt(L.latLng(lat, lon)) : null;
  S.edits.push({
    key: k, regionId: rid, op,
    origLat: r ? r[1] : '', origLon: r ? r[2] : '',
    lat: lat === undefined ? '' : lat, lon: lon === undefined ? '' : lon,
    snapLat: snap.lat, snapLon: snap.lon, offM: snap.d === '' ? '' : Math.round(snap.d),
    elevM: z === null ? '' : z, updated: now(),
  });
  rebuildState(); persist(); drawToe(k); drawLinks();
  return true;
}

function select(k) {
  S.sel = k;
  if (S.handle) { map.removeLayer(S.handle); S.handle = null; }
  if (!k) { document.getElementById('sel').classList.add('hidden'); return; }
  const pos = toePos(k);
  S.handle = L.marker(pos, { draggable: true, autoPan: true, zIndexOffset: 1000,
    icon: L.divIcon({ className: 'toe-handle', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
  S.handle.on('dragend', ev => {
    const p = ev.target.getLatLng();
    if (!record('move', k, +p.lat.toFixed(6), +p.lng.toFixed(6))) ev.target.setLatLng(toePos(k));
    showSel();
  });
  showSel();
}
function showSel() {
  const k = S.sel, el = document.getElementById('sel');
  if (!k) { el.classList.add('hidden'); return; }
  const r = toeRow(k), s = S.state.get(k), pos = toePos(k);
  const rid = r ? r[0] : s.regionId;
  let off = '';
  const o = S.outlines.get(rid);
  if (o && pos) { const n = nearestOn(o, pos[0], pos[1]); off = Math.round(n.d) + ' m ' + (n.inside ? 'inside' : 'outside') + ' outline'; }
  const age = r && r[5] === 1 && r[6] !== null ? r[6] + ' ± ' + r[7] + ' ka' : 'undated';
  const rows = [['Toe', '<b>' + k + '</b>' + (s && s.deleted ? ' (deleted)' : s && s.added ? ' (added)' : s ? ' (moved)' : '')],
    ['Range', r ? S.toes.ranges[r[10]] : ''], ['Age', age],
    ['Original', r ? r[1].toFixed(5) + ', ' + r[2].toFixed(5) : '-'],
    ['Now', pos ? pos[0].toFixed(5) + ', ' + pos[1].toFixed(5) : '-'], ['', off]];
  el.innerHTML = '<table>' + rows.map(x => '<tr><td>' + x[0] + '</td><td>' + x[1] + '</td></tr>').join('') + '</table>' +
    '<div style="margin-top:4px"><button id="sDel">' + (s && s.deleted ? 'Undelete' : 'Delete') + '</button> ' +
    '<button id="sReset"' + (s ? '' : ' disabled') + '>Reset</button> <button id="sClose">Close</button></div>';
  el.classList.remove('hidden');
  document.getElementById('sDel').onclick = () => {
    if (s && s.deleted) { const p = toePos(k); record('move', k, p[0], p[1]); }
    else record('delete', k);
    showSel();
  };
  document.getElementById('sReset').onclick = () => {
    if (record('restore', k)) {
      if (!toeRow(k)) { const m = S.toeLayers.get(k); if (m) gToes.removeLayer(m); S.toeLayers.delete(k); select(null); return; }
      S.handle.setLatLng(toePos(k)); showSel();
    }
  };
  document.getElementById('sClose').onclick = () => select(null);
}

// add a toe: on the nearest outline within ADD_RADIUS_M (it need not be ON it)
map.on('click', ev => {
  if (S.mode !== 'add') { if (S.sel) select(null); return; }
  if (map.getZoom() < OUTLINE_ZOOM) { msg('Zoom in until the outlines show.'); return; }
  const { lat, lng } = ev.latlng;
  let best = null;
  S.outlines.forEach(o => {
    if (!o.bounds.pad(0.5).contains(ev.latlng) && o.bounds.getCenter().distanceTo(ev.latlng) > 50000) return;
    const n = nearestOn(o, lat, lng);
    if (!best || n.d < best.n.d) best = { o, n };
  });
  if (!best || best.n.d > ADD_RADIUS_M) { msg('No outline within 3 km.'); return; }
  const rid = best.o.id;
  let i = 1; while (S.state.has(rid + '-s' + i) || toeRow(rid + '-s' + i) || S.edits.some(e => e.key === rid + '-s' + i)) i++;
  const k = rid + '-s' + i;
  if (record('add', k, +lat.toFixed(6), +lng.toFixed(6))) { setMode('select'); select(k); msg(''); }
});

function setMode(m) {
  S.mode = m;
  document.getElementById('mSelect').classList.toggle('on', m === 'select');
  document.getElementById('mAdd').classList.toggle('on', m === 'add');
  map.getContainer().classList.toggle('adding', m === 'add');
}

// ---------------------------------------------------------------- ICE-D:ALPINE boulders
function sampleStyle(id) {
  const l = S.labelOf.get(id);
  return { radius: 4.5 * zr(), color: '#000', weight: 1, fillOpacity: 1, fillColor: l ? LABEL_COLOR[l] : '#ffffff' };
}
function sampleRow(id) { return S.iced.rows[S.iced.index.get(id)]; }
function labelSamples(ids, label) {
  const t = now();
  ids.forEach(id => {
    const r = sampleRow(id), site = S.iced.sites[r[1]];
    S.labels.push({ sampleId: id, sampleName: S.iced.names[S.iced.index.get(id)], siteId: site.id, siteName: site.name,
      lat: r[2], lon: r[3], label, updated: t });
  });
  rebuildState(); persist();
  ids.forEach(id => { const m = S.sampleLayers.get(id); if (m) m.setStyle(sampleStyle(id)); });
}
function samplePopup(id) {
  const i = S.iced.index.get(id), r = S.iced.rows[i], site = S.iced.sites[r[1]];
  const sib = S.iced.bySite.get(r[1]);
  const cur = S.labelOf.get(id) || '';
  const age = r[5] !== null ? r[5] + ' ± ' + r[6] + ' ka' : 'no age';
  return '<div class="lbl" data-id="' + id + '"><b>' + S.iced.names[i] + '</b><br>' +
    '<a href="' + site.url + '" target="_blank" rel="noopener">' + site.name + '</a> · ' + age + ' · ' + r[4] + ' m<br>' +
    LABELS.map(l => '<button data-l="' + l[0] + '"' + (cur === l[0] ? ' class="on"' : '') + '>' + l[1] + '</button>').join('') +
    '<button data-l="">Clear</button><br>' +
    '<label><input type="checkbox" class="wholeSite"> all ' + sib.length + ' at this site</label></div>';
}
// one listener for every popup's label buttons (popups re-render their content)
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('.lbl button[data-l]'); if (!b) return;
  const box = b.closest('.lbl'), id = +box.dataset.id, r = sampleRow(id);
  labelSamples(box.querySelector('.wholeSite').checked ? S.iced.bySite.get(r[1]) : [id], b.dataset.l);
  // mark the choice in place: replacing the content would detach the clicked
  // button, and Leaflet would take the click for a map click
  box.querySelectorAll('button[data-l]').forEach(x => x.classList.toggle('on', x.dataset.l !== '' && x.dataset.l === (S.labelOf.get(id) || '')));
});

// ---------------------------------------------------------------- CSV
const TOE_COLS = ['key', 'regionId', 'op', 'origLat', 'origLon', 'lat', 'lon', 'snapLat', 'snapLon', 'offM', 'elevM', 'updated'];
const LBL_COLS = ['sampleId', 'sampleName', 'siteId', 'siteName', 'lat', 'lon', 'label', 'updated'];
function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(cols, rows) { return [cols.join(',')].concat(rows.map(r => cols.map(c => csvCell(r[c])).join(','))).join('\n') + '\n'; }
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift() || [];
  return { head, rows: rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, j) => [h, r[j] === undefined ? '' : r[j]]))) };
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function stamp() { return now().slice(0, 10); }
function markSaved() { lsSet(KEYS.saved, { edits: S.edits.length, labels: S.labels.length }); counts(); }
function counts() {
  const sv = lsGet(KEYS.saved, { edits: 0, labels: 0 });
  const un = (S.edits.length - sv.edits) + (S.labels.length - sv.labels);
  document.getElementById('counts').textContent = S.edits.length + ' toe edits (' + S.state.size + ' toes changed) · ' +
    S.labels.length + ' labels (' + S.labelOf.size + ' boulders)' + (un > 0 ? ' · ' + un + ' not downloaded' : '');
}
function rowId(r) { return [r.key || r.sampleId, r.op || r.label, r.updated].join('|'); }
function loadCsv(text) {
  const { head, rows } = parseCsv(text);
  let target, cols;
  if (head.includes('key') && head.includes('op')) { target = S.edits; cols = TOE_COLS; }
  else if (head.includes('sampleId') && head.includes('label')) { target = S.labels; cols = LBL_COLS; }
  else { msg('Not a toe-edit or boulder-label CSV.'); return 0; }
  const seen = new Set(target.map(rowId)); let n = 0;
  rows.forEach(r => {
    const o = {}; cols.forEach(c => { o[c] = r[c] === undefined ? '' : r[c]; });
    ['regionId', 'origLat', 'origLon', 'lat', 'lon', 'snapLat', 'snapLon', 'offM', 'elevM', 'sampleId', 'siteId']
      .forEach(c => { if (o[c] !== undefined && o[c] !== '' && isFinite(+o[c])) o[c] = +o[c]; });
    if (!seen.has(rowId(o))) { target.push(o); seen.add(rowId(o)); n++; }
  });
  target.sort((a, b) => (a.updated < b.updated ? -1 : a.updated > b.updated ? 1 : 0));
  return n;
}

// ---------------------------------------------------------------- controls
document.getElementById('mSelect').onclick = () => setMode('select');
document.getElementById('mAdd').onclick = () => { select(null); setMode(S.mode === 'add' ? 'select' : 'add'); };
document.getElementById('dlToes').onclick = () => { download('toe_edits_' + stamp() + '.csv', toCsv(TOE_COLS, S.edits)); markSaved(); };
document.getElementById('dlLabels').onclick = () => { download('boulder_labels_' + stamp() + '.csv', toCsv(LBL_COLS, S.labels)); markSaved(); };
document.getElementById('load').onclick = () => document.getElementById('file').click();
document.getElementById('file').onchange = ev => {
  const files = Array.from(ev.target.files); let n = 0, left = files.length;
  files.forEach(f => f.text().then(t => {
    n += loadCsv(t);
    if (--left === 0) {
      rebuildState(); persist(); S.state.forEach((_, k) => drawToe(k));
      S.toeLayers.forEach((_, k) => drawToe(k)); drawLinks();
      S.sampleLayers.forEach((m, id) => m.setStyle(sampleStyle(id)));
      markSaved(); msg(n + ' rows loaded.');
    }
  }));
  ev.target.value = '';
};
document.getElementById('undo').onclick = () => {
  const a = S.edits[S.edits.length - 1], b = S.labels[S.labels.length - 1];
  if (!a && !b) return;
  if (b && (!a || b.updated >= a.updated)) {
    const t = b.updated; const ids = [];
    while (S.labels.length && S.labels[S.labels.length - 1].updated === t) ids.push(+S.labels.pop().sampleId);
    rebuildState(); persist(); ids.forEach(id => { const m = S.sampleLayers.get(id); if (m) m.setStyle(sampleStyle(id)); });
  } else {
    const e = S.edits.pop(); rebuildState(); persist();
    if (!toeRow(e.key) && !S.state.has(e.key)) { const m = S.toeLayers.get(e.key); if (m) gToes.removeLayer(m); S.toeLayers.delete(e.key); if (S.sel === e.key) select(null); }
    else { drawToe(e.key); if (S.sel === e.key) { S.handle.setLatLng(toePos(e.key)); showSel(); } }
    drawLinks();
  }
};
document.getElementById('goto').onkeydown = ev => {
  if (ev.key !== 'Enter') return;
  const v = ev.target.value.trim(); if (!v) return;
  const ll = v.match(/^\s*(-?\d+(\.\d+)?)\s*[, ]\s*(-?\d+(\.\d+)?)\s*$/);
  if (ll) { map.setView([+ll[1], +ll[3]], 13); return; }
  const k = v.replace(/^GM/i, '');
  if (toeRow(k) || S.state.has(k)) { map.setView(toePos(k), 13); select(k); return; }
  const site = S.iced.sites.find(s => s.name.toLowerCase() === v.toLowerCase());
  if (site) { map.setView([site.lat, site.lon], 13); return; }
  const j = S.iced.names.findIndex(n => n.toLowerCase() === v.toLowerCase());
  if (j >= 0) { const r = S.iced.rows[j]; map.setView([r[2], r[3]], 15); S.sampleLayers.get(r[0]).openPopup(); return; }
  msg('Not found: ' + v);
};
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { select(null); setMode('select'); } });
window.addEventListener('beforeunload', ev => {
  const sv = lsGet(KEYS.saved, { edits: 0, labels: 0 });
  if (S.edits.length > sv.edits || S.labels.length > sv.labels) { ev.preventDefault(); ev.returnValue = ''; }
});

// ---------------------------------------------------------------- start
Promise.all(['meta', 'toes', 'iced'].map(f => fetch('data/' + f + '.json').then(r => r.json()))).then(([meta, toes, iced]) => {
  S.meta = meta; S.tileSet = new Set(meta.tiles);
  toes.index = new Map(toes.keys.map((k, i) => [k, i])); S.toes = toes;
  iced.index = new Map(iced.rows.map((r, i) => [r[0], i]));
  iced.bySite = new Map(); iced.rows.forEach(r => { if (!iced.bySite.has(r[1])) iced.bySite.set(r[1], []); iced.bySite.get(r[1]).push(r[0]); });
  S.iced = iced;
  S.edits = lsGet(KEYS.edits, []); S.labels = lsGet(KEYS.labels, []);
  rebuildState();
  toes.keys.forEach(k => drawToe(k));
  S.state.forEach((_, k) => drawToe(k));
  drawLinks();
  iced.rows.forEach(r => {
    const m = L.circleMarker([r[2], r[3]], Object.assign({ renderer: canvas, bubblingMouseEvents: false }, sampleStyle(r[0])));
    m.bindPopup(() => samplePopup(r[0]), { maxWidth: 320 });
    m.addTo(gIced); S.sampleLayers.set(r[0], m);
  });
  // boulders above toes, so a click on a moraine reaches its boulder
  gIced.eachLayer(m => m.bringToFront());
  zrLast = zr(); counts(); legend(); loadTiles();
}).catch(err => msg('Could not load the data: ' + err.message));
