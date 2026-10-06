export default function Icon({
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