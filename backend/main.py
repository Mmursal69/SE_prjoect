import os
import sys
import cv2
import numpy as np
import base64
from flask import Flask, render_template, Response, request, jsonify
from flask_socketio import SocketIO, emit
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
# Note: Render uses 'tensorflow-cpu' but imports as 'tensorflow'
from tensorflow.keras.models import load_model

# --- 1. CONFIGURATION (UNIVERSAL PATHS) ---

# Get the folder where THIS main.py file is running
# On Render, this will automatically be /opt/render/project/src/backend
basedir = os.path.abspath(os.path.dirname(__file__))

template_dir = os.path.join(basedir, 'template')
static_dir = os.path.join(basedir, 'static')
instance_path = os.path.join(basedir, 'instance')

print(f"--> Main.py running from: {basedir}")
print(f"--> Templates expected at: {template_dir}")

# Initialize Flask with explicit paths
app = Flask(__name__, 
            template_folder=template_dir, 
            static_folder=static_dir)

# Database Setup
if not os.path.exists(instance_path):
    os.makedirs(instance_path)

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(instance_path, 'database.db')
app.config['SECRET_KEY'] = 'your_secret_key_here' 

# --- 2. EXTENSIONS ---
db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*")
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

# --- 3. LOAD MODEL ---
model_path = os.path.join(basedir, 'asl_model_az.h5')
model = None
try:
    if os.path.exists(model_path):
        model = load_model(model_path)
        print("✅ Model loaded successfully!")
    else:
        print(f"❌ Model not found at: {model_path}")
except Exception as e:
    print(f"❌ Error loading model: {e}")

labels = {i: chr(65 + i) for i in range(26)}

# --- 4. DATABASE MODELS ---
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    email = db.Column(db.String(150), unique=True, nullable=False) # Email is required now
    password = db.Column(db.String(150), nullable=False)
    full_name = db.Column(db.String(150))

class History(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    mode = db.Column(db.String(50))
    content = db.Column(db.Text)
    timestamp = db.Column(db.DateTime, default=db.func.current_timestamp())

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# --- FORCE TABLE CREATION ---
with app.app_context():
    db.create_all()
    print("--> Database tables checked/created.")

# --- 5. ROUTES ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(username=data.get('username')).first()
    if user and user.password == data.get('password'):
        login_user(user)
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Invalid credentials"})

@app.route('/signup', methods=['POST'])
def signup():
    data = request.json
    if User.query.filter_by(username=data.get('username')).first():
        return jsonify({"success": False, "message": "Username already exists"})
    
    # Check for email too
    if User.query.filter_by(email=data.get('email')).first():
        return jsonify({"success": False, "message": "Email already exists"})
        
    new_user = User(
        username=data.get('username'),
        email=data.get('email'),
        password=data.get('password'),
        full_name=data.get('full_name')
    )
    db.session.add(new_user)
    db.session.commit()
    login_user(new_user)
    return jsonify({"success": True})

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return jsonify({"success": True})

@app.route('/save_history', methods=['POST'])
@login_required
def save_history():
    data = request.json
    new_entry = History(user_id=current_user.id, mode=data['mode'], content=data['content'])
    db.session.add(new_entry)
    db.session.commit()
    return jsonify({"success": True})

@app.route('/get_history')
@login_required
def get_history():
    history = History.query.filter_by(user_id=current_user.id).order_by(History.timestamp.desc()).all()
    history_data = [{"date": h.timestamp.strftime('%Y-%m-%d %H:%M'), "mode": h.mode, "content": h.content} for h in history]
    return jsonify(history_data)

# --- 6. SOCKET IO ---
@socketio.on('image_frame')
def handle_image(data):
    if not model: return
    try:
        image_data = base64.b64decode(data.split(',')[1])
        nparr = np.frombuffer(image_data, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None: return

        resized = cv2.resize(frame, (64, 64))
        normalized = resized / 255.0
        reshaped = np.reshape(normalized, (1, 64, 64, 3))
        prediction = model.predict(reshaped, verbose=0)
        predicted_index = np.argmax(prediction)
        confidence = float(np.max(prediction))
        predicted_char = labels[predicted_index]

        emit('prediction_result', {'char': predicted_char, 'confidence': confidence})
    except Exception:
        pass

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)

