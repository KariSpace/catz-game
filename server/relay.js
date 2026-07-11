// Dev-релей для локального тесту з телефоном: імітує транспорт AirConsole
// через WebSocket. Статику віддає Vite (npm run dev), релей — лише повідомлення.
//
//   Екран:    http://localhost:5173/screen.html?local=1
//   Телефон:  http://<IP-ноутбука>:5173/controller.html?local=1  (та сама WiFi)

import { WebSocketServer } from 'ws';
import os from 'node:os';

const PORT = 3001;

const wss = new WebSocketServer({ port: PORT });

let screenWs = null;
const controllers = new Map(); // id → ws
let nextId = 1;

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Перше повідомлення — реєстрація ролі
    if (!ws._role) {
      if (msg.role === 'screen') {
        ws._role = 'screen';
        screenWs = ws;
        console.log('[relay] screen connected');
        controllers.forEach((_, id) => screenWs.send(JSON.stringify({ type: 'connect', id })));
      } else if (msg.role === 'controller') {
        ws._role = 'controller';
        ws._id = nextId++;
        controllers.set(ws._id, ws);
        console.log(`[relay] controller ${ws._id} connected`);
        ws.send(JSON.stringify({ type: 'your_id', id: ws._id }));
        screenWs?.send(JSON.stringify({ type: 'connect', id: ws._id }));
      }
      return;
    }

    if (msg.to === 'screen' && screenWs) {
      screenWs.send(JSON.stringify({ ...msg, from: ws._id }));
    } else if (msg.to === 'controller' && msg.id != null) {
      controllers.get(Number(msg.id))?.send(JSON.stringify(msg));
    } else if (msg.to === 'all') {
      controllers.forEach((c) => c.send(JSON.stringify(msg)));
    }
  });

  ws.on('close', () => {
    if (ws._role === 'controller') {
      controllers.delete(ws._id);
      console.log(`[relay] controller ${ws._id} disconnected`);
      screenWs?.send(JSON.stringify({ type: 'disconnect', id: ws._id }));
    } else if (ws._role === 'screen') {
      screenWs = null;
      console.log('[relay] screen disconnected');
    }
  });
});

function localIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '<IP>';
}

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Релей запущено на порту ${PORT}
  🎮  Екран:    http://localhost:5173/screen.html?local=1
  📱  Телефон:  http://${localIP()}:5173/controller.html?local=1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
