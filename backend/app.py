import os
import json
import uuid
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app) 

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIARY_FILE = os.path.join(BASE_DIR, 'diary.json')
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
if not os.path.exists(DIARY_FILE):
    with open(DIARY_FILE, 'w', encoding='utf-8') as f:
        json.dump({"type": "FeatureCollection", "features": []}, f)

def load_diary():
    with open(DIARY_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_diary(data):
    with open(DIARY_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

# --- API ENDPUNKTE ---

@app.route('/api/pins', methods=['GET'])
def get_pins():
    """Liefert alle Pins zurück."""
    return jsonify(load_diary())

@app.route('/api/pins', methods=['POST'])
def add_pin():
    """Erstellt einen neuen Pin mit generierter ID."""
    diary = load_diary()

    title = request.form.get('title')
    tags = request.form.get('tags')
    date = request.form.get('date')
    description = request.form.get('description')
    
    # NEU: Farbe und Kategorie entgegennehmen (mit Fallbacks)
    color = request.form.get('color', '#0078D7') 
    category = request.form.get('category', 'Standard')
    
    lat = float(request.form.get('lat'))
    lng = float(request.form.get('lng'))

    image_files = request.files.getlist('images')
    filenames = []
    for img in image_files:
        if img and img.filename:
            ext = img.filename.split('.')[-1]
            fname = f"{uuid.uuid4().hex}.{ext}"
            img.save(os.path.join(UPLOAD_FOLDER, fname))
            filenames.append(fname)

    new_feature = {
        "id": uuid.uuid4().hex, # NEU: Eindeutige ID auf GeoJSON-Top-Level
        "type": "Feature",
        "properties": {
            "title": title,
            "tags": tags,
            "date": date,
            "description": description,
            "color": color,       # NEU
            "category": category, # NEU
            "images": filenames
        },
        "geometry": {
            "type": "Point",
            "coordinates": [lng, lat] 
        }
    }

    diary['features'].append(new_feature)
    save_diary(diary)

    return jsonify({"status": "success", "id": new_feature["id"]}), 201


@app.route('/api/pins/<pin_id>', methods=['DELETE'])
def delete_pin(pin_id):
    """Sucht einen Pin per ID, löscht die Bilder physisch und entfernt den Eintrag."""
    diary = load_diary()
    features = diary.get('features', [])
    pin_to_delete = None

    # 1. Pin finden
    for f in features:
        if f.get('id') == pin_id:
            pin_to_delete = f
            break

    if not pin_to_delete:
        return jsonify({"error": "Pin nicht gefunden"}), 404

    # 2. Zugehörige Bilder physisch von der Festplatte löschen
    for img in pin_to_delete['properties'].get('images', []):
        img_path = os.path.join(UPLOAD_FOLDER, img)
        if os.path.exists(img_path):
            os.remove(img_path)

    # 3. Pin aus der Liste werfen und speichern
    diary['features'] = [f for f in features if f.get('id') != pin_id]
    save_diary(diary)

    return jsonify({"status": "success"}), 200


@app.route('/api/pins/<pin_id>', methods=['PUT'])
def update_pin(pin_id):
    """Aktualisiert die Text- und Metadaten eines bestehenden Pins."""
    diary = load_diary()
    features = diary.get('features', [])
    
    for f in features:
        if f.get('id') == pin_id:
            # Überschreibe alte Werte mit neuen, falls diese mitgeschickt wurden
            f['properties']['title'] = request.form.get('title', f['properties']['title'])
            f['properties']['tags'] = request.form.get('tags', f['properties']['tags'])
            f['properties']['date'] = request.form.get('date', f['properties']['date'])
            f['properties']['description'] = request.form.get('description', f['properties']['description'])
            f['properties']['color'] = request.form.get('color', f['properties']['color'])
            f['properties']['category'] = request.form.get('category', f['properties']['category'])
            
            save_diary(diary)
            return jsonify({"status": "success"}), 200
            
    return jsonify({"error": "Pin nicht gefunden"}), 404


@app.route('/api/uploads/<filename>', methods=['GET'])
def get_image(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)


if __name__ == '__main__':
    app.run(debug=True, port=5000)