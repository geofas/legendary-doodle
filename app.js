/**
 * Uno Tracker - Main App Controller
 *
 * Manages screen navigation, player setup, card selection UI,
 * camera integration, game flow, and text-to-speech announcements.
 */

(function () {
  'use strict';

  // ====== DOM REFS ======
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const screens = {
    welcome: $('#screen-welcome'),
    setup: $('#screen-setup'),
    game: $('#screen-game')
  };

  const els = {
    // Welcome
    btnStart: $('#btn-start'),

    // Setup
    playerList: $('#player-list'),
    inputPlayerName: $('#input-player-name'),
    btnAddPlayer: $('#btn-add-player'),
    btnBeginGame: $('#btn-begin-game'),
    setupError: $('#setup-error'),

    // Game
    directionArrow: $('#direction-arrow'),
    directionLabel: $('#direction-label'),
    currentPlayerName: $('#current-player-name'),
    cameraFeed: $('#camera-feed'),
    cameraCanvas: $('#camera-canvas'),
    colorIndicator: $('#color-indicator'),
    detectedColorLabel: $('#detected-color-label'),
    playerRing: $('#player-ring'),
    btnPlayCard: $('#btn-play-card'),
    btnMenu: $('#btn-menu'),

    // Announcement overlay
    overlayAnnouncement: $('#overlay-announcement'),
    playedCardDisplay: $('#played-card-display'),
    nextPlayerAnnounce: $('#next-player-announce'),
    specialAction: $('#special-action'),
    btnDismissAnnouncement: $('#btn-dismiss-announcement'),

    // Menu overlay
    overlayMenu: $('#overlay-menu'),
    btnUndo: $('#btn-undo'),
    btnNewGame: $('#btn-new-game'),
    btnCloseMenu: $('#btn-close-menu')
  };

  // ====== STATE ======
  let players = [];
  let game = null;
  let camera = null;
  let selectedColor = null;
  let selectedValue = null;

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

    // Update begin button
    if (players.length >= 2) {
      els.btnBeginGame.disabled = false;
      els.btnBeginGame.textContent = `Begin Game (${players.length} players)`;
    } else {
      els.btnBeginGame.disabled = true;
      els.btnBeginGame.textContent = `Begin Game (need ${2 - players.length} more)`;
    }

    // Update quick-add buttons visibility
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

  els.btnAddPlayer.addEventListener('click', () => {
    addPlayer(els.inputPlayerName.value);
  });

  els.inputPlayerName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addPlayer(els.inputPlayerName.value);
    }
  });

  els.playerList.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.btn-remove');
    if (removeBtn) {
      removePlayer(parseInt(removeBtn.dataset.index, 10));
    }
  });

  $$('.quick-player').forEach(btn => {
    btn.addEventListener('click', () => addPlayer(btn.dataset.name));
  });

  els.btnBeginGame.addEventListener('click', () => {
    if (players.length < 2) return;
    startGame();
  });

  // ====== GAME START ======
  async function startGame() {
    game = new UnoGame(players);

    // Initialize camera
    camera = new UnoCamera(els.cameraFeed, els.cameraCanvas);
    const cameraOk = await camera.start();

    if (cameraOk) {
      camera.onColorDetected = onCameraColorDetected;
      camera.startDetection();
    } else {
      // Camera not available - that's OK, manual selection still works
      els.colorIndicator.innerHTML = '<span>Camera unavailable - select color manually</span>';
    }

    showScreen('game');
    updateGameUI();
  }

  // ====== CAMERA COLOR DETECTION ======
  function onCameraColorDetected(color) {
    // Highlight the detected color in the UI
    els.colorIndicator.className = 'color-indicator detected-' + color;
    els.detectedColorLabel.textContent = `Detected: ${color.charAt(0).toUpperCase() + color.slice(1)}`;

    // Auto-select the detected color (but don't override manual selection)
    if (!selectedColor) {
      selectColor(color);
    }
  }

  // ====== CARD SELECTION ======
  function selectColor(color) {
    selectedColor = color;
    $$('.btn-color').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.color === color);
    });
    updatePlayButton();

    // If wild color selected, filter value buttons to show only wild values
    updateValueButtonsForColor(color);
  }

  function selectValue(value) {
    selectedValue = value;
    $$('.btn-value').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.value === value);
    });
    updatePlayButton();

    // If wild/wild4 value selected, auto-select wild color if no color yet
    if ((value === 'wild' || value === 'wild4') && !selectedColor) {
      selectColor('wild');
    }
  }

  function updateValueButtonsForColor(color) {
    // Wild color: only wild and wild4 values make sense
    if (color === 'wild') {
      $$('.btn-value').forEach(btn => {
        const v = btn.dataset.value;
        if (v === 'wild' || v === 'wild4') {
          btn.style.opacity = '1';
          btn.disabled = false;
        } else {
          btn.style.opacity = '0.3';
          btn.disabled = true;
        }
      });
      // Auto-select wild if no value selected
      if (!selectedValue || (selectedValue !== 'wild' && selectedValue !== 'wild4')) {
        selectValue('wild');
      }
    } else {
      // Normal color: all values except plain wild make sense
      $$('.btn-value').forEach(btn => {
        const v = btn.dataset.value;
        if (v === 'wild') {
          btn.style.opacity = '0.3';
          btn.disabled = true;
        } else {
          btn.style.opacity = '1';
          btn.disabled = false;
        }
      });
      // If current selection is 'wild', deselect it
      if (selectedValue === 'wild') {
        selectedValue = null;
        $$('.btn-value').forEach(btn => btn.classList.remove('selected'));
      }
    }
  }

  function updatePlayButton() {
    const canPlay = selectedColor && selectedValue;
    els.btnPlayCard.disabled = !canPlay;

    if (canPlay) {
      const colorLabel = selectedColor.charAt(0).toUpperCase() + selectedColor.slice(1);
      const valueLabel = UnoGame.valueDisplay(selectedValue);
      els.btnPlayCard.textContent = `Play ${colorLabel} ${valueLabel}`;
    } else {
      els.btnPlayCard.textContent = 'Select card to play';
    }
  }

  // Color buttons
  $$('.btn-color').forEach(btn => {
    btn.addEventListener('click', () => selectColor(btn.dataset.color));
  });

  // Value buttons
  $$('.btn-value').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!btn.disabled) selectValue(btn.dataset.value);
    });
  });

  // Play card button
  els.btnPlayCard.addEventListener('click', () => {
    if (!selectedColor || !selectedValue) return;
    playCard(selectedColor, selectedValue);
  });

  // ====== PLAY CARD ======
  function playCard(color, value) {
    const result = game.playCard(color, value);
    showAnnouncement(result);
  }

  function showAnnouncement(result) {
    const { card, nextPlayer, actionMessage, directionChanged, skippedPlayer } = result;

    // Card display
    const cardClass = card.color === 'wild' ? 'card-wild' : `card-${card.color}`;
    els.playedCardDisplay.className = `played-card-display ${cardClass}`;
    els.playedCardDisplay.textContent = UnoGame.valueDisplay(card.value);

    // Next player
    els.nextPlayerAnnounce.textContent = nextPlayer;

    // Special action message
    els.specialAction.textContent = actionMessage || '';

    // Show overlay
    els.overlayAnnouncement.classList.remove('hidden');

    // Text-to-speech
    speak(`${nextPlayer}'s turn` + (actionMessage ? `. ${actionMessage}` : ''));
  }

  els.btnDismissAnnouncement.addEventListener('click', () => {
    els.overlayAnnouncement.classList.add('hidden');
    resetCardSelection();
    updateGameUI();
  });

  function resetCardSelection() {
    selectedColor = null;
    selectedValue = null;
    $$('.btn-color').forEach(btn => btn.classList.remove('selected'));
    $$('.btn-value').forEach(btn => {
      btn.classList.remove('selected');
      btn.style.opacity = '1';
      btn.disabled = false;
    });
    updatePlayButton();

    // Reset camera confidence so it can suggest again
    if (camera) {
      camera.confidenceCount = 0;
      camera.lastDetectedColor = null;
    }
  }

  // ====== UPDATE GAME UI ======
  function updateGameUI() {
    // Direction
    els.directionArrow.classList.toggle('counter-clockwise', game.direction === -1);
    els.directionLabel.textContent = game.directionName;

    // Current player
    els.currentPlayerName.textContent = game.currentPlayer;

    // Player ring
    renderPlayerRing();
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

  // ====== MENU ======
  els.btnMenu.addEventListener('click', () => {
    els.overlayMenu.classList.remove('hidden');
  });

  els.btnCloseMenu.addEventListener('click', () => {
    els.overlayMenu.classList.add('hidden');
  });

  els.btnUndo.addEventListener('click', () => {
    if (game && game.undo()) {
      els.overlayMenu.classList.add('hidden');
      resetCardSelection();
      updateGameUI();
      speak(`Undone. ${game.currentPlayer}'s turn.`);
    }
  });

  els.btnNewGame.addEventListener('click', () => {
    els.overlayMenu.classList.add('hidden');
    if (camera) camera.stop();
    game = null;
    selectedColor = null;
    selectedValue = null;
    showScreen('setup');
  });

  // ====== TEXT-TO-SPEECH ======
  function speak(text) {
    if (!('speechSynthesis' in window)) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Try to pick a good voice
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      const englishVoice = voices.find(v => v.lang.startsWith('en') && v.localService);
      if (englishVoice) utterance.voice = englishVoice;
    }

    window.speechSynthesis.speak(utterance);
  }

  // Pre-load voices (some browsers need this)
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

  // ====== SERVICE WORKER REGISTRATION ======
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {
        // Service worker registration failed - app still works fine
      });
    });
  }

  // ====== PREVENT ZOOM ON DOUBLE TAP ======
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      e.preventDefault();
    }
    lastTouchEnd = now;
  }, false);

})();
