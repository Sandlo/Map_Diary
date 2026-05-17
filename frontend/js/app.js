// =========================
// CONFIG
// =========================
const API_BASE = 'http://localhost:5000';

// =========================
// MAP SETUP (Zwei Ebenen)
// =========================
const map = L.map('map', {
  maxBounds: L.latLngBounds(L.latLng(-90, -180), L.latLng(90, 180)),
  maxBoundsViscosity: 1.0,
  zoomSnap: 0.9,
}).setView([50.0, 10.0], 4);

// 1. Layer: Standard OSM (Default)
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png', {
  maxZoom: 17, minZoom: 2.5, attribution: '© OpenStreetMap'
});

// 2. Layer: Satellit Hybrid (Satellitenbilder + Grenzen + Deutsche Labels)
const satelliteLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=de', {
  maxZoom: 20, 
  minZoom: 2.5, 
  attribution: '© Google Maps'
});

// OSM als Startwert hinzufügen
osmLayer.addTo(map);

let clusterGroup = L.markerClusterGroup();
map.addLayer(clusterGroup);

// =========================
// DOM REFERENZEN
// =========================
const sidebar = document.getElementById('sidebar');
const sidebarContent = document.getElementById('sidebar-content');
const tripListEl = document.getElementById('trip-list');
const closeSidebarBtn = document.getElementById('close-sidebar');

const filterUser = document.getElementById('filter-user');
const filterTrip = document.getElementById('filter-trip');
const filterRegion = document.getElementById('filter-region');
const clearFiltersBtn = document.getElementById('clear-filters');

const mapStyleFilter = document.getElementById('map-style-filter'); // NEU
const mapFilterUser = document.getElementById('map-filter-user');
const mapFilterTrip = document.getElementById('map-filter-trip');
const mapFilterYear = document.getElementById('map-filter-year');
const openSidebarBtn = document.getElementById('open-sidebar-btn');

const pinModal = document.getElementById('pin-modal');
const pinForm = document.getElementById('pin-form');
const modalDeletePinBtn = document.getElementById('modal-delete-pin-btn');
const closeModalBtn = document.getElementById('close-modal');

const tripModal = document.getElementById('trip-modal');
const tripForm = document.getElementById('trip-form');

const pinTitleEl = document.getElementById('pin-title');
const pinDateEl = document.getElementById('pin-date');
const pinTimeEl = document.getElementById('pin-time');
const pinUserEl = document.getElementById('pin-user');
const pinTripEl = document.getElementById('pin-tag');
const pinTypeEl = document.getElementById('pin-type');
const pinDescEl = document.getElementById('pin-desc');
const pinImagesEl = document.getElementById('pin-images');

const userDatalist = document.getElementById('user-list');
const tripDatalist = document.getElementById('trip-list-datalist');

// =========================
// GLOBAL DATA
// =========================
let allPinsData = null;
let allFeatures = [];
let tripsMeta = {};
let tripsIndex = new Map();
let currentLatLng = null;

let editPinId = null;
let currentEditTripUser = null;
let currentEditTripName = null;

// =========================
// MAP STYLE TOGGLE
// =========================
if (mapStyleFilter) {
    mapStyleFilter.addEventListener('change', (e) => {
        if (e.target.value === 'satellit') {
            map.removeLayer(osmLayer);
            satelliteLayer.addTo(map);
        } else {
            map.removeLayer(satelliteLayer);
            osmLayer.addTo(map);
        }
    });
}

// =========================
// HELPERS
// =========================
function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeProperties(props) {
  let user = props.user;
  let trip = props.trip;
  if ((!user || !trip) && props.tags) {
    const parts = String(props.tags).split(',').map(s => s.trim());
    if (!user) user = parts[0] || '';
    if (!trip) trip = parts[1] || '';
  }
  const tags = props.tags || (user && trip ? `${user}, ${trip}` : '');
  let datetime = props.datetime;
  if (!datetime && props.date && props.time) {
    datetime = `${props.date}T${props.time}`;
  }
  return {
    user: user || '', trip: trip || '', tags, datetime: datetime || '',
    placeType: props.placeType || '', country: props.country || '', continent: props.continent || ''
  };
}

function tripKey(user, trip) { return `${user}|||${trip}`; }

function getTripColor(user, trip) {
  const key = tripKey(user, trip);
  return (tripsMeta && tripsMeta[key] && tripsMeta[key].color) ? tripsMeta[key].color : '#0078D7';
}

function parseYear(feature) {
  const p = feature.properties || {};
  const norm = normalizeProperties(p);
  const dt = norm.datetime || p.date || '';
  if (!dt) return '';
  const y = new Date(dt).getFullYear();
  return Number.isNaN(y) ? '' : String(y);
}

function openSidebar() { sidebar.classList.add('active'); }
function closeSidebar() { sidebar.classList.remove('active'); }
function toggleSidebar() { sidebar.classList.toggle('active'); }

function fillSelect(selectEl, values, firstLabel) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = ''; opt.textContent = firstLabel; selectEl.appendChild(opt);
  [...values].sort((a, b) => String(a).localeCompare(String(b), 'de-DE'))
    .forEach(v => {
      const o = document.createElement('option'); o.value = String(v); o.textContent = String(v); selectEl.appendChild(o);
    });
}

function fillDatalist(datalistEl, values) {
  if (!datalistEl) return;
  datalistEl.innerHTML = '';
  [...values].sort((a, b) => String(a).localeCompare(String(b), 'de-DE'))
    .forEach(v => {
      const o = document.createElement('option'); o.value = String(v); datalistEl.appendChild(o);
    });
}

// =========================
// BUILD INDEXES
// =========================
function rebuildTripsIndex() {
  tripsIndex = new Map();
  allFeatures.forEach(f => {
    const props = f.properties || {};
    const norm = normalizeProperties(props);
    f.properties = { ...props, ...norm };

    const key = tripKey(f.properties.user, f.properties.trip);
    if (!tripsIndex.has(key)) {
      tripsIndex.set(key, {
        key, user: f.properties.user, trip: f.properties.trip, pins: [],
        color: getTripColor(f.properties.user, f.properties.trip), countries: new Set(), continents: new Set()
      });
    }
    const entry = tripsIndex.get(key);
    entry.pins.push(f);
    if (f.properties.country) entry.countries.add(f.properties.country);
    if (f.properties.continent) entry.continents.add(f.properties.continent);
  });
}

function buildUserTripSuggestions() {
  const users = new Set(); const trips = new Set();
  for (const entry of tripsIndex.values()) {
    if (entry.user) users.add(entry.user);
    if (entry.trip) trips.add(entry.trip);
  }
  fillDatalist(userDatalist, users); fillDatalist(tripDatalist, trips);
}

// =========================
// SIDEBAR
// =========================
function buildSidebarFilters() {
  if (!filterUser || !filterTrip || !filterRegion) return;
  const users = new Set(); const trips = new Set(); const regions = new Set();
  for (const entry of tripsIndex.values()) {
    if (entry.user) users.add(entry.user);
    if (entry.trip) trips.add(entry.trip);
    entry.countries.forEach(c => regions.add(c));
    entry.continents.forEach(c => regions.add(c));
  }
  fillSelect(filterUser, users, 'Alle Nutzer');
  fillSelect(filterTrip, trips, 'Alle Reisen');
  fillSelect(filterRegion, regions, 'Alle Länder / Kontinente');
}

function applySidebarFilters() {
  const u = filterUser ? filterUser.value : '';
  const t = filterTrip ? filterTrip.value : '';
  const r = filterRegion ? filterRegion.value : '';

  const entries = [...tripsIndex.values()].filter(entry => {
    const matchUser = !u || entry.user === u;
    const matchTrip = !t || entry.trip === t;
    const matchRegion = !r || entry.countries.has(r) || entry.continents.has(r);
    return matchUser && matchTrip && matchRegion;
  });
  buildTripList(entries);
}

function buildTripList(entries = [...tripsIndex.values()]) {
  if (!tripListEl) return;
  tripListEl.innerHTML = '';
  entries.sort((a, b) => {
    const u = a.user.localeCompare(b.user, 'de-DE');
    return u !== 0 ? u : a.trip.localeCompare(b.trip, 'de-DE');
  });

  if (entries.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Keine Reisen gefunden.'; li.style.cursor = 'default';
    tripListEl.appendChild(li); return;
  }

  entries.forEach(entry => {
    const li = document.createElement('li');
    li.textContent = `${entry.trip} – ${entry.user}`;
    li.style.borderLeft = `6px solid ${entry.color || '#0078D7'}`;
    li.addEventListener('click', () => openTripTimeline(entry));
    tripListEl.appendChild(li);
  });
}

function openTripTimeline(entry) {
  if (!entry) return;
  openSidebar();

  const pins = [...entry.pins].sort((a, b) => {
    const da = a.properties.datetime || a.properties.date || '';
    const db = b.properties.datetime || b.properties.date || '';
    return new Date(da) - new Date(db);
  });

  let html = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
        <div>
            <h3 style="margin-bottom: 4px; color: #0f172a;">${escapeHtml(entry.trip)}</h3>
            <p style="margin: 0; color: #475569; font-size: 14px;">Reise von <strong>${escapeHtml(entry.user)}</strong></p>
            <div style="display: flex; align-items: center; margin-top: 8px;">
              <span style="display:inline-block; width:16px; height:16px; border-radius:50%; background:${escapeHtml(entry.color)}; margin-right:8px; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></span>
              <span style="font-size: 13px; color: #64748b;">Reise-Farbe</span>
            </div>
        </div>
        <button class="btn-secondary btn-sm" onclick="openTripEditModal('${escapeHtml(entry.user)}', '${escapeHtml(entry.trip)}', '${escapeHtml(entry.color)}')">✏️ Bearbeiten</button>
    </div>
    <div class="timeline">
  `;

  pins.forEach(pin => {
    const p = pin.properties || {};
    const dt = p.datetime || p.date || '';
    const dateObj = dt ? new Date(dt) : null;
    const dateStr = dateObj ? dateObj.toLocaleDateString('de-DE') : '';
    const timeStr = (dateObj && p.datetime) ? dateObj.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : (p.time || '');
    const imgArr = Array.isArray(p.images) ? p.images : [];
    
    // Kategorie (Optional): Wird nur gerendert, wenn eine ausgewählt wurde
    const typeBadge = p.placeType ? `<span style="font-size:12px;background:#e2e8f0;color:#334155;padding:4px 8px;border-radius:6px;">${escapeHtml(p.placeType)}</span>` : '';

    // Bilder (Optional)
    let imagesHtml = '';
    if (imgArr.length > 0) {
      imagesHtml = `<div class="carousel">` + imgArr.map(img => `<img src="${API_BASE}/api/uploads/${encodeURIComponent(img)}" alt="Reisebild">`).join('') + `</div>`;
    }

    // NEU: Beschreibung (Optional): Wird nur gerendert, wenn Text vorhanden ist
    const descHtml = p.description ? `<p class="timeline-desc">${escapeHtml(p.description)}</p>` : '';

    html += `
      <div class="timeline-item">
        <span class="timeline-date">${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</span>
        ${typeBadge}
        <h4 class="timeline-title">
            ${escapeHtml(p.title)} 
            <div style="display:flex; gap: 5px;">
              <button class="btn-primary btn-sm" onclick="editPin('${pin.id}')">✏️ Edit</button>
              <button class="btn-danger btn-sm" onclick="deletePin('${pin.id}')">🗑️</button>
            </div>
        </h4>
        ${descHtml}
        ${imagesHtml}
      </div>
    `;
  });

  html += `</div>`;
  if (sidebarContent) sidebarContent.innerHTML = html;
}

// =========================
// TOPBAR MAP FILTERS
// =========================
function buildMapFilters() {
  if (!mapFilterUser || !mapFilterTrip || !mapFilterYear) return;
  const users = new Set(); const trips = new Set(); const years = new Set();
  allFeatures.forEach(f => {
    const p = f.properties || {};
    const norm = normalizeProperties(p);
    if (norm.user) users.add(norm.user);
    if (norm.trip) trips.add(norm.trip);
    const y = parseYear(f);
    if (y) years.add(y);
  });
  fillSelect(mapFilterUser, users, 'Alle Nutzer');
  fillSelect(mapFilterTrip, trips, 'Alle Reisen');
  fillSelect(mapFilterYear, years, 'Alle Jahre');
}

function getMapFilterPredicate() {
  const u = mapFilterUser ? mapFilterUser.value : '';
  const t = mapFilterTrip ? mapFilterTrip.value : '';
  const y = mapFilterYear ? mapFilterYear.value : '';
  return function (feature) {
    const p = feature.properties || {};
    const norm = normalizeProperties(p);
    const year = parseYear(feature);
    return (!u || norm.user === u) && (!t || norm.trip === t) && (!y || year === y);
  };
}

// =========================
// MARKERS
// =========================
function createTripIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div class="trip-marker" style="background:${color}"></div>`,
    iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -8]
  });
}

function bindPopupToMarker(feature, marker) {
  const props = feature.properties || {};
  const norm = normalizeProperties(props);
  const key = tripKey(norm.user, norm.trip);
  const imgArr = Array.isArray(props.images) ? props.images : [];
  const preview = imgArr.length > 0 ? `<img class="popup-preview" src="${API_BASE}/api/uploads/${encodeURIComponent(imgArr[0])}" alt="Vorschau">` : '';

  const dt = norm.datetime || props.date || '';
  const dateObj = dt ? new Date(dt) : null;
  const dateStr = dateObj ? dateObj.toLocaleDateString('de-DE') : '';
  const timeStr = (dateObj && norm.datetime) ? dateObj.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : (props.time || '');
  const typeLine = norm.placeType ? `<div style="margin:6px 0 0 0; font-size: 13px;"><strong>Typ:</strong> ${escapeHtml(norm.placeType)}</div>` : '';

  const popupContent = `
    ${preview}
    <strong style="font-size: 16px;">${escapeHtml(props.title)}</strong><br/>
    <span style="font-size: 13px; color: #64748b;">${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</span>
    ${typeLine}
    <div style="margin-top:4px;color:#475569; font-size: 13px;">
      <em>${escapeHtml(norm.user)} – ${escapeHtml(norm.trip)}</em>
    </div>
    <div style="display: flex; gap: 6px; margin-top: 10px;">
        <button class="btn-primary btn-sm" style="flex:1;" type="button" onclick="window.openTrip('${encodeURIComponent(key)}')">Details</button>
        <button class="btn-secondary btn-sm" type="button" onclick="editPin('${feature.id}')">✏️</button>
        <button class="btn-danger btn-sm" type="button" onclick="deletePin('${feature.id}')">🗑️</button>
    </div>
  `;
  marker.bindPopup(popupContent, { minWidth: 240 });
}

function redrawClusteredMarkers() {
  if (!allPinsData) return;
  const predicate = getMapFilterPredicate();
  clusterGroup.clearLayers();
  allFeatures.filter(predicate).forEach(f => {
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) return;
    const marker = L.marker([coords[1], coords[0]], { icon: createTripIcon(getTripColor(f.properties.user, f.properties.trip)) });
    bindPopupToMarker(f, marker);
    clusterGroup.addLayer(marker);
  });
}

// =========================
// CRUD LOGIK (PINS)
// =========================
window.editPin = function(id) {
    const pin = allFeatures.find(f => f.id === id);
    if(!pin) return;
    editPinId = id; 
    const props = pin.properties;

    document.getElementById('pin-title').value = props.title || '';
    document.getElementById('pin-date').value = props.date || '';
    document.getElementById('pin-time').value = props.time || '';
    document.getElementById('pin-user').value = props.user || '';
    document.getElementById('pin-tag').value = props.trip || '';
    document.getElementById('pin-type').value = props.placeType || '';
    document.getElementById('pin-desc').value = props.description || '';
    
    modalDeletePinBtn.classList.remove('hidden'); 
    pinModal.classList.remove('hidden');
};

window.deletePin = async function(id) {
    if(!confirm("Bist du sicher, dass du diesen Pin unwiderruflich löschen möchtest?")) return;
    try {
        const res = await fetch(`${API_BASE}/api/pins/${id}`, { method: 'DELETE' });
        if(res.ok) {
            closePinModal();
            loadPins();
        } else alert("Fehler beim Löschen!");
    } catch (e) { console.error(e); }
};

if (modalDeletePinBtn) {
    modalDeletePinBtn.addEventListener('click', () => {
        if(editPinId) deletePin(editPinId);
    });
}

// =========================
// CRUD LOGIK (TRIPS MODAL)
// =========================
window.openTripEditModal = function(user, trip, color) {
    currentEditTripUser = user;
    currentEditTripName = trip;
    document.getElementById('trip-modal-user').textContent = `Reise von: ${user}`;
    document.getElementById('trip-edit-title').value = trip;
    document.getElementById('trip-edit-color').value = color;
    tripModal.classList.remove('hidden');
};

document.getElementById('close-trip-modal').addEventListener('click', () => {
    tripModal.classList.add('hidden');
});

if (tripForm) {
    tripForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newTrip = document.getElementById('trip-edit-title').value.trim();
        const newColor = document.getElementById('trip-edit-color').value;

        try {
            const res = await fetch(`${API_BASE}/api/trips`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    old_user: currentEditTripUser, old_trip: currentEditTripName,
                    new_user: currentEditTripUser, new_trip: newTrip, color: newColor
                })
            });
            if(res.ok) {
                tripModal.classList.add('hidden');
                await loadPins();
                const updatedEntry = tripsIndex.get(tripKey(currentEditTripUser, newTrip));
                if(updatedEntry) openTripTimeline(updatedEntry);
            }
        } catch (e) { console.error(e); }
    });
}

document.getElementById('delete-trip-btn').addEventListener('click', async () => {
    if(!confirm(`Bist du GANZ SICHER, dass du alle Pins und Bilder der Reise "${currentEditTripName}" löschen möchtest?`)) return;
    try {
        const res = await fetch(`${API_BASE}/api/trips`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: currentEditTripUser, trip: currentEditTripName })
        });
        if(res.ok) {
            tripModal.classList.add('hidden');
            if (sidebarContent) sidebarContent.innerHTML = '';
            loadPins();
        }
    } catch (e) { console.error(e); }
});

// =========================
// MODAL / PIN CREATION
// =========================
function openPinModal() {
  if (!pinModal) return;
  pinModal.classList.remove('hidden');
  const dEl = document.getElementById('pin-date');
  const tEl = document.getElementById('pin-time');
  if (dEl) dEl.max = new Date().toISOString().split('T')[0];
  if (tEl && !tEl.value) {
    const now = new Date();
    tEl.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }
}

function closePinModal() {
  if (!pinModal) return;
  pinModal.classList.add('hidden');
}

map.on('click', function (e) {
  editPinId = null; 
  currentLatLng = e.latlng;
  pinForm.reset();
  modalDeletePinBtn.classList.add('hidden'); 
  openPinModal();
});

if (document.getElementById('close-modal')) document.getElementById('close-modal').addEventListener('click', closePinModal);

if (pinForm) {
  pinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editPinId && !currentLatLng) return alert('Bitte zuerst auf die Karte klicken.');

    const formData = new FormData();
    formData.append('title', document.getElementById('pin-title').value);
    formData.append('date', document.getElementById('pin-date').value);
    formData.append('time', document.getElementById('pin-time').value);
    formData.append('description', document.getElementById('pin-desc').value);
    formData.append('user', document.getElementById('pin-user').value.trim());
    formData.append('trip', document.getElementById('pin-tag').value.trim());
    formData.append('placeType', document.getElementById('pin-type').value);
    
    const imageFiles = document.getElementById('pin-images').files;
    for (let i = 0; i < imageFiles.length; i++) formData.append('images', imageFiles[i]);

    if (!editPinId) {
        formData.append('lat', currentLatLng.lat);
        formData.append('lng', currentLatLng.lng);
    }

    try {
      const url = editPinId ? `${API_BASE}/api/pins/${editPinId}` : `${API_BASE}/api/pins`;
      const method = editPinId ? 'PUT' : 'POST';
      const response = await fetch(url, { method: method, body: formData });

      if (response.ok) {
        closePinModal();
        pinForm.reset();
        await loadPins();
      } else alert('Fehler beim Speichern.');
    } catch (err) { console.error(err); alert('Backend nicht erreichbar.'); }
  });
}

// =========================
// UI WIRING & FILTERS
// =========================
if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);
if (openSidebarBtn) openSidebarBtn.addEventListener('click', toggleSidebar);

if (clearFiltersBtn) {
  clearFiltersBtn.addEventListener('click', () => {
    if (filterUser) filterUser.value = '';
    if (filterTrip) filterTrip.value = '';
    if (filterRegion) filterRegion.value = '';
    if (sidebarContent) sidebarContent.innerHTML = ''; 
    applySidebarFilters();
  });
}
if (filterUser) filterUser.addEventListener('change', applySidebarFilters);
if (filterTrip) filterTrip.addEventListener('change', applySidebarFilters);
if (filterRegion) filterRegion.addEventListener('change', applySidebarFilters);

function wireMapFilterListeners() {
  if (mapFilterUser) mapFilterUser.addEventListener('change', redrawClusteredMarkers);
  if (mapFilterTrip) mapFilterTrip.addEventListener('change', redrawClusteredMarkers);
  if (mapFilterYear) mapFilterYear.addEventListener('change', redrawClusteredMarkers);
}

// =========================
// LOAD PINS
// =========================
async function loadPins() {
  try {
    const response = await fetch(`${API_BASE}/api/pins`);
    allPinsData = await response.json();
    allFeatures = Array.isArray(allPinsData.features) ? allPinsData.features : [];
    tripsMeta = (allPinsData.trips && typeof allPinsData.trips === 'object') ? allPinsData.trips : {};

    rebuildTripsIndex();
    buildUserTripSuggestions();
    
    buildSidebarFilters();
    applySidebarFilters();

    buildMapFilters();
    wireMapFilterListeners();
    redrawClusteredMarkers();
  } catch (error) { console.error('Fehler beim Laden:', error); }
}

loadPins();