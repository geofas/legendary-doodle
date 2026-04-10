/**
 * Uno Tracker - Main App Controller
 *
 * Wires together: setup screen, game state, camera auto-detection,
 * countdown confirmation, manual fallback pickers, and TTS announcements.
 */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const screens = {
    welcome: $('#screen-welcome'),
    setup: $('#screen-setup'),
    game: $('#screen-game')
  };

  const els = {
    // Welcome / Setup
    btnStart: $('#btn-start'),
    playerList: $('#player-list'),
    inputPlayerName: $('#input-player-name'),
    btnAddPlayer: $('#btn-add-player'),
    btnBeginGame: $('#btn-begin-game'),
    setupError: $('#setup-error'),

    // Game screen
    directionArrow: $('#direction-arrow'),
    directionLabel: $('#direction-label'),
    currentPlayerName: $('#current-player-name'),
    cameraFeed: $('#camera-feed'),
    cameraCanvas: $('#camera-canvas'),
    scanStatus: $('#scan-status'),
    scanStatusText: $('#scan-status-text'),
    detectedChip: $('#detected-chip'),
    detectedChipText: $('#detected-chip-text'),
    currentCardDisplay: $('#current-card-display'),
    btnDrawCard: $('#btn-draw-card'),
    btnManualEntry: $('#btn-manual-entry'),
    btnWildEntry: $('#btn-wild-entry'),
    playerRing: $('#player-ring'),
    btnMenu: $('#btn-menu'),

    // Action picker (color known, value unknown)
    actionPicker: $('#action-picker'),
    actionPickerColor: $('#action-picker-color'),
    btnActionPickerCancel: $('#btn-action-picker-cancel'),

    // Wild picker
    wildPicker: $('#wild-picker'),
    btnWildPickerCancel: $('#btn-wild-picker-cancel'),

    // Countdown overlay
    overlayCountdown: $('#overlay-countdown'),
    countdownCard: $('#countdown-card'),
    countdownTimer: $('#countdown-timer'),
    btnCountdownCancel: $('#btn-countdown-cancel'),
    btnCountdownPlay: $('#btn-countdown-play'),

    // Announcement
    overlayAnnouncement: $('#overlay-announcement'),
    playedCardDisplay: $('#played-card-display'),
    nextPlayerAnnounce: $('#next-player-announce'),
    specialAction: $('#special-action'),
    btnDismissAnnouncement: $('#btn-dismiss-announcement'),

    // Manual entry overlay
    overlayManual: $('#overlay-manual'),
    btnManualCancel: $('#btn-manual-cancel'),
    btnManualPlay: $('#btn-manual-play'),

    // Menu
    overlayMenu: $('#overlay-menu'),
    btnUndo: $('#btn-undo'),
    btnNewGame: $('#btn-new-game'),
    btnCloseMenu: $('#btn-close-menu')
  };

  // ====== STATE ======
  let players = [];
  let game = null;
  let camera = null;
  let pendingDetection = null;   // card being confirmed via countdown
  let countdownInterval = null;
  let manualSelectedColor = null;
  let manualSelectedValue = null;

  // ====== SCREEN MANAGEMENT ======
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    els.btnMenu.classList.toggle('hidden', name !== 'game');
  }

  // ====== WELCOME SCREEN ======
  els.btnStart.addEventListener('click', () => {
    showScreen('setup');
    els.inputPlayerName.focus();
  });

  // ====== SETUP SCREEN ======
  function addPlayer(name) {
    name = name.trim();
    if (!name) return;
    if (players.length >= 10) {
      showSetupError('Maximum 10 players');
      return;
    }
    if (players.some(p => p.toLowerCase() === name.toLowerCase())) {
      showSetupError('Name already used');
      return;
    }
    players.push(name);
    renderPlayerList();
    els.inputPlayerName.value = '';
    els.inputPlayerName.focus();
    hideSetupError();
  }

  function removePlayer(index) {
    players.splice(index, 1);
    renderPlayerList();
  }

  function renderPlayerList() {
    els.playerList.innerHTML = players.map((name, i) => `
      <div class="player-item">
        <span class="player-number">${i + 1}</span>
        <span class="player-name">${escapeHtml(name)}</span>
        <button class="btn-remove" data-index="${i}" aria-label="Remove ${escapeHtml(name)}">&times;</button>
      </div>
    `).join('');

    if (players.length >= 2) {
      els.btnBeginGame.disabled = false;
      els.btnBeginGame.textContent = `Begin Game (${players.length} players)`;
    } else {
      els.btnBeginGame.disabled = true;
      els.btnBeginGame.textContent = `Begin Game (need ${2 - players.length} more)`;
    }

    $$('.quick-player').forEach(btn => {
      const name = btn.dataset.name;
      btn.disabled = players.some(p => p.toLowerCase() === name.toLowerCase());
    });
  }

  function showSetupError(msg) {
    els.setupError.textContent = msg;
    els.setupError.classList.remove('hidden');
  }
  function hideSetupError() {
    els.setupError.classList.add('hidden');
  }

  els.btnAddPlayer.addEventListener('click', () => addPlayer(els.inputPlayerName.value));
  els.inputPlayerName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPlayer(els.inputPlayerName.value);
  });
  els.playerList.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove');
    if (btn) removePlayer(parseInt(btn.dataset.index, 10));
  });
  $$('.quick-player').forEach(btn => {
    btn.addEventListener('click', () => addPlayer(btn.dataset.name));
  });
  els.btnBeginGame.addEventListener('click', () => {
    if (players.length >= 2) startGame();
  });

  // ====== GAME START ======
  async function startGame() {
    game = new UnoGame(players);
    showScreen('game');
    updateGameUI();

    // Initialize camera
    camera = new UnoCamera(els.cameraFeed, els.cameraCanvas);
    camera.onStatus = handleCameraStatus;
    camera.onColorDetected = handleLiveColor;
    camera.onCardDetected = handleCardDetected;
    camera.onColorStableNoValue = handleColorOnlyDetected;

    const ok = await camera.start();
    if (ok) {
      camera.startScanning();
    } else {
      updateScanStatus('Camera blocked - use Manual button', 'error');
    }
  }

  // ====== CAMERA CALLBACKS ======
  function handleCameraStatus(text, type) {
    updateScanStatus(text, type);
  }

  function updateScanStatus(text, type) {
    els.scanStatusText.textContent = text;
    els.scanStatus.className = 'scan-status status-' + (type || 'info');
  }

  function handleLiveColor(color) {
    if (color === 'none') {
      els.detectedChip.classList.add('hidden');
      return;
    }
    els.detectedChip.classList.remove('hidden');
    els.detectedChip.className = 'detected-chip chip-' + color;
    els.detectedChipText.textContent = color === 'wild' ? 'Wild' :
      color.charAt(0).toUpperCase() + color.slice(1);
  }

  function handleCardDetected(card) {
    // Full auto-detect: show countdown overlay
    startCountdown(card);
  }

  function handleColorOnlyDetected(color) {
    // OCR failed or wild card - open action picker for this color
    if (color === 'wild') {
      openWildPicker();
    } else {
      openActionPicker(color);
    }
  }

  // ====== ACTION PICKER (color known, value manual) ======
  function openActionPicker(color) {
    if (camera) camera.pauseDetection();

    els.actionPicker.classList.remove('hidden');
    els.actionPicker.className = 'action-picker picker-' + color;
    els.actionPickerColor.textContent = color.charAt(0).toUpperCase() + color.slice(1);
    els.actionPicker.dataset.color = color;
  }

  function closeActionPicker() {
    els.actionPicker.classList.add('hidden');
    if (camera) {
      camera.resetDetection();
      camera.resumeDetection();
    }
  }

  $$('.btn-action-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = els.actionPicker.dataset.color;
      const value = btn.dataset.value;
      els.actionPicker.classList.add('hidden');
      playCard(color, value);
    });
  });

  els.btnActionPickerCancel.addEventListener('click', closeActionPicker);

  // ====== WILD PICKER ======
  function openWildPicker() {
    if (camera) camera.pauseDetection();
    els.wildPicker.classList.remove('hidden');
  }

  function closeWildPicker() {
    els.wildPicker.classList.add('hidden');
    if (camera) {
      camera.resetDetection();
      camera.resumeDetection();
    }
  }

  $$('.btn-wild-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      const value = btn.dataset.value;
      els.wildPicker.classList.add('hidden');
      playCard(color, value);
    });
  });

  els.btnWildPickerCancel.addEventListener('click', closeWildPicker);

  // ====== COUNTDOWN OVERLAY ======
  function startCountdown(card) {
    pendingDetection = card;
    if (camera) camera.pauseDetection();

    const cardClass = card.color === 'wild' ? 'card-wild' : `card-${card.color}`;
    els.countdownCard.className = `countdown-card ${cardClass}`;
    const colorLabel = card.color.charAt(0).toUpperCase() + card.color.slice(1);
    els.countdownCard.textContent = `${colorLabel} ${UnoGame.valueDisplay(card.value)}`;

    let remaining = 2;
    els.countdownTimer.textContent = remaining;
    els.overlayCountdown.classList.remove('hidden');

    speak(`${colorLabel} ${UnoGame.valueDisplay(card.value)}`);

    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        confirmCountdown();
      } else {
        els.countdownTimer.textContent = remaining;
      }
    }, 1000);
  }

  function cancelCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    els.overlayCountdown.classList.add('hidden');
    pendingDetection = null;
    if (camera) {
      camera.resetDetection();
      camera.resumeDetection();
    }
  }

  function confirmCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    els.overlayCountdown.classList.add('hidden');
    if (pendingDetection) {
      const card = pendingDetection;
      pendingDetection = null;
      playCard(card.color, card.value);
    }
  }

  els.btnCountdownCancel.addEventListener('click', cancelCountdown);
  els.btnCountdownPlay.addEventListener('click', confirmCountdown);

  // ====== PLAY / DRAW ======
  function playCard(color, value) {
    const result = game.playCard(color, value);
    showAnnouncement(result);
  }

  els.btnDrawCard.addEventListener('click', () => {
    if (!game) return;
    const result = game.drawCard();
    showAnnouncement(result);
  });

  // ====== ANNOUNCEMENT ======
  function showAnnouncement(result) {
    const { card, nextPlayer, actionMessage } = result;

    if (camera) camera.pauseDetection();

    if (card) {
      const cardClass = card.color === 'wild' ? 'card-wild' : `card-${card.color}`;
      els.playedCardDisplay.className = `played-card-display ${cardClass}`;
      els.playedCardDisplay.textContent = UnoGame.valueDisplay(card.value);
    } else {
      els.playedCardDisplay.className = 'played-card-display card-draw';
      els.playedCardDisplay.textContent = 'Drew a card';
    }

    els.nextPlayerAnnounce.textContent = nextPlayer;
    els.specialAction.textContent = actionMessage || '';
    els.overlayAnnouncement.classList.remove('hidden');

    speak(`${nextPlayer}'s turn` + (actionMessage ? `. ${actionMessage}` : ''));
  }

  els.btnDismissAnnouncement.addEventListener('click', () => {
    els.overlayAnnouncement.classList.add('hidden');
    updateGameUI();
    if (camera) {
      camera.resetDetection();
      camera.resumeDetection();
    }
  });

  // ====== GAME UI ======
  function updateGameUI() {
    els.directionArrow.classList.toggle('counter-clockwise', game.direction === -1);
    els.directionLabel.textContent = game.directionName;
    els.currentPlayerName.textContent = game.currentPlayer;
    updateCurrentCardDisplay();
    renderPlayerRing();
  }

  function updateCurrentCardDisplay() {
    const card = game.currentCard;
    if (!card) {
      els.currentCardDisplay.className = 'current-card-display card-none';
      els.currentCardDisplay.textContent = 'None yet';
      return;
    }
    const cardClass = card.color === 'wild' ? 'card-wild' : `card-${card.color}`;
    els.currentCardDisplay.className = `current-card-display ${cardClass}`;
    const colorLabel = card.color.charAt(0).toUpperCase() + card.color.slice(1);
    els.currentCardDisplay.textContent = `${colorLabel} ${UnoGame.valueDisplay(card.value)}`;
  }

  function renderPlayerRing() {
    const order = game.getPlayerOrder();
    els.playerRing.innerHTML = order.map((p, i) => {
      let cls = 'ring-player';
      if (i === 0) cls += ' active';
      else if (i === 1) cls += ' next';
      return `<div class="${cls}">${escapeHtml(p.name)}</div>`;
    }).join('');
  }

  // ====== MANUAL ENTRY OVERLAY ======
  els.btnManualEntry.addEventListener('click', () => {
    openManual();
  });

  els.btnWildEntry.addEventListener('click', () => {
    openWildPicker();
  });

  function openManual() {
    if (camera) camera.pauseDetection();
    manualSelectedColor = null;
    manualSelectedValue = null;
    $$('#overlay-manual .btn-color').forEach(b => b.classList.remove('selected'));
    $$('#overlay-manual .btn-value').forEach(b => {
      b.classList.remove('selected');
      b.style.opacity = '1';
      b.disabled = false;
    });
    els.btnManualPlay.disabled = true;
    els.btnManualPlay.textContent = 'Play Card';
    els.overlayManual.classList.remove('hidden');
  }

  function closeManual() {
    els.overlayManual.classList.add('hidden');
    if (camera) {
      camera.resetDetection();
      camera.resumeDetection();
    }
  }

  $$('#overlay-manual .btn-color').forEach(btn => {
    btn.addEventListener('click', () => {
      manualSelectedColor = btn.dataset.color;
      $$('#overlay-manual .btn-color').forEach(b => b.classList.toggle('selected', b === btn));
      updateManualValueButtons();
      updateManualPlayButton();
    });
  });

  $$('#overlay-manual .btn-value').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      manualSelectedValue = btn.dataset.value;
      $$('#overlay-manual .btn-value').forEach(b => b.classList.toggle('selected', b === btn));
      if ((manualSelectedValue === 'wild' || manualSelectedValue === 'wild4') && !manualSelectedColor) {
        manualSelectedColor = 'wild';
        $$('#overlay-manual .btn-color').forEach(b => b.classList.toggle('selected', b.dataset.color === 'wild'));
        updateManualValueButtons();
      }
      updateManualPlayButton();
    });
  });

  function updateManualValueButtons() {
    const isWild = manualSelectedColor === 'wild';
    $$('#overlay-manual .btn-value').forEach(b => {
      const v = b.dataset.value;
      const isWildValue = v === 'wild' || v === 'wild4';
      if (isWild) {
        b.disabled = !isWildValue;
        b.style.opacity = isWildValue ? '1' : '0.3';
      } else {
        b.disabled = v === 'wild';
        b.style.opacity = v === 'wild' ? '0.3' : '1';
      }
    });
  }

  function updateManualPlayButton() {
    els.btnManualPlay.disabled = !(manualSelectedColor && manualSelectedValue);
    if (manualSelectedColor && manualSelectedValue) {
      const colorLabel = manualSelectedColor.charAt(0).toUpperCase() + manualSelectedColor.slice(1);
      els.btnManualPlay.textContent = `Play ${colorLabel} ${UnoGame.valueDisplay(manualSelectedValue)}`;
    }
  }

  els.btnManualCancel.addEventListener('click', closeManual);
  els.btnManualPlay.addEventListener('click', () => {
    if (!manualSelectedColor || !manualSelectedValue) return;
    els.overlayManual.classList.add('hidden');
    playCard(manualSelectedColor, manualSelectedValue);
  });

  // ====== MENU ======
  els.btnMenu.addEventListener('click', () => {
    if (camera) camera.pauseDetection();
    els.overlayMenu.classList.remove('hidden');
  });

  els.btnCloseMenu.addEventListener('click', () => {
    els.overlayMenu.classList.add('hidden');
    if (camera) camera.resumeDetection();
  });

  els.btnUndo.addEventListener('click', () => {
    if (game && game.undo()) {
      els.overlayMenu.classList.add('hidden');
      updateGameUI();
      speak(`Undone. ${game.currentPlayer}'s turn.`);
      if (camera) {
        camera.resetDetection();
        camera.resumeDetection();
      }
    }
  });

  els.btnNewGame.addEventListener('click', () => {
    els.overlayMenu.classList.add('hidden');
    if (camera) camera.stop();
    camera = null;
    game = null;
    showScreen('setup');
  });

  // ====== TEXT-TO-SPEECH ======
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      const v = voices.find(vc => vc.lang.startsWith('en') && vc.localService);
      if (v) u.voice = v;
    }
    window.speechSynthesis.speak(u);
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  // ====== UTILITIES ======
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ====== SERVICE WORKER ======
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  // ====== PREVENT DOUBLE-TAP ZOOM ======
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  }, false);

})();
