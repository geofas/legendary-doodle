/**
 * Uno Camera Detection Module
 *
 * Detection pipeline:
 * 1. Capture video frame to canvas
 * 2. Detect dominant color via HSV analysis (red/blue/green/yellow/wild)
 * 3. Detect frame stability (card held still) via frame differencing
 * 4. When color is stable + motion is low, capture crop of center
 * 5. Run Tesseract OCR on the crop to read the digit (0-9)
 * 6. Emit detection event
 *
 * Notes:
 * - Tesseract.js is loaded from CDN via script tag
 * - Action cards (Skip/Reverse) are not OCR'd; when color is detected
 *   but no digit is found, caller shows a manual value picker
 */

class UnoCamera {
  constructor(videoEl, canvasEl, scanFrameEl) {
    this.video = videoEl;
    this.canvas = canvasEl;
    this.scanFrameEl = scanFrameEl; // reference element for crop area
    this.ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    this.stream = null;

    // Scanning state
    this.scanning = false;
    this.scanTimer = null;

    // Color detection state
    this.lastDetectedColor = 'none';
    this.colorStableCount = 0;
    this.colorStableThreshold = 3; // frames of same color needed

    // Stability detection state (frame differencing)
    this.lastThumbnail = null;
    this.stableFrameCount = 0;
    this.stableThreshold = 2;
    this.motionThreshold = 8; // average pixel diff below this = stable

    // OCR state
    this.tesseractWorker = null;
    this.tesseractReady = false;
    this.ocrInProgress = false;
    this.ocrCooldownUntil = 0; // wall-clock ms when OCR can run again

    // Prevent re-detecting the same card
    this.detectionCooldownUntil = 0;
    this.detectionCooldownMs = 3000;

    // Callbacks
    this.onStatus = null;          // (text, type) => {}
    this.onColorDetected = null;   // (color) => {} -- live color feedback
    this.onCardDetected = null;    // ({color, value}) => {} -- full detection
    this.onColorStableNoValue = null; // (color) => {} -- stable color but couldn't OCR
  }

  // ====== CAMERA LIFECYCLE ======

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

      await new Promise((resolve) => {
        if (this.video.videoWidth > 0) {
          resolve();
        } else {
          this.video.addEventListener('loadedmetadata', resolve, { once: true });
        }
      });

      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;

      this._status('Camera ready. Loading OCR...', 'info');

      // Initialize Tesseract in background
      this._initTesseract();

      return true;
    } catch (err) {
      console.warn('Camera start failed:', err);
      this._status('Camera unavailable', 'error');
      return false;
    }
  }

  stop() {
    this.stopScanning();
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.tesseractWorker) {
      this.tesseractWorker.terminate().catch(() => {});
      this.tesseractWorker = null;
      this.tesseractReady = false;
    }
  }

  async _initTesseract() {
    if (typeof Tesseract === 'undefined') {
      this._status('OCR library not loaded - color detection only', 'warn');
      return;
    }

    try {
      // Tesseract.js v5 API
      this.tesseractWorker = await Tesseract.createWorker('eng', 1, {
        logger: () => {} // silence logger
      });
      await this.tesseractWorker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: Tesseract.PSM ? Tesseract.PSM.SINGLE_CHAR : '10'
      });
      this.tesseractReady = true;
      this._status('Ready - show a card', 'ready');
    } catch (err) {
      console.warn('Tesseract init failed:', err);
      this._status('OCR failed - color detection only', 'warn');
    }
  }

  // ====== SCANNING LOOP ======

  startScanning() {
    if (this.scanning) return;
    this.scanning = true;
    this._scanLoop();
  }

  stopScanning() {
    this.scanning = false;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
  }

  _scanLoop() {
    if (!this.scanning) return;
    this._scanFrame().finally(() => {
      if (this.scanning) {
        this.scanTimer = setTimeout(() => this._scanLoop(), 200);
      }
    });
  }

  async _scanFrame() {
    if (!this.video.videoWidth) return;

    // Skip if in detection cooldown
    if (Date.now() < this.detectionCooldownUntil) {
      return;
    }

    // Draw frame to canvas
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

    // Detect color in center region
    const color = this._detectCenterColor();

    // Emit live color feedback
    if (this.onColorDetected) {
      this.onColorDetected(color);
    }

    // Update color stability counter
    if (color !== 'none' && color === this.lastDetectedColor) {
      this.colorStableCount++;
    } else {
      this.lastDetectedColor = color;
      this.colorStableCount = color === 'none' ? 0 : 1;
    }

    // Check motion stability
    const stable = this._checkMotionStability();

    // Ready to attempt card detection?
    const colorReady = this.colorStableCount >= this.colorStableThreshold;
    const canTryOcr = this.tesseractReady && !this.ocrInProgress && Date.now() > this.ocrCooldownUntil;

    if (colorReady && stable && color !== 'none' && canTryOcr) {
      if (color === 'wild') {
        // Wild cards can't be OCR'd reliably - ask user
        this._triggerColorWithoutValue(color);
      } else {
        await this._tryRecognizeDigit(color);
      }
    }
  }

  // ====== COLOR DETECTION ======

  _detectCenterColor() {
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Sample center 40% of the frame
    const sw = Math.floor(w * 0.4);
    const sh = Math.floor(h * 0.4);
    const sx = Math.floor((w - sw) / 2);
    const sy = Math.floor((h - sh) / 2);

    const img = this.ctx.getImageData(sx, sy, sw, sh);
    const pixels = img.data;

    const counts = { red: 0, blue: 0, green: 0, yellow: 0, none: 0 };
    const step = 16; // sample every 16th pixel for speed

    // Also track if there's significant multi-color (wild card signal)
    let colorVariety = 0;

    for (let i = 0; i < pixels.length; i += 4 * step) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const cat = this._classifyPixel(r, g, b);
      counts[cat]++;
    }

    const totalColored = counts.red + counts.blue + counts.green + counts.yellow;
    const totalSampled = totalColored + counts.none;

    // Need at least 25% of sampled pixels to be Uno colors
    if (totalColored / totalSampled < 0.25) {
      return 'none';
    }

    // Check for Wild card: multiple colors each >15%
    const colorsAbove15 = ['red', 'blue', 'green', 'yellow']
      .filter(c => counts[c] / totalColored > 0.15).length;
    if (colorsAbove15 >= 3) {
      return 'wild';
    }

    // Dominant color must be >= 50% of colored pixels
    let dominant = 'none';
    let maxCount = 0;
    for (const c of ['red', 'blue', 'green', 'yellow']) {
      if (counts[c] > maxCount) {
        maxCount = counts[c];
        dominant = c;
      }
    }

    if (maxCount / totalColored < 0.5) {
      return 'none';
    }

    return dominant;
  }

  _classifyPixel(r, g, b) {
    const { h, s, v } = this._rgbToHsv(r, g, b);

    // Filter out too dark, too light, or too unsaturated
    if (v < 0.18 || s < 0.30) return 'none';
    if (v > 0.93 && s < 0.20) return 'none'; // white-ish

    // Red: wraps around 0
    if ((h >= 340 || h <= 15) && s > 0.45) return 'red';
    // Orange-reds that Uno red sometimes looks like
    if (h > 15 && h <= 28 && s > 0.55) return 'red';

    // Yellow: 38-68
    if (h > 38 && h <= 68 && s > 0.35) return 'yellow';

    // Green: 85-175
    if (h > 85 && h <= 175 && s > 0.35) return 'green';

    // Blue: 195-260
    if (h > 195 && h <= 260 && s > 0.35) return 'blue';

    return 'none';
  }

  _rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      else if (max === g) h = ((b - r) / d + 2) * 60;
      else h = ((r - g) / d + 4) * 60;
    }
    return { h, s, v };
  }

  // ====== MOTION STABILITY ======

  _checkMotionStability() {
    // Downsample the canvas to a tiny thumbnail and compare to last frame
    const tw = 64;
    const th = 48;

    // Reuse a small canvas
    if (!this._thumbCanvas) {
      this._thumbCanvas = document.createElement('canvas');
      this._thumbCanvas.width = tw;
      this._thumbCanvas.height = th;
      this._thumbCtx = this._thumbCanvas.getContext('2d', { willReadFrequently: true });
    }

    this._thumbCtx.drawImage(this.canvas, 0, 0, tw, th);
    const current = this._thumbCtx.getImageData(0, 0, tw, th).data;

    if (!this.lastThumbnail) {
      this.lastThumbnail = new Uint8ClampedArray(current);
      return false;
    }

    // Average grayscale difference
    let diffSum = 0;
    let count = 0;
    for (let i = 0; i < current.length; i += 4) {
      const curGray = (current[i] + current[i + 1] + current[i + 2]) / 3;
      const lastGray = (this.lastThumbnail[i] + this.lastThumbnail[i + 1] + this.lastThumbnail[i + 2]) / 3;
      diffSum += Math.abs(curGray - lastGray);
      count++;
    }
    const avgDiff = diffSum / count;

    // Save current as last
    this.lastThumbnail.set(current);

    if (avgDiff < this.motionThreshold) {
      this.stableFrameCount++;
    } else {
      this.stableFrameCount = 0;
    }

    return this.stableFrameCount >= this.stableThreshold;
  }

  // ====== OCR / DIGIT RECOGNITION ======

  async _tryRecognizeDigit(color) {
    this.ocrInProgress = true;
    this._status('Reading card...', 'scanning');

    try {
      // Crop the center of the canvas (where the big digit is)
      const w = this.canvas.width;
      const h = this.canvas.height;
      const cropW = Math.floor(w * 0.28);
      const cropH = Math.floor(h * 0.38);
      const cropX = Math.floor((w - cropW) / 2);
      const cropY = Math.floor((h - cropH) / 2);

      // Use a dedicated canvas and preprocess for better OCR
      const ocrCanvas = document.createElement('canvas');
      ocrCanvas.width = cropW;
      ocrCanvas.height = cropH;
      const ocrCtx = ocrCanvas.getContext('2d', { willReadFrequently: true });
      ocrCtx.drawImage(this.canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      // Preprocess: grayscale + threshold to make digits stand out
      this._preprocessForOcr(ocrCtx, cropW, cropH);

      const result = await this.tesseractWorker.recognize(ocrCanvas);
      const text = (result.data.text || '').trim();
      const confidence = result.data.confidence || 0;

      // Try to parse a single digit 0-9
      const digit = this._parseDigit(text);

      if (digit !== null && confidence > 55) {
        // Found it! Emit detection
        this._triggerDetection({ color, value: digit });
      } else {
        // OCR failed - offer manual value pick for this color
        this._triggerColorWithoutValue(color);
      }
    } catch (err) {
      console.warn('OCR error:', err);
      this._triggerColorWithoutValue(color);
    } finally {
      this.ocrInProgress = false;
      // Brief cooldown before next OCR attempt to avoid spamming
      this.ocrCooldownUntil = Date.now() + 800;
    }
  }

  /**
   * Preprocess the OCR crop: convert to grayscale and apply a threshold
   * so digits become black-on-white (or vice versa), which Tesseract
   * handles much better than photos with colored backgrounds.
   */
  _preprocessForOcr(ctx, w, h) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    // First pass: grayscale and find mean luminance
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = gray;
      sum += gray;
    }
    const mean = sum / (d.length / 4);

    // Second pass: threshold around mean - 20 (digits are lighter than bg for most Uno cards since background is colored and digits are white)
    // But also handle the inverse case
    const threshold = Math.max(100, Math.min(200, mean));
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] > threshold ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }

    ctx.putImageData(img, 0, 0);
  }

  _parseDigit(text) {
    // Strip whitespace and non-digits
    const clean = text.replace(/[^\d]/g, '');
    if (clean.length === 0) return null;

    // If multiple digits came back, prefer the most common
    // (Uno cards have the big center digit + two small corner digits)
    const counts = {};
    for (const ch of clean) {
      counts[ch] = (counts[ch] || 0) + 1;
    }
    let best = null;
    let bestCount = 0;
    for (const [digit, count] of Object.entries(counts)) {
      if (count > bestCount) {
        best = digit;
        bestCount = count;
      }
    }
    return best;
  }

  // ====== DETECTION EVENTS ======

  _triggerDetection(card) {
    this.detectionCooldownUntil = Date.now() + this.detectionCooldownMs;
    this.colorStableCount = 0;
    this.lastDetectedColor = 'none';
    if (this.onCardDetected) this.onCardDetected(card);
  }

  _triggerColorWithoutValue(color) {
    this.detectionCooldownUntil = Date.now() + this.detectionCooldownMs;
    this.colorStableCount = 0;
    this.lastDetectedColor = 'none';
    if (this.onColorStableNoValue) this.onColorStableNoValue(color);
  }

  /**
   * Called by app to reset detection state (after a card is played
   * or the user cancels a detection).
   */
  resetDetection() {
    this.colorStableCount = 0;
    this.lastDetectedColor = 'none';
    this.stableFrameCount = 0;
    this.detectionCooldownUntil = Date.now() + 1500; // short cooldown
  }

  /**
   * Called to pause detection entirely (e.g., when an overlay is shown).
   */
  pauseDetection() {
    this.detectionCooldownUntil = Date.now() + 999999;
  }

  resumeDetection() {
    this.detectionCooldownUntil = Date.now() + 500;
    this.colorStableCount = 0;
    this.stableFrameCount = 0;
  }

  _status(text, type = 'info') {
    if (this.onStatus) this.onStatus(text, type);
  }
}
