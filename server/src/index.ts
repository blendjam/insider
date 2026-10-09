import 'dotenv/config'
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Server, type Socket } from 'socket.io'
import decksJson from '../word-decks.json' with { type: 'json' }

const moduleLocation = import.meta.url
const modulePath = moduleLocation.startsWith('file:') ? fileURLToPath(moduleLocation) : moduleLocation
const __dirname = dirname(modulePath)
const decks = decksJson as Record<string, string[]>
const roundDurations = new Set([30, 60, 90, 120, 150, 180])
const port = Number.parseInt(process.env.PORT || '3001', 10)
const allowedOrigins = new Set(
  (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)
const allowedPreviewHosts = [...allowedOrigins]
  .filter((origin) => origin.startsWith('https://*.'))
  .map((origin) => origin.slice('https://*.'.length).toLowerCase())

function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.has(origin)) return true

  let parsedOrigin: URL
  try {
    parsedOrigin = new URL(origin)
  } catch {
    return false
  }
  if (parsedOrigin.protocol !== 'https:' || parsedOrigin.origin !== origin) return false

  return allowedPreviewHosts.some((host) => {
    const suffix = `.${host}`
    const subdomain = parsedOrigin.hostname.slice(0, -suffix.length)
    return parsedOrigin.hostname.endsWith(suffix) && subdomain.length > 0 && !subdomain.includes('.')
  })
}

const app = express()
app.disable('x-powered-by')
app.get('/healthz', (_request, response) => response.json({ ok: true }))
app.use(express.static(resolve(__dirname, '../../dist'), { index: false, maxAge: '1h' }))
app.get('*', (_request, response, next) => {
  response.sendFile(resolve(__dirname, '../../dist/index.html'), (error) => {
    if (error) next()
  })
})

const httpServer = createServer(app)
type Role = 'judge' | 'insider' | 'citizen'
type Stage = 'lobby' | 'reveal' | 'questions' | 'discussion' | 'hand-vote' | 'ballot' | 'tie-break' | 'result'
type Winner = 'commons' | 'insider' | 'nobody'
type Ack<T = undefined> = { ok: true; data: T } | { ok: false; error: string }
type AckCallback<T = undefined> = (result: Ack<T>) => void

interface Player {
  id: string
  name: string
  socketId: string | null
  connected: boolean
  disconnectedAt: number | null
  ready: boolean
  role: Role | null
}

interface Room {
  code: string
  category: string
  hostId: string
  stage: Stage
  round: number
  roundDurationSeconds: number
  players: Map<string, Player>
  word: string | null
  deadline: number | null
  solverId: string | null
  handVotes: Map<string, boolean>
  ballots: Map<string, string>
  tiedPlayerIds: string[]
  winner: Winner | null
  outcomeReason: string | null
  createdAt: number
  lastActivity: number
  emptySince: number | null
  guessAt: Map<string, number>
}

interface SocketData {
  roomCode?: string
  playerId?: string
}

interface ClientToServerEvents {
  'room:create': (input: { name: string; category: string; code?: string }, callback: AckCallback<{ room: string; playerId: string }>) => void
  'room:join': (input: { code: string; name: string; playerId?: string }, callback: AckCallback<{ room: string; playerId: string }>) => void
  'room:resume': (input: { code: string; playerId: string }, callback: AckCallback<{ room: string; playerId: string }>) => void
  'room:leave': () => void
  'room:kick': (input: { playerId: string }, callback: AckCallback) => void
  'room:category': (input: { category: string }, callback: AckCallback) => void
  'room:ready': (input: { ready: boolean }, callback: AckCallback) => void
  'game:start': (input: { durationSeconds: number }, callback: AckCallback) => void
  'game:continue': (callback: AckCallback) => void
  'game:guess': (input: { guess: string }, callback: AckCallback<{ solverId: string }>) => void
  'game:end-discussion': (callback: AckCallback) => void
  'game:hand-vote': (input: { thinksInsider: boolean }, callback: AckCallback) => void
  'game:ballot': (input: { targetId: string }, callback: AckCallback) => void
  'game:tie-break': (input: { targetId: string }, callback: AckCallback) => void
  'game:end-round': (callback: AckCallback) => void
  'game:restart': (input: { durationSeconds: number }, callback: AckCallback) => void
  'game:play-again': (callback: AckCallback) => void
}

interface ServerToClientEvents {
  'room:update': (room: ReturnType<typeof publicRoom>) => void
  'room:kicked': () => void
  'player:private': (role: { round: number; role: Role | null; word: string | null; category: string; handVote: boolean | null; hasBallot: boolean }) => void
  'room:error': (message: string) => void
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>

const io: GameServer = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) callback(null, true)
      else callback(new Error('This origin is not allowed to connect.'))
    },
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 16_384,
  pingInterval: 25_000,
  pingTimeout: 20_000,
})

const rooms = new Map<string, Room>()
const roomCodeAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const MAX_ROOM_AGE = 24 * 60 * 60 * 1000
const EMPTY_ROOM_TTL = 5 * 60 * 1000
const DISCONNECTED_PLAYER_TTL = 30 * 60 * 1000

function createCode(requestedCode?: string): string {
  if (requestedCode) {
    if (rooms.has(requestedCode)) throw new Error('That room code is already in use.')
    return requestedCode
  }

  let code
  do {
    code = Array.from(randomBytes(6), (byte) => roomCodeAlphabet[byte % roomCodeAlphabet.length]).join('')
  } while (rooms.has(code))
  return code
}

function cleanName(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').slice(0, 24)
    : ''
}

function cleanCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : ''
}

function connectedPlayers(room: Room): Player[] {
  return [...room.players.values()].filter((player) => player.connected)
}

function updateEmptySince(room: Room, now = Date.now()): void {
  room.emptySince = connectedPlayers(room).length === 0
    ? room.emptySince ?? now
    : null
}

function playerSocket(player: Player | undefined): GameSocket | undefined {
  return player?.socketId ? io.sockets.sockets.get(player.socketId) : undefined
}

function privateRole(player: Player, room: Room): void {
  if (room.stage === 'lobby' || !player.role) return
  playerSocket(player)?.emit('player:private', {
    round: room.round,
    roundDurationSeconds: room.roundDurationSeconds,
    role: player.role,
    word: player.role === 'judge' || player.role === 'insider' ? room.word : null,
    category: room.category,
    handVote: room.handVotes.get(player.id) ?? null,
    hasBallot: room.ballots.has(player.id),
  })
}

function publicRoom(room: Room) {
  const showOutcome = room.stage === 'result'
  return {
    code: room.code,
    category: room.category,
    hostId: room.hostId,
    stage: room.stage,
    round: room.round,
    players: [...room.players.values()].map(({ id, name, connected, ready }) => ({ id, name, connected, ready })),
    deadline: room.deadline,
    solverId: room.solverId,
    handVotes: room.handVotes.size,
    ballotVotes: room.ballots.size,
    tiedPlayerIds: room.tiedPlayerIds,
    winner: room.winner,
    outcomeReason: room.outcomeReason,
    word: showOutcome ? room.word : null,
    roles: showOutcome
      ? Object.fromEntries([...room.players.values()].map((player) => [player.id, player.role as Role]))
      : null,
  }
}

function broadcast(room: Room): void {
  io.to(room.code).emit('room:update', publicRoom(room))
  for (const player of room.players.values()) privateRole(player, room)
}

function fail<T>(socket: GameSocket, callback: AckCallback<T>, message: string): void {
  callback({ ok: false, error: message })
  socket.emit('room:error', message)
}

function handleAck<T>(socket: GameSocket, callback: AckCallback<T>, action: () => T): void {
  try {
    callback({ ok: true, data: action() })
  } catch (error) {
    fail(socket, callback, error instanceof Error ? error.message : 'Something went wrong.')
  }
}

function makeRoom({ name, category, code, socket }: { name: string; category: string; code?: string; socket: GameSocket }): { room: Room; player: Player } {
  if (!name) throw new Error('Enter your name first.')
  if (!Object.hasOwn(decks, category)) throw new Error('Choose a valid word deck.')
  const roomCode = createCode(code)
  const playerId = randomUUID()
  const player: Player = { id: playerId, name, socketId: socket.id, connected: true, disconnectedAt: null, ready: false, role: null }
  const room: Room = {
    code: roomCode,
    category,
    hostId: playerId,
    stage: 'lobby',
    round: 0,
    roundDurationSeconds: 180,
    players: new Map([[playerId, player]]),
    word: null,
    deadline: null,
    solverId: null,
    handVotes: new Map(),
    ballots: new Map(),
    tiedPlayerIds: [],
    winner: null,
    outcomeReason: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    emptySince: null,
    guessAt: new Map(),
  }
  rooms.set(roomCode, room)
  socket.join(roomCode)
  socket.data.roomCode = roomCode
  socket.data.playerId = playerId
  broadcast(room)
  return { room, player }
}

function requireRoom(socket: GameSocket): { room: Room; player: Player } {
  const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined
  const player = room && socket.data.playerId ? room.players.get(socket.data.playerId) : undefined
  if (!room || !player || !player.connected || player.socketId !== socket.id) {
    throw new Error('Your room connection expired. Rejoin using the room code.')
  }
  room.lastActivity = Date.now()
  return { room, player }
}

function enterRoom(socket: GameSocket, room: Room, player: Player): void {
  const previous = playerSocket(player)
  if (previous && previous.id !== socket.id) {
    previous.data.roomCode = undefined
    previous.data.playerId = undefined
    previous.leave(room.code)
    previous.disconnect(true)
  }
  player.socketId = socket.id
  player.connected = true
  player.disconnectedAt = null
  room.lastActivity = Date.now()
  updateEmptySince(room)
  socket.join(room.code)
  socket.data.roomCode = room.code
  socket.data.playerId = player.id
  privateRole(player, room)
  broadcast(room)
}

function setStage(room: Room, stage: Stage, durationSeconds: number | null): void {
  room.stage = stage
  room.deadline = durationSeconds ? Date.now() + durationSeconds * 1000 : null
  room.lastActivity = Date.now()
}

function finish(room: Room, winner: Winner, reason: string): void {
  room.winner = winner
  room.outcomeReason = reason
  room.deadline = null
  room.stage = 'result'
  room.lastActivity = Date.now()
  broadcast(room)
}

function finishQuestions(room: Room): void {
  finish(room, 'nobody', 'The word stayed hidden until time ran out.')
}

function startDiscussion(room: Room): void {
  room.handVotes.clear()
  room.ballots.clear()
  room.tiedPlayerIds = []
  setStage(room, 'discussion', 120)
  broadcast(room)
}

function startBallot(room: Room): void {
  room.ballots.clear()
  room.handVotes.clear()
  setStage(room, 'ballot', null)
  broadcast(room)
}

function concludeBallot(room: Room): void {
  const tally = new Map()
  for (const targetId of room.ballots.values()) tally.set(targetId, (tally.get(targetId) || 0) + 1)
  const highest = Math.max(...tally.values())
  const leaders = [...tally].filter(([, votes]) => votes === highest).map(([id]) => id)
  if (leaders.length > 1) {
    room.tiedPlayerIds = leaders
    setStage(room, 'tie-break', null)
    broadcast(room)
  } else {
    const chosen = room.players.get(leaders[0])
    if (chosen?.role === 'insider') finish(room, 'commons', 'The final vote exposed the Insider.')
    else finish(room, 'insider', 'The group voted for a Citizen. The Insider wins.')
  }
}

function tryCompleteVotes(room: Room): void {
  const connectedIds = new Set(connectedPlayers(room).map((player) => player.id))
  if (room.stage === 'hand-vote' && [...connectedIds].every((id) => room.handVotes.has(id))) {
    const yesVotes = [...room.handVotes.values()].filter(Boolean).length
    const solver = room.solverId ? room.players.get(room.solverId) : undefined
    if (yesVotes > connectedIds.size / 2) {
      if (solver?.role === 'insider') finish(room, 'commons', `The group correctly identified ${solver.name} as the Insider.`)
      else finish(room, 'insider', `${solver?.name || 'The accused player'} was a Citizen. The Insider slipped away.`)
    } else {
      startBallot(room)
    }
  } else if (room.stage === 'ballot' && [...connectedIds].every((id) => room.ballots.has(id))) {
    concludeBallot(room)
  }
}

function startRound(room: Room): void {
  room.round += 1
  room.word = decks[room.category][randomBytes(4).readUInt32BE(0) % decks[room.category].length]
  room.solverId = null
  room.winner = null
  room.outcomeReason = null
  room.handVotes.clear()
  room.ballots.clear()
  room.tiedPlayerIds = []
  room.guessAt.clear()
  const players = [...room.players.values()]
  const judge = players[randomBytes(4).readUInt32BE(0) % players.length]
  if (!judge) throw new Error('Unable to assign a Judge.')
  for (const player of room.players.values()) {
    player.ready = false
    player.role = player.id === judge.id ? 'judge' : 'citizen'
  }
  const insiderPool = players.filter((player) => player.id !== judge.id)
  const insider = insiderPool[randomBytes(4).readUInt32BE(0) % insiderPool.length]
  if (!insider) throw new Error('Unable to assign an Insider.')
  insider.role = 'insider'
  setStage(room, 'reveal', null)
  for (const player of room.players.values()) privateRole(player, room)
  broadcast(room)
}

function returnToLobby(room: Room): void {
  room.stage = 'lobby'
  room.word = null
  room.deadline = null
  room.solverId = null
  room.handVotes.clear()
  room.ballots.clear()
  room.tiedPlayerIds = []
  room.winner = null
  room.outcomeReason = null
  room.guessAt.clear()
  for (const player of room.players.values()) {
    player.ready = false
    player.role = null
  }
}

function completeReveal(room: Room): void {
  if (room.stage !== 'reveal') return
  if ([...room.players.values()].every((player) => player.connected && player.ready)) {
    setStage(room, 'questions', room.roundDurationSeconds)
    broadcast(room)
  }
}

io.on('connection', (socket) => {
  socket.on('room:create', (input, callback) => handleAck(socket, callback, () => {
    const name = cleanName(input?.name)
    const code = cleanCode(input?.code)
    const { room, player } = makeRoom({ name, category: input?.category, code, socket })
    return { room: room.code, playerId: player.id }
  }))

  socket.on('room:leave', () => {
    const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined
    const player = room && socket.data.playerId ? room.players.get(socket.data.playerId) : undefined
    if (!room || !player || player.socketId !== socket.id) return
    socket.leave(room.code)
    socket.data.roomCode = undefined
    socket.data.playerId = undefined
    player.connected = false
    player.socketId = null
    player.disconnectedAt = Date.now()
    room.lastActivity = player.disconnectedAt
    updateEmptySince(room, player.disconnectedAt)
    broadcast(room)
    tryCompleteVotes(room)
  })

  socket.on('room:kick', (input, callback) => handleAck(socket, callback, () => {
    const { room, player: host } = requireRoom(socket)
    if (host.id !== room.hostId) throw new Error('Only the host can remove players.')
    const target = room.players.get(input?.playerId)
    if (!target || target.id === host.id) throw new Error('Choose another player in the room.')

    const wasInGame = room.stage !== 'lobby'
    const targetSocket = playerSocket(target)
    targetSocket?.emit('room:kicked')
    targetSocket?.leave(room.code)
    if (targetSocket) {
      targetSocket.data.roomCode = undefined
      targetSocket.data.playerId = undefined
    }
    room.players.delete(target.id)
    room.handVotes.delete(target.id)
    room.ballots.delete(target.id)
    room.tiedPlayerIds = room.tiedPlayerIds.filter((id) => id !== target.id)
    room.guessAt.delete(target.id)
    room.lastActivity = Date.now()
    updateEmptySince(room)

    if (wasInGame) {
      const players = connectedPlayers(room)
      if (players.length >= 4 && players.length === room.players.size) startRound(room)
      else {
        returnToLobby(room)
        broadcast(room)
      }
    } else {
      broadcast(room)
    }
    return undefined
  }))

  socket.on('room:join', (input, callback) => handleAck(socket, callback, () => {
    const code = cleanCode(input?.code)
    const name = cleanName(input?.name)
    const room = rooms.get(code)
    if (!room) throw new Error('Room not found. Check the code and try again.')
    if (!name) throw new Error('Enter your name first.')
    const savedPlayer = input?.playerId ? room.players.get(input.playerId) : undefined
    if (savedPlayer) {
      if (savedPlayer.connected) throw new Error('That saved player is already connected.')
      if ([...room.players.values()].some((player) => player.id !== savedPlayer.id && player.name.toLowerCase() === name.toLowerCase())) {
        throw new Error('Someone in this room already has that name.')
      }
      savedPlayer.name = name
      enterRoom(socket, room, savedPlayer)
      return { room: room.code, playerId: savedPlayer.id }
    }
    const returningPlayer = [...room.players.values()].find((player) => player.name.toLowerCase() === name.toLowerCase())
    if (returningPlayer) {
      if (returningPlayer.connected) throw new Error('Someone in this room already has that name.')
      enterRoom(socket, room, returningPlayer)
      return { room: room.code, playerId: returningPlayer.id }
    }
    if (room.stage !== 'lobby') throw new Error('This game has already started.')
    if (room.players.size >= 12) throw new Error('This room is full.')
    const player: Player = { id: randomUUID(), name, socketId: socket.id, connected: true, disconnectedAt: null, ready: false, role: null }
    room.players.set(player.id, player)
    socket.join(room.code)
    socket.data.roomCode = room.code
    socket.data.playerId = player.id
    room.lastActivity = Date.now()
    updateEmptySince(room)
    broadcast(room)
    return { room: room.code, playerId: player.id }
  }))

  socket.on('room:resume', (input, callback) => handleAck(socket, callback, () => {
    const room = rooms.get(cleanCode(input?.code))
    const player = room?.players.get(input?.playerId)
    if (!room || !player) throw new Error('That room or saved player could not be found.')
    enterRoom(socket, room, player)
    return { room: room.code, playerId: player.id }
  }))

  socket.on('room:category', (input, callback) => handleAck(socket, callback, () => {
    const { room, player } = requireRoom(socket)
    if ((room.stage !== 'lobby' && room.stage !== 'result') || player.id !== room.hostId) {
      throw new Error('Only the host can change the word deck between rounds.')
    }
    if (!Object.hasOwn(decks, input?.category)) throw new Error('Choose a valid word deck.')
    room.category = input.category
    broadcast(room)
    return undefined
  }))

  socket.on('room:ready', (input, callback) => handleAck(socket, callback, () => {
    const { room, player } = requireRoom(socket)
    if (room.stage !== 'reveal') throw new Error('The role reveal is not active.')
    player.ready = input?.ready === true
    broadcast(room)
    completeReveal(room)
    return undefined
  }))

  socket.on('game:start', (input, callback) => handleAck(socket, callback, () => {
    const { room, player } = requireRoom(socket)
    if (player.id !== room.hostId || room.stage !== 'lobby') throw new Error('Only the host can start a lobby.')
    if (room.players.size < 4) throw new Error('At least four players are needed.')
    if (room.players.size > 12) throw new Error('A room can have at most twelve players.')
    if (connectedPlayers(room).length !== room.players.size) throw new Error('Everyone needs to be connected before the game starts.')
    if (!roundDurations.has(input?.durationSeconds)) throw new Error('Choose a valid round timer.')
    room.roundDurationSeconds = input.durationSeconds
    startRound(room)
    return undefined
  }))

  socket.on('game:continue', (callback) => handleAck(socket, callback, () => {
    const { room, player } = requireRoom(socket)
    if (player.id !== room.hostId || room.stage !== 'reveal') {
      throw new Error('Only the host can start the game from the role reveal.')
    }
    setStage(room, 'questions', room.roundDurationSeconds)
    broadcast(room)
    return undefined
  }))

  socket.on('game:guess', (input, callback) => handleAck(socket, callback, () => {
    const { room, player } = requireRoom(socket)
    if (room.stage !== 'questions') throw new Error('Questions are not open right now.')
    if (player.role === 'judge') throw new Error('The Judge guides the round; players ask and guess.')
    const now = Date.now()
    if (now - (room.guessAt.get(player.id) || 0) < 800) throw new Error('Wait a moment before guessing again.')
    room.guessAt.set(player.id, now)
    const guess = typeof input?.guess === 'string' ? input.guess.trim().slice(0, 80) : ''
    if (!guess) throw new Error('Type your guess first.')
    if (!room.word || guess.toLocaleLowerCase() !== room.word.toLocaleLowerCase()) throw new Error('Not quite. Keep asking questions and try again.')
    room.solverId = player.id
    startDiscussion(room)
    return { solverId: player.id }
  }))

  socket.on('game:end-discussion', (callback) => handleAck(socket, callback, () => {
    const { room, player } = requireRoom(socket)
    if (room.stage !== 'discussion') throw new Error('The discussion has already ended.')
    if (player.id !== room.hostId && player.role !== 'judge') {
      throw new Error('Only the host or the Judge can end the discussion early.')
    }
    room.handVotes.clear()
    setStage(room, 'hand-vote', null)
    broadcast(room)
    return undefined
  }))

  socket.on('game:hand-vote', (input, callback) => handleAck(socket, callback, () => {
    const { room, player } = requireRoom(socket)
    if (room.stage !== 'hand-vote') throw new Error('The first vote is not open.')
    if (typeof input?.thinksInsider !== 'boolean') throw new Error('Choose yes or no.')
    if (room.handVotes.has(player.id)) throw new Error('You already voted.')
    room.handVotes.set(player.id, input.thinksInsider)
    broadcast(room)
    tryCompleteVotes(room)
    return undefined
  }))

  socket.on('game:ballot', (input, callback) => handleAck(socket, callback, () => {
    const { room, player } = requireRoom(socket)
    if (room.stage !== 'ballot') throw new Error('The final vote is not open.')
    if (room.ballots.has(player.id)) throw new Error('You already voted.')
    if (!room.players.has(input?.targetId) || input.targetId === player.id) throw new Error('Choose another player.')
    room.ballots.set(player.id, input.targetId)
    broadcast(room)
    tryCompleteVotes(room)
    return undefined
  }))

  socket.on('game:tie-break', (input, callback) => handleAck(socket, callback, () => {
    const { room, player } = requireRoom(socket)
    if (room.stage !== 'tie-break' || player.id !== room.solverId) throw new Error('Only the player who found the word can break this tie.')
    if (!room.tiedPlayerIds.includes(input?.targetId)) throw new Error('Choose one of the tied players.')
    const chosen = room.players.get(input.targetId)
    if (chosen?.role === 'insider') finish(room, 'commons', `${player.name} broke the tie and found the Insider.`)
    else finish(room, 'insider', `${player.name} broke the tie for a Citizen.`)
    return undefined
  }))

  socket.on('game:play-again', (callback) => handleAck(socket, callback, () => {
    const { room, player } = requireRoom(socket)
    if (room.stage !== 'result' || player.id !== room.hostId) throw new Error('Only the host can start another round.')
    if (connectedPlayers(room).length !== room.players.size) throw new Error('Everyone needs to reconnect before the next round.')
    startRound(room)
    return undefined
  }))

  socket.on('game:restart', (input, callback) => handleAck(socket, callback, () => {
    const { room, player } = requireRoom(socket)
    if (player.id !== room.hostId) throw new Error('Only the host can restart the game.')
    if (room.stage === 'lobby') throw new Error('The game has not started yet.')
    if (room.players.size < 4 || room.players.size > 12) throw new Error('At least four players are needed to restart.')
    if (connectedPlayers(room).length !== room.players.size) throw new Error('Everyone needs to reconnect before restarting.')
    if (!roundDurations.has(input?.durationSeconds)) throw new Error('Choose a valid round timer.')
    room.roundDurationSeconds = input.durationSeconds
    startRound(room)
    return undefined
  }))

  socket.on('game:end-round', (callback) => handleAck(socket, callback, () => {
    const { room, player } = requireRoom(socket)
    if (player.id !== room.hostId) throw new Error('Only the host can end the round early.')
    if (room.stage === 'lobby' || room.stage === 'result') throw new Error('There is no active round to end.')
    finish(room, 'nobody', 'The host ended the round early.')
    return undefined
  }))

  socket.on('disconnect', () => {
    const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined
    const player = room && socket.data.playerId ? room.players.get(socket.data.playerId) : undefined
    if (!room || !player || player.socketId !== socket.id) return
    player.connected = false
    player.socketId = null
    player.disconnectedAt = Date.now()
    room.lastActivity = player.disconnectedAt
    updateEmptySince(room, player.disconnectedAt)
    broadcast(room)
    tryCompleteVotes(room)
  })
})

const timers = setInterval(() => {
  const now = Date.now()
  for (const [code, room] of rooms) {
    updateEmptySince(room, now)
    if (room.emptySince !== null && now - room.emptySince >= EMPTY_ROOM_TTL) {
      rooms.delete(code)
      continue
    }
    if (now - room.lastActivity > MAX_ROOM_AGE) {
      rooms.delete(code)
      continue
    }
    let removedDisconnectedPlayers = false
    for (const [playerId, player] of room.players) {
      if (player.connected || player.disconnectedAt === null || now - player.disconnectedAt < DISCONNECTED_PLAYER_TTL) continue
      room.players.delete(playerId)
      room.handVotes.delete(playerId)
      room.ballots.delete(playerId)
      room.guessAt.delete(playerId)
      room.tiedPlayerIds = room.tiedPlayerIds.filter((tiedPlayerId) => tiedPlayerId !== playerId)
      if (room.hostId === playerId) {
        const nextHost = connectedPlayers(room)[0]
        if (nextHost) room.hostId = nextHost.id
      }
      removedDisconnectedPlayers = true
    }
    if (removedDisconnectedPlayers) {
      const previousStage = room.stage
      tryCompleteVotes(room)
      if (room.stage === previousStage) broadcast(room)
    }
    if (!room.deadline || now < room.deadline) continue
    if (room.stage === 'questions') finishQuestions(room)
    else if (room.stage === 'discussion') {
      setStage(room, 'hand-vote', null)
      broadcast(room)
    }
  }
}, 1000)
timers.unref()

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Insider server listening on port ${port}`)
})

function shutdown() {
  clearInterval(timers)
  io.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
