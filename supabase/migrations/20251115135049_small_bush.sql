/*
  # Enhanced Team Challenge Schema

  1. New Columns for team_rooms
    - `num_teams` (integer) - number of teams in the room
    - `questions_per_team` (integer) - questions per team  
    - `time_per_question` (integer) - seconds per question
    - `current_turn_team_id` (integer) - which team's turn it is
    - `current_question_index` (integer) - current question index for active team
    - `team_questions` (jsonb) - questions assigned to each team
    - `team_scores` (jsonb) - scores for each team
    - `room_status` (text) - 'lobby', 'in_progress', 'finished'

  2. New Columns for room_participants
    - `team_number` (integer) - which team the participant joined

  3. Security
    - Update existing RLS policies to work with new columns
*/

-- Add new columns to team_rooms table
DO $$
BEGIN
  -- Add num_teams column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_rooms' AND column_name = 'num_teams'
  ) THEN
    ALTER TABLE team_rooms ADD COLUMN num_teams integer DEFAULT 2;
  END IF;

  -- Add questions_per_team column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_rooms' AND column_name = 'questions_per_team'
  ) THEN
    ALTER TABLE team_rooms ADD COLUMN questions_per_team integer DEFAULT 10;
  END IF;

  -- Add time_per_question column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_rooms' AND column_name = 'time_per_question'
  ) THEN
    ALTER TABLE team_rooms ADD COLUMN time_per_question integer DEFAULT 60;
  END IF;

  -- Add current_turn_team_id column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_rooms' AND column_name = 'current_turn_team_id'
  ) THEN
    ALTER TABLE team_rooms ADD COLUMN current_turn_team_id integer DEFAULT 1;
  END IF;

  -- Add current_question_index column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_rooms' AND column_name = 'current_question_index'
  ) THEN
    ALTER TABLE team_rooms ADD COLUMN current_question_index integer DEFAULT 0;
  END IF;

  -- Add team_questions column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_rooms' AND column_name = 'team_questions'
  ) THEN
    ALTER TABLE team_rooms ADD COLUMN team_questions jsonb DEFAULT '{}'::jsonb;
  END IF;

  -- Add team_scores column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_rooms' AND column_name = 'team_scores'
  ) THEN
    ALTER TABLE team_rooms ADD COLUMN team_scores jsonb DEFAULT '{}'::jsonb;
  END IF;

  -- Add room_status column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_rooms' AND column_name = 'room_status'
  ) THEN
    ALTER TABLE team_rooms ADD COLUMN room_status text DEFAULT 'lobby';
  END IF;
END $$;

-- Add new column to room_participants table
DO $$
BEGIN
  -- Add team_number column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'room_participants' AND column_name = 'team_number'
  ) THEN
    ALTER TABLE room_participants ADD COLUMN team_number integer DEFAULT 1;
  END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_team_rooms_status ON team_rooms(room_status);
CREATE INDEX IF NOT EXISTS idx_team_rooms_turn ON team_rooms(current_turn_team_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_team ON room_participants(team_number);

-- Add constraints
ALTER TABLE team_rooms ADD CONSTRAINT IF NOT EXISTS check_num_teams CHECK (num_teams >= 2 AND num_teams <= 8);
ALTER TABLE team_rooms ADD CONSTRAINT IF NOT EXISTS check_questions_per_team CHECK (questions_per_team >= 1 AND questions_per_team <= 50);
ALTER TABLE team_rooms ADD CONSTRAINT IF NOT EXISTS check_time_per_question CHECK (time_per_question >= 10 AND time_per_question <= 300);
ALTER TABLE team_rooms ADD CONSTRAINT IF NOT EXISTS check_room_status CHECK (room_status IN ('lobby', 'in_progress', 'finished'));

ALTER TABLE room_participants ADD CONSTRAINT IF NOT EXISTS check_team_number CHECK (team_number >= 1 AND team_number <= 8);