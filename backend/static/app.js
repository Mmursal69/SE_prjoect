// Wait for the HTML to load before running ANY JavaScript
document.addEventListener('DOMContentLoaded', () => {
    
    const socket = io();

    // --- STATE VARIABLES ---
    let currentPrediction = "";
    let predictionCount = 0;
    const STABILITY_THRESHOLD = 5; 
    let isTextToSignMode = false;

    // --- DOM ELEMENTS ---
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const context = canvas.getContext('2d');
    const predictionDisplay = document.getElementById('current-prediction');
    const stabilityBar = document.getElementById('stability-bar');
    const outputText = document.getElementById('output_text');

    // --- CAMERA SETUP ---
    // Only request camera if the video element exists
    if (video) {
        navigator.mediaDevices.getUserMedia({ video: true })
            .then(stream => { video.srcObject = stream; })
            .catch(err => console.error("Camera access denied:", err));
    }

    // --- VIDEO PROCESSING LOOP ---
    setInterval(() => {
        if (!isTextToSignMode && video && context) {
            context.drawImage(video, 0, 0, 640, 480);
            const data = canvas.toDataURL('image/jpeg', 0.5);
            socket.emit('image_frame', data);
        }
    }, 200); 

    // --- SOCKET LISTENERS ---
    socket.on('prediction_result', (data) => {
        const char = data.char;
        
        if (char === currentPrediction) {
            predictionCount++;
        } else {
            currentPrediction = char;
            predictionCount = 0;
        }

        if (predictionDisplay) predictionDisplay.innerText = char;
        
        if (stabilityBar) {
            const percentage = Math.min((predictionCount / STABILITY_THRESHOLD) * 100, 100);
            stabilityBar.style.width = percentage + '%';
        }

        if (predictionCount === STABILITY_THRESHOLD) {
            if (outputText) outputText.value += char;
            predictionCount = 0; 
            if (stabilityBar) stabilityBar.style.width = '0%';
            if (predictionDisplay) {
                predictionDisplay.classList.add('text-success');
                setTimeout(() => predictionDisplay.classList.remove('text-success'), 200);
            }
        }
    });

    // --- UI INTERACTIONS ---
    
    // Safety check function to add listener only if element exists
    function addListener(id, event, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    }

    // 1. Sentence Builder Buttons
    addListener('btn-space', 'click', () => { if(outputText) outputText.value += " "; });
    addListener('btn-backspace', 'click', () => { if(outputText) outputText.value = outputText.value.slice(0, -1); });
    addListener('btn-clear', 'click', () => { if(outputText) outputText.value = ""; });
    addListener('btn-speak', 'click', () => {
        if(outputText) {
            const utterance = new SpeechSynthesisUtterance(outputText.value);
            window.speechSynthesis.speak(utterance);
        }
    });

    // 2. Mode Switching
    addListener('btn-mode-sign2text', 'click', function() {
        isTextToSignMode = false;
        this.classList.add('active', 'btn-primary');
        this.classList.remove('btn-outline-primary');
        const otherBtn = document.getElementById('btn-mode-text2sign');
        if(otherBtn) {
            otherBtn.classList.remove('active', 'btn-primary');
            otherBtn.classList.add('btn-outline-primary');
        }
        const s2t = document.getElementById('sign-to-text-view');
        const t2s = document.getElementById('text-to-sign-view');
        if(s2t) s2t.style.display = 'block';
        if(t2s) t2s.style.display = 'none';
    });

    addListener('btn-mode-text2sign', 'click', function() {
        isTextToSignMode = true;
        this.classList.add('active', 'btn-primary');
        this.classList.remove('btn-outline-primary');
        const otherBtn = document.getElementById('btn-mode-sign2text');
        if(otherBtn) {
            otherBtn.classList.remove('active', 'btn-primary');
            otherBtn.classList.add('btn-outline-primary');
        }
        const s2t = document.getElementById('sign-to-text-view');
        const t2s = document.getElementById('text-to-sign-view');
        if(s2t) s2t.style.display = 'none';
        if(t2s) t2s.style.display = 'block';
    });

    // 3. Text to Sign Logic
    addListener('btn-visual-play', 'click', async () => {
        const inputEl = document.getElementById('text-input');
        if(!inputEl) return;
        
        const text = inputEl.value.toUpperCase().replace(/[^A-Z]/g, '');
        const displayImg = document.getElementById('main-sign-image');
        const displayLetter = document.getElementById('main-sign-letter');

        if(displayImg && displayLetter) {
            for (let char of text) {
                displayLetter.innerText = char;
                // Using lowercase path fix we discussed
                displayImg.src = `/static/images/${char.toLowerCase()}.png`;
                await new Promise(r => setTimeout(r, 800)); 
            }
            displayLetter.innerText = "Done";
        }
    });

    // 4. Reference Grid Population
    const referenceGrid = document.getElementById('reference-grid');
    if (referenceGrid) {
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        for (let letter of alphabet) {
            let div = document.createElement('div');
            div.className = 'grid-item';
            div.innerHTML = `
                <img src="/static/images/${letter.toLowerCase()}.png" alt="${letter}">
                <span class="fw-bold small text-muted">${letter}</span>
            `;
            div.onclick = () => {
                const inp = document.getElementById('text-input');
                if(inp) inp.value += letter;
            };
            referenceGrid.appendChild(div);
        }
    }

    // 5. Auth & History
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault(); // STOP THE RELOAD
            console.log("Submitting Login..."); // Debug log
            
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            try {
                const res = await fetch('/login', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(data)
                });
                const result = await res.json();
                if(result.success) location.reload();
                else {
                    const err = document.getElementById('login-error');
                    if(err) err.innerText = result.message;
                }
            } catch (err) {
                console.error("Login Fetch Error:", err);
            }
        };
    }

    const signupForm = document.getElementById('signup-form');
    if (signupForm) {
        signupForm.onsubmit = async (e) => {
            e.preventDefault(); // STOP THE RELOAD
            console.log("Submitting Signup..."); // Debug log

            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            try {
                const res = await fetch('/signup', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(data)
                });
                const result = await res.json();
                if(result.success) location.reload();
                else {
                    const err = document.getElementById('signup-error');
                    if(err) err.innerText = result.message;
                }
            } catch (err) {
                console.error("Signup Fetch Error:", err);
            }
        };
    }

    addListener('logout-btn', 'click', async () => {
        await fetch('/logout');
        location.reload();
    });

    // Make global functions available to HTML onclicks
    window.saveToHistory = async (elementId, mode) => {
        const el = document.getElementById(elementId);
        if(!el || !el.value) return;
        
        await fetch('/save_history', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ mode, content: el.value })
        });
        alert('Saved to history!');
    };

    addListener('btn-view-history', 'click', async () => {
        const res = await fetch('/get_history');
        const data = await res.json();
        const tbody = document.getElementById('history-table-body');
        if(tbody) {
            tbody.innerHTML = '';
            data.forEach(row => {
                tbody.innerHTML += `<tr><td>${row.date}</td><td>${row.mode}</td><td>${row.content}</td></tr>`;
            });
        }
    });

}); // End of DOMContentLoaded
