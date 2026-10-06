import { useEffect, useMemo, useState } from 'react'

type Role = 'judge' | 'insider' | 'citizen'
type Stage =
  | 'setup'
  | 'reveal'
  | 'questions'
  | 'discussion'
  | 'hand-vote'
  | 'ballot'
  | 'tie-break'
  | 'result'
type Player = { id: string; name: string; role: Role }
type Category = { name: string; icon: string; words: string[] }

const categories: Category[] = [
  {
    name: 'Everyday things',
    icon: '✳',
    words: ['Umbrella', 'Toothbrush', 'Elevator', 'Microwave', 'Backpack', 'Candle', 'Mailbox', 'Sunglasses', 'Key', 'Pillow', 'Bicycle', 'Calendar'],
  },
  {
    name: 'Food & drink',
    icon: '◒',
    words: ['Pancake', 'Sushi', 'Lemonade', 'Popcorn', 'Avocado', 'Pretzel', 'Cinnamon', 'Dumpling', 'Watermelon', 'Espresso', 'Pineapple', 'Waffle'],
  },
  {
    name: 'Places',
    icon: '⌂',
    words: ['Aquarium', 'Airport', 'Lighthouse', 'Bookstore', 'Volcano', 'Museum', 'Desert', 'Rooftop', 'Subway', 'Greenhouse', 'Campground', 'Bakery'],
  },
  {
    name: 'Nature',
    icon: '❋',
    words: ['Hummingbird', 'Thunderstorm', 'Cactus', 'Tide pool', 'Mushroom', 'Northern lights', 'Seashell', 'Bamboo', 'Firefly', 'Glacier', 'Sunflower', 'Coral reef'],
  },
  {
    name: 'Culture & fun',
    icon: '✴',
    words: ['Karaoke', 'Roller coaster', 'Board game', 'Magic trick', 'Film festival', 'Treasure hunt', 'Jazz band', 'Puppet show', 'Costume party', 'Circus', 'Comic book', 'Escape room'],
  },
]

const startingNames = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Casey']

function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

function Icon({
  name,
  size = 18,
}: {
  name: 'arrow' | 'plus' | 'minus' | 'clock' | 'users' | 'spark' | 'eye' | 'check' | 'close' | 'refresh' | 'shield' | 'vote' | 'menu'
  size?: number
}) {
  const shared = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }

  switch (name) {
    case 'arrow':
      return <svg {...shared}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    case 'plus':
      return <svg {...shared}><path d="M12 5v14M5 12h14" /></svg>
    case 'minus':
      return <svg {...shared}><path d="M5 12h14" /></svg>
    case 'clock':
      return <svg {...shared}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    case 'users':
      return <svg {...shared}><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 8v6m3-3h-6" /></svg>
    case 'spark':
      return <svg {...shared}><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l1 2.5 2.5 1-2.5 1L19 23l-1-2.5-2.5-1 2.5-1L19 16Z" /></svg>
    case 'eye':
      return <svg {...shared}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
    case 'check':
      return <svg {...shared}><path d="m5 12 4 4L19 6" /></svg>
    case 'close':
      return <svg {...shared}><path d="m18 6-12 12M6 6l12 12" /></svg>
    case 'refresh':
      return <svg {...shared}><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9a7 7 0 0 1 11.6-2.6L20 12M4 12l2.8 5.6A7 7 0 0 0 18.4 15" /></svg>
    case 'shield':
      return <svg {...shared}><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></svg>
    case 'vote':
      return <svg {...shared}><path d="M9 12l2 2 4-4M7 3h10l4 4v14H3V7l4-4Z" /><path d="M7 3v5h10V3" /></svg>
    case 'menu':
      return <svg {...shared}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
  }
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  const remainder = (seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remainder}`
}

function App() {
  const [stage, setStage] = useState<Stage>('setup')
  const [players, setPlayers] = useState<Player[]>(
    startingNames.map((name) => ({ id: makeId(), name, role: 'citizen' })),
  )
  const [selectedCategory, setSelectedCategory] = useState(categories[0].name)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [roundPlayers, setRoundPlayers] = useState<Player[]>([])
  const [word, setWord] = useState('')
  const [revealIndex, setRevealIndex] = useState(0)
  const [roleVisible, setRoleVisible] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(180)
  const [timerRunning, setTimerRunning] = useState(false)
  const [solverId, setSolverId] = useState('')
  const [solverPicker, setSolverPicker] = useState(false)
  const [answerConfirmed, setAnswerConfirmed] = useState(false)
  const [guess, setGuess] = useState('')
  const [majorityThinksInsider, setMajorityThinksInsider] = useState<boolean | null>(null)
  const [ballotIndex, setBallotIndex] = useState(0)
  const [ballots, setBallots] = useState<Record<string, string>>({})
  const [winner, setWinner] = useState<'commons' | 'insider' | 'nobody' | null>(null)
  const [outcomeReason, setOutcomeReason] = useState('')
  const [notice, setNotice] = useState('')

  const chosenCategory = categories.find((category) => category.name === selectedCategory) ?? categories[0]
  const solver = roundPlayers.find((player) => player.id === solverId)
  const candidate = solver
  const ballotPlayer = roundPlayers[ballotIndex]
  const remainingVoters = roundPlayers.length - Object.keys(ballots).length
  const ballotTally = useMemo(() => {
    return Object.values(ballots).reduce<Record<string, number>>((tally, playerId) => {
      tally[playerId] = (tally[playerId] ?? 0) + 1
      return tally
    }, {})
  }, [ballots])
  const topVoteIds = useMemo(() => {
    if (!Object.keys(ballots).length) return []
    const highest = Math.max(...Object.values(ballotTally))
    return Object.keys(ballotTally).filter((playerId) => ballotTally[playerId] === highest)
  }, [ballotTally, ballots])

  useEffect(() => {
    if (!timerRunning) return
    const interval = window.setInterval(() => {
      setSecondsLeft((time) => Math.max(0, time - 1))
    }, 1000)
    return () => window.clearInterval(interval)
  }, [timerRunning, stage])

  useEffect(() => {
    if (!timerRunning || secondsLeft > 0) return
    setTimerRunning(false)
    if (stage === 'questions') {
      setWinner('nobody')
      setOutcomeReason('The word stayed hidden until time ran out.')
      setStage('result')
    } else if (stage === 'discussion') {
      setStage('hand-vote')
    }
  }, [secondsLeft, stage, timerRunning])

  useEffect(() => {
    if (notice === '') return
    const timeout = window.setTimeout(() => setNotice(''), 2800)
    return () => window.clearTimeout(timeout)
  }, [notice])

  function changePlayerName(id: string, name: string) {
    setPlayers((current) => current.map((player) => player.id === id ? { ...player, name } : player))
  }

  function addPlayer() {
    if (players.length >= 12) return
    setPlayers((current) => [...current, { id: makeId(), name: '', role: 'citizen' }])
  }

  function removePlayer(id: string) {
    if (players.length <= 4) return
    setPlayers((current) => current.filter((player) => player.id !== id))
  }

  function startGame() {
    const cleaned = players.map((player) => ({ ...player, name: player.name.trim() }))
    if (cleaned.some((player) => player.name === '')) {
      setNotice('Give everyone a name before starting.')
      return
    }
    const uniqueNames = new Set(cleaned.map((player) => player.name.toLocaleLowerCase()))
    if (uniqueNames.size !== cleaned.length) {
      setNotice('Each player needs a different name.')
      return
    }
    const assigned = shuffle(cleaned.map((player) => ({ ...player, role: 'citizen' as Role })))
    assigned[0].role = 'judge'
    assigned[1].role = 'insider'
    setRoundPlayers(assigned)
    setPlayers(cleaned)
    setWord(chosenCategory.words[Math.floor(Math.random() * chosenCategory.words.length)])
    setRevealIndex(0)
    setRoleVisible(false)
    setSecondsLeft(180)
    setTimerRunning(false)
    setSolverId('')
    setSolverPicker(false)
    setAnswerConfirmed(false)
    setGuess('')
    setMajorityThinksInsider(null)
    setBallotIndex(0)
    setBallots({})
    setWinner(null)
    setStage('reveal')
  }

  function advanceReveal() {
    if (revealIndex < roundPlayers.length - 1) {
      setRevealIndex((index) => index + 1)
      setRoleVisible(false)
      return
    }
    setStage('questions')
    setSecondsLeft(180)
    setTimerRunning(true)
  }

  function submitAnswer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (guess.trim().toLocaleLowerCase() !== word.toLocaleLowerCase()) {
      setNotice('Not quite. Keep asking questions and try again.')
      return
    }
    setAnswerConfirmed(true)
  }

  function confirmSolver() {
    if (!solverId) {
      setNotice('Choose who found the word.')
      return
    }
    setSolverPicker(false)
    setTimerRunning(false)
    setStage('discussion')
    setSecondsLeft(120)
    setTimerRunning(true)
  }

  function finishDiscussion() {
    setTimerRunning(false)
    setStage('hand-vote')
  }

  function castMajorityVote(believesInsider: boolean) {
    setMajorityThinksInsider(believesInsider)
    setTimerRunning(false)
    if (believesInsider && candidate?.role === 'insider') {
      finishRound('commons', `The group correctly identified ${candidate.name} as the Insider.`)
    } else if (believesInsider) {
      finishRound('insider', `${candidate?.name ?? 'The accused player'} was a Citizen. The Insider slipped away.`)
    } else {
      setBallots({})
      setBallotIndex(0)
      setStage('ballot')
    }
  }

  function castBallot(targetId: string) {
    const nextBallots = { ...ballots, [ballotPlayer.id]: targetId }
    setBallots(nextBallots)
    if (Object.keys(nextBallots).length === roundPlayers.length) {
      const tally = Object.values(nextBallots).reduce<Record<string, number>>((result, votedId) => {
        result[votedId] = (result[votedId] ?? 0) + 1
        return result
      }, {})
      const highest = Math.max(...Object.values(tally))
      const leaders = Object.keys(tally).filter((id) => tally[id] === highest)
      if (leaders.length > 1) {
        setStage('tie-break')
      } else if (roundPlayers.find((player) => player.id === leaders[0])?.role === 'insider') {
        finishRound('commons', 'The final vote exposed the Insider.')
      } else {
        finishRound('insider', 'The group voted for a Citizen. The Insider wins.')
      }
      return
    }
    setBallotIndex((index) => index + 1)
  }

  function resolveTie(playerId: string) {
    if (roundPlayers.find((player) => player.id === playerId)?.role === 'insider') {
      finishRound('commons', `${solver?.name ?? 'The solver'} broke the tie and found the Insider.`)
    } else {
      finishRound('insider', `${solver?.name ?? 'The solver'} broke the tie for a Citizen.`)
    }
  }

  function finishRound(result: 'commons' | 'insider' | 'nobody', reason: string) {
    setTimerRunning(false)
    setWinner(result)
    setOutcomeReason(reason)
    setStage('result')
  }

  function returnToSetup() {
    setTimerRunning(false)
    setStage('setup')
    setNotice('')
    if (roundPlayers.length > 0) {
      setPlayers(roundPlayers.map(({ id, name }) => ({ id, name, role: 'citizen' })))
    }
    setRoundPlayers([])
    setSolverPicker(false)
  }

  const stageLabels: Record<Stage, string> = {
    setup: 'Make a new room',
    reveal: 'Secret roles',
    questions: 'Find the word',
    discussion: 'Read the room',
    'hand-vote': 'First accusation',
    ballot: 'Final vote',
    'tie-break': 'Break the tie',
    result: 'The reveal',
  }

  return (
    <main className="app-shell min-h-screen text-ink">
      <div className="ambient-glow" aria-hidden="true" />
      <header className="topbar">
        <button className="brand" onClick={returnToSetup} aria-label="Go to game setup">
          <span className="brand-mark"><Icon name="spark" size={17} /></span>
          <span>AFTER<span className="brand-dot">HOURS</span></span>
        </button>
        <div className="topbar-center"><span className="live-indicator" /> THE SOCIAL DEDUCTION GAME</div>
        <div className="topbar-right">
          {stage !== 'setup' && <span className="round-pill"><span className="round-dot" /> ROUND 01</span>}
          <span className="edition-label">EDITION 01</span>
        </div>
      </header>

      <div className="page-wrap">
        <section className="intro-row">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> A GAME OF HIDDEN INTENTIONS</div>
            <h1>Trust is a <span className="title-accent">game.</span></h1>
            <p className="intro-copy">Find the word. Catch the Insider. Try not to look suspicious.</p>
          </div>
          <div className="intro-stamp"><span>GATHER<br />YOUR PEOPLE</span><span className="stamp-icon">↗</span></div>
        </section>

        <div className="game-layout">
          <aside className="sidebar">
            <div className="sidebar-heading">THE BRIEFING</div>
            <div className="how-card">
              <div className="how-icon"><Icon name="eye" size={18} /></div>
              <h2>One of you knows.</h2>
              <p>A secret word. One Insider. And a room full of people pretending not to know.</p>
            </div>
            <div className="step-list" aria-label="Game steps">
              <div className={`step-item ${stage === 'setup' || stage === 'reveal' ? 'step-active' : 'step-done'}`}>
                <span className="step-number">{stage === 'setup' || stage === 'reveal' ? '01' : '✓'}</span>
                <span>Get in the room</span>
              </div>
              <div className={`step-item ${stage === 'questions' ? 'step-active' : ['discussion', 'hand-vote', 'ballot', 'tie-break', 'result'].includes(stage) ? 'step-done' : ''}`}>
                <span className="step-number">{['discussion', 'hand-vote', 'ballot', 'tie-break', 'result'].includes(stage) ? '✓' : '02'}</span>
                <span>Find the word</span>
              </div>
              <div className={`step-item ${stage === 'discussion' || stage === 'hand-vote' ? 'step-active' : ['ballot', 'tie-break', 'result'].includes(stage) ? 'step-done' : ''}`}>
                <span className="step-number">{['ballot', 'tie-break', 'result'].includes(stage) ? '✓' : '03'}</span>
                <span>Call the bluff</span>
              </div>
              <div className={`step-item ${['ballot', 'tie-break', 'result'].includes(stage) ? 'step-active' : ''}`}>
                <span className="step-number">{stage === 'result' ? '✓' : '04'}</span>
                <span>Unmask the Insider</span>
              </div>
            </div>
            <div className="sidebar-note">
              <span className="note-spark">✳</span>
              <p>Best played with<br /><strong>4–12 players</strong></p>
              <span className="note-rule" />
              <span className="note-time"><Icon name="clock" size={14} /> ~10 min</span>
            </div>
            <div className="sidebar-footer">NO APP. NO ACCOUNTS. JUST SUSPICION.</div>
          </aside>

          <section className="main-panel">
            <div className="panel-topline">
              <div className="breadcrumb"><span>ROOM 001</span><span className="crumb-slash">/</span>{stageLabels[stage]}</div>
              <div className="privacy-tag"><Icon name="shield" size={13} /> PASS &amp; PLAY</div>
            </div>

            {stage === 'setup' && (
              <div className="setup-content">
                <div className="section-heading">
                  <div>
                    <div className="section-kicker">FIRST THINGS FIRST</div>
                    <h2>Who’s playing <span>tonight?</span></h2>
                    <p>Names are public. Roles are not. Add your whole crew.</p>
                  </div>
                  <div className="player-count"><Icon name="users" size={15} /> {players.length}<span> / 12</span></div>
                </div>

                <div className="players-box">
                  <div className="list-heading"><span>THE GUEST LIST</span><span>PLAYER NAME</span></div>
                  <div className="players-list">
                    {players.map((player, index) => (
                      <div className="player-row" key={player.id}>
                        <span className="player-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className={`avatar avatar-${index % 5}`}>{player.name.trim().charAt(0).toUpperCase() || '·'}</span>
                        <input
                          aria-label={`Player ${index + 1} name`}
                          maxLength={24}
                          placeholder={`Player ${index + 1}`}
                          value={player.name}
                          onChange={(event) => changePlayerName(player.id, event.target.value)}
                        />
                        {players.length > 4 && (
                          <button className="icon-button remove-player" onClick={() => removePlayer(player.id)} aria-label={`Remove player ${player.name || index + 1}`}>
                            <Icon name="close" size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button className="add-player" onClick={addPlayer} disabled={players.length >= 12}>
                    <span className="add-circle"><Icon name="plus" size={14} /></span>
                    Add someone to the room
                    <span className="add-shortcut">{players.length >= 12 ? 'MAX' : `${players.length} / 12`}</span>
                  </button>
                </div>

                <div className="setup-bottom">
                  <div className="category-picker-wrap">
                    <span className="field-label">WORD DECK</span>
                    <button className={`category-picker ${categoryOpen ? 'picker-open' : ''}`} onClick={() => setCategoryOpen((open) => !open)} aria-expanded={categoryOpen}>
                      <span className="category-icon">{chosenCategory.icon}</span>
                      <span>{selectedCategory}</span>
                      <span className="picker-chevron">⌄</span>
                    </button>
                    {categoryOpen && (
                      <div className="category-menu">
                        {categories.map((category) => (
                          <button key={category.name} onClick={() => { setSelectedCategory(category.name); setCategoryOpen(false) }}>
                            <span>{category.icon}</span>{category.name}
                            {selectedCategory === category.name && <Icon name="check" size={15} />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="deck-note"><span className="tiny-spark">✳</span><span>A new secret word every round</span></div>
                </div>

                <div className="panel-actions">
                  <div className="action-hint"><span className="hint-dot" /> ROLES ARE DEALT AT RANDOM</div>
                  <button className="primary-button" onClick={startGame}>
                    Start the game <Icon name="arrow" size={17} />
                  </button>
                </div>
              </div>
            )}

            {stage === 'reveal' && roundPlayers[revealIndex] && (
              <div className="stage-content reveal-content">
                <div className="section-kicker">THE ROOM IS GETTING QUIET</div>
                <h2>Pass the phone to<br /><span>{roundPlayers[revealIndex].name}</span></h2>
                <p className="stage-description">Make sure nobody else can see the screen. Your secret is yours to keep.</p>
                <div className={`secret-card ${roleVisible ? `secret-${roundPlayers[revealIndex].role}` : ''}`}>
                  {!roleVisible ? (
                    <button className="reveal-button" onClick={() => setRoleVisible(true)}>
                      <span className="reveal-eye"><Icon name="eye" size={23} /></span>
                      <span>Tap to see your role</span>
                      <span className="reveal-caption">KEEP IT TO YOURSELF</span>
                    </button>
                  ) : (
                    <div className="role-reveal">
                      <span className="role-symbol">{roundPlayers[revealIndex].role === 'insider' ? '◉' : roundPlayers[revealIndex].role === 'judge' ? '✳' : '○'}</span>
                      <span className="role-label">{roundPlayers[revealIndex].role === 'judge' ? 'YOU’RE THE JUDGE' : roundPlayers[revealIndex].role === 'insider' ? 'YOU’RE THE INSIDER' : 'YOU’RE A CITIZEN'}</span>
                      <h3>{roundPlayers[revealIndex].role === 'insider' ? 'Blend in.' : roundPlayers[revealIndex].role === 'judge' ? 'Keep things moving.' : 'Find the word.'}</h3>
                      <p>{roundPlayers[revealIndex].role === 'insider'
                        ? <>The secret word is <strong>{word}</strong>. Help the group find it without giving yourself away.</>
                        : roundPlayers[revealIndex].role === 'judge'
                          ? <>The secret word is <strong>{word}</strong>. Guide the round. You’ll join the group when it’s time to vote.</>
                          : 'You don’t know the word. Listen closely, ask smart questions, and spot the Insider.'}</p>
                    </div>
                  )}
                </div>
                <div className="reveal-progress">
                  {roundPlayers.map((player, index) => <span key={player.id} className={index <= revealIndex && roleVisible ? 'progress-segment segment-done' : index === revealIndex ? 'progress-segment segment-current' : 'progress-segment'} />)}
                  <span className="progress-text">{String(revealIndex + 1).padStart(2, '0')} <span>/</span> {String(roundPlayers.length).padStart(2, '0')}</span>
                </div>
                <div className="panel-actions reveal-actions">
                  <span className="action-hint"><Icon name="shield" size={14} /> {roleVisible ? 'HIDE YOUR ROLE BEFORE PASSING' : 'PRIVATE ROLE REVEAL'}</span>
                  <button className="primary-button" onClick={advanceReveal} disabled={!roleVisible}>
                    {revealIndex === roundPlayers.length - 1 ? 'Everyone’s ready' : 'Hide & pass'} <Icon name="arrow" size={17} />
                  </button>
                </div>
              </div>
            )}

            {stage === 'questions' && (
              <div className="stage-content play-content">
                <div className="play-heading">
                  <div>
                    <div className="section-kicker">ROUND 01 · ASK AWAY</div>
                    <h2>Find the <span>word.</span></h2>
                  </div>
                  <div className={`timer ${secondsLeft <= 30 ? 'timer-urgent' : ''}`}>
                    <Icon name="clock" size={17} /><span>{formatTime(secondsLeft)}</span>
                  </div>
                </div>
                <div className="question-stage-card">
                  <div className="question-orbit orbit-one" /><div className="question-orbit orbit-two" />
                  <div className="question-mark">?</div>
                  <div className="question-card-title">YES. NO. MAYBE.</div>
                  <p>Ask questions the group can answer. The Insider knows the word — but so does the Judge.</p>
                  <div className="answer-chips"><span>YES</span><span>NO</span><span>I DON’T KNOW</span></div>
                </div>
                <div className="tip-line"><span className="tip-star">✳</span><span>No question limit. The clock is your only one.</span></div>
                <div className="panel-actions">
                  <span className="action-hint"><span className="hint-dot hint-orange" /> SAY THE WORD OUT LOUD TO GUESS</span>
                  <button className="primary-button" onClick={() => { setGuess(''); setAnswerConfirmed(false); setSolverPicker(true) }}>
                    We found it <Icon name="check" size={17} />
                  </button>
                </div>
              </div>
            )}

            {stage === 'discussion' && (
              <div className="stage-content play-content discussion-content">
                <div className="play-heading">
                  <div>
                    <div className="section-kicker">THE WORD IS OUT</div>
                    <h2>Who feels <span>off?</span></h2>
                  </div>
                  <div className={`timer ${secondsLeft <= 30 ? 'timer-urgent' : ''}`}>
                    <Icon name="clock" size={17} /><span>{formatTime(secondsLeft)}</span>
                  </div>
                </div>
                <div className="discussion-callout">
                  <span className="callout-mark">“</span>
                  <div><span>THE LAST QUESTION CAME FROM</span><strong>{solver?.name ?? 'The solver'}</strong></div>
                  <span className="callout-note">Keep an eye<br />on them.</span>
                </div>
                <div className="discussion-copy">
                  <h3>Time to compare notes.</h3>
                  <p>Who asked something a little too specific? Who was steering the conversation? Talk it out — and pick someone to accuse.</p>
                </div>
                <div className="tip-line"><span className="tip-star">✳</span><span>The Judge votes too. Anyone can be the Insider.</span></div>
                <div className="panel-actions">
                  <span className="action-hint"><Icon name="users" size={14} /> DISCUSS WITH THE WHOLE ROOM</span>
                  <button className="primary-button" onClick={finishDiscussion}>
                    Time to accuse <Icon name="arrow" size={17} />
                  </button>
                </div>
              </div>
            )}

            {stage === 'hand-vote' && (
              <div className="stage-content play-content accusation-content">
                <div className="section-kicker">THE FIRST CALL</div>
                <h2>Point the <span>finger.</span></h2>
                <p className="stage-description">The solver asked the final question. Is {solver?.name ?? 'that player'} the Insider?</p>
                <div className="discussion-callout accusation-callout">
                  <span className="callout-mark">?</span>
                  <div><span>THE PLAYER YOU’RE JUDGING</span><strong>{solver?.name}</strong></div>
                  <span className="callout-note">The Judge<br />votes too.</span>
                </div>
                <div className="vote-question">
                  <span className="field-label">DOES THE MAJORITY THINK THEY’RE THE INSIDER?</span>
                  <div className="vote-choice-row">
                    <button className={`vote-choice ${majorityThinksInsider === true ? 'vote-choice-selected' : ''}`} onClick={() => setMajorityThinksInsider(true)}>
                      <span className="vote-choice-icon">↗</span><span>Yes, it’s them</span>
                    </button>
                    <button className={`vote-choice ${majorityThinksInsider === false ? 'vote-choice-selected' : ''}`} onClick={() => setMajorityThinksInsider(false)}>
                      <span className="vote-choice-icon">↘</span><span>Not convinced</span>
                    </button>
                  </div>
                  <p className="vote-helper">Take a quick show of hands, then record the majority.</p>
                </div>
                <div className="panel-actions">
                  <span className="action-hint"><Icon name="vote" size={14} /> ACCUSING {candidate?.name.toUpperCase() ?? 'THE SOLVER'}</span>
                  <button className="primary-button" disabled={majorityThinksInsider === null} onClick={() => castMajorityVote(majorityThinksInsider ?? false)}>
                    Lock it in <Icon name="arrow" size={17} />
                  </button>
                </div>
              </div>
            )}

            {stage === 'ballot' && ballotPlayer && (
              <div className="stage-content reveal-content ballot-content">
                <div className="section-kicker">NO MAJORITY? NO PROBLEM.</div>
                <h2>Pass the phone to<br /><span>{ballotPlayer.name}</span></h2>
                <p className="stage-description">Choose who you think the Insider is. Your vote stays secret until everyone has voted.</p>
                <div className="ballot-card">
                  <div className="ballot-header"><Icon name="vote" size={16} /><span>YOUR PRIVATE BALLOT</span><span>{String(ballotIndex + 1).padStart(2, '0')} / {String(roundPlayers.length).padStart(2, '0')}</span></div>
                  <div className="ballot-options">
                    {roundPlayers.filter((player) => player.id !== ballotPlayer.id).map((player) => (
                      <button key={player.id} className="ballot-option" onClick={() => castBallot(player.id)}>
                        <span className={`avatar avatar-${roundPlayers.indexOf(player) % 5}`}>{player.name.charAt(0).toUpperCase()}</span>
                        <span>{player.name}</span><Icon name="arrow" size={16} />
                      </button>
                    ))}
                  </div>
                  <div className="ballot-confidential"><Icon name="shield" size={13} /> Votes are hidden until the last ballot is in.</div>
                </div>
                <div className="ballot-remaining">{remainingVoters} {remainingVoters === 1 ? 'vote' : 'votes'} left to cast</div>
              </div>
            )}

            {stage === 'tie-break' && (
              <div className="stage-content play-content tie-content">
                <div className="section-kicker">IT’S A DEAD HEAT</div>
                <h2>The solver <span>decides.</span></h2>
                <p className="stage-description">{solver?.name ?? 'The player who found the word'} breaks the tie. Pass them the phone.</p>
                <div className="tie-candidates">
                  {topVoteIds.map((playerId) => {
                    const player = roundPlayers.find((entry) => entry.id === playerId)!
                    return (
                      <div className="tie-person" key={player.id}>
                        <span className={`avatar avatar-${roundPlayers.indexOf(player) % 5}`}>{player.name.charAt(0).toUpperCase()}</span>
                        <strong>{player.name}</strong>
                        <span>{ballotTally[player.id]} VOTES</span>
                      </div>
                    )
                  })}
                </div>
                <div className="tie-picker">
                  <span className="field-label">WHO’S YOUR FINAL CALL?</span>
                  <div className="tie-actions">
                    {topVoteIds.map((playerId) => {
                      const player = roundPlayers.find((entry) => entry.id === playerId)!
                      return <button key={player.id} className="primary-button" onClick={() => resolveTie(player.id)}>{player.name} <Icon name="arrow" size={16} /></button>
                    })}
                  </div>
                </div>
              </div>
            )}

            {stage === 'result' && (
              <div className={`stage-content result-content result-${winner}`}>
                <div className="result-icon">{winner === 'commons' ? <Icon name="check" size={27} /> : winner === 'nobody' ? <Icon name="clock" size={27} /> : <span>◉</span>}</div>
                <div className="section-kicker">{winner === 'commons' ? 'THE ROOM GOT IT RIGHT' : winner === 'nobody' ? 'TIME’S UP' : 'THE INSIDER GETS AWAY'}</div>
                <h2>{winner === 'commons' ? 'Well played.' : winner === 'nobody' ? 'The word wins.' : 'Nice try.'}</h2>
                <p className="result-reason">{outcomeReason}</p>
                <div className="reveal-answer">
                  <span>THE SECRET WORD WAS</span>
                  <strong>{word}</strong>
                  <span className="answer-category">{chosenCategory.name.toUpperCase()}</span>
                </div>
                <div className="reveal-players">
                  {roundPlayers.map((player, index) => (
                    <div className="reveal-player" key={player.id}>
                      <span className={`avatar avatar-${index % 5}`}>{player.name.charAt(0).toUpperCase()}</span>
                      <span className="result-player-name">{player.name}</span>
                      <span className={`role-badge badge-${player.role}`}>{player.role === 'judge' ? 'JUDGE' : player.role.toUpperCase()}</span>
                    </div>
                  ))}
                </div>
                <div className="panel-actions result-actions">
                  <button className="secondary-button" onClick={returnToSetup}><Icon name="refresh" size={16} /> Change players</button>
                  <button className="primary-button" onClick={startGame}>Play again <Icon name="arrow" size={17} /></button>
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="page-footer">
          <span>AFTERHOURS <span className="footer-dot">•</span> 2026</span>
          <span>THE BEST STORIES START WITH “I DIDN’T DO IT.”</span>
          <button onClick={() => setNotice('Setup ready. Gather 4–12 players and pass the phone around.')}>HOW TO PLAY <span>↗</span></button>
        </footer>
      </div>

      {solverPicker && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSolverPicker(false) }}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="solver-title">
            <button className="modal-close icon-button" onClick={() => setSolverPicker(false)} aria-label="Close"><Icon name="close" size={18} /></button>
            <span className="modal-icon"><Icon name="spark" size={20} /></span>
            {!answerConfirmed ? (
              <>
                <div className="section-kicker">SAY IT OUT LOUD</div>
                <h2 id="solver-title">What’s the<br /><span>secret word?</span></h2>
                <p>Enter the group’s guess to check whether you’ve found it.</p>
                <form className="guess-form" onSubmit={submitAnswer}>
                  <input autoFocus value={guess} onChange={(event) => setGuess(event.target.value)} placeholder="Type the word…" aria-label="Guess the secret word" />
                  <button className="primary-button modal-submit" type="submit">Check the word <Icon name="arrow" size={17} /></button>
                </form>
              </>
            ) : (
              <>
                <div className="section-kicker">THE WORD WAS FOUND</div>
                <h2 id="solver-title">Who asked the<br /><span>final question?</span></h2>
                <p>The solver gets the deciding vote if the final ballot is tied.</p>
                <div className="solver-options">
                  {roundPlayers.map((player) => (
                    <button key={player.id} className={`solver-option ${solverId === player.id ? 'solver-selected' : ''}`} onClick={() => setSolverId(player.id)}>
                      <span className={`avatar avatar-${roundPlayers.indexOf(player) % 5}`}>{player.name.charAt(0).toUpperCase()}</span>
                      <span>{player.name}</span>{solverId === player.id && <Icon name="check" size={16} />}
                    </button>
                  ))}
                </div>
                <button className="primary-button modal-submit" onClick={confirmSolver}>Let’s talk <Icon name="arrow" size={17} /></button>
              </>
            )}
          </section>
        </div>
      )}

      {notice && <div className="toast" role="status"><span className="toast-dot" />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><Icon name="close" size={14} /></button></div>}
    </main>
  )
}

export default App
