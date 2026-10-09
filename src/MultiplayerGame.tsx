import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  Ack,
  ClientToServerEvents,
  GameStage,
  PlayerRole,
  PrivateRole,
  PublicRoom,
  ServerToClientEvents,
} from "./shared/realtime";
import Icon from "./components/Icon";

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type SavedSession = { code: string; playerId: string; name: string };
type SavedPlayerInfo = { code: string; name: string; playerId?: string };

const WORD_DECKS = [
  { name: "Everyday things", icon: "✳" },
  { name: "Food & drink", icon: "◒" },
  { name: "Places", icon: "⌂" },
  { name: "Nature", icon: "❋" },
  { name: "Culture & fun", icon: "✴" },
];
const ROUND_DURATIONS = [
  { seconds: 30, label: "30 sec" },
  { seconds: 60, label: "1 min" },
  { seconds: 90, label: "1.5 min" },
  { seconds: 120, label: "2 min" },
  { seconds: 150, label: "2.5 min" },
  { seconds: 180, label: "3 min" },
];
const SESSION_KEY = "afterhours-online-session";
const PLAYER_INFO_KEY = "afterhours-player-info";

function RoundDurationPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="round-duration-options" role="group" aria-label="Round timer">
      {ROUND_DURATIONS.map(duration => (
        <button
          key={duration.seconds}
          type="button"
          className={`round-duration-option ${value === duration.seconds ? "round-duration-selected" : ""}`}
          aria-pressed={value === duration.seconds}
          disabled={disabled}
          onClick={() => onChange(duration.seconds)}>
          {duration.label}
        </button>
      ))}
    </div>
  );
}

function DeckPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedDeck = WORD_DECKS.find(deck => deck.name === value) ?? WORD_DECKS[0];

  return (
    <div className="category-picker-wrap multiplayer-deck-picker">
      <button
        type="button"
        className={`category-picker ${open ? "picker-open" : ""}`}
        disabled={disabled}
        onClick={() => setOpen(isOpen => !isOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}>
        <span className="category-icon">{selectedDeck.icon}</span>
        <span>{selectedDeck.name}</span>
        <span className="picker-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>
      {open && (
        <div
          className="category-menu multiplayer-category-menu"
          role="listbox"
          aria-label="Secret word deck">
          {WORD_DECKS.map(deck => (
            <button
              type="button"
              role="option"
              aria-selected={value === deck.name}
              key={deck.name}
              onClick={() => {
                onChange(deck.name);
                setOpen(false);
              }}>
              <span>{deck.icon}</span>
              {deck.name}
              {value === deck.name && (
                <span className="category-selected-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function readSession(): SavedSession | null {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) return null;
    const value: unknown = JSON.parse(saved);
    if (
      typeof value === "object" &&
      value !== null &&
      "code" in value &&
      typeof value.code === "string" &&
      "playerId" in value &&
      typeof value.playerId === "string" &&
      "name" in value &&
      typeof value.name === "string" &&
      (!("playerId" in value) || typeof value.playerId === "string")
    )
      return value as SavedSession;
  } catch {
    return null;
  }
  return null;
}

function readPlayerInfo(): SavedPlayerInfo {
  try {
    const saved = localStorage.getItem(PLAYER_INFO_KEY);
    if (!saved) return { code: "", name: "" };
    const value: unknown = JSON.parse(saved);
    if (
      typeof value === "object" &&
      value !== null &&
      "code" in value &&
      typeof value.code === "string" &&
      "name" in value &&
      typeof value.name === "string"
    )
      return value as SavedPlayerInfo;
  } catch {
    return { code: "", name: "" };
  }
  return { code: "", name: "" };
}

function request<T>(send: (callback: (result: Ack<T>) => void) => void): Promise<Ack<T>> {
  return new Promise(resolve => {
    const timeout = window.setTimeout(
      () => resolve({ ok: false, error: "The server took too long to respond. Try again." }),
      8000,
    );
    send(result => {
      window.clearTimeout(timeout);
      resolve(result);
    });
  });
}

function initials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

function timeLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function phaseLabel(stage: GameStage) {
  const labels: Record<GameStage, string> = {
    lobby: "Waiting room",
    reveal: "Your secret role",
    questions: "Find the word",
    discussion: "Read the room",
    "hand-vote": "First accusation",
    ballot: "Final vote",
    "tie-break": "Break the tie",
    result: "The reveal",
  };
  return labels[stage];
}

function MultiplayerGame({ onPassPlay }: { onPassPlay: () => void }) {
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const savedInfo = readPlayerInfo();
  const savedRoomFromLink = new URLSearchParams(window.location.search).get("room") ?? "";
  const [roomCodeInput, setRoomCodeInput] = useState(
    (savedRoomFromLink || savedInfo.code).toUpperCase(),
  );
  const [name, setName] = useState(readSession()?.name ?? savedInfo.name);
  const [category, setCategory] = useState(WORD_DECKS[0].name);
  const [roundDurationSeconds, setRoundDurationSeconds] = useState(120);
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [privateRole, setPrivateRole] = useState<PrivateRole | null>(null);
  const privateRoleRef = useRef<PrivateRole | null>(null);
  const [roleVisible, setRoleVisible] = useState(false);
  const [selectedBallotId, setSelectedBallotId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [kickConfirmId, setKickConfirmId] = useState("");
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [confirmEndRound, setConfirmEndRound] = useState(false);
  const [guess, setGuess] = useState("");
  const [guessOpen, setGuessOpen] = useState(false);
  const [timeNow, setTimeNow] = useState(Date.now());
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const ownPlayer = room?.players.find(player => player.id === playerId);
  const isHost = room?.hostId === playerId;
  const solver = room?.players.find(player => player.id === room.solverId);
  const onlineCount = room?.players.filter(player => player.connected).length ?? 0;
  const timeLeft = room?.deadline ? Math.max(0, room.deadline - timeNow) : null;
  const roomRoundDuration = room?.roundDurationSeconds;
  const inviteUrl = room
    ? `${window.location.origin}${window.location.pathname}?room=${room.code}`
    : "";

  useEffect(() => {
    const isProd = import.meta.env.VITE_PROD
    const socketUrl = import.meta.env.VITE_SOCKET_URL || undefined;
    const client = io(socketUrl, {
      path: isProd ? "/insider/socket.io/" : "/socket.io/",
      autoConnect: true,
      transports: ["websocket", "polling"],
      tryAllTransports: true,
    });
    setSocket(client);
    client.on("connect", () => {
      setConnected(true);
      const saved = readSession();
      if (!saved) return;
      void request<{ room: string; playerId: string }>(callback => {
        client.emit("room:resume", { code: saved.code, playerId: saved.playerId }, callback);
      }).then(result => {
        if (result.ok) {
          setPlayerId(result.data.playerId);
          setRoomCodeInput(result.data.room);
          setNotice("");
        } else {
          localStorage.removeItem(SESSION_KEY);
          setNotice("Your saved room is no longer available. Join or create a room to play.");
        }
      });
    });
    client.on("disconnect", () => setConnected(false));
    client.on("room:update", nextRoom => setRoom(nextRoom));
    client.on("room:kicked", () => {
      localStorage.removeItem(SESSION_KEY);
      setRoom(null);
      setPlayerId("");
      setPrivateRole(null);
      privateRoleRef.current = null;
      setRoleVisible(false);
      setSettingsOpen(false);
      setNotice("The host removed you from the room.");
      window.history.replaceState({}, "", window.location.pathname);
    });
    client.on("player:private", role => {
      const previousRole = privateRoleRef.current;
      const roleChanged =
        previousRole?.round !== role.round ||
        previousRole?.role !== role.role ||
        previousRole?.word !== role.word ||
        previousRole?.category !== role.category;
      privateRoleRef.current = role;
      setPrivateRole(role);
      if (roleChanged) setRoleVisible(false);
    });
    client.on("room:error", message => setNotice(message));
    return () => {
      client.removeAllListeners();
      client.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!room?.deadline) return;
    const interval = window.setInterval(() => setTimeNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [room?.deadline]);

  useEffect(() => {
    if (roomRoundDuration !== undefined) setRoundDurationSeconds(roomRoundDuration);
  }, [roomRoundDuration]);

  useEffect(() => {
    if (guessOpen && room?.stage !== "questions") setGuessOpen(false);
  }, [guessOpen, room?.stage]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!room) return;
    const params = new URLSearchParams(window.location.search);
    params.set("room", room.code);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }, [room]);

  useEffect(() => {
    if (room?.stage !== "ballot" || privateRole?.hasBallot) setSelectedBallotId("");
  }, [room?.stage, privateRole?.hasBallot]);

  useEffect(() => {
    const code = room?.code ?? roomCodeInput;
    const previous = readPlayerInfo();
    localStorage.setItem(
      PLAYER_INFO_KEY,
      JSON.stringify({
        code,
        name,
        ...(previous.code === code && previous.playerId ? { playerId: previous.playerId } : {}),
      }),
    );
  }, [name, room?.code, roomCodeInput]);

  const players = useMemo(() => room?.players ?? [], [room]);

  function rememberSession(session: SavedSession) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.setItem(
      PLAYER_INFO_KEY,
      JSON.stringify({ code: session.code, name: session.name, playerId: session.playerId }),
    );
    setPlayerId(session.playerId);
    setRoomCodeInput(session.code);
  }

  async function createRoom() {
    if (!socket || !connected) {
      setNotice("Connecting to the game server…");
      return;
    }
    if (!name.trim()) {
      setNotice("Enter your name first.");
      return;
    }
    setBusy(true);
    const requestedCode = roomCodeInput.trim().toUpperCase();
    const result = await request<{ room: string; playerId: string }>(callback => {
      socket.emit(
        "room:create",
        { name, category, ...(requestedCode ? { code: requestedCode } : {}) },
        callback,
      );
    });
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    rememberSession({ code: result.data.room, playerId: result.data.playerId, name: name.trim() });
    setNotice("");
  }

  async function joinRoom() {
    if (!socket || !connected) {
      setNotice("Connecting to the game server…");
      return;
    }
    if (!name.trim()) {
      setNotice("Enter your name first.");
      return;
    }
    const code = roomCodeInput.trim().toUpperCase();
    if (!code) {
      setNotice("Enter a room code to join.");
      return;
    }
    setBusy(true);
    const savedPlayerInfo = readPlayerInfo();
    const result = await request<{ room: string; playerId: string }>(callback => {
      socket.emit(
        "room:join",
        {
          code,
          name,
          ...(savedPlayerInfo.code === code && savedPlayerInfo.playerId
            ? { playerId: savedPlayerInfo.playerId }
            : {}),
        },
        callback,
      );
    });
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    rememberSession({ code: result.data.room, playerId: result.data.playerId, name: name.trim() });
    setNotice("");
  }

  async function perform<T>(send: (callback: (result: Ack<T>) => void) => void) {
    if (!socket || !connected || busy) {
      if (!connected) setNotice("Reconnecting to the game server…");
      return false;
    }
    setBusy(true);
    const result = await request(send);
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return false;
    }
    return true;
  }

  async function changeCategory(nextCategory: string) {
    setCategory(nextCategory);
    if (!socket || !connected) return;
    const result = await request(callback =>
      socket.emit("room:category", { category: nextCategory }, callback),
    );
    if (!result.ok) setNotice(result.error);
  }

  async function submitGuess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!socket || !connected || busy) return;
    setBusy(true);
    const result = await request<{ solverId: string }>(callback =>
      socket.emit("game:guess", { guess }, callback),
    );
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    setGuess("");
    setGuessOpen(false);
    setNotice("Correct. The group has two minutes to find the Insider.");
  }

  async function restartGame(durationSeconds: number) {
    if (await perform(callback => socket?.emit("game:restart", { durationSeconds }, callback))) {
      setConfirmRestart(false);
      setKickConfirmId("");
    }
  }

  async function endRoundEarly() {
    if (await perform(callback => socket?.emit("game:end-round", callback))) {
      setConfirmEndRound(false);
    }
  }

  async function kickPlayer(targetId: string) {
    if (await perform(callback => socket?.emit("room:kick", { playerId: targetId }, callback))) {
      setKickConfirmId("");
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice("Copying is unavailable here. Share the room code instead.");
    }
  }

  function leaveRoom() {
    socket?.emit("room:leave");
    localStorage.removeItem(SESSION_KEY);
    setRoom(null);
    setPlayerId("");
    setPrivateRole(null);
    privateRoleRef.current = null;
    setRoleVisible(false);
    setGuessOpen(false);
    setNotice("");
    window.history.replaceState({}, "", window.location.pathname);
  }

  return (
    <main className="online-app app-shell min-h-screen text-ink">
      <div className="ambient-glow" aria-hidden="true" />
      <header className="topbar mb-2">
        <button className="brand" onClick={leaveRoom} aria-label="Go to online game lobby">
          <span className="brand-mark">
            <Icon name="eye" size={17} />
          </span>
          <span>
            AFTER<span className="brand-dot">HOURS</span>
          </span>
        </button>
        <div className="topbar-right">
          {room && (
            <span className="round-pill">
              <span className="text-text-muted">ROOM: </span> {room.code}
            </span>
          )}
          <span
            className={`connection-indicator ${connected ? "connection-indicator-online" : ""}`}
            role="status"
            aria-label={connected ? "Connected" : "Reconnecting"}
            title={connected ? "Connected" : "Reconnecting"}>
            <span className="connection-dot" aria-hidden="true" />
            <span>{connected ? "LIVE" : "RECONNECTING"}</span>
          </span>
          <button className="mode-switch" onClick={onPassPlay}>
            PASS &amp; PLAY <span>↗</span>
          </button>
        </div>
      </header>

      <div className="page-wrap">
        {!room && (
          <section className="intro-row">
          <div>
            <h1 className="text-control-text-active">
              Trust is a <span className="text-text-primary">game.</span>
            </h1>
            <div className="eyebrow mt-3">
              <span className="eyebrow-line" /> One word. One Insider. Ask away. Can you find the insider?
            </div>
          </div>
          <div className="intro-stamp">
            <span>
              PLAY FROM
              <br />
              ANYWHERE
            </span>
            <span className="stamp-icon">↗</span>
          </div>
          </section>
        )}

        {!room ? (
          <>
            <section className="online-panel lobby-panel">
              <div className="online-panel-top">
                <div className="breadcrumb items-center">
                  <span>ONLINE MODE</span>
                  <span className="crumb-slash">/</span>Make or join a room
                </div>
              </div>
              <div className="join-create-content">
                <div className="section-kicker">TRUST NO ONE</div>
                <h2>
                  Start a room.
                  <br />
                  Or join the<span> game.</span>
                </h2>

                <form className="online-form" onSubmit={event => event.preventDefault()}>
                  <label className="online-field">
                    <span className="field-label">USERNAME</span>
                    <input
                      autoComplete="nickname"
                      maxLength={24}
                      placeholder="Enter your name"
                      value={name}
                      onChange={event => setName(event.target.value)}
                    />
                  </label>
                  <label className="online-field">
                    <span className="field-label">ROOM CODE</span>
                    <input
                      autoComplete="off"
                      maxLength={6}
                      placeholder="Enter a code to join"
                      value={roomCodeInput}
                      onChange={event =>
                        setRoomCodeInput(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                      }
                      className="room-code-input"
                    />
                  </label>
                  <div className="entry-actions">
                    <button
                      className="secondary-button create-room-button"
                      type="button"
                      disabled={!connected || busy}
                      onClick={() => void createRoom()}>
                      {busy ? "Please wait…" : "Create room"} <span>→</span>
                    </button>
                    <button
                      className="green-button join-room-button"
                      type="button"
                      disabled={!connected || busy}
                      onClick={() => void joinRoom()}>
                      Join room <span>→</span>
                    </button>
                  </div>
                </form>
              </div>
            </section>
          </>
        ) : (
          <section className="online-panel room-panel">
            <div className="online-panel-top">
              <div className="breadcrumb flex items-center">
                <span>Round {room.round}</span>
                <span className="crumb-slash">/</span>
                {phaseLabel(room.stage)}
              </div>
              {timeLeft !== null ? (
                <div className={`timer room-header-timer ${timeLeft <= 30_000 ? "timer-urgent" : ""}`}>
                  <span>◷</span> {timeLabel(timeLeft)}
                </div>
              ) : null}
            </div>

            {room.stage === "lobby" && (
              <div className="room-stage lobby-stage">
                <div className="room-stage-heading">
                  <div>
                    <h2>
                      Bring the <span>usual suspects.</span>
                    </h2>
                    <p>
                      At least four players to begin. Share the invite so everyone joins on their
                      own phone.
                    </p>
                  </div>
                  <div className="room-count">
                    <strong>{room.players.length}</strong>
                    <span>
                      {" "}
                      / 12
                      <br />
                      PLAYERS
                    </span>
                  </div>
                </div>

                <div className="invite-card">
                  <div className="invite-code-block">
                    <span>ROOM CODE</span>
                    <strong>{room.code}</strong>
                  </div>
                  <div className="invite-divider" />
                  <div className="invite-url-block">
                    <span>INVITE LINK</span>
                    <strong>{inviteUrl.replace(/^https?:\/\//, "")}</strong>
                  </div>
                  <button
                    className="secondary-button invite-copy"
                    onClick={() => void copyInvite()}>
                    {copied ? "Copied ✓" : "Copy invite"}
                  </button>
                </div>

                <div className="room-content-grid">
                  <div className="room-roster">
                    <div className="roster-heading">
                      <span>THE GUEST LIST</span>
                      <span>{onlineCount} ONLINE</span>
                    </div>
                    <div className="room-player-list">
                      {players.map((player, index) => (
                        <div className="room-player-row" key={player.id}>
                          <span className={`flex items-center justify-center w-6.75 h-6.75 rounded-full avatar-${index % 5}`}>
                            {initials(player.name)}
                          </span>
                          <span className="room-player-name">
                            {player.name}
                            {player.id === playerId ? <small>YOU</small> : null}
                          </span>
                          {player.id === room.hostId && <span className="host-badge">HOST</span>}
                          <span
                            className={`player-status ${player.connected ? "status-online" : ""}`}>
                            <i />
                            {player.connected ? "HERE" : "AWAY"}
                          </span>
                        </div>
                      ))}
                      {room.players.length < 4 && (
                        <div className="empty-seat">
                          <span>+</span> Waiting for {4 - room.players.length} more{" "}
                          {4 - room.players.length === 1 ? "player" : "players"}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="room-settings">
                    <label className="online-field">
                      <span className="field-label">SECRET WORD DECK</span>
                      <DeckPicker
                        value={room.category}
                        onChange={nextCategory => void changeCategory(nextCategory)}
                        disabled={!isHost}
                      />
                    </label>
                    {isHost && (
                      <div className="online-field">
                        <span className="field-label">ROUND TIMER</span>
                        <RoundDurationPicker
                          value={roundDurationSeconds}
                          onChange={setRoundDurationSeconds}
                          disabled={busy}
                        />
                      </div>
                    )}
                    <div className="setting-fact">
                      <span>✳</span>
                      <p>
                        The Judge and Insider see the word privately. Everyone else gets their own
                        Citizen role.
                      </p>
                    </div>
                    {isHost ? (
                      <button
                        className="green-button create-room-button"
                        disabled={
                          room.players.length < 4 ||
                          room.players.length > 12 ||
                          onlineCount !== room.players.length
                        }
                        onClick={() =>
                          void perform(callback =>
                            socket?.emit("game:start", { durationSeconds: roundDurationSeconds }, callback),
                          )
                        }>
                        {room.players.length < 4
                          ? `Need ${4 - room.players.length} more players`
                          : onlineCount !== room.players.length
                            ? "Waiting for everyone to reconnect"
                            : "Deal the roles"}{" "}
                        <span>→</span>
                      </button>
                    ) : (
                      <div className="waiting-host">
                        <span className="waiting-pulse" /> Waiting for{" "}
                        {room.players.find(player => player.id === room.hostId)?.name ?? "the host"}{" "}
                        to start.
                      </div>
                    )}
                  </div>
                </div>
                <div className="room-bottomline">
                  <span>
                    <i /> PASS THE LINK, NOT THE PHONE
                  </span>
                  <button className="quiet-button" onClick={leaveRoom}>
                    Leave room
                  </button>
                </div>
              </div>
            )}

            {room.stage === "reveal" && (
              <div className="room-stage private-stage">
                <div className="section-kicker">
                  ROUND {String(room.round).padStart(2, "0")} · Tap to see your role
                </div>
                <div
                  className={`private-role-card ${!privateRole ? "role-loading" : roleVisible ? `role-${privateRole.role}` : "role-hidden"}`}
                  role="button"
                  tabIndex={privateRole ? 0 : -1}
                  aria-label={
                    privateRole
                      ? roleVisible
                        ? "Your role and word are visible. Tap to hide them."
                        : "Your role and word are hidden. Tap to reveal them."
                      : "Waiting for your secret role"
                  }
                  aria-pressed={roleVisible}
                  onClick={() => {
                    if (privateRole) setRoleVisible(visible => !visible);
                  }}
                  onKeyDown={event => {
                    if (privateRole && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      setRoleVisible(visible => !visible);
                    }
                  }}>
                  {!privateRole ? (
                    <div className="private-loading">
                      <span className="waiting-pulse" /> Dealing your secret role…
                    </div>
                  ) : roleVisible ? (
                    <>
                      <div className="private-role-emblem">
                        {privateRole.role === "judge"
                          ? "✳"
                          : privateRole.role === "insider"
                            ? "◉"
                            : "○"}
                      </div>
                      <div className="role-label">
                        {privateRole.role === "judge"
                          ? "YOU’RE THE JUDGE"
                          : privateRole.role === "insider"
                            ? "YOU’RE THE INSIDER"
                            : "YOU’RE A CITIZEN"}
                      </div>
                      <h3>
                        {privateRole.role === "judge"
                          ? "Set the scene."
                          : privateRole.role === "insider"
                            ? "Blend right in."
                            : "Find the word."}
                      </h3>
                      <p>
                        {privateRole.role === "citizen" &&
                          "You don’t know the secret word. Listen closely, ask questions, and spot the Insider."}
                      </p>
                      {privateRole.role !== "citizen" && (
                        <>
                          <div className="private-secret-word">
                            <span>THE SECRET WORD</span>
                            <strong>{privateRole.word}</strong>
                          </div>
                          <p>
                            {privateRole.role === "judge"
                              ? "Guide the round and keep the conversation moving."
                              : "Help the group find it without giving yourself away."}
                          </p>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="role-card-cover" aria-hidden="true">
                      <span className="role-cover-icon">◉</span>
                      <strong>Tap to reveal</strong>
                      <span>Your role and word are hidden</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-3 mt-5">
                  <div className="ready-summary">
                    {room.players.filter(player => player.connected && player.ready).length} /{" "}
                    {onlineCount} PLAYERS READY
                  </div>
                <div className="ready-players">
                  {room.players.map((player, index) => (
                    <span
                      key={player.id}
                      className={`ready-person ${player.ready ? "ready-person-done" : ""}`}>
                      <i className={`avatar avatar-${index % 5}`}>{initials(player.name)}</i>
                      {player.name}
                      {player.id === playerId ? " (you)" : ""}
                      {player.ready ? " ✓" : ""}
                    </span>
                  ))}
                </div>
                  <button
                    className="green-button"
                    disabled={!privateRole || busy}
                    onClick={() => {
                      setRoleVisible(false);
                      void perform(callback =>
                        socket?.emit("room:ready", { ready: !ownPlayer?.ready }, callback),
                      );
                    }}>
                    {ownPlayer?.ready ? "I’m ready ✓" : "Got it — ready"} <span>→</span>
                  </button>
                </div>
              </div>
            )}

            {room.stage === "questions" && (
              <div className="room-stage game-stage">
                <div className="play-heading">
                  <h2>
                    Find the <span>word.</span>
                  </h2>
                  <div className="play-heading-tools">
                    <button
                      type="button"
                      className={`role-peek-toggle ${roleVisible ? "role-peek-toggle-open" : ""}`}
                      disabled={!privateRole}
                      aria-expanded={roleVisible}
                      onClick={() => setRoleVisible(visible => !visible)}>
                      <span aria-hidden="true">◉</span>
                      {roleVisible ? "Hide role" : "My role"}
                    </button>
                  </div>
                </div>
                {roleVisible && privateRole && (
                  <div
                    className={`role-peek-panel role-peek-${privateRole.role}`}
                    id="round-role-details"
                    aria-live="polite">
                    <div>
                      <span className="role-peek-label">YOUR ROLE</span>
                      <strong>
                        {privateRole.role === "judge"
                          ? "Judge"
                          : privateRole.role === "insider"
                            ? "Insider"
                            : "Citizen"}
                      </strong>
                    </div>
                    {privateRole.role !== "citizen" && (
                      <div className="role-peek-word">
                        <span className="role-peek-label">SECRET WORD</span>
                        <strong>{privateRole.word}</strong>
                      </div>
                    )}
                  </div>
                )}
                <div className="online-game-card px-2">
                  <div className="question-orbit orbit-one" />
                  <div className="question-orbit orbit-two" />
                  <span className="question-mark">?</span>
                  <strong>YES. NO. MAYBE.</strong>
                  <p>
                    Ask questions the host will answer. The Insider knows the word — can you work it
                    out?
                  </p>
                  <div className="answer-chips">
                    <span>YES</span>
                    <span>NO</span>
                    <span>I DON’T KNOW</span>
                  </div>
                </div>
                <div className="game-hint">
                  <span>✳</span> Say the answer out loud, then the solver enters it on their phone.
                </div>
                <div className="game-stage-footer flex-col">
                  {privateRole?.role === "judge" ? (
                    <div className="judge-note">
                      You’re the Judge. Guide the room; players can submit guesses.
                    </div>
                  ) : (
                    <div className="action-hint">
                      <i className="hint-dot hint-orange" /> NO QUESTION LIMIT. THE CLOCK IS YOURS.
                    </div>
                  )}
                  {privateRole?.role !== "judge" && (
                    <button className="green-button" onClick={() => setGuessOpen(true)}>
                      Guess the word <span>→</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {room.stage === "discussion" && (
              <div className="room-stage game-stage">
                <div className="play-heading">
                  <div>
                    <div className="section-kicker">THE WORD IS OUT</div>
                    <h2>
                      Who feels <span>off?</span>
                    </h2>
                  </div>
                </div>
                <div className="discussion-callout">
                  <span className="callout-mark">“</span>
                  <div>
                    <span>The solver is: </span>
                    <strong>{solver?.name ?? "The solver"}</strong>
                  </div>
                  <span className="callout-note">
                    Keep an eye
                    <br />
                    on them.
                  </span>
                </div>
                <div className="discussion-copy">
                  <h3>Time to compare notes.</h3>
                  <p>
                    Who asked something a little too specific? Who was steering the conversation?
                    Talk it out, then the host or Judge can move to accusations.
                  </p>
                </div>
                <div className="online-game-footer">
                  <div className="action-hint">
                    <span className="hint-dot" /> TWO MINUTES TO DISCUSS
                  </div>
                  {isHost || privateRole?.role === "judge" ? (
                    <button
                      className="primary-button"
                      onClick={() =>
                        void perform(callback => socket?.emit("game:end-discussion", callback))
                      }>
                      Time to accuse <span>→</span>
                    </button>
                  ) : (
                    <div className="waiting-host">
                      <span className="waiting-pulse" /> The host or Judge will end the discussion.
                    </div>
                  )}
                </div>
              </div>
            )}

            {room.stage === "hand-vote" && (
              <div className="room-stage game-stage vote-stage">
                <div className="section-kicker">THE FIRST CALL</div>
                <h2>
                  Is the solver <span>the Insider?</span>
                </h2>
                <p className="stage-lead">
                  Take a quick show of hands together, then everyone privately records the majority.
                </p>
                <div className="discussion-callout accusation-callout">
                  <span className="callout-mark">?</span>
                  <div>
                    <span>THE PLAYER YOU’RE JUDGING</span>
                    <strong>{solver?.name ?? "The solver"}</strong>
                  </div>
                  <span className="callout-note">
                    The Judge
                    <br />
                    votes too.
                  </span>
                </div>
                {privateRole?.handVote === null ? (
                  <div className="vote-choice-row">
                    <button
                      className="vote-choice"
                      disabled={busy}
                      onClick={() =>
                        void perform(callback =>
                          socket?.emit("game:hand-vote", { thinksInsider: true }, callback),
                        )
                      }>
                      <span className="vote-choice-icon">↗</span>
                      <span>Yes, it’s them</span>
                    </button>
                    <button
                      className="vote-choice"
                      disabled={busy}
                      onClick={() =>
                        void perform(callback =>
                          socket?.emit("game:hand-vote", { thinksInsider: false }, callback),
                        )
                      }>
                      <span className="vote-choice-icon">↘</span>
                      <span>Not convinced</span>
                    </button>
                  </div>
                ) : (
                  <div className="vote-waiting">
                    <span className="waiting-pulse" /> Your vote is in. Waiting for the room (
                    {room.handVotes} / {onlineCount}).
                  </div>
                )}
              </div>
            )}

            {room.stage === "ballot" && (
              <div className="room-stage game-stage ballot-stage">
                <div className="section-kicker">NO MAJORITY? NO PROBLEM.</div>
                <h2>
                  Who’s the <span>Insider?</span>
                </h2>
                <p className="stage-lead">
                  Choose a player, then cast your ballot. The room will only see the result once
                  every connected player has voted.
                </p>
                {!privateRole?.hasBallot ? (
                  <div className="ballot-card">
                    <div className="ballot-header">
                      YOUR PRIVATE BALLOT{" "}
                      <span>
                        {room.ballotVotes} / {onlineCount} IN
                      </span>
                    </div>
                    <div className="ballot-options">
                      {players
                        .filter(player => player.id !== playerId)
                        .map((player, index) => (
                          <button
                            className={`ballot-option ${selectedBallotId === player.id ? "ballot-option-selected" : ""}`}
                            key={player.id}
                            disabled={busy}
                            aria-pressed={selectedBallotId === player.id}
                            onClick={() => setSelectedBallotId(player.id)}>
                            <span className={`avatar avatar-${index % 5}`}>
                              {initials(player.name)}
                            </span>
                            <span>{player.name}</span>
                            <span className="ballot-arrow">→</span>
                          </button>
                        ))}
                    </div>
                    <button
                      className="primary-button ballot-submit"
                      disabled={!selectedBallotId || busy}
                      onClick={() => {
                        if (selectedBallotId) {
                          void perform(callback =>
                            socket?.emit("game:ballot", { targetId: selectedBallotId }, callback),
                          );
                        }
                      }}>
                      Cast vote <span>→</span>
                    </button>
                    <div className="ballot-confidential">
                      ◇ Votes stay hidden until everyone’s ballot is in. You can change your
                      selection before casting.
                    </div>
                  </div>
                ) : (
                  <div className="vote-waiting">
                    <span className="waiting-pulse" /> Ballot cast. Waiting for the room (
                    {room.ballotVotes} / {onlineCount}).
                  </div>
                )}
              </div>
            )}

            {room.stage === "tie-break" && (
              <div className="room-stage game-stage tie-stage">
                <div className="section-kicker">IT’S A DEAD HEAT</div>
                <h2>
                  The solver <span>decides.</span>
                </h2>
                <p className="stage-lead">
                  {solver?.name ?? "The solver"} breaks the tie. Everyone else, pass them their
                  phone.
                </p>
                <div className="tie-candidates">
                  {room.tiedPlayerIds.map((id, index) => {
                    const player = players.find(entry => entry.id === id);
                    if (!player) return null;
                    return (
                      <div className="tie-person" key={id}>
                        <span className={`avatar avatar-${index % 5}`}>
                          {initials(player.name)}
                        </span>
                        <strong>{player.name}</strong>
                        <span>TIED VOTE</span>
                      </div>
                    );
                  })}
                </div>
                {playerId === room.solverId ? (
                  <div className="tie-actions">
                    {room.tiedPlayerIds.map(id => {
                      const player = players.find(entry => entry.id === id);
                      return player ? (
                        <button
                          key={id}
                          className="primary-button"
                          onClick={() =>
                            void perform(callback =>
                              socket?.emit("game:tie-break", { targetId: id }, callback),
                            )
                          }>
                          {player.name} <span>→</span>
                        </button>
                      ) : null;
                    })}
                  </div>
                ) : (
                  <div className="vote-waiting">
                    <span className="waiting-pulse" /> Waiting for {solver?.name ?? "the solver"} to
                    break the tie.
                  </div>
                )}
              </div>
            )}

            {room.stage === "result" && (
              <div className={`room-stage result-content result-${room.winner}`}>
                <div className="result-icon">
                  {room.winner === "commons" ? "✓" : room.winner === "nobody" ? "◷" : "◉"}
                </div>
                <div className="section-kicker"></div>
                <h2>
                  {room.winner === "commons"
                    ? "THE ROOM GOT IT RIGHT"
                    : room.winner === "nobody"
                      ? "TIME’S UP"
                      : "THE INSIDER GETS AWAY"}
                
                </h2>
                <p className="result-reason">{room.outcomeReason}</p>
                <div className="reveal-answer">
                  <span>THE SECRET WORD WAS</span>
                  <strong>{room.word}</strong>
                  <span className="answer-category">{room.category.toUpperCase()}</span>
                </div>
                {isHost && (
                  <div className="result-deck-picker">
                    <span className="field-label">NEXT ROUND’S WORD DECK</span>
                    <DeckPicker
                      value={room.category}
                      onChange={nextCategory => void changeCategory(nextCategory)}
                      disabled={busy}
                    />
                  </div>
                )}
                <div className="reveal-players mt-2">
                  {players.map((player, index) => {
                    const role = room.roles?.[player.id] as PlayerRole | undefined;
                    return (
                      <div className="reveal-player" key={player.id}>
                        <span className={`avatar avatar-${index % 5}`}>
                          {initials(player.name)}
                        </span>
                        <span className="result-player-name">{player.name}</span>
                        <span className={`role-badge badge-${role}`}>
                          {role === "judge" ? "JUDGE" : role?.toUpperCase()}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="online-game-footer result-online-footer">
                  {isHost ? (
                    <button
                      className="primary-button"
                      disabled={busy || onlineCount !== players.length}
                      onClick={() =>
                        void perform(callback => socket?.emit("game:play-again", callback))
                      }>
                      {onlineCount !== players.length
                        ? "Waiting for everyone"
                        : "Play another round"}{" "}
                      <span>→</span>
                    </button>
                  ) : (
                    <div className="waiting-host flex">
                      <span className="waiting-pulse" /> Waiting for the host to start another
                      round.
                    </div>
                  )}
                  <button className="secondary-button" onClick={leaveRoom}>
                    Leave room
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
        {room?.stage === "lobby" && (
          <section className="online-panel px-4 my-2 py-2">
            <ul className="online-fineprint">
              <span className="font-bold">RULES:</span>
              <li>
                <span className="fineprint-lock">◇</span>
                <span><span className="text-blue-300">Judge</span> and <span className="text-ink">Insider</span> secretly know the word.</span>
              </li>
              <li>
                <span className="fineprint-lock">◇</span>
                <span>Ask (Yes/No) questions to the <span className="text-blue-300">Judge</span> to find the word.</span>
              </li>
              <li>
                <span className="fineprint-lock">◇</span>
                <span>Find the <span className="text-ink">Insider</span> before time runs out.</span>
              </li>
              <li>
                <span className="fineprint-lock">◇</span>
                <span>After guessing, vote for the Insider.</span>
              </li>
            </ul>
          </section>
        )}
      </div>

      {guessOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setGuessOpen(false);
          }}>
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="online-guess-title">
            <button
              className="modal-close icon-button"
              onClick={() => setGuessOpen(false)}
              aria-label="Close">
              ×
            </button>
            <span className="modal-icon">✳</span>
            <div className="section-kicker">SAY IT OUT LOUD</div>
            <h2 id="online-guess-title">
              What’s the
              <br />
              <span>secret word?</span>
            </h2>
            <p>Enter the group’s guess. Only the server checks the answer.</p>
            <form className="guess-form" onSubmit={submitGuess}>
              <input
                autoFocus
                value={guess}
                onChange={event => setGuess(event.target.value)}
                placeholder="Type the word…"
                aria-label="Guess the secret word"
              />
              <button className="green-button modal-submit" disabled={busy}>
                Check the word <span>→</span>
              </button>
            </form>
          </section>
        </div>
      )}

      {room && isHost && (
        <div className="host-settings">
          {settingsOpen && (
            <section
              className="host-settings-panel"
              id="host-settings-panel"
              aria-label="Host settings">
              <div className="host-settings-heading">
                <span>HOST SETTINGS</span>
                <button
                  className="host-settings-close"
                  onClick={() => {
                    setSettingsOpen(false);
                    setKickConfirmId("");
                    setConfirmRestart(false);
                    setConfirmEndRound(false);
                  }}
                  aria-label="Close host settings">
                  ×
                </button>
              </div>
              {room.stage === "reveal" && (
                <div className="host-restart-option">
                  <div>
                    <strong>Start game now</strong>
                    <span>
                      Continue without waiting for everyone to tap ready (
                      {room.players.filter(player => player.connected && player.ready).length}/
                      {onlineCount} ready).
                    </span>
                  </div>
                  <button
                    className="host-settings-action"
                    disabled={busy}
                    onClick={() =>
                      void perform(callback => socket?.emit("game:continue", callback))
                    }>
                    Start now
                  </button>
                </div>
              )}
              {room.stage !== "lobby" && (
                <div className="host-restart-option">
                  <div>
                    <strong>Restart game</strong>
                    <span>Deal new roles and begin a fresh round.</span>
                    <div className="host-restart-duration">
                      <span className="field-label">ROUND TIMER</span>
                      <RoundDurationPicker
                        value={roundDurationSeconds}
                        onChange={setRoundDurationSeconds}
                        disabled={busy}
                      />
                    </div>
                  </div>
                  {confirmRestart ? (
                    <div className="host-settings-confirm">
                      <button
                        className="host-settings-action host-settings-danger"
                        disabled={busy || room.players.length < 4 || onlineCount !== room.players.length}
                        onClick={() => void restartGame(roundDurationSeconds)}>
                        Restart now
                      </button>
                      <button
                        className="host-settings-action"
                        onClick={() => setConfirmRestart(false)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="host-settings-action"
                      disabled={busy || room.players.length < 4 || onlineCount !== room.players.length}
                      onClick={() => setConfirmRestart(true)}>
                      Restart
                    </button>
                  )}
                </div>
              )}
              {room.stage !== "lobby" && room.stage !== "result" && (
                <div className="host-restart-option">
                  <div>
                    <strong>End current round</strong>
                    <span>Finish now without waiting for the timer or remaining votes.</span>
                  </div>
                  {confirmEndRound ? (
                    <div className="host-settings-confirm">
                      <button
                        className="host-settings-action host-settings-danger"
                        disabled={busy}
                        onClick={() => void endRoundEarly()}>
                        End round
                      </button>
                      <button
                        className="host-settings-action"
                        onClick={() => setConfirmEndRound(false)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="host-settings-action host-settings-danger"
                      disabled={busy}
                      onClick={() => setConfirmEndRound(true)}>
                      End now
                    </button>
                  )}
                </div>
              )}
              <div className="host-kick-list">
                <span className="host-kick-heading">REMOVE A PLAYER</span>
                {players.filter(player => player.id !== playerId).length === 0 ? (
                  <p className="host-settings-empty">No other players in the room.</p>
                ) : (
                  players
                    .filter(player => player.id !== playerId)
                    .map(player => (
                      <div className="host-kick-row" key={player.id}>
                        <span>{player.name}</span>
                        {kickConfirmId === player.id ? (
                          <div className="host-settings-confirm">
                            <button
                              className="host-settings-action host-settings-danger"
                              disabled={busy}
                              onClick={() => void kickPlayer(player.id)}>
                              Remove
                            </button>
                            <button
                              className="host-settings-action"
                              onClick={() => setKickConfirmId("")}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            className="host-settings-action host-settings-danger"
                            disabled={busy}
                            onClick={() => setKickConfirmId(player.id)}>
                            Kick
                          </button>
                        )}
                      </div>
                    ))
                )}
              </div>
              {room.stage !== "lobby" && (
                <p className="host-settings-note">
                  Kicking a player during a game restarts the round, or returns everyone to the
                  lobby if fewer than four remain.
                </p>
              )}
            </section>
          )}
          <button
            className={`host-settings-fab ${settingsOpen ? "host-settings-fab-open" : ""}`}
            aria-label={settingsOpen ? "Close host settings" : "Open host settings"}
            aria-expanded={settingsOpen}
            aria-controls="host-settings-panel"
            onClick={() => setSettingsOpen(open => !open)}>
            <span aria-hidden="true">⚙</span>
          </button>
        </div>
      )}

      {notice && (
        <div className="toast" role="status">
          <span className="toast-dot" />
          {notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {room && !connected && (
        <div className="reconnect-banner">
          <span className="waiting-pulse" /> Connection lost. Reconnecting — your room is saved on
          this device.
        </div>
      )}
    </main>
  );
}

export default MultiplayerGame;
