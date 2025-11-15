/*
  # Add Team Challenge columns to team_rooms and room_participants

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
    - No changes to existing RLS policies
*/

-- Add new columns to team_rooms table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_rooms' AND column_name = 'num_teams'
  ) THEN
    ALTER TABLE team_rooms ADD COLUMN num_teams integer DEFAULT 2;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_rooms' AND column_name = 'questions_per_team'
  ) THEN
    ALTER TABLE team_rooms ADD COLUMN questions_per_team integer DEFAULT 10;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_rooms' AND column_name = 'time_per_question'
  ) THEN
    ALTER TABLE team_rooms ADD COLUMN time_per_question integer DEFAULT 60;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_rooms' AND column_name = 'current_turn_team_id'
  ) THEN
    ALTER TABLE team_rooms ADD COLUMN current_turn_team_id integer DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_rooms' AND column_name = 'current_question_index'
  ) THEN
    ALTER TABLE team_rooms ADD COLUMN current_question_index integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_rooms' AND column_name = 'team_questions'
  ) THEN
    ALTER TABLE team_rooms ADD COLUMN team_questions jsonb DEFAULT '{}'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_rooms' AND column_name = 'team_scores'
  ) THEN
    ALTER TABLE team_rooms ADD COLUMN team_scores jsonb DEFAULT '{}'::jsonb;
  END IF;

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
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'room_participants' AND column_name = 'team_number'
  ) THEN
    ALTER TABLE room_participants ADD COLUMN team_number integer DEFAULT 1;
  END IF;
END $$;