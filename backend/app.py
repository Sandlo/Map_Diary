import os
import json
import uuid
import urllib.request
import urllib.parse
import random

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIARY_FILE = os.path.join(BASE_DIR, 'diary.json')
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config['MAX_CONTENT_LENGTH'] = 12 * 1024 * 1024  # 12MB
ALLOWED_EXT = {'jpg', 'jpeg', 'png', 'webp', 'gif'}
GEOCODE_CACHE = {}

# ==========================================
# HILFSFUNKTIONEN
# ==========================================

def get_unique_color(existing_colors):
    """Gibt eine Farbe zurück, die noch nicht in den existing_colors vorhanden ist."""
    colors_palette = [
        "#0078D7", "#FF5733", "#33FF57", "#F333FF", "#FF33A8", "#33FFF3", 
        "#F3FF33", "#FF8C33", "#8C33FF", "#33FF8C", "#D70000", "#00D778",
        "#7800D7", "#D77800", "#0055A4", "#A40055", "#55A400", "#FF4500"
    ]
    existing_lower = [c.lower() for c in existing_colors]
    for c in colors_palette:
        if c.lower() not in existing_lower:
            return c
    # Fallback, falls alle Palettenfarben verbraucht sind: Zufalls-Hex
    return f"#{random.randint(0, 0xFFFFFF):06x}"

def enforce_uniqueness(diary, user, trip):
    """Prüft ob Nutzer/Reise schon existieren (case-insensitive) und gibt die existierende Schreibweise zurück."""
    existing_users = {}
    existing_trips = {}
    
    for f in diary.get("features", []):
        u = f["properties"].get("user", "")
        t = f["properties"].get("trip", "")
        if u: existing_users[u.lower()] = u
        if t: existing_trips[t.lower()] = t
        
    final_user = existing_users.get(user.lower(), user)
    final_trip = existing_trips.get(trip.lower(), trip)
    
    return final_user, final_trip

def ensure_diary_structure(data):
    if not isinstance(data, dict):
        data = {}
    if data.get("type") != "FeatureCollection":
        data["type"] = "FeatureCollection"
    if "features" not in data or not isinstance(data["features"], list):
        data["features"] = []
    if "trips" not in data or not isinstance(data["trips"], dict):
        data["trips"] = {}
        
    # MIGRATION: Sicherstellen, dass jeder bestehende Pin eine ID hat
    for f in data["features"]:
        if "id" not in f:
            f["id"] = uuid.uuid4().hex
            
    return data

def load_diary():
    if not os.path.exists(DIARY_FILE):
        return ensure_diary_structure({"type": "FeatureCollection", "features": [], "trips": {}})
    try:
        with open(DIARY_FILE, 'r', encoding='utf-8') as f:
            content = f.read().strip()
            if not content:
                return ensure_diary_structure({"type": "FeatureCollection", "features": [], "trips": {}})
            data = json.loads(content)
            return ensure_diary_structure(data)
    except Exception as e:
        print("⚠️ diary.json beschädigt, wird neu initialisiert:", e)
        return ensure_diary_structure({"type": "FeatureCollection", "features": [], "trips": {}})

def save_diary(data):
    data = ensure_diary_structure(data)
    with open(DIARY_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

def reverse_geocode(lat, lng):
    key = f"{round(lat, 5)}|{round(lng, 5)}"
    if key in GEOCODE_CACHE:
        return GEOCODE_CACHE[key]
    base_url = "https://nominatim.openstreetmap.org/reverse"
    params = {"lat": lat, "lon": lng, "format": "json", "addressdetails": 1, "zoom": 3, "accept-language": "de"}
    url = base_url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "TravelMapDiary-UniProjekt/1.0", "Accept-Language": "de"})
    try:
        with urllib.request.urlopen(req, timeout=6) as response:
            data = json.loads(response.read().decode("utf-8"))
            address = data.get("address", {})
            country = address.get("country", "") or ""
            continent = address.get("continent", "") or ""
            if not continent and country:
                fallback = {
                    "Deutschland": "Europa", "Frankreich": "Europa", "Italien": "Europa", "Spanien": "Europa",
                    "Japan": "Asien", "Südkorea": "Asien", "China": "Asien", "USA": "Nordamerika",
                    "Vereinigte Staaten": "Nordamerika", "Kanada": "Nordamerika", "Brasilien": "Südamerika",
                    "Australien": "Ozeanien", "Südafrika": "Afrika"
                }
                continent = fallback.get(country, "")
            GEOCODE_CACHE[key] = (country, continent)
            return country, continent
    except Exception as e:
        print("Reverse-Geocoding-Fehler:", e)
        return "", ""

# ==========================================
# API ROUTEN
# ==========================================

@app.route('/api/pins', methods=['GET'])
def get_pins():
    return jsonify(load_diary())

@app.route('/api/pins', methods=['POST'])
def add_pin():
    diary = load_diary()

    user = request.form.get('user', '').strip()
    trip = request.form.get('trip', '').strip()
    
    # 1. Einzigartigkeit erzwingen (z.B. "peter" -> "Peter")
    user, trip = enforce_uniqueness(diary, user, trip)

    # 2. Reise-Farbe zuweisen oder generieren
    tkey = f"{user}|||{trip}"
    if tkey not in diary["trips"]:
        existing_colors = [t.get("color") for t in diary["trips"].values() if t.get("color")]
        diary["trips"][tkey] = {"color": get_unique_color(existing_colors)}

    title = request.form.get('title', '')
    date = request.form.get('date', '')
    time_ = request.form.get('time', '')
    datetime_ = request.form.get('datetime', '') if request.form.get('datetime') else f"{date}T{time_}"
    description = request.form.get('description', '')
    place_type = request.form.get('placeType', '')
    lat = float(request.form.get('lat'))
    lng = float(request.form.get('lng'))

    country, continent = reverse_geocode(lat, lng)

    image_files = request.files.getlist('images')
    filenames = []
    for img in image_files:
        if img and img.filename and '.' in img.filename:
            ext = img.filename.rsplit('.', 1)[-1].lower()
            if ext in ALLOWED_EXT:
                fname = f"{uuid.uuid4().hex}.{ext}"
                img.save(os.path.join(UPLOAD_FOLDER, fname))
                filenames.append(fname)

    new_feature = {
        "id": uuid.uuid4().hex, # NEU: Eindeutige ID
        "type": "Feature",
        "properties": {
            "title": title,
            "date": date,
            "time": time_,
            "datetime": datetime_,
            "description": description,
            "user": user,
            "trip": trip,
            "tags": f"{user}, {trip}",
            "placeType": place_type,
            "country": country,
            "continent": continent,
            "images": filenames
        },
        "geometry": {
            "type": "Point",
            "coordinates": [lng, lat]
        }
    }

    diary["features"].append(new_feature)
    save_diary(diary)
    return jsonify({"status": "success"}), 201


@app.route('/api/pins/<pin_id>', methods=['PUT'])
def update_pin(pin_id):
    """Aktualisiert einen bestehenden Pin."""
    diary = load_diary()
    pin = next((f for f in diary["features"] if f.get("id") == pin_id), None)
    
    if not pin:
        return jsonify({"error": "Pin nicht gefunden"}), 404

    # Texte aktualisieren
    user = request.form.get('user', pin["properties"].get("user")).strip()
    trip = request.form.get('trip', pin["properties"].get("trip")).strip()
    user, trip = enforce_uniqueness(diary, user, trip)

    # Falls der Pin einer GANZ NEUEN Reise zugewiesen wurde -> Farbe generieren
    tkey = f"{user}|||{trip}"
    if tkey not in diary["trips"]:
        existing_colors = [t.get("color") for t in diary["trips"].values() if t.get("color")]
        diary["trips"][tkey] = {"color": get_unique_color(existing_colors)}

    pin["properties"]["title"] = request.form.get('title', pin["properties"].get("title"))
    pin["properties"]["date"] = request.form.get('date', pin["properties"].get("date"))
    pin["properties"]["time"] = request.form.get('time', pin["properties"].get("time"))
    
    date = pin["properties"]["date"]
    time_ = pin["properties"]["time"]
    pin["properties"]["datetime"] = request.form.get('datetime', f"{date}T{time_}")
    
    pin["properties"]["description"] = request.form.get('description', pin["properties"].get("description"))
    pin["properties"]["placeType"] = request.form.get('placeType', pin["properties"].get("placeType"))
    pin["properties"]["user"] = user
    pin["properties"]["trip"] = trip
    pin["properties"]["tags"] = f"{user}, {trip}"

    # Neue Bilder hinzufügen (alte bleiben bestehen)
    image_files = request.files.getlist('images')
    for img in image_files:
        if img and img.filename and '.' in img.filename:
            ext = img.filename.rsplit('.', 1)[-1].lower()
            if ext in ALLOWED_EXT:
                fname = f"{uuid.uuid4().hex}.{ext}"
                img.save(os.path.join(UPLOAD_FOLDER, fname))
                pin["properties"].setdefault("images", []).append(fname)

    save_diary(diary)
    return jsonify({"status": "success"}), 200


@app.route('/api/pins/<pin_id>', methods=['DELETE'])
def delete_pin(pin_id):
    """Löscht einen Pin und dessen Bilder."""
    diary = load_diary()
    pin = next((f for f in diary["features"] if f.get("id") == pin_id), None)
    
    if not pin:
        return jsonify({"error": "Pin nicht gefunden"}), 404
        
    for img in pin["properties"].get("images", []):
        img_path = os.path.join(UPLOAD_FOLDER, img)
        if os.path.exists(img_path):
            os.remove(img_path)
            
    diary["features"] = [f for f in diary["features"] if f.get("id") != pin_id]
    save_diary(diary)
    return jsonify({"status": "success"}), 200


@app.route('/api/trips', methods=['PUT'])
def update_trip():
    """Ganze Reise umbenennen oder Farbe ändern."""
    data = request.json
    diary = load_diary()
    
    old_key = f"{data['old_user']}|||{data['old_trip']}"
    new_user, new_trip = enforce_uniqueness(diary, data['new_user'].strip(), data['new_trip'].strip())
    new_key = f"{new_user}|||{new_trip}"
    
    # 1. Pins aktualisieren
    for f in diary["features"]:
        p = f["properties"]
        if p.get("user") == data['old_user'] and p.get("trip") == data['old_trip']:
            p["user"] = new_user
            p["trip"] = new_trip
            p["tags"] = f"{new_user}, {new_trip}"
            
    # 2. Meta-Daten aktualisieren
    color = data.get("color", "#0078D7")
    if old_key in diary["trips"] and old_key != new_key:
        del diary["trips"][old_key]
    diary["trips"][new_key] = {"color": color}
    
    save_diary(diary)
    return jsonify({"status": "success"})


@app.route('/api/trips', methods=['DELETE'])
def delete_trip():
    """Löscht eine gesamte Reise inkl. aller Pins und Bilder."""
    data = request.json
    user = data.get("user")
    trip = data.get("trip")
    diary = load_diary()
    
    pins_to_keep = []
    for f in diary["features"]:
        p = f["properties"]
        if p.get("user") == user and p.get("trip") == trip:
            # Bilder löschen
            for img in p.get("images", []):
                img_path = os.path.join(UPLOAD_FOLDER, img)
                if os.path.exists(img_path):
                    os.remove(img_path)
        else:
            pins_to_keep.append(f)
            
    diary["features"] = pins_to_keep
    
    tkey = f"{user}|||{trip}"
    if tkey in diary["trips"]:
        del diary["trips"][tkey]
        
    save_diary(diary)
    return jsonify({"status": "success"})


@app.route('/api/uploads/<filename>', methods=['GET'])
def get_image(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == '__main__':
    app.run(debug=True, port=5000)