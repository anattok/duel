const WebSocket = require('ws');

const server = new WebSocket.Server({ port: 8080 });
const rooms = new Map(); // Хранит комнаты: id → { players, mode }

// Константы для боя
const ATTACK_ZONES = {
  HEAD: 'Голова',
  BODY: 'Корпус',
  WAIST: 'Пояс',
  LEGS: 'Ноги'
};

const DAMAGE = {
  HEAD: { min: 15, max: 25 },
  BODY: { min: 10, max: 20 },
  WAIST: { min: 5, max: 15 },
  LEGS: { min: 3, max: 10 }
};

server.on('connection', (socket) => {
  console.log('Новое подключение');
  socket.id = Math.random().toString(36).substring(7);

  // Отправка сообщения клиенту
  socket.send(JSON.stringify({ type: 'welcome', message: 'Connected to server!' }));

  // Обработка сообщений от клиента
  socket.on('message', (data) => {
    const message = JSON.parse(data);
    console.log('Получено:', message);

    switch (message.type) {
      // Создание комнаты
      case 'create_room':
        const roomId = generateRoomId();
        rooms.set(roomId, {
          mode: message.mode || '1x1',
          players: [{ 
            id: socket.id, 
            side: 'blue', 
            socket,
            name: message.playerName || 'Игрок',
            health: 100,
            currentMove: null
          }],
        });
        socket.send(JSON.stringify({ type: 'room_created', roomId }));
        break;

      // Подключение к комнате
      case 'join_room':
        const room = rooms.get(message.roomId);
        if (!room) {
          socket.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        room.players.push({ 
          id: socket.id, 
          side: 'red', 
          socket,
          name: message.playerName || 'Игрок',
          health: 100,
          currentMove: null
        });
        broadcastRoomState(room);
        break;

      // Ход в бою
      case 'make_move':
        handleBattleMove(socket, message);
        break;
    }
  });

  // Закрытие соединения
  socket.on('close', () => {
    console.log('Клиент отключился');
    removePlayer(socket);
  });
});

// Обработка хода в бою
function handleBattleMove(socket, message) {
  const room = findRoomBySocket(socket);
  if (!room) return;

  const player = room.players.find(p => p.socket === socket);
  if (!player) return;

  player.currentMove = {
    defense: message.defense,
    attack: message.attack
  };

  // Проверяем, сделали ли оба игрока ход
  if (room.players.every(p => p.currentMove)) {
    processBattleRound(room);
  }
}

// Обработка раунда боя
function processBattleRound(room) {
  const [player1, player2] = room.players;
  
  // Рассчитываем урон
  const result1 = calculateDamageWithDetails(player1.currentMove.attack, player2.currentMove.defense);
  const result2 = calculateDamageWithDetails(player2.currentMove.attack, player1.currentMove.defense);

  // Применяем урон
  player1.health = Math.max(0, player1.health - result2.damage);
  player2.health = Math.max(0, player2.health - result1.damage);

  // Формируем детали для каждого игрока
  const details1 = [
    {
      message: `=== Ваш ход ===`,
      type: 'system'
    },
    {
      message: `Вы атаковали в ${ATTACK_ZONES[player1.currentMove.attack]}`,
      type: 'system'
    },
    {
      message: result1.message,
      type: result1.damage === 0 ? 'block' : 'damage'
    },
    {
      message: `=== Ход противника ===`,
      type: 'system'
    },
    {
      message: `Противник атаковал в ${ATTACK_ZONES[player2.currentMove.attack]}`,
      type: 'system'
    },
    {
      message: result2.message,
      type: result2.damage === 0 ? 'block' : 'damage'
    },
    {
      message: `=== Итоги раунда ===`,
      type: 'system'
    },
    {
      message: `Вы нанесли: ${result1.damage} урона`,
      type: result1.damage === 0 ? 'block' : 'damage'
    },
    {
      message: `Вы получили: ${result2.damage} урона`,
      type: result2.damage === 0 ? 'block' : 'damage'
    },
    {
      message: `Ваше здоровье: ${player1.health}`,
      type: 'system'
    },
    {
      message: `Здоровье противника: ${player2.health}`,
      type: 'system'
    }
  ];

  const details2 = [
    {
      message: `=== Ваш ход ===`,
      type: 'system'
    },
    {
      message: `Вы атаковали в ${ATTACK_ZONES[player2.currentMove.attack]}`,
      type: 'system'
    },
    {
      message: result2.message,
      type: result2.damage === 0 ? 'block' : 'damage'
    },
    {
      message: `=== Ход противника ===`,
      type: 'system'
    },
    {
      message: `Противник атаковал в ${ATTACK_ZONES[player1.currentMove.attack]}`,
      type: 'system'
    },
    {
      message: result1.message,
      type: result1.damage === 0 ? 'block' : 'damage'
    },
    {
      message: `=== Итоги раунда ===`,
      type: 'system'
    },
    {
      message: `Вы нанесли: ${result2.damage} урона`,
      type: result2.damage === 0 ? 'block' : 'damage'
    },
    {
      message: `Вы получили: ${result1.damage} урона`,
      type: result1.damage === 0 ? 'block' : 'damage'
    },
    {
      message: `Ваше здоровье: ${player2.health}`,
      type: 'system'
    },
    {
      message: `Здоровье противника: ${player1.health}`,
      type: 'system'
    }
  ];

  // Отправляем обновление состояния боя
  player1.socket.send(JSON.stringify({
    type: 'battle_update',
    myNewHealth: player1.health,
    enemyNewHealth: player2.health,
    message: `Раунд завершен`,
    details: details1
  }));

  player2.socket.send(JSON.stringify({
    type: 'battle_update',
    myNewHealth: player2.health,
    enemyNewHealth: player1.health,
    message: `Раунд завершен`,
    details: details2
  }));

  // Сбрасываем ходы
  player1.currentMove = null;
  player2.currentMove = null;

  // Проверяем окончание боя
  if (player1.health === 0 || player2.health === 0) {
    const winner = player1.health > 0 ? player1 : player2;
    const gameOverMessage = `Игра окончена! Победитель: ${winner.name}`;
    
    room.players.forEach(p => {
      p.socket.send(JSON.stringify({
        type: 'game_over',
        message: gameOverMessage
      }));
    });
  }
}

// Рассчет урона с подробностями
function calculateDamageWithDetails(attackZone, defenseZone) {
  if (attackZone === defenseZone) {
    return {
      damage: 0,
      message: `Атака в ${ATTACK_ZONES[attackZone]} заблокирована!`
    };
  }
  
  const damageRange = DAMAGE[attackZone];
  const damage = Math.floor(Math.random() * (damageRange.max - damageRange.min + 1)) + damageRange.min;
  
  return {
    damage,
    message: `Успешная атака в ${ATTACK_ZONES[attackZone]} нанесла ${damage} урона!`
  };
}

// Поиск комнаты по сокету игрока
function findRoomBySocket(socket) {
  for (const [_, room] of rooms) {
    if (room.players.some(p => p.socket === socket)) {
      return room;
    }
  }
  return null;
}

// Удаление игрока при отключении
function removePlayer(socket) {
  for (const [roomId, room] of rooms) {
    const playerIndex = room.players.findIndex(p => p.socket === socket);
    if (playerIndex !== -1) {
      room.players.splice(playerIndex, 1);
      if (room.players.length === 0) {
        rooms.delete(roomId);
      } else {
        broadcastRoomState(room);
      }
      break;
    }
  }
}

// Генерация ID комнаты
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Рассылка состояния комнаты всем игрокам
function broadcastRoomState(room) {
  const state = {
    type: 'room_state',
    mode: room.mode,
    players: room.players.map(p => ({ 
      id: p.id, 
      side: p.side, 
      name: p.name,
      health: p.health
    })),
  };
  room.players.forEach(player => player.socket.send(JSON.stringify(state)));
}

console.log('Сервер запущен на ws://localhost:8080');