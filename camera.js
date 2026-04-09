/**
 * Camera Module
 *
 * Handles front-facing camera access via getUserMedia and
 * performs real-time color detection from the video feed.
 * Detects dominant Uno card colors: red, blue, green, yellow.
 */

class UnoCamera {
  constructor(videoEl, canvasEl) {
    this.video = videoEl;
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    this.stream = null;
    this.detecting = false;
    this.detectionInterval = null;
    this.onColorDetected = null; // callback: (color) => {}
    this.lastDetectedColor = null;
    this.confidenceCount = 0;
    this.requiredConfidence = 3; // frames in a row to confirm
  }

  /**
   * Start the front-facing camera.
   */
  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });

      this.video.srcObject = this.stream;
      await this.video.play();

      // Match canvas to video dimensions
      this.video.addEventListener('loadedmetadata', () => {
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
      });

      return true;
    } catch (err) {
      console.warn('Camera access failed:', err.message);
      return false;
    }
  }

  /**
   * Stop the camera stream.
   */
  stop() {
    this.stopDetection();
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  /**
   * Start periodic color detection from the camera feed.
   */
  startDetection() {
    if (this.detecting) return;
    this.detecting = true;
    this.detectionInterval = setInterval(() => this.detectColor(), 300);
  }

  /**
   * Stop color detection.
   */
  stopDetection() {
    this.detecting = false;
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = null;
    }
  }

  /**
   * Sample the center region of the video frame and detect dominant color.
   */
  detectColor() {
    if (!this.video.videoWidth) return;

    const w = this.video.videoWidth;
    const h = this.video.videoHeight;

    // Sample center 30% of the frame
    const sampleW = Math.floor(w * 0.3);
    const sampleH = Math.floor(h * 0.3);
    const startX = Math.floor((w - sampleW) / 2);
    const startY = Math.floor((h - sampleH) / 2);

    this.ctx.drawImage(this.video, 0, 0, w, h);
    const imageData = this.ctx.getImageData(startX, startY, sampleW, sampleH);
    const pixels = imageData.data;

    // Count pixels by Uno color category
    const counts = { red: 0, blue: 0, green: 0, yellow: 0, none: 0 };
    const step = 16; // sample every 16th pixel for performance

    for (let i = 0; i < pixels.length; i += 4 * step) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];

      const color = this.classifyPixel(r, g, b);
      counts[color]++;
    }

    // Find dominant Uno color (exclude 'none')
    const totalColored = counts.red + counts.blue + counts.green + counts.yellow;
    const totalSampled = totalColored + counts.none;

    // Need at least 20% of pixels to be a Uno color
    if (totalColored / totalSampled < 0.2) {
      this.confidenceCount = 0;
      this.lastDetectedColor = null;
      return;
    }

    let dominant = 'none';
    let maxCount = 0;
    for (const color of ['red', 'blue', 'green', 'yellow']) {
      if (counts[color] > maxCount) {
        maxCount = counts[color];
        dominant = color;
      }
    }

    // The dominant color must be at least 40% of colored pixels
    if (maxCount / totalColored < 0.4) {
      this.confidenceCount = 0;
      return;
    }

    // Require consecutive frames for confidence
    if (dominant === this.lastDetectedColor) {
      this.confidenceCount++;
    } else {
      this.lastDetectedColor = dominant;
      this.confidenceCount = 1;
    }

    if (this.confidenceCount >= this.requiredConfidence && this.onColorDetected) {
      this.onColorDetected(dominant);
    }
  }

  /**
   * Classify a single pixel's RGB values into an Uno color.
   * Uses HSV conversion for more robust color detection.
   */
  classifyPixel(r, g, b) {
    const hsv = this.rgbToHsv(r, g, b);
    const h = hsv.h; // 0-360
    const s = hsv.s; // 0-1
    const v = hsv.v; // 0-1

    // Low saturation or very dark/light = not a card color
    if (s < 0.25 || v < 0.2) return 'none';
    if (v > 0.95 && s < 0.15) return 'none'; // white-ish

    // Red: 0-15 or 345-360 (wraps around)
    if ((h >= 345 || h <= 15) && s > 0.4) return 'red';
    // Also catch orange-reds from Uno red cards
    if (h > 15 && h <= 30 && s > 0.5) return 'red';

    // Yellow: 40-65
    if (h > 40 && h <= 65 && s > 0.3) return 'yellow';

    // Green: 90-170
    if (h > 90 && h <= 170 && s > 0.3) return 'green';

    // Blue: 200-260
    if (h > 200 && h <= 260 && s > 0.3) return 'blue';

    return 'none';
  }

  /**
   * Convert RGB to HSV.
   */
  rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;

    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;

    if (d !== 0) {
      if (max === r) {
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      } else if (max === g) {
        h = ((b - r) / d + 2) * 60;
      } else {
        h = ((r - g) / d + 4) * 60;
      }
    }

    return { h, s, v };
  }
}
