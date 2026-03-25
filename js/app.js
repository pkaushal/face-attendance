const App = {
  user: null,
  users: [],
  attendanceUsers: [],
  video: null,
  registerVideo: null,
  overlay: null,
  registerOverlay: null,
  captureCanvas: document.createElement('canvas'),
  detectionInterval: null,
  registerDetectionInterval: null,
  lastRecognizedUser: null,
  cooldown: false,
  capturedDescriptor: null,
  capturedImageData: null,

  async init() {
    this.video = document.getElementById('video');
    this.registerVideo = document.getElementById('register-video');
    this.overlay = document.getElementById('overlay');
    this.registerOverlay = document.getElementById('register-overlay');
    this.captureCanvas = document.createElement('canvas');

    this.setupNavigation();
    this.setupRegister();
    this.setupLogs();

    const modelsLoaded = await FaceAPI.loadModels();
    document.getElementById('status-badge').textContent = modelsLoaded ? 'Ready' : 'Model error';

    await this.checkAuth();
  },

  async checkAuth() {
    try {
      this.user = await API.getMe();
      this.updateAuthUI();
      await this.loadData();
    } catch (e) {
      this.user = null;
      this.updateAuthUI();
    }
  },

  updateAuthUI() {
    const isLoggedIn = !!this.user;
    const isAdmin = this.user?.isAdmin;
    document.body.classList.toggle('is-admin', isAdmin);
    document.getElementById('login-btn').classList.toggle('hidden', isLoggedIn);
    document.getElementById('logout-btn').classList.toggle('hidden', !isLoggedIn);
    document.getElementById('user-info').classList.toggle('hidden', !isLoggedIn);
    
    if (isLoggedIn) {
      document.getElementById('user-avatar').src = this.user.avatar || '';
      document.getElementById('user-name').textContent = this.user.username;
      document.getElementById('admin-badge').classList.toggle('hidden', !isAdmin);
    }
  },

  async loadData() {
    if (!this.user) return;
    try {
      this.users = await API.getUsers();
      this.attendanceUsers = await API.getUsersForAttendance();
      this.renderUsers();
      this.renderLogs();
      this.renderTodayAttendance();
      this.populateUserFilter();
    } catch (e) {
      this.showToast('Failed to load data', 'error');
    }
  },

  setupNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'attendance') this.startAttendanceCamera();
      });
    });

    document.getElementById('login-btn').addEventListener('click', () => {
      window.location.href = 'http://localhost:3000/auth/github';
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
      await API.request('/auth/logout', { method: 'GET' });
      this.user = null;
      this.updateAuthUI();
      this.showToast('Logged out');
    });
  },

  async startAttendanceCamera() {
    if (!this.user) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
      this.video.srcObject = stream;
      await this.video.play();
      this.overlay.width = this.video.videoWidth;
      this.overlay.height = this.video.videoHeight;
      this.startDetection();
    } catch (e) {
      this.showToast('Camera access denied', 'error');
    }
  },

  startDetection() {
    if (this.detectionInterval) clearInterval(this.detectionInterval);
    this.detectionInterval = setInterval(async () => {
      if (!FaceAPI.modelsLoaded || this.cooldown || !this.user) return;
      try {
        const detections = await FaceAPI.detectFace(this.video);
        FaceAPI.clearCanvas(this.overlay);
        const detectedEl = document.getElementById('detected-user');

        if (detections.length === 1) {
          const match = FaceAPI.findMatchingUser(detections[0].descriptor, this.attendanceUsers);
          FaceAPI.drawFaceBox(this.overlay, detections[0], match ? '#10b981' : '#6b7280');
          
          if (match) {
            detectedEl.innerHTML = `<div class="name">${match.name}</div><div class="status">Recognized</div>`;
            if (this.lastRecognizedUser !== match.id) {
              this.lastRecognizedUser = match.id;
              await this.recordAttendance(match.id);
            }
          } else {
            detectedEl.innerHTML = `<span class="placeholder">Unknown Person</span>`;
            this.lastRecognizedUser = null;
          }
        } else {
          detectedEl.innerHTML = `<span class="placeholder">${detections.length === 0 ? 'Waiting for face...' : 'Multiple faces'}</span>`;
        }
      } catch (e) {}
    }, 500);
  },

  async recordAttendance(userId) {
    this.cooldown = true;
    try {
      const today = new Date().toISOString().split('T')[0];
      const todayRecords = await API.getAttendance({ date: today });
      const userRecords = todayRecords.filter(r => r.user_id === userId);
      const type = userRecords.length === 0 || userRecords.every(r => r.check_out) ? 'in' : 'out';
      
      await API.recordAttendance(userId, type);
      this.showToast(`Checked ${type}`, type === 'in' ? 'success' : '');
      this.renderTodayAttendance();
      this.renderLogs();
    } catch (e) {
      this.showToast(e.message, 'error');
    }
    setTimeout(() => { this.cooldown = false; }, 2000);
  },

  async renderTodayAttendance() {
    const list = document.getElementById('today-list');
    const today = new Date().toISOString().split('T')[0];
    const records = await API.getAttendance({ date: today });
    
    if (records.length === 0) {
      list.innerHTML = '<div class="attendance-item"><span>No attendance today</span></div>';
      return;
    }

    const latest = {};
    records.forEach(r => { if (!latest[r.user_id] || new Date(r.check_in) > new Date(latest[r.user_id].check_in)) latest[r.user_id] = r; });

    list.innerHTML = Object.values(latest).map(r => {
      const time = new Date(r.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const status = r.check_out ? 'out' : 'in';
      const statusText = r.check_out ? 'Out' : 'In';
      return `<div class="attendance-item"><span>${r.name}</span><span class="time">${time} <span class="status ${status}">${statusText}</span></span></div>`;
    }).join('');
  },

  setupRegister() {
    document.querySelector('[data-tab="register"]').addEventListener('click', () => {
      if (!this.user?.isAdmin) return;
      this.startRegisterCamera();
    });

    document.getElementById('capture-btn').addEventListener('click', async () => {
      try {
        this.capturedDescriptor = await FaceAPI.captureFaceDescriptor(this.registerVideo);
        this.captureCanvas.width = this.registerVideo.videoWidth;
        this.captureCanvas.height = this.registerVideo.videoHeight;
        this.captureCanvas.getContext('2d').drawImage(this.registerVideo, 0, 0);
        this.capturedImageData = this.captureCanvas.toDataURL('image/jpeg');
        
        document.getElementById('captured-image').src = this.capturedImageData;
        document.getElementById('capture-preview').classList.remove('hidden');
        document.getElementById('capture-btn').classList.add('hidden');
        document.getElementById('retake-btn').classList.remove('hidden');
        
        if (this.registerVideo.srcObject) this.registerVideo.srcObject.getTracks().forEach(t => t.stop());
        clearInterval(this.registerDetectionInterval);
        FaceAPI.clearCanvas(this.registerOverlay);
      } catch (e) { this.showToast(e.message, 'error'); }
    });

    document.getElementById('retake-btn').addEventListener('click', () => {
      this.capturedDescriptor = null;
      this.capturedImageData = null;
      document.getElementById('capture-preview').classList.add('hidden');
      document.getElementById('capture-btn').classList.remove('hidden');
      document.getElementById('retake-btn').classList.add('hidden');
      document.getElementById('register-form').reset();
      this.startRegisterCamera();
    });

    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await API.createUser({
          employeeId: document.getElementById('employee-id').value.trim(),
          name: document.getElementById('employee-name').value.trim(),
          faceDescriptor: Array.from(this.capturedDescriptor),
          imageData: this.capturedImageData
        });
        this.showToast('User registered', 'success');
        this.capturedDescriptor = null;
        this.capturedImageData = null;
        document.getElementById('capture-preview').classList.add('hidden');
        document.getElementById('capture-btn').classList.remove('hidden');
        document.getElementById('retake-btn').classList.add('hidden');
        document.getElementById('register-form').reset();
        await this.loadData();
      } catch (e) { this.showToast(e.message, 'error'); }
    });
  },

  async startRegisterCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' } });
      this.registerVideo.srcObject = stream;
      await this.registerVideo.play();
      this.registerOverlay.width = this.registerVideo.videoWidth;
      this.registerOverlay.height = this.registerVideo.videoHeight;
      this.startRegisterDetection();
    } catch (e) { this.showToast('Camera access denied', 'error'); }
  },

  startRegisterDetection() {
    clearInterval(this.registerDetectionInterval);
    this.registerDetectionInterval = setInterval(async () => {
      if (!FaceAPI.modelsLoaded) return;
      try {
        const detections = await FaceAPI.detectFace(this.registerVideo);
        FaceAPI.clearCanvas(this.registerOverlay);
        document.getElementById('capture-btn').disabled = detections.length !== 1;
        if (detections.length === 1) FaceAPI.drawFaceBox(this.registerOverlay, detections[0], '#10b981');
      } catch (e) {}
    }, 500);
  },

  renderUsers() {
    const grid = document.getElementById('users-grid');
    document.getElementById('user-count').textContent = this.users.length;
    
    if (this.users.length === 0) {
      grid.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:40px;">No users registered</p>';
      return;
    }

    grid.innerHTML = this.users.map(u => `
      <div class="user-card">
        <div class="user-avatar">${u.image_data ? `<img src="${u.image_data}" alt="">` : u.name.charAt(0)}</div>
        <h4>${u.name}</h4>
        <p>${u.employee_id}</p>
        <button class="btn btn-danger" onclick="App.deleteUser(${u.id})">Delete</button>
      </div>
    `).join('');
  },

  async deleteUser(id) {
    if (!confirm('Delete this user?')) return;
    try {
      await API.deleteUser(id);
      this.showToast('User deleted');
      await this.loadData();
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  setupLogs() {
    document.getElementById('log-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('log-date').addEventListener('change', () => this.renderLogs());
    document.getElementById('log-user').addEventListener('change', () => this.renderLogs());
    document.getElementById('export-btn').addEventListener('click', () => this.exportCSV());
  },

  populateUserFilter() {
    const select = document.getElementById('log-user');
    select.innerHTML = '<option value="">All Users</option>' + 
      this.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  },

  async renderLogs() {
    const tbody = document.getElementById('logs-tbody');
    const date = document.getElementById('log-date').value;
    const userId = document.getElementById('log-user').value;
    
    try {
      const records = await API.getAttendance({ date, userId: userId || undefined });
      if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary)">No records found</td></tr>';
        return;
      }

      tbody.innerHTML = records.map(r => {
        const checkIn = new Date(r.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const checkOut = r.check_out ? new Date(r.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
        let duration = '-';
        if (r.check_in && r.check_out) {
          const mins = Math.round((new Date(r.check_out) - new Date(r.check_in)) / 60000);
          duration = `${Math.floor(mins / 60)}h ${mins % 60}m`;
        }
        return `<tr><td>${r.date}</td><td>${r.name}</td><td>${checkIn}</td><td>${checkOut}</td><td>${duration}</td></tr>`;
      }).join('');
    } catch (e) { this.showToast('Failed to load logs', 'error'); }
  },

  async exportCSV() {
    try {
      const records = await API.exportAttendance();
      const headers = ['Date', 'Employee ID', 'Name', 'Check In', 'Check Out'];
      const rows = records.map(r => [
        r.date, r.employee_id, r.name,
        new Date(r.check_in).toLocaleString(),
        r.check_out ? new Date(r.check_out).toLocaleString() : ''
      ]);
      const csv = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      this.showToast('Exported', 'success');
    } catch (e) { this.showToast('Export failed', 'error'); }
  },

  showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type;
    setTimeout(() => toast.classList.add('hidden'), 3000);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('auth') === 'success') {
  window.history.replaceState({}, '', '/');
  setTimeout(() => App.checkAuth(), 100);
}
