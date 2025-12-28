// --- Global Settings (Default or User Preference) ---
const RECOGNITION_SPEED = (typeof USER_SETTINGS !== 'undefined') ? USER_SETTINGS.recognitionSpeed : 2000;
const VOICE_SPEED = (typeof USER_SETTINGS !== 'undefined') ? USER_SETTINGS.voiceSpeed : 1.0;

const socket = io.connect(location.protocol + '//' + document.domain + ':' + location.port);

// --- 1. LOGIN / SIGNUP PAGE LOGIC ---
function switchAuth(type) {
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + type).classList.add('active');
    if(type === 'login'){
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('signup-form').style.display = 'none';
    } else {
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('signup-form').style.display = 'block';
    }
}

async function handleAuth(e, url, errId) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const errEl = document.getElementById(errId);
    try {
        const res = await fetch(url, { method: 'POST', body: formData });
        const d = await res.json();
        if (res.ok) window.location.href = "/"; // Redirect to home
        else errEl.innerText = d.message;
    } catch (err) { errEl.innerText = 'Error connecting to server'; }
}

if(document.getElementById('login-form')) document.getElementById('login-form').addEventListener('submit', e => handleAuth(e, '/api/login', 'login-error'));
if(document.getElementById('signup-form')) document.getElementById('signup-form').addEventListener('submit', e => handleAuth(e, '/api/signup', 'signup-error'));


// --- 2. DASHBOARD LOGIC (Only runs if video element exists) ---
const video = document.getElementById('video');

if (video) {
    const canvas = document.getElementById('canvas');
    const context = canvas.getContext('2d');
    const currentPredEl = document.getElementById('current-prediction');
    const outputTextArea = document.getElementById('output_text');
    const stabilityBar = document.getElementById('stability-bar');

    let isStreaming = false;
    let lastPrediction = "";
    let stabilityStartTime = 0;

    // Mode Switching
    const btnSign2Text = document.getElementById('btn-mode-sign2text');
    const btnText2Sign = document.getElementById('btn-mode-text2sign');
    const viewSign2Text = document.getElementById('sign-to-text-view');
    const viewText2Sign = document.getElementById('text-to-sign-view');

    btnSign2Text.addEventListener('click', () => {
        btnSign2Text.classList.add('active', 'btn-primary');
        btnSign2Text.classList.remove('btn-outline-primary');
        btnText2Sign.classList.remove('active', 'btn-primary');
        btnText2Sign.classList.add('btn-outline-primary');
        viewSign2Text.style.display = 'block';
        viewText2Sign.style.display = 'none';
        startCamera();
    });

    btnText2Sign.addEventListener('click', () => {
        btnText2Sign.classList.add('active', 'btn-primary');
        btnText2Sign.classList.remove('btn-outline-primary');
        btnSign2Text.classList.remove('active', 'btn-primary');
        btnSign2Text.classList.add('btn-outline-primary');
        viewText2Sign.style.display = 'block';
        viewSign2Text.style.display = 'none';
        stopCamera();
    });

    // Camera Functions
    function startCamera() {
        if (isStreaming) return;
        navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
            video.srcObject = stream;
            isStreaming = true;
        }).catch(err => console.error("Camera Error:", err));
    }

    function stopCamera() {
        if (!isStreaming) return;
        if (video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
        isStreaming = false;
    }

    // Start camera by default on load
    startCamera();

    // Frame Loop
    setInterval(() => {
        if (isStreaming && video.readyState === video.HAVE_ENOUGH_DATA) {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            socket.emit('image', canvas.toDataURL('image/jpeg', 0.5));
        }
    }, 100);

    // Socket Response
    socket.on('response_back', data => {
        if (!isStreaming) return;
        const prediction = data.prediction;
        if (prediction === "No hand detected" || prediction === "Error") {
            currentPredEl.innerText = "...";
            resetStability();
            return;
        }
        currentPredEl.innerText = prediction;
        
        if (prediction === lastPrediction) {
            const elapsed = Date.now() - stabilityStartTime;
            // Use User Setting for Speed
            const progress = Math.min((elapsed / RECOGNITION_SPEED) * 100, 100);
            stabilityBar.style.width = progress + "%";
            
            if (elapsed >= RECOGNITION_SPEED) {
                addLetterToSentence(prediction);
                resetStability();
                // Add a small delay after success so it doesn't double type immediately
                stabilityStartTime = Date.now() + 500; 
            }
        } else {
            lastPrediction = prediction;
            stabilityStartTime = Date.now();
            stabilityBar.style.width = "0%";
        }
    });

    function resetStability() {
        lastPrediction = "";
        stabilityStartTime = Date.now();
        stabilityBar.style.width = "0%";
    }

    function addLetterToSentence(letter) {
        outputTextArea.value += letter;
        outputTextArea.scrollTop = outputTextArea.scrollHeight;
    }

    // Sentence Controls
    document.getElementById('btn-space').addEventListener('click', () => outputTextArea.value += " ");
    document.getElementById('btn-backspace').addEventListener('click', () => outputTextArea.value = outputTextArea.value.slice(0, -1));
    document.getElementById('btn-clear').addEventListener('click', () => outputTextArea.value = "");
    
    document.getElementById('btn-speak').addEventListener('click', () => {
        const text = outputTextArea.value;
        if (text) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = VOICE_SPEED; // Use User Setting
            window.speechSynthesis.speak(utterance);
        }
    });
}

// --- 3. TEXT TO SIGN LOGIC (Visual Playback) ---
const btnVisualPlay = document.getElementById('btn-visual-play');
if(btnVisualPlay) {
    const textInput = document.getElementById('text-input');
    const mainSignImage = document.getElementById('main-sign-image');
    const mainSignLetter = document.getElementById('main-sign-letter');

    btnVisualPlay.addEventListener('click', async () => {
        const text = textInput.value.trim().toUpperCase();
        if(!text) return alert("Please type something first!");

        btnVisualPlay.disabled = true;
        btnVisualPlay.innerText = "Playing...";

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (/[A-Z]/.test(char)) {
                mainSignImage.src = `/static/images/${char.toLowerCase()}.png`;
                mainSignLetter.innerText = char;
            } else {
                mainSignImage.src = "https://via.placeholder.com/200?text=..."; 
                mainSignLetter.innerText = " ";
            }
            
            // Highlight Grid
            document.querySelectorAll('.grid-item').forEach(el => el.classList.remove('active-letter'));
            const gridEl = document.getElementById('grid-' + char);
            if(gridEl) gridEl.classList.add('active-letter');

            await new Promise(r => setTimeout(r, 1500));
        }

        btnVisualPlay.disabled = false;
        btnVisualPlay.innerText = "Play Sequence";
        mainSignLetter.innerText = "Done";
        document.querySelectorAll('.grid-item').forEach(el => el.classList.remove('active-letter'));
    });

    // Instant Preview on Typing
    textInput.addEventListener('input', (e) => {
        const val = e.target.value.toUpperCase();
        if (val.length > 0) {
            const lastChar = val[val.length - 1];
            if (/[A-Z]/.test(lastChar)) {
                mainSignImage.src = `/static/images/${lastChar.toLowerCase()}.png`;
                mainSignLetter.innerText = lastChar;
            }
        }
    });
}

// --- 4. GLOBAL HELPERS (Save History & Grid) ---
const referenceGrid = document.getElementById('reference-grid');
if(referenceGrid) {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('');
    letters.forEach(letter => {
        const div = document.createElement('div');
        div.className = 'grid-item';
        div.id = 'grid-' + letter;
        const img = document.createElement('img');
        img.src = `/static/images/${letter.toLowerCase()}.png`; 
        img.alt = letter;
        img.onerror = function() { this.src = 'https://via.placeholder.com/50?text='+letter; };
        const span = document.createElement('span');
        span.innerText = letter;
        div.appendChild(img);
        div.appendChild(span);
        referenceGrid.appendChild(div);
    });
}

async function saveToHistory(elId, mode) {
    const content = document.getElementById(elId).value || document.getElementById(elId).innerText;
    if(!content) return alert("Nothing to save");
    await fetch('/save_history', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({content, mode})
    });
    alert("Saved to History!");
}


const loginVideo = document.getElementById('login-video-bg');
if (loginVideo) {
    // List of video files
    const videos = ['V1.mp4', 'V2.mp4', 'V3.mp4', 'V4.mp4', 'V5.mp4', 'V6.mp4'];
    
    // Pick a random index
    const randomIndex = Math.floor(Math.random() * videos.length);
    const selectedVideo = videos[randomIndex];

    // Set the source and play
    // Assuming videos are stored in 'static/videos/'
    loginVideo.src = `/static/videos/${selectedVideo}`;
    
    // Optional: If you want to cycle through them one by one instead of random
    // loginVideo.onended = () => {
    //    let nextIndex = (videos.indexOf(selectedVideo) + 1) % videos.length;
    //    loginVideo.src = `/static/videos/${videos[nextIndex]}`;
    // }
}