// script.js - 增强版乒乓球（Pong）含：局数设置、难度选择、开始/暂停/结束、结算界面及声音效果
(() => {
  // DOM
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const endBtn = document.getElementById('endBtn');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayDesc = document.getElementById('overlayDesc');
  const overlayStart = document.getElementById('overlayStart');
  const overlayClose = document.getElementById('overlayClose');
  const resultOverlay = document.getElementById('resultOverlay');
  const resultTitle = document.getElementById('resultTitle');
  const resultDesc = document.getElementById('resultDesc');
  const retryBtn = document.getElementById('retryBtn');
  const quitBtn = document.getElementById('quitBtn');

  const bestOfSelect = document.getElementById('bestOfSelect');
  const pointsToWinInput = document.getElementById('pointsToWin');
  const diffBtns = document.querySelectorAll('.diff-btn');

  const leftScoreEl = document.getElementById('leftScore');
  const rightScoreEl = document.getElementById('rightScore');
  const leftMatchEl = document.getElementById('leftMatch');
  const rightMatchEl = document.getElementById('rightMatch');

  // Canvas size
  const W = canvas.width;
  const H = canvas.height;

  // Game objects
  const paddleWidth = 10;
  const paddleHeight = 90;
  const paddleMargin = 12;
  const ballRadius = 8;

  const leftPaddle = { x: paddleMargin, y: (H - paddleHeight) / 2, w: paddleWidth, h: paddleHeight, vy: 0, speed: 6 };
  const rightPaddle = { x: W - paddleMargin - paddleWidth, y: (H - paddleHeight) / 2, w: paddleWidth, h: paddleHeight, speed: 4.2 };

  const ball = { x: W / 2, y: H / 2, r: ballRadius, vx: 0, vy: 0, baseSpeed: 5 };

  // Match & game state
  let leftPoints = 0;
  let rightPoints = 0;
  let leftMatchWins = 0;
  let rightMatchWins = 0;
  let bestOf = parseInt(bestOfSelect.value, 10) || 3;
  let pointsToWin = parseInt(pointsToWinInput.value, 10) || 11;
  let matchWinsNeeded = Math.ceil(bestOf / 2);

  let gameState = 'idle'; // idle | running | paused | betweenRally | matchEnded
  let waitingToServe = false;
  let serveCountdown = 0;
  let serveToRight = true; // 发球方向
  let lastServeWinner = null;

  // Input
  const keys = { ArrowUp: false, ArrowDown: false };
  let mouseY = null;
  let lastMouseMoveTime = 0;

  // Difficulty presets
  const difficulties = {
    easy:    { aiSpeed: 3.2, aiReaction: 0.10, ballBase: 4.2, accel: 1.03 },
    normal:  { aiSpeed: 4.2, aiReaction: 0.15, ballBase: 5.0, accel: 1.05 },
    hard:    { aiSpeed: 5.1, aiReaction: 0.20, ballBase: 5.6, accel: 1.06 },
    hell:    { aiSpeed: 6.6, aiReaction: 0.28, ballBase: 6.2, accel: 1.08 }
  };
  let chosenDifficulty = 'normal';

  // Sound - WebAudio
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) audioCtx = new AudioCtx();
  }
  function playTone(freq = 440, time = 0.08, type = 'sine', gain = 0.08) {
    try {
      ensureAudio();
      const t0 = audioCtx.currentTime;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(gain, t0);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + time);
      o.stop(t0 + time + 0.02);
    } catch (e) {
      // 某些浏览器会阻止自动播放音频，忽略
    }
  }
  function playHit() { playTone(1200, 0.05, 'sine', 0.06); }
  function playWall() { playTone(650, 0.06, 'square', 0.05); }
  function playScore() { playTone(220, 0.26, 'sine', 0.09); }
  function playWin() { playTone(880, 0.12, 'sawtooth', 0.09); setTimeout(()=>playTone(660,0.12,'sine',0.09),120); }
  function playLose() { playTone(200, 0.3, 'sine', 0.09); }

  // 初始化球与发球（仅用于发球时调用）
  function resetBall(toRight = Math.random() >= 0.5) {
    ball.x = W / 2;
    ball.y = H / 2;
    ball.baseSpeed = difficulties[chosenDifficulty].ballBase;
    const angle = (Math.random() * Math.PI / 4) - (Math.PI / 8); // -22.5 .. 22.5 deg
    ball.vx = (toRight ? 1 : -1) * ball.baseSpeed * Math.cos(angle);
    ball.vy = ball.baseSpeed * Math.sin(angle);
    waitingToServe = true;
    serveCountdown = 60; // 帧，约1秒
    serveToRight = toRight;
    gameState = 'betweenRally';
  }
  function startServeNow() {
    waitingToServe = false;
    gameState = 'running';
  }

  // 碰撞检测（圆矩形）
  function circleRectCollision(cx, cy, r, rx, ry, rw, rh) {
    const closestX = Math.max(rx, Math.min(cx, rx + rw));
    const closestY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return (dx * dx + dy * dy) <= (r * r);
  }

  // 更新得分显示
  function updateScoreboard() {
    leftScoreEl.textContent = leftPoints;
    rightScoreEl.textContent = rightPoints;
    leftMatchEl.textContent = leftMatchWins;
    rightMatchEl.textContent = rightMatchWins;
  }

  // 进入下一局（局比分重置）或判定比赛结束
  function handleGameWin(isLeftWonGame) {
    if (isLeftWonGame) leftMatchWins++; else rightMatchWins++;
    updateScoreboard();

    // 是否达到 matchWinsNeeded？
    if (leftMatchWins >= matchWinsNeeded || rightMatchWins >= matchWinsNeeded) {
      // 比赛结束
      gameState = 'matchEnded';
      pauseBtn.disabled = true;
      endBtn.disabled = true;
      startBtn.disabled = false;
      // 显示结算界面
      showResult(leftMatchWins > rightMatchWins);
      if (leftMatchWins > rightMatchWins) playWin(); else playLose();
      return;
    }

    // 否则开始下一局（重置局分）
    leftPoints = 0;
    rightPoints = 0;
    updateScoreboard();
    // 下局由上一局输方发球（更公平）
    serveToRight = !isLeftWonGame;
    resetBall(serveToRight);
    // 保持界面处于 betweenRally 状态，等待发球
  }

  // 得分后处理
  function scorePoint(isLeftScored) {
    if (isLeftScored) leftPoints++; else rightPoints++;
    playScore();

    // 检查局胜利（达到 pointsToWin）
    if (leftPoints >= pointsToWin || rightPoints >= pointsToWin) {
      const leftWonGame = leftPoints >= pointsToWin;
      // 记录上一局胜利者
      lastServeWinner = leftWonGame ? 'left' : 'right';
      handleGameWin(leftWonGame);
      return;
    } else {
      // 只是丢分：重置球并为得分者下一发球方向相反（常见规则可调整）
      serveToRight = !isLeftScored; // 若左得分，则向右发
      resetBall(serveToRight);
    }
    updateScoreboard();
  }

  // AI 更新
  function updateAI() {
    const preset = difficulties[chosenDifficulty];
    const center = rightPaddle.y + rightPaddle.h / 2;
    const diff = ball.y - center;
    let targetVy = diff * preset.aiReaction;
    if (targetVy > preset.aiSpeed) targetVy = preset.aiSpeed;
    if (targetVy < -preset.aiSpeed) targetVy = -preset.aiSpeed;
    rightPaddle.y += targetVy;

    // 边界
    if (rightPaddle.y < 0) rightPaddle.y = 0;
    if (rightPaddle.y + rightPaddle.h > H) rightPaddle.y = H - rightPaddle.h;
  }

  // 更新帧
  function update() {
    if (gameState === 'paused' || gameState === 'idle' || gameState === 'matchEnded') return;

    // 玩家键盘控制
    if (keys.ArrowUp) leftPaddle.vy = -leftPaddle.speed;
    else if (keys.ArrowDown) leftPaddle.vy = leftPaddle.speed;
    else leftPaddle.vy = 0;

    leftPaddle.y += leftPaddle.vy;

    // 鼠标优先（最近 1s 有鼠标移动）
    if (mouseY !== null && (Date.now() - lastMouseMoveTime < 1000)) {
      leftPaddle.y = mouseY - leftPaddle.h / 2;
    }

    // 边界限制
    if (leftPaddle.y < 0) leftPaddle.y = 0;
    if (leftPaddle.y + leftPaddle.h > H) leftPaddle.y = H - leftPaddle.h;

    // AI
    updateAI();

    // 发球倒计时或球移动
    if (waitingToServe) {
      serveCountdown--;
      if (serveCountdown <= 0) startServeNow();
      // 小动画
      ball.x = W / 2;
      ball.y = H / 2 + Math.sin((serveCountdown || 0) / 6) * 8;
      return;
    }

    // 球移动
    ball.x += ball.vx;
    ball.y += ball.vy;

    // 上下墙
    if (ball.y - ball.r <= 0) {
      ball.y = ball.r;
      ball.vy = -ball.vy;
      playWall();
    } else if (ball.y + ball.r >= H) {
      ball.y = H - ball.r;
      ball.vy = -ball.vy;
      playWall();
    }

    // 左球拍碰撞
    if (circleRectCollision(ball.x, ball.y, ball.r, leftPaddle.x, leftPaddle.y, leftPaddle.w, leftPaddle.h)) {
      ball.x = leftPaddle.x + leftPaddle.w + ball.r;
      // 计算反弹角度
      const relativeIntersectY = (leftPaddle.y + leftPaddle.h / 2) - ball.y;
      const normalized = (relativeIntersectY / (leftPaddle.h / 2));
      const bounceAngle = normalized * (Math.PI / 3); // 最大 60°
      const speed = Math.min(Math.hypot(ball.vx, ball.vy) * difficulties[chosenDifficulty].accel, 14);
      ball.vx = Math.abs(speed * Math.cos(bounceAngle));
      ball.vy = -speed * Math.sin(bounceAngle);
      playHit();
    }

    // 右球拍碰撞
    if (circleRectCollision(ball.x, ball.y, ball.r, rightPaddle.x, rightPaddle.y, rightPaddle.w, rightPaddle.h)) {
      ball.x = rightPaddle.x - ball.r;
      const relativeIntersectY = (rightPaddle.y + rightPaddle.h / 2) - ball.y;
      const normalized = (relativeIntersectY / (rightPaddle.h / 2));
      const bounceAngle = normalized * (Math.PI / 3);
      const speed = Math.min(Math.hypot(ball.vx, ball.vy) * difficulties[chosenDifficulty].accel, 14);
      ball.vx = -Math.abs(speed * Math.cos(bounceAngle));
      ball.vy = -speed * Math.sin(bounceAngle);
      playHit();
    }

    // 左右出界得分检测
    if (ball.x - ball.r <= 0) {
      // 右方得分
      scorePoint(false);
    } else if (ball.x + ball.r >= W) {
      // 左方得分
      scorePoint(true);
    }
  }

  // 渲染
  function render() {
    // 清屏
    ctx.clearRect(0, 0, W, H);

    // 中线
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // 球拍
    ctx.fillStyle = '#cfe8ff';
    ctx.fillRect(leftPaddle.x, leftPaddle.y, leftPaddle.w, leftPaddle.h);
    ctx.fillStyle = '#ffd7a3';
    ctx.fillRect(rightPaddle.x, rightPaddle.y, rightPaddle.w, rightPaddle.h);

    // 球
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();

    // 发球提示
    if (waitingToServe) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '18px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('准备发球... ' + Math.ceil(serveCountdown / 60), W / 2, 40);
    }

    // 暂停文本
    if (gameState === 'paused') {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = '28px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('已暂停', W / 2, H / 2 - 10);
      ctx.font = '14px Arial';
      ctx.fillText('按 暂停/继续 或 Start 恢复', W / 2, H / 2 + 20);
    }
  }

  // 主循环
  function loop() {
    update();
    render();
    requestAnimationFrame(loop);
  }

  // UI helpers
  function showOverlay(title, desc) {
    overlayTitle.textContent = title;
    overlayDesc.textContent = desc;
    overlay.classList.remove('hidden');
    overlay.classList.add('visible');
  }
  function hideOverlay() {
    overlay.classList.remove('visible');
    overlay.classList.add('hidden');
  }
  function showResult(playerWon) {
    resultTitle.textContent = playerWon ? '恭喜你赢了！' : '很遗憾你输了';
    resultDesc.textContent = playerWon ? `本场比赛你以 ${leftMatchWins} - ${rightMatchWins} 获胜` : `本场比赛你以 ${leftMatchWins} - ${rightMatchWins} 失利`;
    resultOverlay.classList.remove('hidden');
    resultOverlay.classList.add('visible');
  }
  function hideResult() {
    resultOverlay.classList.remove('visible');
    resultOverlay.classList.add('hidden');
  }

  // 启动新比赛（根据当前设置）
  function startMatch(autoStart = true) {
    // 读取设置
    bestOf = parseInt(bestOfSelect.value, 10) || 3;
    pointsToWin = Math.max(1, parseInt(pointsToWinInput.value, 10) || 11);
    matchWinsNeeded = Math.ceil(bestOf / 2);

    // 初始化比分
    leftPoints = 0;
    rightPoints = 0;
    leftMatchWins = 0;
    rightMatchWins = 0;
    updateScoreboard();

    // 应用难度参数
    const preset = difficulties[chosenDifficulty];
    rightPaddle.speed = preset.aiSpeed;
    ball.baseSpeed = preset.ballBase;

    // UI 按钮
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    endBtn.disabled = false;

    hideResult();
    hideOverlay();

    // 把球重置，并等待发球
    resetBall(Math.random() >= 0.5);
    if (autoStart) {
      // 仍然显示短暂倒计时，startServeNow 将在倒计时结束或用户触发时执行
      gameState = 'betweenRally';
    } else {
      gameState = 'idle';
    }
  }

  // 结束比赛并回到初始界面
  function endMatch() {
    gameState = 'idle';
    waitingToServe = false;
    serveCountdown = 0;
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    endBtn.disabled = true;
    hideResult();
    showOverlay('已结束', '比赛已结束，你可以调整设置后再次开始。');
    // 复位比分
    leftPoints = rightPoints = leftMatchWins = rightMatchWins = 0;
    updateScoreboard();
  }

  // 事件绑定
  startBtn.addEventListener('click', () => {
    // Start match only when user intentionally presses Start
    ensureAudio();
    startMatch(true);
    startBtn.disabled = true;
  });

  pauseBtn.addEventListener('click', () => {
    if (gameState === 'running') {
      gameState = 'paused';
      pauseBtn.textContent = '继续';
    } else if (gameState === 'paused') {
      gameState = 'running';
      pauseBtn.textContent = '暂停';
    }
  });

  endBtn.addEventListener('click', () => {
    endMatch();
  });

  // 覆盖层按钮
  // 修改：overlayStart 仅关闭提示覆盖层，引导用户按页面上的“开始”按钮来真正开始比赛。
  overlayStart.addEventListener('click', () => {
    // 仅隐藏覆盖层，保持游戏处于 idle，用户需按上方 Start 正式开始
    hideOverlay();
    showOverlay; // noop to keep intent clear
    // 更新提示，提醒用户按开始
    overlayTitle.textContent = '已准备';
    overlayDesc.textContent = '请按页面左上角的“开始”按钮以开始比赛。';
    // 实际上把覆盖层隐藏，让用户能修改设置后点击开始
    hideOverlay();
  });
  overlayClose.addEventListener('click', () => {
    // 关闭并保持在 idle 初始页面
    hideOverlay();
    gameState = 'idle';
  });

  // 结算界面按钮
  retryBtn.addEventListener('click', () => {
    // 使用同一设置再来一次
    hideResult();
    startMatch(true);
    startBtn.disabled = true;
  });
  quitBtn.addEventListener('click', () => {
    hideResult();
    endMatch();
  });

  // 难度按钮
  diffBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      diffBtns.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      chosenDifficulty = btn.getAttribute('data-diff');
      // 立即应用 AI 参数（如果正在运行）
      const preset = difficulties[chosenDifficulty];
      rightPaddle.speed = preset.aiSpeed;
      ball.baseSpeed = preset.ballBase;
    });
  });

  // 设置输入变化
  bestOfSelect.addEventListener('change', () => {
    bestOf = parseInt(bestOfSelect.value, 10) || 3;
    matchWinsNeeded = Math.ceil(bestOf / 2);
  });
  pointsToWinInput.addEventListener('change', () => {
    pointsToWin = Math.max(1, parseInt(pointsToWinInput.value, 10) || 11);
  });

  // 键盘 / 鼠标输入
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      keys[e.key] = true;
      e.preventDefault();
    }
    if (e.code === 'Space') {
      // 空格在等待发球时立即发球；在比赛进行中没有别的用途
      if (waitingToServe) startServeNow();
      e.preventDefault();
    }
    // P 快捷键用于暂停/继续
    if (e.key === 'p' || e.key === 'P') {
      if (!pauseBtn.disabled) pauseBtn.click();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      keys[e.key] = false;
      e.preventDefault();
    }
  });

  const rect = () => canvas.getBoundingClientRect();
  canvas.addEventListener('mousemove', (e) => {
    const r = rect();
    const y = e.clientY - r.top;
    mouseY = Math.max(0, Math.min(H, y));
    lastMouseMoveTime = Date.now();
  });
  canvas.addEventListener('click', () => {
    if (waitingToServe) startServeNow();
  });

  // 初始覆盖层显示（未开始），并要求用户先设置然后点击左上角 Start
  showOverlay('准备开始比赛', '请先在左侧设置好局数、胜分与难度，然后按页面左上角的“开始”按钮开始比赛。');

  // 初始化一些值并开始循环
  function init() {
    chosenDifficulty = 'normal';
    // apply preset
    const preset = difficulties[chosenDifficulty];
    rightPaddle.speed = preset.aiSpeed;
    ball.baseSpeed = preset.ballBase;
    updateScoreboard();

    // 初始按钮状态：用户需按开始
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    endBtn.disabled = true;

    // 确保 gameState 为 idle，球静止在中间（不自动发球）
    gameState = 'idle';
    waitingToServe = false;
    ball.x = W / 2;
    ball.y = H / 2;
    ball.vx = 0;
    ball.vy = 0;

    render();
    requestAnimationFrame(loop);
  }

  // 启动
  init();

  // 公开供调试（可选）
  window.__pong = {
    resetBall, startMatch, endMatch, playHit
  };

})();