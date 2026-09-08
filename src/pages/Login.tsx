import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Button, ErrorText, Eyebrow } from '../components/ui'

export default function Login() {
  const { user, loading, signInWithDiscord } = useAuth()
  const [error, setError] = useState<string | null>(null)

  if (!loading && user) return <Navigate to="/" replace />

  async function handleLogin() {
    setError(null)
    try {
      await signInWithDiscord()
    } catch {
      setError('Fikk ikke kontakt med Discord. Prøv igjen.')
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-between px-7 pb-10 pt-24">
      <div className="flex flex-col items-center gap-7 text-center">
        <div className="flex h-[72px] w-[72px] items-center justify-center rounded-3xl bg-surface shadow-card">
          <CalendarIcon />
        </div>
        <div className="flex flex-col gap-2.5">
          <Eyebrow>Timeplan</Eyebrow>
          <h1 className="text-[30px] font-extrabold leading-tight tracking-tight">Når kan du spille denne uka?</h1>
          <p className="max-w-[300px] text-[15px] leading-relaxed text-muted">
            Kryss av kveldene du er ledig, så finner laget tidspunkt som passer for alle.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3.5">
        <ErrorText>{error}</ErrorText>
        <Button onClick={handleLogin} className="h-[52px] w-full">
          <ChatIcon />
          Logg inn med Discord
        </Button>
        <p className="text-center text-[13px] leading-relaxed text-faint">
          Vi henter bare navn og avatar fra Discord. Ingenting postes på dine vegne.
        </p>
      </div>
    </main>
  )
}

function CalendarIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#3E9A63" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="4" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <circle cx="12" cy="15.5" r="1.6" fill="#3E9A63" stroke="none" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z" />
      <circle cx="9" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}
