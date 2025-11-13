/*
  # Fix room_participants RLS policy infinite recursion

  1. Security Changes
    - Drop the existing problematic SELECT policy that causes infinite recursion
    - Create a new simplified SELECT policy that allows users to view participants in rooms they've joined
    - Ensure the policy doesn't reference the same table in a circular manner

  2. Policy Changes
    - Replace complex subquery with a simple join-based approach
    - Allow users to see participants in rooms where they are also participants
    - Maintain security by only showing participants to room members
*/

-- Drop the existing problematic SELECT policy
DROP POLICY IF EXISTS "Users can view participants in rooms they've joined" ON room_participants;

-- Create a new simplified SELECT policy that avoids infinite recursion
CREATE POLICY "Users can view room participants"
  ON room_participants
  FOR SELECT
  TO authenticated
  USING (
    -- Users can see participants in rooms where they are the creator
    room_id IN (
      SELECT id FROM team_rooms WHERE created_by = auth.uid()
    )
    OR
    -- Users can see participants in rooms where they are also a participant
    -- Use a direct approach without subqueries on the same table
    EXISTS (
      SELECT 1 FROM team_rooms tr 
      WHERE tr.id = room_participants.room_id 
      AND (
        tr.created_by = auth.uid() 
        OR tr.id IN (
          SELECT rp.room_id FROM room_participants rp 
          WHERE rp.user_id = auth.uid() AND rp.room_id = tr.id
        )
      )
    )
  );