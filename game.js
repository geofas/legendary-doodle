/**
 * Uno Game State & Logic
 *
 * Tracks players, direction, current turn, and handles
 * action card effects (Reverse, Skip, Draw Two, Wild Draw Four).
 */

class UnoGame {
  constructor(playerNames) {
    this.players = playerNames.slice();
    this.currentIndex = 0;
    this.direction = 1; // 1 = clockwise, -1 = counter-clockwise
    this.currentCard = null;
    this.history = []; // for undo
    this.turnCount = 0;
  }

  get currentPlayer() {
    return this.players[this.currentIndex];
  }

  get playerCount() {
    return this.players.length;
  }

  /**
   * Returns the next player index without modifying state.
   * Takes into account special card effects.
   */
  peekNextIndex(cardValue) {
    let dir = this.direction;
    let idx = this.currentIndex;

    if (cardValue === 'reverse') {
      dir *= -1;
      // In a 2-player game, Reverse acts as Skip
      if (this.players.length === 2) {
        return idx; // same player goes again
      }
    }

    if (cardValue === 'skip' || cardValue === 'draw2' || cardValue === 'wild4') {
      // Skip the next player (advance twice)
      idx = (idx + dir + this.playerCount) % this.playerCount;
      idx = (idx + dir + this.playerCount) % this.playerCount;

      // For 2-player reverse already handled above
      if (cardValue !== 'skip' || this.players.length !== 2) {
        // skip/draw2/wild4: skip next, land on the one after
      }

      if (cardValue === 'reverse') {
        // Already handled above, this branch won't hit
      }

      return idx;
    }

    // Normal advance
    idx = (idx + dir + this.playerCount) % this.playerCount;
    return idx;
  }

  /**
   * Play a card. Returns an object describing what happened.
   */
  playCard(color, value) {
    // Save state for undo
    this.history.push({
      currentIndex: this.currentIndex,
      direction: this.direction,
      currentCard: this.currentCard ? { ...this.currentCard } : null,
      turnCount: this.turnCount
    });

    // Keep history manageable
    if (this.history.length > 50) {
      this.history.shift();
    }

    const previousPlayer = this.currentPlayer;
    const previousDirection = this.direction;
    let actionMessage = '';
    let skippedPlayer = null;

    this.currentCard = { color, value };
    this.turnCount++;

    // Handle Reverse
    if (value === 'reverse') {
      this.direction *= -1;
      actionMessage = 'Direction reversed!';

      if (this.players.length === 2) {
        // In 2-player, reverse = skip: current player goes again
        actionMessage = 'Reverse! You go again!';
        return {
          previousPlayer,
          nextPlayer: this.currentPlayer,
          directionChanged: true,
          direction: this.direction,
          actionMessage,
          skippedPlayer: null,
          card: { color, value }
        };
      }
    }

    // Handle Skip
    if (value === 'skip') {
      const skippedIndex = (this.currentIndex + this.direction + this.playerCount) % this.playerCount;
      skippedPlayer = this.players[skippedIndex];
      this.currentIndex = (skippedIndex + this.direction + this.playerCount) % this.playerCount;
      actionMessage = `${skippedPlayer} was skipped!`;

      return {
        previousPlayer,
        nextPlayer: this.currentPlayer,
        directionChanged: false,
        direction: this.direction,
        actionMessage,
        skippedPlayer,
        card: { color, value }
      };
    }

    // Handle Draw Two
    if (value === 'draw2') {
      const skippedIndex = (this.currentIndex + this.direction + this.playerCount) % this.playerCount;
      skippedPlayer = this.players[skippedIndex];
      this.currentIndex = (skippedIndex + this.direction + this.playerCount) % this.playerCount;
      actionMessage = `${skippedPlayer} draws 2 and is skipped!`;

      return {
        previousPlayer,
        nextPlayer: this.currentPlayer,
        directionChanged: false,
        direction: this.direction,
        actionMessage,
        skippedPlayer,
        card: { color, value }
      };
    }

    // Handle Wild Draw Four
    if (value === 'wild4') {
      const skippedIndex = (this.currentIndex + this.direction + this.playerCount) % this.playerCount;
      skippedPlayer = this.players[skippedIndex];
      this.currentIndex = (skippedIndex + this.direction + this.playerCount) % this.playerCount;
      actionMessage = `${skippedPlayer} draws 4 and is skipped!`;

      return {
        previousPlayer,
        nextPlayer: this.currentPlayer,
        directionChanged: false,
        direction: this.direction,
        actionMessage,
        skippedPlayer,
        card: { color, value }
      };
    }

    // Normal card or Wild (no skip)
    const directionChanged = previousDirection !== this.direction;
    this.currentIndex = (this.currentIndex + this.direction + this.playerCount) % this.playerCount;

    if (value === 'wild') {
      actionMessage = `Color changed to ${color}!`;
    }

    return {
      previousPlayer,
      nextPlayer: this.currentPlayer,
      directionChanged,
      direction: this.direction,
      actionMessage,
      skippedPlayer,
      card: { color, value }
    };
  }

  /**
   * Undo the last play.
   */
  undo() {
    if (this.history.length === 0) return false;

    const prev = this.history.pop();
    this.currentIndex = prev.currentIndex;
    this.direction = prev.direction;
    this.currentCard = prev.currentCard;
    this.turnCount = prev.turnCount;
    return true;
  }

  /**
   * Get the direction as a human-readable string.
   */
  get directionName() {
    return this.direction === 1 ? 'Clockwise' : 'Counter-clockwise';
  }

  /**
   * Get display text for a card value.
   */
  static valueDisplay(value) {
    const map = {
      'skip': 'Skip',
      'reverse': 'Reverse',
      'draw2': '+2',
      'wild': 'Wild',
      'wild4': 'Wild +4'
    };
    return map[value] || value;
  }

  /**
   * Get the ordered list of players starting from current,
   * going in the current direction.
   */
  getPlayerOrder() {
    const order = [];
    for (let i = 0; i < this.playerCount; i++) {
      const idx = (this.currentIndex + i * this.direction + this.playerCount * 10) % this.playerCount;
      order.push({ name: this.players[idx], index: idx });
    }
    return order;
  }
}
