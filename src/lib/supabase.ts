import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Database types
export interface Document {
  id: string
  name: string
  content: string
  file_path: string
  file_size: number
  mime_type: string
  uploaded_by: string
  created_at: string
  updated_at: string
}

export interface TeamRoom {
  id: string
  name: string
  code: string
  created_by: string
  is_active: boolean
  current_question: any
  current_answers: Record<string, any>
  created_at: string
  updated_at: string
}

export interface RoomParticipant {
  id: string
  room_id: string
  user_id: string
  user_email: string
  joined_at: string
}

export interface ChatMessage {
  id: string
  content: string
  is_user: boolean
  timestamp: string
  sources?: string[]
}

export interface QuizQuestion {
  id: string
  type: 'multiple_choice' | 'true_false' | 'open_ended'
  question: string
  options?: string[]
  correct_answer: string | number
  explanation: string
  difficulty: 'easy' | 'medium' | 'hard'
}