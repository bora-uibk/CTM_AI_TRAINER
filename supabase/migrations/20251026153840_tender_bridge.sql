/*
  # Initial Schema for Formula Student Quiz App

  1. New Tables
    - `documents`
      - `id` (uuid, primary key)
      - `name` (text, document name)
      - `content` (text, document content)
      - `file_type` (text, file type)
      - `uploaded_by` (uuid, references auth.users)
      - `created_at` (timestamp)
      - `embedding` (vector, for RAG)
    
    - `team_rooms`
      - `id` (uuid, primary key)
      - `name` (text, room name)
      - `created_by` (uuid, references auth.users)
      - `created_at` (timestamp)
      - `is_active` (boolean)
      - `current_question` (jsonb, current quiz question)
    
    - `room_participants`
      - `id` (uuid, primary key)
      - `room_id` (uuid, references team_rooms)
      - `user_id` (uuid, references auth.users)
      - `user_email` (text)
      - `joined_at` (timestamp)
      - `current_answer` (text, current answer)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users
*/

-- Enable vector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  content text NOT NULL,
  file_type text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  embedding vector(768)
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all documents"
  ON documents
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert their own documents"
  ON documents
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = uploaded_by);

CREATE POLICY "Users can delete their own documents"
  ON documents
  FOR DELETE
  TO authenticated
  USING (auth.uid() = uploaded_by);

-- Team rooms table
CREATE TABLE IF NOT EXISTS team_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true,
  current_question jsonb
);

ALTER TABLE team_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view active rooms"
  ON team_rooms
  FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Users can create rooms"
  ON team_rooms
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Room creators can update their rooms"
  ON team_rooms
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by);

-- Room participants table
CREATE TABLE IF NOT EXISTS room_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES team_rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  joined_at timestamptz DEFAULT now(),
  current_answer text,
  UNIQUE(room_id, user_id)
);

ALTER TABLE room_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view participants in rooms they joined"
  ON room_participants
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM room_participants rp
      WHERE rp.room_id = room_participants.room_id
      AND rp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can join rooms"
  ON room_participants
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own participation"
  ON room_participants
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can leave rooms"
  ON room_participants
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_embedding ON documents USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_team_rooms_active ON team_rooms(is_active);
CREATE INDEX IF NOT EXISTS idx_room_participants_room_id ON room_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_user_id ON room_participants(user_id);