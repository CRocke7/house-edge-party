const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname));

const rooms = new Map();
const STARTING_CHIPS = 1000;
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({length: 5}, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}
function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    maxRounds: room.maxRounds,
    pot: room.pot,
    message: room.message,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, chips: p.chips, ready: p.ready,
      connected: p.connected, bet: p.bet, choice: p.choice,
      lastRoll: p.lastRoll, roundScore: p.roundScore,
      isHost: p.id === room.hostId
    }))
  };
}
function sendRoom(room) { io.to(room.code).emit("state", publicRoom(room)); }
function note(room, msg) { room.message = msg; }
function activePlayers(room) {
  return [...room.players.values()].filter(p => p.connected);
}
function settleRound(room) {
  const players = activePlayers(room);
  const contenders = players.filter(p => p.choice !== "fold" && p.bet > 0);
  if (!contenders.length) {
    room.phase = "lobby";
    room.pot = 0;
    note(room, "Everyone folded. The chips stay in your stacks.");
    sendRoom(room);
    return;
  }
  let best = -1;
  let winners = [];
  for (const p of contenders) {
    const score = p.lastRoll[0] + p.lastRoll[1] + (p.choice === "bold" ? 2 : 0);
    p.roundScore = score;
    if (score > best) { best = score; winners = [p]; }
    else if (score === best) winners.push(p);
  }
  const share = Math.floor(room.pot / winners.length);
  const remainder = room.pot - share * winners.length;
  winners.forEach((p, i) => { p.chips += share + (i === 0 ? remainder : 0); });
  note(room, `${winners.map(p => p.name).join(" and ")} win ${room.pot.toLocaleString()} chips${winners.length > 1 ? " each share the pot" : ""}!`);
  room.phase = "results";
  room.results = { winners: winners.map(p => p.id), best };
  sendRoom(room);
}
function startRound(room) {
  const players = activePlayers(room);
  if (players.length < MIN_PLAYERS) return;
  room.round += 1;
  room.pot = 0;
  room.results = null;
  for (const p of players) {
    p.bet = 0; p.choice = null; p.lastRoll = null; p.roundScore = null; p.locked = false;
  }
  room.phase = "betting";
  note(room, `Round ${room.round}: choose your stake. Bigger bets mean bigger risk.`);
  sendRoom(room);
}

io.on("connection", socket => {
  socket.on("createRoom", ({name, maxRounds} = {}, cb = () => {}) => {
    const code = makeCode();
    const cleanName = String(name || "Player").trim().slice(0, 18) || "Player";
    const room = {
      code, hostId: socket.id, phase: "lobby", round: 0,
      maxRounds: [3,5,10].includes(Number(maxRounds)) ? Number(maxRounds) : 5,
      pot: 0, message: "Waiting for players to join.", players: new Map(), results: null
    };
    room.players.set(socket.id, {
      id: socket.id, name: cleanName, chips: STARTING_CHIPS, ready: true,
      connected: true, bet: 0, choice: null, lastRoll: null, roundScore: null, locked: false
    });
    rooms.set(code, room);
    socket.join(code);
    cb({ok:true, code});
    sendRoom(room);
  });

  socket.on("joinRoom", ({code, name} = {}, cb = () => {}) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb({ok:false, error:"Room not found. Check the code and try again."});
    if (room.players.size >= MAX_PLAYERS) return cb({ok:false, error:"That room is full (8 players max)."});
    if (room.phase !== "lobby") return cb({ok:false, error:"That game has already started."});
    const cleanName = String(name || "Player").trim().slice(0, 18) || "Player";
    const p = {id:socket.id, name:cleanName, chips:STARTING_CHIPS, ready:true, connected:true,
      bet:0, choice:null, lastRoll:null, roundScore:null, locked:false};
    room.players.set(socket.id, p);
    socket.join(code);
    cb({ok:true, code});
    note(room, `${cleanName} joined the table.`);
    sendRoom(room);
  });

  socket.on("startGame", ({code} = {}) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || room.hostId !== socket.id || room.phase !== "lobby") return;
    if (activePlayers(room).length < MIN_PLAYERS) return socket.emit("toast", "You need at least 2 players.");
    room.round = 0;
    startRound(room);
  });

  socket.on("placeBet", ({code, amount, choice} = {}) => {
    const room = rooms.get(String(code || "").toUpperCase());
    const p = room && room.players.get(socket.id);
    if (!room || !p || room.phase !== "betting" || p.locked) return;
    if (!["steady", "bold", "fold"].includes(choice)) return;
    amount = Math.floor(Number(amount));
    if (choice === "fold") amount = 0;
    else if (!Number.isFinite(amount) || amount < 10 || amount > p.chips) return socket.emit("toast", "Choose a valid stake from 10 chips up to your stack.");
    p.chips -= amount;
    p.bet = amount;
    p.choice = choice;
    p.locked = true;
    room.pot += amount;
    if (choice === "fold") {
      p.lastRoll = [0,0];
      note(room, `${p.name} sat this round out.`);
    } else {
      // Roll is server-side so clients cannot choose or alter it.
      p.lastRoll = [1 + crypto.randomInt(6), 1 + crypto.randomInt(6)];
      note(room, `${p.name} locked in. Waiting for the others...`);
    }
    const players = activePlayers(room);
    if (players.every(x => x.locked)) settleRound(room);
    else sendRoom(room);
  });

  socket.on("nextRound", ({code} = {}) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || room.hostId !== socket.id || room.phase !== "results") return;
    if (room.round >= room.maxRounds) {
      room.phase = "finished";
      const sorted = [...room.players.values()].sort((a,b) => b.chips - a.chips);
      note(room, `Game over! ${sorted[0]?.name || "Nobody"} finished on top with ${sorted[0]?.chips.toLocaleString() || 0} chips.`);
      sendRoom(room);
    } else startRound(room);
  });

  socket.on("playAgain", ({code} = {}) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || room.hostId !== socket.id || room.phase !== "finished") return;
    for (const p of room.players.values()) {
      p.chips = STARTING_CHIPS; p.ready = true; p.bet = 0; p.choice = null;
      p.lastRoll = null; p.roundScore = null; p.locked = false;
    }
    room.round = 0; room.pot = 0; room.phase = "lobby"; room.results = null;
    note(room, "Fresh stacks. Waiting to start again.");
    sendRoom(room);
  });

  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      const p = room.players.get(socket.id);
      if (!p) continue;
      p.connected = false;
      note(room, `${p.name} disconnected.`);
      if (room.hostId === socket.id) {
        const next = [...room.players.values()].find(x => x.connected);
        if (next) room.hostId = next.id;
      }
      if (room.phase === "betting" && activePlayers(room).length > 0 && activePlayers(room).every(x => x.locked)) settleRound(room);
      else sendRoom(room);
    }
  });
});

server.listen(PORT, () => console.log(`House Edge Party running on port ${PORT}`));
