'use strict';

const CARD_NAMES = { slave: '奴隷', emperor: '皇帝', citizen: '市民' };
const HANDS = {
  kaiji:   ['slave',   'citizen', 'citizen', 'citizen', 'citizen'],
  emperor: ['emperor', 'citizen', 'citizen', 'citizen', 'citizen'],
};

class ECardGame {
  constructor() {
    this.peer        = null;
    this.conn        = null;
    this.isHost      = false;
    this.myRole      = null;   // 'kaiji' | 'emperor'
    this.myHand      = [];
    this.score       = { mine: 0, theirs: 0 };
    this.round       = 1;
    this.selectedIdx = null;

    // per-round state
    this.myPlayedCard    = null;
    this.theirPlayedCard = null;
    this.iCommitted      = false;
    this.theyCommitted   = false;
    this.iReadyNext      = false;
    this.theyReadyNext   = false;
  }

  // ─── ネットワーク ───────────────────────────────────────────

  // 合言葉をPeerJS IDに変換（FNV-1aハッシュ）
  _passphraseToId(passphrase) {
    let hash = 0x811c9dc5;
    const s = passphrase.trim().toLowerCase();
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return 'ecard-' + hash.toString(36);
  }

  connect() {
    const passphrase = this.$('passphrase-input').value.trim();
    if (!passphrase) { this.showMsg('合言葉を入力してください'); return; }

    const peerId = this._passphraseToId(passphrase);
    this.showMsg('接続中…');

    // まず同じIDでPeerを作成してみる → 成功すればホスト
    this.peer = new Peer(peerId);

    this.peer.on('open', () => {
      // IDが取れた → ホスト。相手を待つ
      this.isHost = true;
      this.showMsg('');
      this.$('lobby-form').classList.add('hidden');
      this.$('passphrase-display').textContent = passphrase;
      this.$('lobby-waiting').classList.remove('hidden');
    });

    this.peer.on('connection', conn => {
      this.conn = conn;
      this._setupConn();
      this.showScreen('role');
      this.$('role-select').classList.remove('hidden');
    });

    this.peer.on('error', e => {
      if (e.type === 'unavailable-id') {
        // IDが使用中 → ゲストとして接続
        this._connectAsGuest(peerId, passphrase);
      } else {
        this.showMsg('エラー: ' + e.type);
      }
    });
  }

  _connectAsGuest(hostId, passphrase) {
    this.peer.destroy();
    this.isHost = false;
    this.showMsg('マッチング中…');

    this.peer = new Peer();
    this.peer.on('open', () => {
      this.conn = this.peer.connect(hostId, { reliable: true });
      this._setupConn();
    });
    this.peer.on('error', e => this.showMsg('接続失敗: ' + e.type));
  }

  _setupConn() {
    this.conn.on('open', () => {
      if (!this.isHost) {
        this.showScreen('role');
        this.$('role-waiting').classList.remove('hidden');
      }
    });
    this.conn.on('data',  msg => this._onMessage(msg));
    this.conn.on('close', ()  => { alert('接続が切れました'); location.reload(); });
    this.conn.on('error', e   => this.showMsg('通信エラー: ' + e));
  }

  send(msg) {
    if (this.conn?.open) this.conn.send(msg);
  }

  // ─── メッセージ処理 ────────────────────────────────────────

  _onMessage(msg) {
    switch (msg.type) {

      // ホストが役割を決定して送信
      case 'role':
        this.myRole = msg.role;
        this._startGame();
        break;

      // 相手がカードを確定（中身は未公開）
      case 'commit':
        this.theyCommitted = true;
        this._setBattleCard('their-battle-card', 'hidden', true);
        // 自分もコミット済みなら今すぐ公開値を送る
        if (this.iCommitted) this.send({ type: 'reveal', card: this.myPlayedCard });
        this._updateStatus();
        break;

      // 相手のカードを受け取る（両者コミット後に送られる）
      case 'reveal':
        this.theirPlayedCard = msg.card;
        this._tryReveal();
        break;

      // 相手が「次へ」を押した
      case 'next':
        this.theyReadyNext = true;
        this._tryNextRound();
        break;

      // ホストから「勝負決定」通知（ゲスト側のボタン修正用）
      case 'decisive':
        this.roundDecisive = true;
        const btn = this.$('btn-next');
        btn.textContent = 'リザルトを見る';
        break;
    }
  }

  // ─── 役割選択 ──────────────────────────────────────────────

  chooseRole(role) {
    if (!this.isHost) return;
    this.myRole = role;
    const theirRole = role === 'kaiji' ? 'emperor' : 'kaiji';
    this.send({ type: 'role', role: theirRole });
    this._startGame();
  }

  // ─── ゲーム開始・ラウンド描画 ──────────────────────────────

  _startGame() {
    this.myHand = [...HANDS[this.myRole]];
    this.score  = { mine: 0, theirs: 0 };
    this.round  = 1;
    this.showScreen('game');
    this._renderRound();
  }

  _renderRound() {
    // per-round リセット
    this.selectedIdx     = null;
    this.myPlayedCard    = null;
    this.theirPlayedCard = null;
    this.iCommitted      = false;
    this.theyCommitted   = false;
    this.iReadyNext      = false;
    this.theyReadyNext   = false;
    this.roundDecisive   = false;

    const roleLabel = { kaiji: 'カイジ側', emperor: '帝愛側' };
    const theirRole = this.myRole === 'kaiji' ? 'emperor' : 'kaiji';

    this.$('round-num').textContent       = this.round;
    this.$('score-mine').textContent      = this.score.mine;
    this.$('score-theirs').textContent    = this.score.theirs;
    this.$('my-role-name').textContent    = roleLabel[this.myRole];
    this.$('their-role-name').textContent = roleLabel[theirRole];

    this._setBattleCard('my-battle-card',    null);
    this._setBattleCard('their-battle-card', null);

    this.$('result-area').classList.add('hidden');
    this.$('btn-play').classList.add('hidden');
    this.$('hand-zone').classList.remove('hidden');

    this._renderHand();
    this._updateStatus('カードを選んでください');
  }

  // ─── 手札描画・カード選択 ─────────────────────────────────

  _renderHand() {
    const handEl = this.$('hand');
    handEl.innerHTML = '';
    this.myHand.forEach((card, i) => {
      const el = document.createElement('div');
      el.className = `hand-card card-${card}`;
      el.innerHTML = `<span>${CARD_NAMES[card]}</span>`;
      el.onclick = () => this._selectCard(i);
      handEl.appendChild(el);
    });
  }

  _selectCard(i) {
    if (this.iCommitted) return;
    this.selectedIdx = i;
    document.querySelectorAll('.hand-card').forEach((el, j) => {
      el.classList.toggle('selected', j === i);
    });
    this.$('btn-play').classList.remove('hidden');
  }

  playSelected() {
    if (this.selectedIdx === null || this.iCommitted) return;
    this._warmUpAudio();

    const card = this.myHand[this.selectedIdx];
    this.myPlayedCard = card;
    this.iCommitted   = true;

    // 自分のバトルカードを「確定済み（裏向き）」で表示
    this._setBattleCard('my-battle-card', card, true);

    // 手札からカードを除去
    this.myHand.splice(this.selectedIdx, 1);
    this.selectedIdx = null;

    this.$('hand-zone').classList.add('hidden');
    this.$('btn-play').classList.add('hidden');

    // コミットを通知（カード値はまだ送らない）
    this.send({ type: 'commit' });

    // 相手がすでにコミット済みなら即座に公開値を送る
    if (this.theyCommitted) this.send({ type: 'reveal', card: this.myPlayedCard });

    this._updateStatus();
  }

  // ─── サウンド ───────────────────────────────────────────────

  _getAudioCtx() {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this._audioCtx;
  }

  // ユーザー操作のタイミングで AudioContext を起動しておく
  _warmUpAudio() {
    const ctx = this._getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
  }

  _scheduleSnareHit(ctx, time, vol) {
    const len = Math.floor(ctx.sampleRate * 0.06);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(time);
  }

  _startDrumRoll(durationMs) {
    const ctx = this._getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const duration = durationMs / 1000;
    const now = ctx.currentTime;
    const hitCount = 30;
    for (let i = 0; i < hitCount; i++) {
      const progress = i / (hitCount - 1);
      const t = now + duration * (progress * progress);
      const vol = 0.25 + progress * 0.55;
      this._scheduleSnareHit(ctx, t, vol);
    }
  }

  _playBangSound() {
    const ctx = this._getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;

    // 全体をブーストしてからコンプレッサーでリミット
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.ratio.value     = 6;
    comp.attack.value    = 0.001;
    comp.release.value   = 0.1;
    comp.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = 2.5;
    master.connect(comp);

    // メインキック: 320Hz → 90Hz（スマホ対応）
    const osc1 = ctx.createOscillator();
    const g1   = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(320, now);
    osc1.frequency.exponentialRampToValueAtTime(90, now + 0.3);
    g1.gain.setValueAtTime(1.0, now);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc1.connect(g1); g1.connect(master);
    osc1.start(now); osc1.stop(now + 0.6);

    // 倍音で厚みを出す: 640Hz → 180Hz
    const osc2 = ctx.createOscillator();
    const g2   = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(640, now);
    osc2.frequency.exponentialRampToValueAtTime(180, now + 0.18);
    g2.gain.setValueAtTime(0.7, now);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc2.connect(g2); g2.connect(master);
    osc2.start(now); osc2.stop(now + 0.3);

    // アタック感ノイズ
    const noiseLen  = Math.floor(ctx.sampleRate * 0.1);
    const noiseBuf  = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
    }
    const noiseSrc  = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    const gNoise    = ctx.createGain();
    gNoise.gain.setValueAtTime(1.0, now);
    gNoise.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    noiseSrc.connect(gNoise); gNoise.connect(master);
    noiseSrc.start(now);
  }

  // ─── 公開・結果 ────────────────────────────────────────────

  _tryReveal() {
    if (!this.myPlayedCard || !this.theirPlayedCard) return;

    // 結果は先に計算（アニメーション中もスコアは確定済みにする）
    const result = this._getResult();
    if (result === 'mine')   this.score.mine++;
    if (result === 'theirs') this.score.theirs++;

    this.roundDecisive = (result !== 'draw');
    if (this.isHost && this.roundDecisive) this.send({ type: 'decisive' });

    this._updateStatus('');

    const myEl    = this.$('my-battle-card');
    const theirEl = this.$('their-battle-card');

    // ① 揺れる + ドラムロール
    myEl.classList.add('card-shaking');
    theirEl.classList.add('card-shaking');
    this._startDrumRoll(1500);

    setTimeout(() => {
      myEl.classList.remove('card-shaking');
      theirEl.classList.remove('card-shaking');

      // ② 折り畳む（flip-out）
      myEl.classList.add('card-flip-out');
      theirEl.classList.add('card-flip-out');

      setTimeout(() => {
        // ③ 中身を差し替えてバン！と開く（flip-in）
        myEl.classList.remove('card-flip-out');
        theirEl.classList.remove('card-flip-out');

        this._setBattleCard('my-battle-card',    this.myPlayedCard,    false);
        this._setBattleCard('their-battle-card', this.theirPlayedCard, false);

        this._playBangSound();
        myEl.classList.add('card-flip-in', 'card-glow');
        theirEl.classList.add('card-flip-in', 'card-glow');

        setTimeout(() => {
          myEl.classList.remove('card-flip-in', 'card-glow');
          theirEl.classList.remove('card-flip-in', 'card-glow');

          // ④ 結果表示
          this._showRoundResult(result);
        }, 300);
      }, 150); // flip-out の長さ
    }, 1500);  // 揺れの長さ
  }

  _showRoundResult(result) {
    this.$('score-mine').textContent   = this.score.mine;
    this.$('score-theirs').textContent = this.score.theirs;

    const myName    = CARD_NAMES[this.myPlayedCard];
    const theirName = CARD_NAMES[this.theirPlayedCard];

    const textMap  = { mine: 'あなたの勝ち！', theirs: '相手の勝ち…', draw: '引き分け' };
    const classMap = { mine: 'result-win', theirs: 'result-lose', draw: 'result-draw' };

    const rt = this.$('result-text');
    rt.textContent = textMap[result];
    rt.className   = 'result-text ' + classMap[result];
    this.$('result-detail').textContent = `あなた: ${myName}　相手: ${theirName}`;

    this.$('result-area').classList.remove('hidden');

    const btn = this.$('btn-next');
    btn.disabled = false;
    if (this.roundDecisive) {
      btn.textContent = 'リザルトを見る';
    } else if (this.round >= 5) {
      btn.textContent = '結果を見る';
    } else {
      btn.textContent = '次のラウンドへ';
    }
  }

  _getResult() {
    const mine   = this.myPlayedCard;
    const theirs = this.theirPlayedCard;
    const kaijiCard   = this.myRole === 'kaiji'   ? mine : theirs;
    const emperorCard = this.myRole === 'emperor' ? mine : theirs;

    let winner;
    if      (kaijiCard === 'slave'   && emperorCard === 'emperor') winner = 'kaiji';
    else if (kaijiCard === 'citizen' && emperorCard === 'emperor') winner = 'emperor';
    else if (kaijiCard === 'slave'   && emperorCard === 'citizen') winner = 'emperor';
    else winner = 'draw';

    if (winner === 'draw')         return 'draw';
    if (winner === this.myRole)    return 'mine';
    return 'theirs';
  }

  // ─── 次ラウンド同期 ────────────────────────────────────────

  readyNext() {
    this.iReadyNext = true;
    const btn = this.$('btn-next');
    btn.disabled    = true;
    btn.textContent = '待機中…';
    this.send({ type: 'next' });
    this._tryNextRound();
  }

  _tryNextRound() {
    if (!this.iReadyNext || !this.theyReadyNext) return;
    if (this.roundDecisive || this.round >= 5) {
      this._showEnd();
    } else {
      this.round++;
      this._renderRound();
    }
  }

  _showEnd() {
    this.showScreen('end');
    const { mine, theirs } = this.score;
    const draws = this.round - mine - theirs;
    const title = this.$('end-title');
    if      (mine > theirs) { title.textContent = '勝利！';   title.className = 'end-title win'; }
    else if (mine < theirs) { title.textContent = '敗北…';   title.className = 'end-title lose'; }
    else                    { title.textContent = '引き分け'; title.className = 'end-title draw'; }

    const drawText = draws > 0 ? `${draws}回の引き分けを経て` : '';
    const resultText = mine > theirs ? 'あなたの勝利' : theirs > mine ? '相手の勝利' : '引き分け';
    this.$('end-score').textContent = drawText ? `${drawText}${resultText}` : resultText;
  }

  // ─── UIヘルパー ────────────────────────────────────────────

  _setBattleCard(id, card, faceDown = false) {
    const el = this.$(id);
    if (!card) {
      el.className = 'battle-card face-down';
      el.innerHTML = '<span>?</span>';
    } else if (faceDown) {
      el.className = 'battle-card face-down committed';
      el.innerHTML = '<span>■</span>';
    } else {
      el.className = `battle-card face-up card-${card}`;
      el.innerHTML = `<span>${CARD_NAMES[card]}</span>`;
    }
  }

  _updateStatus(msg) {
    const el = this.$('game-status');
    if (msg !== undefined) { el.textContent = msg; return; }
    if (!this.iCommitted)               el.textContent = 'カードを選んでください';
    else if (!this.theyCommitted)       el.textContent = '相手がカードを選んでいます…';
    else                                el.textContent = 'カードを公開中…';
  }

  showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    this.$('screen-' + name).classList.add('active');
  }

  $(id) { return document.getElementById(id); }

  showMsg(msg) { this.$('lobby-msg').textContent = msg; }

}

const game = new ECardGame();
