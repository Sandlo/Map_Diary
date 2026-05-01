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

@app.route('/api/pins', methods=['GET'])
def get_pins():
    return jsonify(load_diary())

@app.route('/api/pins', methods=['POST'])
def add_pin():
    diary = load_diary()

    # 1. Neue und alte Texte auslesen
    title = request.form.get('title')
    tags = request.form.get('tags')
    date = request.form.get('date')
    description = request.form.get('description')
    lat = float(request.form.get('lat'))
    lng = float(request.form.get('lng'))

    # 2. MEHRERE Bilder speichern
    image_files = request.files.getlist('images')
    filenames = []
    for img in image_files:
        if img and img.filename:
            ext = img.filename.split('.')[-1]
            fname = f"{uuid.uuid4().hex}.{ext}"
            img.save(os.path.join(UPLOAD_FOLDER, fname))
            filenames.append(fname)

    # 3. GeoJSON Feature zusammenbauen
    new_feature = {
        "type": "Feature",
        "properties": {
            "title": title,
            "tags": tags,
            "date": date,
            "description": description,
            "images": filenames # Jetzt ein Array!
        },
        "geometry": {
            "type": "Point",
            "coordinates": [lng, lat] 
        }
    }

    diary['features'].append(new_feature)
    save_diary(diary)

    return jsonify({"status": "success"}), 201

@app.route('/api/uploads/<filename>', methods=['GET'])
def get_image(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == '__main__':
    app.run(debug=True, port=5000)