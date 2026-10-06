import { useState } from 'react'
import MultiplayerGame from './MultiplayerGame'
import PassPlayGame from './PassPlayGame'

function App() {
  const [mode, setMode] = useState<'online' | 'pass-play'>('online')

  return mode === 'online'
    ? <MultiplayerGame onPassPlay={() => setMode('pass-play')} />
    : <PassPlayGame onBack={() => setMode('online')} />
}

export default App
