const map = L.map('map').setView([50.0, 10.0], 4);
L.tileLayer('https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

const sidebar = document.getElementById('sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar');
const sidebarContent = document.getElementById('sidebar-content');

closeSidebarBtn.addEventListener('click', () => {
    sidebar.classList.remove('active');
});

// --- GLOBALE DATEN & SIDEBAR LOGIK ---
let allPinsData = null; // Speichert alle abgerufenen Daten für die Filterung

window.openSidebar = function(targetTags) {
    sidebar.classList.add('active');
    
    // 1. Daten filtern (nur Pins dieses Trips)
    const tripPins = allPinsData.features.filter(f => f.properties.tags === targetTags);
    
    // 2. Daten chronologisch sortieren (älteste zuerst)
    tripPins.sort((a, b) => new Date(a.properties.date) - new Date(b.properties.date));

    // 3. HTML für die Sidebar bauen
    const [user, tripName] = targetTags.split(',').map(s => s.trim());
    let html = `<h2>${tripName}</h2><p style="color: gray;">Reise von ${user}</p><div class="timeline">`;

    tripPins.forEach(pin => {
        const props = pin.properties;
        
        // Karussell-HTML für mehrere Bilder bauen
        let imagesHtml = '<div class="carousel">';
        props.images.forEach(img => {
            imagesHtml += `<img src="http://localhost:5000/api/uploads/${img}" alt="Reisebild">`;
        });
        imagesHtml += '</div>';

        // Timeline-Eintrag hinzufügen
        html += `
            <div class="timeline-item">
                <span class="timeline-date">${new Date(props.date).toLocaleDateString('de-DE')}</span>
                <h3 class="timeline-title">${props.title}</h3>
                <p class="timeline-desc">${props.description}</p>
                ${imagesHtml}
            </div>
        `;
    });

    html += '</div>';
    sidebarContent.innerHTML = html;
};


// --- NEUEN PIN ANLEGEN ---
const pinModal = document.getElementById('pin-modal');
const closeModalBtn = document.getElementById('close-modal');
const pinForm = document.getElementById('pin-form');
let currentLatLng = null; 

map.on('click', function(e) {
    currentLatLng = e.latlng;
    pinModal.classList.remove('hidden');
});

closeModalBtn.addEventListener('click', () => {
    pinModal.classList.add('hidden');
});

pinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('title', document.getElementById('pin-title').value);
    formData.append('date', document.getElementById('pin-date').value);
    formData.append('description', document.getElementById('pin-desc').value);
    
    const user = document.getElementById('pin-user').value;
    const tripTag = document.getElementById('pin-tag').value;
    formData.append('tags', `${user}, ${tripTag}`); 
    
    // ALLE ausgewählten Dateien in das FormData packen
    const imageFiles = document.getElementById('pin-images').files;
    for(let i = 0; i < imageFiles.length; i++) {
        formData.append('images', imageFiles[i]);
    }
    
    formData.append('lat', currentLatLng.lat);
    formData.append('lng', currentLatLng.lng);

    try {
        const response = await fetch('http://localhost:5000/api/pins', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            alert('Pin erfolgreich gespeichert!');
            pinModal.classList.add('hidden');
            pinForm.reset();
            loadPins(); 
        } else {
            alert('Fehler beim Speichern im Backend.');
        }
    } catch (error) {
        console.error("Backend-Fehler:", error);
    }
});


// --- PINS LADEN UND AUF KARTE ZEICHNEN ---
let geoJsonLayer = null;

async function loadPins() {
    try {
        const response = await fetch('http://localhost:5000/api/pins');
        allPinsData = await response.json(); // Global speichern für die Sidebar

        if (geoJsonLayer) map.removeLayer(geoJsonLayer);

        geoJsonLayer = L.geoJSON(allPinsData, {
            onEachFeature: function (feature, layer) {
                const props = feature.properties;
                
                // Karussell auch für das Map-Popup bauen
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
                        <button onclick="openSidebar('${props.tags}')" style="width: 100%; padding: 6px; background: #0078D7; color: white; border: none; border-radius: 3px; cursor: pointer;">
                            Reise anzeigen
                        </button>
                    </div>
                `;
                layer.bindPopup(popupContent, { minWidth: 220 });
            }
        }).addTo(map);

    } catch (error) {
        console.error("Fehler beim Laden der Pins:", error);
    }
}

loadPins();