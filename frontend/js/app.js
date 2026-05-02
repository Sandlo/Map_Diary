// ==========================================
// 1. KARTEN-SETUP & LAYER (KArte vs. Satellit)
// ==========================================
const map = L.map('map').setView([50.0, 10.0], 4);

// OSM Karte (Deutsch)
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
}).addTo(map);

// Esri Satelliten-Karte
const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: '© Esri'
});

// Layer-Control oben rechts hinzufügen
L.control.layers({
    "Karte": osmLayer,
    "Satellit": satelliteLayer
}).addTo(map);

// Cluster-Gruppe initialisieren
const markersCluster = L.markerClusterGroup();
map.addLayer(markersCluster);


// ==========================================
// 2. GLOBALE STATE-VARIABLEN
// ==========================================
let allPinsData = { features: [] };
let editPinId = null; // Speichert die ID, falls wir bearbeiten statt neu erstellen


// ==========================================
// 3. UI REFERENZEN
// ==========================================
const sidebar = document.getElementById('sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar');
const sidebarContent = document.getElementById('sidebar-content');

const filterUser = document.getElementById('filter-user');
const filterTrip = document.getElementById('filter-trip');
const sidebarSearch = document.getElementById('sidebar-trip-search');

const pinModal = document.getElementById('pin-modal');
const pinForm = document.getElementById('pin-form');


// ==========================================
// 4. HILFSFUNKTIONEN
// ==========================================

// Buntes Icon generieren (L.divIcon)
function createCustomIcon(color, emoji) {
    // Emoji aus dem Text extrahieren (z.B. "🍽️" aus "🍽️ Restaurant")
    const justEmoji = emoji.substring(0, 2); 
    
    return L.divIcon({
        className: 'custom-pin-wrapper', // Verhindert den weißen Standard-Hintergrund
        html: `<div class="custom-pin" style="background-color: ${color}; width: 34px; height: 34px;">${justEmoji}</div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 38],
        popupAnchor: [0, -38]
    });
}

// Dropdowns und Datalists mit existierenden Usern/Trips füllen
function updateDropdowns() {
    const users = new Set();
    const trips = new Set();

    allPinsData.features.forEach(pin => {
        const parts = pin.properties.tags.split(',').map(s => s.trim());
        if (parts.length >= 2) {
            users.add(parts[0]);
            trips.add(parts[1]);
        }
    });

    // 1. Die Filter im Header und in der Sidebar befüllen
    filterUser.innerHTML = '<option value="">Alle Nutzer</option>' + Array.from(users).map(u => `<option value="${u}">${u}</option>`).join('');
    filterTrip.innerHTML = '<option value="">Alle Reisen</option>' + Array.from(trips).map(t => `<option value="${t}">${t}</option>`).join('');
    sidebarSearch.innerHTML = '<option value="">Reise auswählen...</option>' + Array.from(trips).map(t => `<option value="${t}">${t}</option>`).join('');

    // 2. Die Auto-Vervollständigung (Datalist) für das neue Pin-Formular befüllen
    const userList = document.getElementById('user-list');
    const tripList = document.getElementById('trip-list');
    
    if (userList) {
        userList.innerHTML = Array.from(users).map(u => `<option value="${u}">`).join('');
    }
    if (tripList) {
        tripList.innerHTML = Array.from(trips).map(t => `<option value="${t}">`).join('');
    }
}


// ==========================================
// 5. RENDERING LOGIK (KARTE & SIDEBAR)
// ==========================================

// Karte filtern und zeichnen
function renderMap() {
    markersCluster.clearLayers(); // Alte Pins löschen

    const selectedUser = filterUser.value;
    const selectedTrip = filterTrip.value;

    allPinsData.features.forEach(pin => {
        const props = pin.properties;
        const [u, t] = props.tags.split(',').map(s => s.trim());

        // Filter prüfen
        if (selectedUser && u !== selectedUser) return;
        if (selectedTrip && t !== selectedTrip) return;

        // Karussell bauen
        let imagesHtml = '<div class="carousel" style="margin-bottom: 8px;">';
        props.images.forEach(img => {
            imagesHtml += `<img src="http://localhost:5000/api/uploads/${img}" alt="Vorschau" style="max-height: 150px;">`;
        });
        imagesHtml += '</div>';

        const popupContent = `
            <div style="text-align: center;">
                ${imagesHtml}
                <h4 style="margin: 0 0 5px 0;">${props.title}</h4>
                <p style="margin: 0 0 8px 0; font-size: 11px; color: #666;">${new Date(props.date).toLocaleDateString('de-DE')} | Tags: ${props.tags}</p>
                <button onclick="openSidebar('${props.tags}')" class="btn-sm btn-primary" style="width: 100%; margin-bottom: 5px;">Reise anzeigen</button>
                <div class="action-buttons">
                    <button onclick="editPin('${pin.id}')" class="btn-sm" style="background:#f0ad4e;">Bearbeiten</button>
                    <button onclick="deletePin('${pin.id}')" class="btn-sm btn-danger">Löschen</button>
                </div>
            </div>
        `;

        const marker = L.marker([pin.geometry.coordinates[1], pin.geometry.coordinates[0]], {
            icon: createCustomIcon(props.color, props.category)
        });
        
        marker.bindPopup(popupContent, { minWidth: 220 });
        markersCluster.addLayer(marker);
    });
}

// Sidebar chronologisch befüllen
window.openSidebar = function(targetTags) {
    sidebar.classList.add('active');
    
    // Nach Dropdown (falls genutzt) oder nach Button-Übergabe filtern
    const filterTag = targetTags || `${filterUser.value}, ${sidebarSearch.value}`;

    let tripPins = allPinsData.features.filter(f => f.properties.tags.includes(filterTag.split(',')[1]?.trim() || filterTag));
    
    if (tripPins.length === 0) {
        sidebarContent.innerHTML = "<p>Keine Pins gefunden.</p>";
        return;
    }

    tripPins.sort((a, b) => new Date(a.properties.date) - new Date(b.properties.date));

    const [user, tripName] = tripPins[0].properties.tags.split(',').map(s => s.trim());
    let html = `<h2>${tripName}</h2><p style="color: gray;">Reise von ${user}</p><div class="timeline">`;

    tripPins.forEach(pin => {
        const props = pin.properties;
        let imagesHtml = '<div class="carousel">';
        props.images.forEach(img => {
            imagesHtml += `<img src="http://localhost:5000/api/uploads/${img}">`;
        });
        imagesHtml += '</div>';

        html += `
            <div class="timeline-item">
                <span class="timeline-date">${new Date(props.date).toLocaleDateString('de-DE')}</span>
                <h3 class="timeline-title">${props.title} <span style="font-size:12px;">${props.category}</span></h3>
                <p class="timeline-desc">${props.description}</p>
                ${imagesHtml}
                <div class="action-buttons" style="margin-top:10px;">
                    <button onclick="editPin('${pin.id}')" class="btn-sm" style="background:#f0ad4e;">Bearbeiten</button>
                    <button onclick="deletePin('${pin.id}')" class="btn-sm btn-danger">Löschen</button>
                </div>
            </div>
        `;
    });
    html += '</div>';
    sidebarContent.innerHTML = html;
};


// ==========================================
// 6. EVENT LISTENER FÜR FILTER
// ==========================================
filterUser.addEventListener('change', renderMap);
filterTrip.addEventListener('change', renderMap);
sidebarSearch.addEventListener('change', (e) => {
    if (e.target.value !== "") openSidebar(null);
});
document.getElementById('open-sidebar-btn').addEventListener('click', () => {
    sidebar.classList.add('active');
});
closeSidebarBtn.addEventListener('click', () => {
    sidebar.classList.remove('active');
});


// ==========================================
// 7. CRUD-OPERATIONEN (Load, Save, Edit, Delete)
// ==========================================

async function loadPins() {
    try {
        const response = await fetch('http://localhost:5000/api/pins');
        allPinsData = await response.json();
        updateDropdowns();
        renderMap();
    } catch (error) {
        console.error("Fehler beim Laden:", error);
    }
}

// Löschen (DELETE)
window.deletePin = async function(id) {
    if(!confirm("Bist du sicher, dass du diesen Pin unwiderruflich löschen möchtest?")) return;
    try {
        const res = await fetch(`http://localhost:5000/api/pins/${id}`, { method: 'DELETE' });
        if(res.ok) loadPins();
        else alert("Fehler beim Löschen!");
    } catch (e) { console.error(e); }
};

// Bearbeiten (Werte ins Formular laden)
window.editPin = function(id) {
    const pin = allPinsData.features.find(f => f.id === id);
    if(!pin) return;
    
    editPinId = id; // Status auf Edit setzen
    const props = pin.properties;
    const [u, t] = props.tags.split(',').map(s => s.trim());

    document.getElementById('pin-title').value = props.title;
    document.getElementById('pin-date').value = props.date;
    document.getElementById('pin-user').value = u;
    document.getElementById('pin-tag').value = t;
    document.getElementById('pin-color').value = props.color || '#0078D7';
    document.getElementById('pin-category').value = props.category || '📍';
    document.getElementById('pin-desc').value = props.description;
    
    // Bild-Upload im Edit-Modus optional machen (erfordert Frontend-Hack für Simplizität)
    document.getElementById('pin-images').removeAttribute('required'); 
    
    pinModal.classList.remove('hidden');
};


// Neuen Pin anlegen (oder bearbeiten)
let currentLatLng = null; 
map.on('click', function(e) {
    editPinId = null; // Wir erstellen einen NEUEN Pin
    currentLatLng = e.latlng;
    pinForm.reset();
    document.getElementById('pin-images').setAttribute('required', 'true');
    pinModal.classList.remove('hidden');
});

document.getElementById('close-modal').addEventListener('click', () => {
    pinModal.classList.add('hidden');
});

pinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('title', document.getElementById('pin-title').value);
    formData.append('date', document.getElementById('pin-date').value);
    formData.append('description', document.getElementById('pin-desc').value);
    formData.append('color', document.getElementById('pin-color').value);
    formData.append('category', document.getElementById('pin-category').value);
    
    const user = document.getElementById('pin-user').value;
    const tripTag = document.getElementById('pin-tag').value;
    formData.append('tags', `${user}, ${tripTag}`); 
    
    if(!editPinId) {
        // Nur beim NEUEN Pin schicken wir Koordinaten und erzwingen Bilder
        formData.append('lat', currentLatLng.lat);
        formData.append('lng', currentLatLng.lng);
        const imageFiles = document.getElementById('pin-images').files;
        for(let i = 0; i < imageFiles.length; i++) formData.append('images', imageFiles[i]);
    }

    try {
        const url = editPinId ? `http://localhost:5000/api/pins/${editPinId}` : 'http://localhost:5000/api/pins';
        const method = editPinId ? 'PUT' : 'POST';

        const response = await fetch(url, { method: method, body: formData });

        if (response.ok) {
            pinModal.classList.add('hidden');
            pinForm.reset();
            loadPins(); // Alles neu laden und rendern
        } else {
            alert('Server-Fehler beim Speichern.');
        }
    } catch (error) {
        console.error(error);
    }
});

// INITIALER START
loadPins();