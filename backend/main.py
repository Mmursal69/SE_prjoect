import base64
import cv2
import numpy as np
from flask import Flask, render_template, request, jsonify, redirect, url_for, flash
from flask_socketio import SocketIO, emit
from keras.models import load_model
import mediapipe as mp
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_bcrypt import Bcrypt
import os
from datetime import datetime

# --- App & Database Configuration ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, '..', 'frontend')

app = Flask(__name__, 
            static_folder=FRONTEND_DIR, 
            template_folder=FRONTEND_DIR,
            static_url_path='/static')

app.config['SECRET_KEY'] = 'your_very_secret_key_here' 
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///site.db' 
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
bcrypt = Bcrypt(app)
socketio = SocketIO(app, cors_allowed_origins="*")
login_manager = LoginManager(app)
login_manager.login_view = 'login_page' # Redirects here if not logged in

# --- Database Models ---
@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(20), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    full_name = db.Column(db.String(100), nullable=False)
    password = db.Column(db.String(60), nullable=False)
    # New Settings Columns
    recognition_speed = db.Column(db.Integer, default=2000) # milliseconds
    voice_speed = db.Column(db.Float, default=1.0) # 0.5 to 2.0
    history = db.relationship('History', backref='author', lazy=True)

class History(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    mode = db.Column(db.String(20), nullable=False)
    timestamp = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

# --- ASL Model Setup (Same as before) ---
# ... (Keep your existing Model/MediaPipe code here) ...
# For brevity, I am assuming the model loading code remains identical.
MODEL_PATH = os.path.join(BASE_DIR, 'asl_model_az.h5')
try:
    model = load_model(MODEL_PATH)
    print("✅ Model loaded successfully!")
except Exception:
    print("❌ Model not found (Dummy mode)")
    model = None

labels = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(static_image_mode=False, max_num_hands=1, min_detection_confidence=0.7)

def extract_features(image):
    # ... (Keep existing extraction code) ...
    if image.shape[2] == 4:
        image = cv2.cvtColor(image, cv2.COLOR_RGBA2RGB)
    results = hands.process(image)
    if results.multi_hand_landmarks:
        landmarks = results.multi_hand_landmarks[0]
        keypoints = []
        for lm in landmarks.landmark:
            keypoints.extend([lm.x, lm.y, lm.z]) 
        return np.array(keypoints).reshape(1, -1)
    return None

# --- PAGE ROUTES ---

@app.route('/')
@login_required
def index():
    return render_template('index.html')

@app.route('/login', methods=['GET', 'POST'])
def login_page():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    return render_template('login.html')

@app.route('/history')
@login_required
def history_page():
    entries = History.query.filter_by(user_id=current_user.id).order_by(History.timestamp.desc()).all()
    return render_template('history.html', entries=entries)

@app.route('/settings', methods=['GET', 'POST'])
@login_required
def settings_page():
    if request.method == 'POST':
        current_user.recognition_speed = int(request.form.get('recognition_speed'))
        current_user.voice_speed = float(request.form.get('voice_speed'))
        db.session.commit()
        flash('Settings Updated!', 'success')
        return redirect(url_for('settings_page'))
    return render_template('settings.html')

@app.route('/about')
def about_page():
    return render_template('about.html')

# --- API ROUTES (Auth Logic) ---

@app.route('/api/signup', methods=['POST'])
def api_signup():
    username = request.form.get('username')
    email = request.form.get('email')
    full_name = request.form.get('full_name')
    password = request.form.get('password')

    if User.query.filter((User.username==username) | (User.email==email)).first():
        return jsonify({'message': 'User already exists'}), 409

    hashed = bcrypt.generate_password_hash(password).decode('utf-8')
    user = User(username=username, email=email, full_name=full_name, password=hashed)
    db.session.add(user)
    db.session.commit()
    
    login_user(user)
    return jsonify({'message': 'Created'}), 201

@app.route('/api/login', methods=['POST'])
def api_login():
    username = request.form.get('username')
    password = request.form.get('password')
    user = User.query.filter_by(username=username).first()
    if user and bcrypt.check_password_hash(user.password, password):
        login_user(user, remember=True)
        return jsonify({'message': 'Success'}), 200
    return jsonify({'message': 'Invalid credentials'}), 401

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login_page'))

@app.route('/save_history', methods=['POST'])
@login_required
def save_history():
    data = request.get_json()
    if data.get('content'):
        entry = History(content=data['content'], mode=data['mode'], author=current_user)
        db.session.add(entry)
        db.session.commit()
        return jsonify({'message': 'Saved!'}), 201
    return jsonify({'message': 'Empty'}), 400

# --- SOCKET IO ---
@socketio.on('image')
def handle_image(data_image):
    if not model: return
    try:
        header, encoded = data_image.split(",", 1)
        nparr = np.frombuffer(base64.b64decode(encoded), np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        frame = cv2.flip(frame, 1) 
        keypoints = extract_features(frame)
        if keypoints is not None:
            prediction = model.predict(keypoints, verbose=0) 
            predicted_label = labels[np.argmax(prediction)]
            emit('response_back', {'prediction': predicted_label})
        else:
            emit('response_back', {'prediction': "No hand detected"})
    except Exception as e:
        print(e)
        emit('response_back', {'prediction': "Error"})

with app.app_context():
    db.create_all()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)