const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const TILE = 44;
const COLS = 15;
const ROWS = 13;
const EMPTY = 0;
const WALL = 1;
const CRATE = 2;

const rooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  if (rooms.has(code)) return makeCode();
  return code;
}

function keyOf(x, y) {
  return `${x},${y}`;
}

function inside(x, y) {
  return x >= 0 && y >= 0 && x < COLS && y < ROWS;
}

function dist(a, b, c, d) {
  return Math.hypot(a - c, b - d);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class GameRoom {
  constructor(code) {
    this.code = code;
    this.status = "waiting";
    this.wave = 1;
    this.grid = [];
    this.players = {
      p1: this.makePlayer("p1", "BLUE", 1, 1, "#2f80ed"),
      p2: this.makePlayer("p2", "PINK", COLS - 2, ROWS - 2, "#ff5da2")
    };
    this.socketToPlayer = new Map();
    this.bombs = [];
    this.blasts = [];
    this.monsters = [];
    this.items = [];
    this.messages = [];
    this.buildLevel(true);
  }

  makePlayer(id, name, spawnX, spawnY, color) {
    return {
      id,
      name,
      socketId: null,
      connected: false,
      color,
      spawnX,
      spawnY,
      tileX: spawnX,
      tileY: spawnY,
      dirX: 0,
      dirY: 1,
      life: 5,
      maxLife: 5,
      score: 0,
      bombMax: 1,
      range: 2,
      inv: 0,
      damageCool: 0,
      moveCool: 0,
      bombCool: 0
    };
  }

  addPlayer(socket) {
    const slot = !this.players.p1.connected ? "p1" : (!this.players.p2.connected ? "p2" : null);
    if (!slot) return null;

    const p = this.players[slot];
    p.connected = true;
    p.socketId = socket.id;
    this.socketToPlayer.set(socket.id, slot);
    socket.join(this.code);

    this.say(`${p.name} joined.`);
    return slot;
  }

  removePlayer(socketId) {
    const slot = this.socketToPlayer.get(socketId);
    if (!slot) return;

    const p = this.players[slot];
    p.connected = false;
    p.socketId = null;
    this.socketToPlayer.delete(socketId);
    this.say(`${p.name} left.`);

    if (!this.players.p1.connected && !this.players.p2.connected) {
      rooms.delete(this.code);
      return;
    }

    if (this.status === "playing") {
      this.status = "waiting";
      this.say("A player left. Waiting for reconnection or restart.");
    }
  }

  say(text) {
    this.messages.unshift({ text, time: Date.now() });
    this.messages = this.messages.slice(0, 5);
  }

  resetPlayer(p, fullReset = false) {
    p.tileX = p.spawnX;
    p.tileY = p.spawnY;
    p.dirX = 0;
    p.dirY = p.id === "p1" ? 1 : -1;
    p.inv = 1.5;
    p.damageCool = 0;
    p.moveCool = 0;
    p.bombCool = 0;

    if (fullReset) {
      p.life = p.maxLife;
      p.score = 0;
      p.bombMax = 1;
      p.range = 2;
    }
  }

  buildLevel(fullReset = false) {
    this.grid = [];
    this.bombs = [];
    this.blasts = [];
    this.monsters = [];
    this.items = [];

    for (let y = 0; y < ROWS; y++) {
      this.grid[y] = [];
      for (let x = 0; x < COLS; x++) {
        const edge = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
        const pillar = x % 2 === 0 && y % 2 === 0;
        this.grid[y][x] = edge || pillar ? WALL : EMPTY;
      }
    }

    const safe = new Set([
      "1,1","1,2","2,1","1,3","3,1","2,3","3,2",
      `${COLS - 2},${ROWS - 2}`,
      `${COLS - 3},${ROWS - 2}`,
      `${COLS - 2},${ROWS - 3}`,
      `${COLS - 4},${ROWS - 2}`,
      `${COLS - 2},${ROWS - 4}`,
      `${COLS - 3},${ROWS - 4}`,
      `${COLS - 4},${ROWS - 3}`
    ]);

    const crateChance = Math.min(0.30 + this.wave * 0.015, 0.43);
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (this.grid[y][x] !== EMPTY || safe.has(keyOf(x, y))) continue;
        if (Math.random() < crateChance) this.grid[y][x] = CRATE;
      }
    }

    this.resetPlayer(this.players.p1, fullReset);
    this.resetPlayer(this.players.p2, fullReset);

    const cells = this.emptyCells().filter(c =>
      dist(c.x, c.y, 1, 1) > 5 &&
      dist(c.x, c.y, COLS - 2, ROWS - 2) > 5
    );
    shuffle(cells);

    const count = Math.min(4 + this.wave, 13);
    for (let i = 0; i < Math.min(count, cells.length); i++) {
      const c = cells[i];
      const tank = this.wave >= 4 && Math.random() > 0.72;
      this.monsters.push({
        id: `m${Date.now()}_${i}_${Math.random().toString(16).slice(2)}`,
        tileX: c.x,
        tileY: c.y,
        hp: tank ? 2 : 1,
        maxHp: tank ? 2 : 1,
        color: tank ? "#20bf55" : (Math.random() > 0.5 ? "#7b61ff" : "#ff9f1c"),
        score: tank ? 220 : 100,
        wait: rand(0.2, 0.8),
        moveCool: 0
      });
    }
  }

  emptyCells() {
    const cells = [];
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (this.grid[y][x] === EMPTY) cells.push({ x, y });
      }
    }
    return cells;
  }

  start() {
    if (!this.players.p1.connected || !this.players.p2.connected) {
      this.say("Need 2 players to start.");
      return false;
    }
    this.status = "playing";
    this.wave = 1;
    this.buildLevel(true);
    this.say("Game started.");
    return true;
  }

  restart() {
    this.status = this.players.p1.connected && this.players.p2.connected ? "playing" : "waiting";
    this.wave = 1;
    this.buildLevel(true);
    this.say("Game restarted.");
  }

  playerBySocket(socketId) {
    const slot = this.socketToPlayer.get(socketId);
    return slot ? this.players[slot] : null;
  }

  handleMove(socketId, dx, dy) {
    if (this.status !== "playing") return;
    const p = this.playerBySocket(socketId);
    if (!p || p.life <= 0) return;
    if (p.moveCool > 0) return;

    dx = Math.sign(dx);
    dy = Math.sign(dy);
    if (Math.abs(dx) + Math.abs(dy) !== 1) return;

    p.dirX = dx;
    p.dirY = dy;

    const nx = p.tileX + dx;
    const ny = p.tileY + dy;
    if (!this.canEnter(nx, ny)) return;

    p.tileX = nx;
    p.tileY = ny;
    p.moveCool = 0.13;

    this.checkPlayerHazards(p);
  }

  handleBomb(socketId) {
    if (this.status !== "playing") return;
    const p = this.playerBySocket(socketId);
    if (!p || p.life <= 0 || p.bombCool > 0) return;

    const active = this.bombs.filter(b => b.owner === p.id).length;
    if (active >= p.bombMax) return;
    if (this.bombs.some(b => b.x === p.tileX && b.y === p.tileY)) return;

    this.bombs.push({
      id: `b${Date.now()}_${Math.random().toString(16).slice(2)}`,
      x: p.tileX,
      y: p.tileY,
      owner: p.id,
      range: p.range,
      timer: 1.55
    });
    p.bombCool = 0.2;
  }

  canEnter(x, y) {
    if (!inside(x, y)) return false;
    if (this.grid[y][x] === WALL || this.grid[y][x] === CRATE) return false;
    if (this.bombs.some(b => b.x === x && b.y === y)) return false;
    return true;
  }

  update(dt) {
    if (this.status !== "playing") return;

    for (const p of Object.values(this.players)) {
      p.inv = Math.max(0, p.inv - dt);
      p.damageCool = Math.max(0, p.damageCool - dt);
      p.moveCool = Math.max(0, p.moveCool - dt);
      p.bombCool = Math.max(0, p.bombCool - dt);
    }

    this.updateBombs(dt);
    this.updateBlasts(dt);
    this.updateMonsters(dt);
    this.updateItems();

    if (this.monsters.length === 0) {
      this.wave++;
      this.buildLevel(false);
      this.say(`Wave ${this.wave} started.`);
    }

    const alive = Object.values(this.players).some(p => p.life > 0);
    if (!alive) {
      this.status = "gameover";
      this.say("Game over.");
    }
  }

  updateBombs(dt) {
    for (const b of this.bombs) b.timer -= dt;

    const due = this.bombs.filter(b => b.timer <= 0);
    for (const b of due) this.explode(b);
  }

  explode(bomb) {
    const index = this.bombs.findIndex(b => b.id === bomb.id);
    if (index < 0) return;
    this.bombs.splice(index, 1);

    const cells = [{ x: bomb.x, y: bomb.y }];
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];

    for (const [dx, dy] of dirs) {
      for (let r = 1; r <= bomb.range; r++) {
        const x = bomb.x + dx * r;
        const y = bomb.y + dy * r;
        if (!inside(x, y)) break;
        if (this.grid[y][x] === WALL) break;

        cells.push({ x, y });

        const chained = this.bombs.find(b => b.x === x && b.y === y);
        if (chained) chained.timer = Math.min(chained.timer, 0.04);

        if (this.grid[y][x] === CRATE) {
          this.grid[y][x] = EMPTY;
          this.maybeItem(x, y);
          break;
        }
      }
    }

    this.blasts.push({
      id: `e${Date.now()}_${Math.random().toString(16).slice(2)}`,
      cells,
      timer: 0.38,
      max: 0.38
    });

    for (const p of Object.values(this.players)) {
      if (p.life > 0 && cells.some(c => c.x === p.tileX && c.y === p.tileY)) {
        this.hurtPlayer(p, "blast");
      }
    }

    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      if (cells.some(c => c.x === m.tileX && c.y === m.tileY)) {
        m.hp--;
        if (m.hp <= 0) {
          const owner = this.players[bomb.owner];
          if (owner) owner.score += m.score;
          this.monsters.splice(i, 1);
        }
      }
    }
  }

  updateBlasts(dt) {
    for (const e of this.blasts) e.timer -= dt;
    this.blasts = this.blasts.filter(e => e.timer > 0);
  }

  updateMonsters(dt) {
    for (const m of this.monsters) {
      m.wait -= dt;
      m.moveCool = Math.max(0, m.moveCool - dt);
      if (m.wait <= 0 && m.moveCool <= 0) this.tryMonsterMove(m);

      for (const p of Object.values(this.players)) {
        if (p.life > 0 && p.tileX === m.tileX && p.tileY === m.tileY) this.hurtPlayer(p, "monster");
      }

      if (this.blasts.some(e => e.cells.some(c => c.x === m.tileX && c.y === m.tileY))) {
        m.hp = 0;
      }
    }

    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      if (m.hp <= 0) {
        this.monsters.splice(i, 1);
      }
    }
  }

  tryMonsterMove(m) {
    let dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    const targets = Object.values(this.players).filter(p => p.life > 0);
    if (targets.length && Math.random() < 0.43) {
      const target = targets.reduce((best, p) =>
        dist(m.tileX, m.tileY, p.tileX, p.tileY) < dist(m.tileX, m.tileY, best.tileX, best.tileY) ? p : best
      , targets[0]);

      const dx = target.tileX - m.tileX;
      const dy = target.tileY - m.tileY;
      if (Math.abs(dx) > Math.abs(dy)) {
        dirs = [[Math.sign(dx),0],[0,Math.sign(dy)],[0,-Math.sign(dy)],[-Math.sign(dx),0]];
      } else {
        dirs = [[0,Math.sign(dy)],[Math.sign(dx),0],[-Math.sign(dx),0],[0,-Math.sign(dy)]];
      }
    } else {
      shuffle(dirs);
    }

    for (const [dx, dy] of dirs) {
      if (dx === 0 && dy === 0) continue;
      const nx = m.tileX + dx;
      const ny = m.tileY + dy;
      if (!this.canEnter(nx, ny)) continue;
      if (this.monsters.some(o => o !== m && o.tileX === nx && o.tileY === ny)) continue;

      m.tileX = nx;
      m.tileY = ny;
      m.moveCool = Math.max(0.25, 0.48 - this.wave * 0.015);
      m.wait = rand(0.15, 0.45);
      return;
    }

    m.wait = rand(0.15, 0.45);
  }

  hurtPlayer(p, reason) {
    if (p.inv > 0 || p.damageCool > 0) return;
    p.life--;
    p.inv = 1.6;
    p.damageCool = 1.6;

    if (p.life > 0) {
      p.tileX = p.spawnX;
      p.tileY = p.spawnY;
      this.say(`${p.name} hit by ${reason}.`);
    }
  }

  checkPlayerHazards(p) {
    if (this.blasts.some(e => e.cells.some(c => c.x === p.tileX && c.y === p.tileY))) {
      this.hurtPlayer(p, "blast");
    }
    if (this.monsters.some(m => m.tileX === p.tileX && m.tileY === p.tileY)) {
      this.hurtPlayer(p, "monster");
    }
  }

  maybeItem(x, y) {
    if (Math.random() > 0.40) return;
    const pool = ["range", "bomb", "life"];
    const type = pool[Math.floor(Math.random() * pool.length)];
    this.items.push({
      id: `i${Date.now()}_${Math.random().toString(16).slice(2)}`,
      x,
      y,
      type
    });
  }

  updateItems() {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      for (const p of Object.values(this.players)) {
        if (p.life <= 0) continue;
        if (p.tileX === item.x && p.tileY === item.y) {
          if (item.type === "range") p.range = Math.min(7, p.range + 1);
          if (item.type === "bomb") p.bombMax = Math.min(5, p.bombMax + 1);
          if (item.type === "life") p.life = Math.min(p.maxLife, p.life + 1);
          this.items.splice(i, 1);
          break;
        }
      }
    }
  }

  snapshot() {
    return {
      code: this.code,
      status: this.status,
      wave: this.wave,
      grid: this.grid,
      players: this.players,
      bombs: this.bombs,
      blasts: this.blasts,
      monsters: this.monsters,
      items: this.items,
      messages: this.messages,
      constants: { tile: TILE, cols: COLS, rows: ROWS }
    };
  }
}

io.on("connection", (socket) => {
  socket.on("createRoom", (cb) => {
    const code = makeCode();
    const room = new GameRoom(code);
    rooms.set(code, room);
    const slot = room.addPlayer(socket);
    cb?.({ ok: true, code, slot });
    io.to(code).emit("state", room.snapshot());
  });

  socket.on("joinRoom", (code, cb) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      cb?.({ ok: false, error: "Room not found." });
      return;
    }

    const slot = room.addPlayer(socket);
    if (!slot) {
      cb?.({ ok: false, error: "Room is full." });
      return;
    }

    cb?.({ ok: true, code, slot });
    io.to(code).emit("state", room.snapshot());
  });

  socket.on("startGame", () => {
    const room = roomOf(socket.id);
    if (!room) return;
    room.start();
    io.to(room.code).emit("state", room.snapshot());
  });

  socket.on("restartGame", () => {
    const room = roomOf(socket.id);
    if (!room) return;
    room.restart();
    io.to(room.code).emit("state", room.snapshot());
  });

  socket.on("move", ({ dx, dy }) => {
    const room = roomOf(socket.id);
    if (!room) return;
    room.handleMove(socket.id, Number(dx), Number(dy));
  });

  socket.on("bomb", () => {
    const room = roomOf(socket.id);
    if (!room) return;
    room.handleBomb(socket.id);
  });

  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      if (room.socketToPlayer.has(socket.id)) {
        const code = room.code;
        room.removePlayer(socket.id);
        if (rooms.has(code)) io.to(code).emit("state", room.snapshot());
        break;
      }
    }
  });
});

function roomOf(socketId) {
  for (const room of rooms.values()) {
    if (room.socketToPlayer.has(socketId)) return room;
  }
  return null;
}

setInterval(() => {
  for (const room of rooms.values()) {
    room.update(1 / 12);
    io.to(room.code).emit("state", room.snapshot());
  }
}, 1000 / 12);

server.listen(PORT, () => {
  console.log(`Online Bubble Game server running on port ${PORT}`);
});
