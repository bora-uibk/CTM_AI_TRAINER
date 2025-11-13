/*
  # Formula Student Training Platform Schema

  1. New Tables
    - `documents`
      - `id` (uuid, primary key)
      - `name` (text)
      - `content` (text)
      - `file_path` (text)
      - `file_size` (bigint)
      - `mime_type` (text)
      - `embedding` (vector)
      - `uploaded_by` (uuid, references auth.users)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
    
    - `team_rooms`
      - `id` (uuid, primary key)
      - `name` (text)
      - `code` (text, unique)
      - `created_by` (uuid, references auth.users)
      - `is_active` (boolean)
      - `current_question` (jsonb)
      - `current_answers` (jsonb)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
    
    - `room_participants`
      - `id` (uuid, primary key)
      - `room_id` (uuid, references team_rooms)
      - `user_id` (uuid, references auth.users)
      - `user_email` (text)
      - `joined_at` (timestamp)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users
    - Users can manage their own documents
    - Room creators can manage their rooms
    - Participants can view room data

  3. Storage
    - Create documents bucket for file storage
*/

-- Enable the vector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  content text NOT NULL,
  file_path text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  mime_type text NOT NULL DEFAULT 'text/plain',
  embedding vector(768),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create team_rooms table
CREATE TABLE IF NOT EXISTS team_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active boolean DEFAULT true,
  current_question jsonb,
  current_answers jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create room_participants table
CREATE TABLE IF NOT EXISTS room_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES team_rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(room_id, user_id)
);

-- Enable Row Level Security
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_participants ENABLE ROW LEVEL SECURITY;

-- Documents policies
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

CREATE POLICY "Users can update their own documents"
  ON documents
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = uploaded_by);

CREATE POLICY "Users can delete their own documents"
  ON documents
  FOR DELETE
  TO authenticated
  USING (auth.uid() = uploaded_by);

-- Team rooms policies
CREATE POLICY "Users can view all active rooms"
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

CREATE POLICY "Room creators can delete their rooms"
  ON team_rooms
  FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by);

-- Room participants policies
CREATE POLICY "Users can view participants in rooms they've joined"
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

CREATE POLICY "Users can leave rooms"
  ON room_participants
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
CREATE INDEX IF NOT EXISTS idx_team_rooms_code ON team_rooms(code);
CREATE INDEX IF NOT EXISTS idx_team_rooms_created_by ON team_rooms(created_by);
CREATE INDEX IF NOT EXISTS idx_team_rooms_is_active ON team_rooms(is_active);
CREATE INDEX IF NOT EXISTS idx_room_participants_room_id ON room_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_user_id ON room_participants(user_id);

-- Create vector similarity search index
CREATE INDEX IF NOT EXISTS idx_documents_embedding ON documents USING ivfflat (embedding vector_cosine_ops);

-- Create storage bucket for documents
INSERT INTO storage.buckets (id, name, public) 
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Authenticated users can upload documents"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Authenticated users can view documents"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'documents');

CREATE POLICY "Users can delete their own documents"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_team_rooms_updated_at
  BEFORE UPDATE ON team_rooms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();