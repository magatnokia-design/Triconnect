import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://daqdythztsisfncnnotd.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhcWR5dGh6dHNpc2ZuY25ub3RkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5Njk4ODgsImV4cCI6MjA5MTU0NTg4OH0.1NvakjjJpwqpeqx3XlC8PsVPVRUv2ebloRMpv7dsWXs'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)