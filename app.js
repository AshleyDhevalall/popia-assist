/* app.js — module */
const form = document.getElementById('complaintForm');
const statusEl = document.getElementById('status');
const queueList = document.getElementById('queueList');
const saveDraftBtn = document.getElementById('saveDraftBtn');
const submitBtn = document.getElementById('submitBtn');

const DB_NAME = 'form5db';
const DB_STORE = 'queue';

// --- register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js')
    .then(() => console.log('SW registered'))
    .catch(err => console.warn('SW registration failed', err));
}

// --- install prompt handling (optional)
let deferredPrompt;
const installBtn = document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});

// --- tiny IndexedDB wrapper for queue
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function addToQueue(payload) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.add({ payload, createdAt: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function getAllQueue() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function removeFromQueue(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// --- helpers
function showStatus(msg, isError=false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? 'crimson' : 'green';
}

function serializeForm(formEl) {
  const fd = new FormData(formEl);
  // convert file inputs to array of file descriptors (store file blobs in IndexedDB)
  const attachments = fd.getAll('attachments');
  const attachmentsArray = attachments.filter(f=>f && f.size).map(f => {
    return { name: f.name, type: f.type, size: f.size, blob: f.slice(0, f.size, f.type) };
  });
  const obj = {};
  for (const [k, v] of fd.entries()) {
    if (k === 'attachments') continue;
    obj[k] = v;
  }
  obj.attachments = attachmentsArray;
  obj.submittedAt = new Date().toISOString();
  return obj;
}

// create a simplified payload suitable for network (files are base64)
async function prepareNetworkPayload(storedPayload) {
  const payload = { ...storedPayload };
  // attachments are objects with blob slices; convert to base64 strings
  if (payload.attachments && payload.attachments.length) {
    payload.attachments = await Promise.all(payload.attachments.map(async a => {
      const b = a.blob;
      const base64 = await blobToBase64(b);
      return { name: a.name, type: a.type, size: a.size, data: base64 };
    }));
  }
  return payload;
}
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]); // base64 string
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// --- queue UI
async function refreshQueueUI() {
  const items = await getAllQueue();
  queueList.innerHTML = '';
  if (!items.length) {
    queueList.innerHTML = '<li class="muted">No queued items</li>';
    return;
  }
  items.forEach(it => {
    const li = document.createElement('li');
    li.textContent = `Queued at ${new Date(it.createdAt).toLocaleString()} — ${it.payload.p1_complainant_fullnames || 'No name'}`;
    const sendBtn = document.createElement('button');
    sendBtn.textContent = 'Try send';
    sendBtn.style.marginLeft = '8px';
    sendBtn.addEventListener('click', () => sendQueuedItem(it.id, it.payload));
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.style.marginLeft = '8px';
    delBtn.addEventListener('click', async () => {
      await removeFromQueue(it.id);
      refreshQueueUI();
    });
    li.appendChild(sendBtn);
    li.appendChild(delBtn);
    queueList.appendChild(li);
  });
}

// --- submit & sync
async function sendToServer(payload) {
  // NOTE: change URL to your server endpoint. For demo we use example.com
  // The network payload will contain base64 attachments.
  const networkPayload = await prepareNetworkPayload(payload);
  const endpoint = '/api/complaints'; // << set to your real endpoint
  // For demo, we'll attempt to POST JSON. Omit attachments if none.
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(networkPayload)
  });
  if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
  return resp.json();
}

async function sendQueuedItem(id, payload) {
  showStatus('Sending queued item...');
  try {
    await sendToServer(payload);
    await removeFromQueue(id);
    showStatus('Queued item sent successfully.');
    refreshQueueUI();
  } catch (err) {
    console.error(err);
    showStatus('Failed to send queued item — will remain in queue.', true);
  }
}

async function attemptSendAllQueued() {
  const items = await getAllQueue();
  for (const it of items) {
    try {
      await sendToServer(it.payload);
      await removeFromQueue(it.id);
      console.log('Sent queued id', it.id);
    } catch (e) {
      console.warn('Could not send queued id', it.id, e);
    }
  }
  refreshQueueUI();
}

// --- form events
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  showStatus('Processing...');
  try {
    const payload = serializeForm(form);
    // If online try to send immediately, otherwise queue
    if (navigator.onLine) {
      try {
        await sendToServer(payload);
        showStatus('Complaint submitted successfully.');
        form.reset();
      } catch (err) {
        // on server failure, queue
        console.warn('Send failed, queuing', err);
        await addToQueue(payload);
        showStatus('Server unavailable — saved to queue and will retry when online.', true);
      }
    } else {
      await addToQueue(payload);
      showStatus('You are offline. Complaint saved to local queue.');
      form.reset();
    }
    refreshQueueUI();
  } finally {
    submitBtn.disabled = false;
  }
});

saveDraftBtn.addEventListener('click', async () => {
  const payload = serializeForm(form);
  await addToQueue(payload);
  showStatus('Draft saved to local queue.');
  refreshQueueUI();
});

// sync when coming online
window.addEventListener('online', () => {
  showStatus('Back online — trying to send queued submissions...');
  attemptSendAllQueued();
});
window.addEventListener('offline', () => {
  showStatus('Offline — submissions will be queued locally.', true);
});

// initial UI
refreshQueueUI();
if (navigator.onLine) attemptSendAllQueued();
