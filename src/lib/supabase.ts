import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  throw new Error(
    'Mangler VITE_SUPABASE_URL eller VITE_SUPABASE_ANON_KEY. Kopier .env.example til .env.local og fyll inn.',
  )
}

// anon-nøkkelen er offentlig med vilje. Alt som betyr noe sikres av RLS i databasen.
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})
