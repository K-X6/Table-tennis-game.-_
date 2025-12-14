/* 兼容移动与桌面的 Pong 实现
   - 保留原页面所有控件与交互（开始/暂停/结束、局数、胜分、难度、覆盖层、空格/点击发球）
   - 增加：高 DPI(canvas 内部像素按 devicePixelRatio 缩放)、响应式画布、触摸控制（拖动控制左球拍）、防止触摸导致页面滚动
*/
(function(){
  // DOM 元素（保持与现有 HTML id/class 完全一致）
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const endBtn = document.getElementById('endBtn');
  const bestOfSelect = document.getElementById('bestOfSelect');
  const pointsToWinInput = document.getElementById('pointsToWin');
  const diffBtns = Array.from(document.querySelectorAll('.diff-btn'));
  const overlay = document.getElementById('overlay');
  const overlayStart = document.getElementById('overlayStart');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayDesc = document.getElementById('overlayDesc');
  const resultOverlay = document.getElementById('resultOverlay');
  const resultTitle = document.getElementById('resultTitle');
  const resultDesc = document.getElementById('resultDesc');
  const retryBtn = document.getElementById('retryBtn');
  const quitBtn = document.getElementById('quitBtn');

  const leftScoreEl = document.getElementById('leftScore');
  const rightScoreEl = document.getElementById('rightScore');
  const leftMatchEl = document.getElementById('leftMatch');
  const rightMatchEl = document.getElementById('rightMatch');

  // 逻辑分辨率（与原 canvas width/height 对齐）
  const LOGICAL_W = 900;
  const LOGICAL_H = 520;

  // 物理缩放（devicePixelRatio）
  let DPR = Math.max(1, window.devicePixelRatio || 1);

  // 游戏实体（使用逻辑坐标）
  const paddleLeft = { w: 16, h: 100, x: 30, y: (LOGICAL_H-100)/2, speed: 8 };
  const paddleRight = { w: 16, h: 100, x: LOGICAL_W - 30 - 16, y: (LOGICAL_H-100)/2, speed: 5 };
  const ball = { r: 9, x: LOGICAL_W/2, y: LOGICAL_H/2, vx: 6, vy: 4 };

  // 状态
  let running = false;
  let paused = false;
  let waitingToServe = false;
  let serveCountdown = 0;
  let lastTime = 0;
  let leftScore = 0, rightScore = 0;
  let leftMatches = 0, rightMatches = 0;
  let bestOf = parseInt(bestOfSelect.value, 10) || 3;
  let pointsToWin = parseInt(pointsToWinInput.value, 10) || 11;
  let difficulty = 'normal'; // easy, normal, hard, hell

  // 输入
  let mouseY = null;
  let touchY = null;
  let keyUp = false, keyDown = false;

  // AI 参数由难度控制
  function aiParamsFor(d) {
    switch(d){
      case 'easy': return { speed: 3.0, react: 0.12 };
      case 'normal': return { speed: 4.2, react: 0.18 };
      case 'hard': return { speed: 5.2, react: 0.24 };
      case 'hell': return { speed: 7.0, react: 0.32 };
      default: return { speed: 4.2, react: 0.18 };
    }
  }

  // 初始化 canvas 大小（根据外部容器宽度自适应并考虑 DPR）
  function resizeCanvas(){
    DPR = Math.max(1, window.devicePixelRatio || 1);
    // 让 canvas 在 CSS 尺寸上自适应，但内部像素按照 DPR 放大
    const wrap = canvas.parentElement;
    const wrapRect = wrap.getBoundingClientRect();
    // 计算显示宽高（以 LOGICAL 宽度为参考，保持比例）
    const displayWidth = Math.min(wrapRect.width - 20, 1000); // 限制最大显示宽度，留白
    const displayHeight = Math.round(displayWidth * (LOGICAL_H / LOGICAL_W));

    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';

    canvas.width = Math.max(300, Math.floor(displayWidth * DPR));
    canvas.height = Math.max(200, Math.floor(displayHeight * DPR));

    // 将逻辑坐标映射到画布像素（使用 transform）
    const scaleX = canvas.width / LOGICAL_W;
    const scaleY = canvas.height / LOGICAL_H;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

    // 立刻重绘
    draw();
  }

  // 绘制函数（保留视觉风格）
  function drawBackground(){
    // 背景与边框风格，尽量和原来匹配
    ctx.fillStyle = '#071022';
    ctx.fillRect(0,0,LOGICAL_W,LOGICAL_H);

    // 中线
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = 10; y < LOGICAL_H; y += 24){
      ctx.moveTo(LOGICAL_W/2, y);
      ctx.lineTo(LOGICAL_W/2, y+12);
    }
    ctx.stroke();
  }

  function draw(){
    // 清空
    drawBackground();

    // 左 paddle
    ctx.fillStyle = '#e6eef8';
    roundRect(ctx, paddleLeft.x, paddleLeft.y, paddleLeft.w, paddleLeft.h, 6);
    // 右 paddle
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, paddleRight.x, paddleRight.y, paddleRight.w, paddleRight.h, 6);
    // 球
    ctx.fillStyle = '#ffd';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI*2);
    ctx.fill();

    // 发球提示
    if (waitingToServe) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '18px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('准备发球... ' + Math.ceil(serveCountdown / 60), LOGICAL_W / 2, 40);
    }

    // scores are updated via DOM; optional: draw small hints
  }

  function roundRect(ctx,x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
    ctx.fill();
  }

  // 重置球（direction: 'left' means send toward左方）
  function resetBall(direction){
    ball.x = LOGICAL_W/2;
    ball.y = LOGICAL_H/2;
    const base = 5 + Math.min(4, Math.floor(Math.max(leftScore, rightScore)/3));
    const ang = (Math.random() * Math.PI/3) - Math.PI/6;
    const dir = (direction === 'left') ? -1 : 1;
    ball.vx = dir * (base * Math.cos(ang));
    ball.vy = base * Math.sin(ang);
    // 微小随机扰动
    if (Math.abs(ball.vx) < 2) ball.vx = dir * 2.2;
  }

  // 启动、暂停、结束逻辑（与原功能一致）
  function startMatch(){
    // 读取设置
    bestOf = parseInt(bestOfSelect.value, 10) || 3;
    pointsToWin = Math.max(1, parseInt(pointsToWinInput.value, 10) || 11);
    // 按钮状态
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    endBtn.disabled = false;
    overlay.classList.remove('visible');
    overlay.classList.add('hidden');
    resultOverlay.classList.add('hidden');
    running = true;
    paused = false;
    waitingToServe = false;
    lastTime = performance.now();
    // 初次发球朝玩家方向（默认电脑先发）
    resetBall('right');
  }

  // 重置对局到初始状态
  function resetMatch(){
    // 重置所有游戏状态
    running = false;
    paused = false;
    leftScore = 0;
    rightScore = 0;
    leftMatches = 0;
    rightMatches = 0;
    waitingToServe = false;
    serveCountdown = 0;
    
    // 重置按钮状态
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    endBtn.disabled = true;
    
    // 更新分数显示
    updateScoreDOM();
    leftMatchEl.textContent = leftMatches;
    rightMatchEl.textContent = rightMatches;
    
    // 重置球位置
    resetBall('right');
    
    // 先隐藏结果overlay
    resultOverlay.classList.add('hidden');
    resultOverlay.classList.remove('visible');
    
    // 显示初始overlay（准备开始比赛的界面）
    overlay.classList.remove('hidden');
    overlay.classList.add('visible');
    overlayTitle.textContent = '准备开始比赛';
    overlayDesc.textContent = '请在左侧设置好局数、胜分与难度，按"开始"进入比赛。';
  }

  function pauseMatch(){
    paused = true;
    running = false;
    pauseBtn.disabled = true;
    startBtn.disabled = false;
  }

  function resumeMatch(){
    if (!running){
      running = true;
      paused = false;
      lastTime = performance.now();
      pauseBtn.disabled = false;
      startBtn.disabled = true;
    }
  }

  function endMatch(){
    // 重置对局到初始状态
    resetMatch();
  }

  // 得分 & 局逻辑（保留原描述：丢分后会重置球并短暂停止发球）
  function onPoint(scoredBy){ // 'left' 或 'right'
    if (scoredBy === 'left') leftScore++; else rightScore++;
    updateScoreDOM();

    // 判断局胜利
    if (leftScore >= pointsToWin || rightScore >= pointsToWin){
      if (leftScore > rightScore) leftMatches++; else rightMatches++;
      leftScore = 0; rightScore = 0;
      leftMatchEl.textContent = leftMatches;
      rightMatchEl.textContent = rightMatches;
      updateScoreDOM();
      // 检查比赛结束（bestOf 的赛制）
      const needed = Math.ceil(bestOf/2);
      if (leftMatches >= needed || rightMatches >= needed){
        // 比赛结束
        running = false;
        startBtn.disabled = false;
        pauseBtn.disabled = true;
        endBtn.disabled = true;
        // 展示结果 overlay
        resultOverlay.classList.remove('hidden');
        resultOverlay.classList.add('visible');
        resultTitle.textContent = (leftMatches > rightMatches) ? '你赢了！' : '你输了';
        resultDesc.textContent = `最终局分 ${leftMatchEl.textContent} - ${rightMatchEl.textContent}`;
        return;
      }
    }

    // 丢分后重置球并短暂停止发球（和原描述一致）
    waitingToServe = true;
    serveCountdown = 60;
    // 将球发向失分方（下一次发球由点击/按空格触发）
    resetBall(scoredBy === 'left' ? 'right' : 'left');
  }

  // 更新 DOM 分数
  function updateScoreDOM(){
    leftScoreEl.textContent = leftScore;
    rightScoreEl.textContent = rightScore;
  }

  // 主循环
  function loop(ts){
    if (!lastTime) lastTime = ts;
    const dt = Math.min(0.032, (ts - lastTime) / 1000); // 防止 dt 过大
    lastTime = ts;

    if (running && !paused){
      if (waitingToServe){
        serveCountdown--;
        if (serveCountdown <= 0){
          waitingToServe = false;
        }
      } else {
        // 输入处理：鼠标/触摸优先，键盘其次
        if (mouseY !== null){
          // 鼠标以 canvas 的显示尺寸为准，映射到逻辑坐标
          const rect = canvas.getBoundingClientRect();
          const displayH = rect.height;
          const y = ((mouseY / displayH) * LOGICAL_H) - paddleLeft.h/2;
          paddleLeft.y += (y - paddleLeft.y) * 0.35;
        } else if (touchY !== null){
          const rect = canvas.getBoundingClientRect();
          const y = ((touchY / rect.height) * LOGICAL_H) - paddleLeft.h/2;
          paddleLeft.y += (y - paddleLeft.y) * 0.4;
        } else {
          // 键盘控制
          if (keyUp) paddleLeft.y -= paddleLeft.speed;
          if (keyDown) paddleLeft.y += paddleLeft.speed;
        }

        // 限制在画布内
        paddleLeft.y = Math.max(6, Math.min(LOGICAL_H - paddleLeft.h - 6, paddleLeft.y));

        // AI 控制右边球拍（基于当前难度）
        const aiP = aiParamsFor(difficulty);
        const aim = ball.y - paddleRight.h/2;
        const dy = aim - paddleRight.y;
        paddleRight.y += Math.sign(dy) * Math.min(Math.abs(dy) * aiP.react + aiP.speed * dt * 60, aiP.speed * 1.6);

        paddleRight.y = Math.max(6, Math.min(LOGICAL_H - paddleRight.h - 6, paddleRight.y));

        // 球运动
        ball.x += ball.vx;
        ball.y += ball.vy;

        // 边界碰撞（上/下）
        if (ball.y - ball.r <= 0) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); }
        if (ball.y + ball.r >= LOGICAL_H) { ball.y = LOGICAL_H - ball.r; ball.vy = -Math.abs(ball.vy); }

        // 左右出界 -> 得分
        if (ball.x - ball.r <= 0){
          onPoint('right');
        } else if (ball.x + ball.r >= LOGICAL_W){
          onPoint('left');
        }

        // 碰撞左球拍
        if (ball.x - ball.r <= paddleLeft.x + paddleLeft.w &&
            ball.y >= paddleLeft.y && ball.y <= paddleLeft.y + paddleLeft.h &&
            ball.vx < 0){
          ball.x = paddleLeft.x + paddleLeft.w + ball.r + 0.5;
          ball.vx = -ball.vx;
          // 根据击球位置调整 vx/vy
          const rel = (ball.y - (paddleLeft.y + paddleLeft.h/2)) / (paddleLeft.h/2);
          ball.vy += rel * 3;
          ball.vx *= 1.03;
        }

        // 碰撞右球拍
        if (ball.x + ball.r >= paddleRight.x &&
            ball.y >= paddleRight.y && ball.y <= paddleRight.y + paddleRight.h &&
            ball.vx > 0){
          ball.x = paddleRight.x - ball.r - 0.5;
          ball.vx = -ball.vx;
          const rel = (ball.y - (paddleRight.y + paddleRight.h/2)) / (paddleRight.h/2);
          ball.vy += rel * 3;
          ball.vx *= 1.03;
        }
      }
    } // running && !paused

    draw();
    requestAnimationFrame(loop);
  }

  // 事件绑定（保持与原控件行为一致并加入触摸/高 DPI 适配）
  // 鼠标移动（控制左拍）
  canvas.addEventListener('mousemove', function(e){
    const rect = canvas.getBoundingClientRect();
    mouseY = e.clientY - rect.top;
  });
  canvas.addEventListener('mouseleave', function(){ mouseY = null; });

  // 点击 canvas 立即发球
  canvas.addEventListener('click', function(){
    if (waitingToServe){
      waitingToServe = false;
      serveCountdown = 0;
    }
  });

  // 触摸控制（拖动控制左拍），并在触摸在 canvas 时阻止页面滚动
  canvas.addEventListener('touchstart', function(e){
    const t = e.changedTouches[0];
    const rect = canvas.getBoundingClientRect();
    touchY = t.clientY - rect.top;
    // 如果当前未运行或等待发球，触摸一次等同于发球/继续
    if (waitingToServe){
      waitingToServe = false;
      serveCountdown = 0;
    } else if (!running){
      running = true;
      paused = false;
      lastTime = performance.now();
    }
    e.preventDefault();
  }, {passive:false});
  canvas.addEventListener('touchmove', function(e){
    const t = e.changedTouches[0];
    const rect = canvas.getBoundingClientRect();
    touchY = t.clientY - rect.top;
    e.preventDefault();
  }, {passive:false});
  canvas.addEventListener('touchend', function(e){
    touchY = null;
    e.preventDefault();
  }, {passive:false});

  // 键盘控制（↑ ↓ / W S / 空格 发球/暂停）
  window.addEventListener('keydown', function(e){
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') keyUp = true;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keyDown = true;
    if (e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space'){
      if (waitingToServe){
        waitingToServe = false;
        serveCountdown = 0;
      } else if (!running){
        running = true;
        paused = false;
        lastTime = performance.now();
      } else {
        // 切换 pause
        if (!paused){
          paused = true; running = false;
        } else { paused = false; running = true; lastTime = performance.now(); }
      }
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', function(e){
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') keyUp = false;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keyDown = false;
  });

  // 控件按钮绑定（保留原行为）
  startBtn.addEventListener('click', function(){
    startMatch();
  });
  pauseBtn.addEventListener('click', function(){
    if (running) { pauseMatch(); } else { resumeMatch(); }
  });
  endBtn.addEventListener('click', function(){
    endMatch();
  });

  overlayStart.addEventListener('click', function(){
    // 只是关闭overlay，让用户看到设置界面，不直接开始游戏
    overlay.classList.remove('visible');
    overlay.classList.add('hidden');
  });

  retryBtn.addEventListener('click', function(){
    // 重置并开始新比赛
    leftMatches = rightMatches = 0;
    leftMatchEl.textContent = leftMatches;
    rightMatchEl.textContent = rightMatches;
    leftScore = rightScore = 0;
    updateScoreDOM();
    resultOverlay.classList.add('hidden');
    resultOverlay.classList.remove('visible');
    startMatch();
  });
  quitBtn.addEventListener('click', function(){
    // 点击退出时，重置对局并显示初始界面
    resetMatch();
  });

  // 难度按钮
  diffBtns.forEach(btn=>{
    btn.addEventListener('click', function(){
      diffBtns.forEach(b=>b.classList.remove('active'));
      this.classList.add('active');
      difficulty = this.dataset.diff || 'normal';
    });
  });

  // 设置项监听
  bestOfSelect.addEventListener('change', function(){
    bestOf = parseInt(this.value,10) || 3;
  });
  pointsToWinInput.addEventListener('change', function(){
    pointsToWin = Math.max(1, parseInt(this.value,10) || 11);
  });

  // 禁止在与 canvas 交互时页面滚动（移动端）
  document.addEventListener('touchmove', function(e){
    const t = e.target;
    if (t === canvas || t.closest && t.closest('.canvas-wrap')) {
      e.preventDefault();
    }
  }, {passive:false});

  // 初始化与适配
  function init(){
    // 初始化 DOM 显示
    updateScoreDOM();
    leftMatchEl.textContent = leftMatches;
    rightMatchEl.textContent = rightMatches;

    // 自适应画布
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // 初始球
    resetBall('right');

    // 显示初始 overlay
    overlay.classList.remove('hidden');
    overlay.classList.add('visible');
    overlayTitle.textContent = '准备开始比赛';
    overlayDesc.textContent = '请在左侧设置好局数、胜分与难度，按"开始"进入比赛。';

    // 启动渲染循环
    requestAnimationFrame(loop);
  }

  // 初始调用
  init();
})();