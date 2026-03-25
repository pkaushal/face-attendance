const FaceAPI = {
  modelsLoaded: false,

  async loadModels() {
    const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model';
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
      ]);
      this.modelsLoaded = true;
      return true;
    } catch (error) {
      console.error('Error loading models:', error);
      return false;
    }
  },

  getFaceDetectorOptions() {
    return new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });
  },

  async detectFace(videoElement) {
    if (!this.modelsLoaded) throw new Error('Models not loaded');
    return faceapi.detectAllFaces(videoElement, this.getFaceDetectorOptions())
      .withFaceLandmarks(true).withFaceDescriptors();
  },

  async captureFaceDescriptor(videoElement) {
    const detections = await this.detectFace(videoElement);
    if (detections.length === 0) throw new Error('No face detected');
    if (detections.length > 1) throw new Error('Multiple faces detected');
    return detections[0].descriptor;
  },

  findMatchingUser(descriptor, users, threshold = 0.4) {
    let bestMatch = null, bestDistance = Infinity;
    for (const user of users) {
      if (!user.faceDescriptor) continue;
      const distance = faceapi.euclideanDistance(descriptor, new Float32Array(user.faceDescriptor));
      if (distance < threshold && distance < bestDistance) {
        bestDistance = distance;
        bestMatch = { ...user, distance };
      }
    }
    return bestMatch;
  },

  drawFaceBox(canvas, detection, color = '#2563eb') {
    const ctx = canvas.getContext('2d');
    const { x, y, width, height } = detection.detection.box;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 8);
    ctx.stroke();
  },

  clearCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
};
