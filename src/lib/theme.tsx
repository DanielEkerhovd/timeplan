import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

// Light / dark / follow the system. Stored per browser; applied as a class on <html>.

export type ThemePref = 'light' | 'dark' | 'system'
const KEY = 'timeplan.theme'

interface ThemeState {
  pref: ThemePref
  setPref: (p: ThemePref) => void
  /** What is actually showing right now. */
  dark: boolean
}

const ThemeContext = createContext<ThemeState>({ pref: 'system', setPref: () => {}, dark: false })

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref)
  const [sys, setSys] = useState(systemDark)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSys(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const dark = pref === 'dark' || (pref === 'system' && sys)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', dark ? '#141311' : '#f6f5f2')
  }, [dark])

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p)
    try {
      if (p === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, p)
    } catch {
      // private mode etc.
    }
  }, [])

  return <ThemeContext.Provider value={{ pref, setPref, dark }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
