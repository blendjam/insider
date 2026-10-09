export type PlayerRole = 'judge' | 'insider' | 'citizen'
export type GameStage =
  | 'lobby'
  | 'reveal'
  | 'questions'
  | 'discussion'
  | 'hand-vote'
  | 'ballot'
  | 'tie-break'
  | 'result'

export type PublicPlayer = {
  id: string
  name: string
  connected: boolean
  ready: boolean
}

export type PublicRoom = {
  code: string
  category: string
  hostId: string
  stage: GameStage
  round: number
  roundDurationSeconds: number
  players: PublicPlayer[]
  deadline: number | null
  solverId: string | null
  handVotes: number
  ballotVotes: number
  tiedPlayerIds: string[]
  winner: 'commons' | 'insider' | 'nobody' | null
  outcomeReason: string | null
  word: string | null
  roles: Record<string, PlayerRole> | null
}

export type PrivateRole = {
  round: number
  role: PlayerRole
  word: string | null
  category: string
  handVote: boolean | null
  hasBallot: boolean
}

export type Ack<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export type ServerToClientEvents = {
  'room:update': (room: PublicRoom) => void
  'room:kicked': () => void
  'player:private': (role: PrivateRole) => void
  'room:error': (message: string) => void
}

export type ClientToServerEvents = {
  'room:create': (
    input: { name: string; category: string; code?: string },
    callback: (result: Ack<{ room: string; playerId: string }>) => void,
  ) => void
  'room:join': (
    input: { code: string; name: string; playerId?: string },
    callback: (result: Ack<{ room: string; playerId: string }>) => void,
  ) => void
  'room:resume': (
    input: { code: string; playerId: string },
    callback: (result: Ack<{ room: string; playerId: string }>) => void,
  ) => void
  'room:leave': () => void
  'room:kick': (input: { playerId: string }, callback: (result: Ack) => void) => void
  'room:category': (input: { category: string }, callback: (result: Ack) => void) => void
  'room:ready': (input: { ready: boolean }, callback: (result: Ack) => void) => void
  'game:start': (input: { durationSeconds: number }, callback: (result: Ack) => void) => void
  'game:continue': (callback: (result: Ack) => void) => void
  'game:guess': (input: { guess: string }, callback: (result: Ack<{ solverId: string }>) => void) => void
  'game:end-discussion': (callback: (result: Ack) => void) => void
  'game:hand-vote': (input: { thinksInsider: boolean }, callback: (result: Ack) => void) => void
  'game:ballot': (input: { targetId: string }, callback: (result: Ack) => void) => void
  'game:tie-break': (input: { targetId: string }, callback: (result: Ack) => void) => void
  'game:end-round': (callback: (result: Ack) => void) => void
  'game:restart': (input: { durationSeconds: number }, callback: (result: Ack) => void) => void
  'game:play-again': (callback: (result: Ack) => void) => void
}
