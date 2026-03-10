-- Add role column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'
  CHECK (role IN ('admin', 'moderator', 'member', 'guest'));

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
