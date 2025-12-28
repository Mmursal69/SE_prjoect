#Speak4me AI — Silent Voice to Speech

[cite_start]**Speak4me AI** is a professional, responsive web application that translates American Sign Language (ASL) hand gestures into text and human-like speech in real-time[cite: 2].

It uses a **TensorFlow/Keras** model for prediction and **MediaPipe** for hand tracking, wrapped in a **Flask** backend. [cite_start]The frontend uses the browser's native **Speech Synthesis API** to vocalize the detected sentences[cite: 5, 49].

## 📂 Project Structure

```text
Speak4me-AI/
├── backend/
│   ├── main.py              # Flask server & Prediction logic
│   ├── requirements.txt     # Python dependencies
│   ├── Procfile             # Deployment command (for Render/Heroku)
│   └── asl_model_az.h5      # ⚠️ YOUR TRAINED MODEL GOES HERE
├── frontend/
│   ├── index.html           # UI Structure
│   ├── styles.css           # Navy-blue responsive theme
│   └── app.js               # Webcam logic & Speech API
└── README.md