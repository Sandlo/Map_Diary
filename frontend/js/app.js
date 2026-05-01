// 1. Karte initialisieren (Startpunkt: ca. Mitteleuropa, Zoom-Level 4)[cite: 11]
const map = L.map('map').setView([50.0, 10.0], 4);

// 2. Basiskarte (Tiles) von OpenStreetMap laden und zur Map hinzufügen[cite: 11]
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

// 3. UI-Referenzen für die Sidebar holen
const sidebar = document.getElementById('sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar');

// 4. Funktion zum Schließen der Sidebar
closeSidebarBtn.addEventListener('click', () => {
    sidebar.classList.remove('active');
});

// Test-Funktion: Öffne die Konsole im Browser und tippe 'testSidebar()' ein, um die Animation zu prüfen.
function testSidebar() {
    sidebar.classList.add('active');
}