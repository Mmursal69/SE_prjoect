const socket = io();

// --- STATE VARIABLES ---
let currentPrediction = "";
let predictionCount = 0;
const STABILITY_THRESHOLD = 5; // Frames required to confirm a sign
let isTextToSignMode = false;

// --- DOM ELEMENTS ---
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');
const predictionDisplay = document.getElementById('current-prediction');
const stabilityBar = document.getElementById('stability-bar');
const outputText = document.getElementById('output_text');

// --- CAMERA SETUP ---
navigator.mediaDevices.getUserMedia({ video: true })
    .then(stream => { video.srcObject = stream; })
    .catch(err => console.error("Camera access denied:", err));

// --- VIDEO PROCESSING LOOP ---
setInterval(() => {
    if (!isTextToSignMode) {
        context.drawImage(video, 0, 0, 640, 480);
        const data = canvas.toDataURL('image/jpeg', 0.5);
        socket.emit('image_frame', data);
    }
}, 200); // 5 FPS to reduce server load

// --- SOCKET LISTENERS ---
socket.on('prediction_result', (data) => {
    const char = data.char;
    const confidence = data.confidence;

    // Logic: If same char detected repeatedly, fill the stability bar
    if (char === currentPrediction) {
        predictionCount++;
    } else {
        currentPrediction = char;
        predictionCount = 0;
    }

    // Update UI
    predictionDisplay.innerText = char;
    const percentage = Math.min((predictionCount / STABILITY_THRESHOLD) * 100, 100);
    stabilityBar.style.width = percentage + '%';

    // If stable, add to sentence
    if (predictionCount === STABILITY_THRESHOLD) {
        outputText.value += char;
        predictionCount = 0; // Reset
        stabilityBar.style.width = '0%';
        // Visual feedback
        predictionDisplay.classList.add('text-success');
        setTimeout(() => predictionDisplay.classList.remove('text-success'), 200);
    }
});

// --- UI INTERACTIONS ---

// 1. Sentence Builder Buttons
document.getElementById('btn-space').onclick = () => outputText.value += " ";
document.getElementById('btn-backspace').onclick = () => outputText.value = outputText.value.slice(0, -1);
document.getElementById('btn-clear').onclick = () => outputText.value = "";
document.getElementById('btn-speak').onclick = () => {
    const utterance = new SpeechSynthesisUtterance(outputText.value);
    window.speechSynthesis.speak(utterance);
};

// 2. Mode Switching
document.getElementById('btn-mode-sign2text').onclick = function() {
    isTextToSignMode = false;
    this.classList.add('active', 'btn-primary');
    this.classList.remove('btn-outline-primary');
    document.getElementById('btn-mode-text2sign').classList.remove('active', 'btn-primary');
    document.getElementById('btn-mode-text2sign').classList.add('btn-outline-primary');
    document.getElementById('sign-to-text-view').style.display = 'block';
    document.getElementById('text-to-sign-view').style.display = 'none';
};

document.getElementById('btn-mode-text2sign').onclick = function() {
    isTextToSignMode = true;
    this.classList.add('active', 'btn-primary');
    this.classList.remove('btn-outline-primary');
    document.getElementById('btn-mode-sign2text').classList.remove('active', 'btn-primary');
    document.getElementById('btn-mode-sign2text').classList.add('btn-outline-primary');
    document.getElementById('sign-to-text-view').style.display = 'none';
    document.getElementById('text-to-sign-view').style.display = 'block';
};

// 3. Text to Sign Logic
document.getElementById('btn-visual-play').onclick = async () => {
    const text = document.getElementById('text-input').value.toUpperCase().replace(/[^A-Z]/g, '');
    const displayImg = document.getElementById('main-sign-image');
    const displayLetter = document.getElementById('main-sign-letter');

    for (let char of text) {
        displayLetter.innerText = char;
        // UPDATED: Correct path for static files
        displayImg.src = `/static/images/${char}.png`;
        await new Promise(r => setTimeout(r, 800)); // Wait 800ms per letter
    }
    displayLetter.innerText = "Done";
};

// 4. Reference Grid Population
const referenceGrid = document.getElementById('reference-grid');
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
for (let letter of alphabet) {
    let div = document.createElement('div');
    div.className = 'grid-item';
    div.innerHTML = `
        <img src="/static/images/${letter}.png" alt="${letter}">
        <span class="fw-bold small text-muted">${letter}</span>
    `;
    div.onclick = () => {
        document.getElementById('text-input').value += letter;
    };
    referenceGrid.appendChild(div);
}

// 5. Auth & History (Simple Fetch Wrappers)
document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    
    const res = await fetch('/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    const result = await res.json();
    if(result.success) location.reload();
    else document.getElementById('login-error').innerText = result.message;
};

document.getElementById('signup-form').onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    
    const res = await fetch('/signup', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    const result = await res.json();
    if(result.success) location.reload();
    else document.getElementById('signup-error').innerText = result.message;
};

document.getElementById('logout-btn').onclick = async () => {
    await fetch('/logout');
    location.reload();
};

window.saveToHistory = async (elementId, mode) => {
    const content = document.getElementById(elementId).value;
    if(!content) return;
    await fetch('/save_history', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ mode, content })
    });
    alert('Saved to history!');
};

document.getElementById('btn-view-history').onclick = async () => {
    const res = await fetch('/get_history');
    const data = await res.json();
    const tbody = document.getElementById('history-table-body');
    tbody.innerHTML = '';
    data.forEach(row => {
        tbody.innerHTML += `<tr><td>${row.date}</td><td>${row.mode}</td><td>${row.content}</td></tr>`;
    });
};
