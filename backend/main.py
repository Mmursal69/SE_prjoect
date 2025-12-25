import os
import cv2
import numpy as np
import base64
from flask import Flask, render_template, Response, request, jsonify
from flask_socketio import SocketIO, emit
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from tensorflow.keras.models import load_model

# --- 1. CONFIGURATION ---

# Initialize Flask with explicit folder paths
app = Flask(__name__, template_folder='templates', static_folder='static')

# Fix Database URI for consistent access on all operating systems
basedir = os.path.abspath(os.path.dirname(__file__))
# Ensure the instance folder exists
instance_path = os.path.join(basedir, 'instance')
if not os.path.exists(instance_path):
    os.makedirs(instance_path)

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(instance_path, 'database.db')
app.config['SECRET_KEY'] = 'your_secret_key_here' # Change this in production!

# Initialize Extensions
db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*")
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

# Load the AI Model
# Ensure the model file is in the same directory as main.py
model_path = os.path.join(basedir, 'asl_model_az.h5')
try:
    model = load_model(model_path)
    print("✅ Model loaded successfully!")
except Exception as e:
    print(f"❌ Error loading model: {e}")
    # We don't exit, so the app can still run (just without prediction)

labels = {i: chr(65 + i) for i in range(26)}  # A-Z map

# --- 2. DATABASE MODELS ---
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(150), nullable=False)
    full_name = db.Column(db.String(150))

class History(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    mode = db.Column(db.String(50))  # 'Sign-to-Text' or 'Text-to-Sign'
    content = db.Column(db.Text)
    timestamp = db.Column(db.DateTime, default=db.func.current_timestamp())

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# --- 3. ROUTES ---

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
    
    new_user = User(
        username=data.get('username'),
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
    new_entry = History(
        user_id=current_user.id,
        mode=data['mode'],
        content=data['content']
    )
    db.session.add(new_entry)
    db.session.commit()
    return jsonify({"success": True})

@app.route('/get_history')
@login_required
def get_history():
    history = History.query.filter_by(user_id=current_user.id).order_by(History.timestamp.desc()).all()
    history_data = [
        {"date": h.timestamp.strftime('%Y-%m-%d %H:%M'), "mode": h.mode, "content": h.content}
        for h in history
    ]
    return jsonify(history_data)

# --- 4. SOCKET IO (VIDEO PROCESSING) ---

@socketio.on('image_frame')
def handle_image(data):
    # Decode image
    image_data = base64.b64decode(data.split(',')[1])
    nparr = np.frombuffer(image_data, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if frame is None:
        return

    # Preprocess for Model (Resize to 64x64)
    try:
        resized = cv2.resize(frame, (64, 64))
        normalized = resized / 255.0
        reshaped = np.reshape(normalized, (1, 64, 64, 3))

        # Prediction
        prediction = model.predict(reshaped, verbose=0)
        predicted_index = np.argmax(prediction)
        confidence = float(np.max(prediction))
        predicted_char = labels[predicted_index]

        # Send result back
        emit('prediction_result', {
            'char': predicted_char, 
            'confidence': confidence
        })
    except Exception as e:
        print(f"Prediction Error: {e}")

# --- 5. MAIN ENTRY POINT ---
if __name__ == '__main__':
    with app.app_context():
        db.create_all()  # Create tables if they don't exist
    # Debug=True is fine for local, but Gunicorn will override this on Render
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
