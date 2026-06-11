-- Rooms table
CREATE TABLE public.rooms (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT        UNIQUE NOT NULL,
  display_name    TEXT,
  created_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  max_participants INT        DEFAULT 5 CHECK (max_participants BETWEEN 1 AND 5),
  is_active       BOOLEAN     DEFAULT TRUE
);

-- Row Level Security
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read active rooms"
  ON public.rooms FOR SELECT
  TO authenticated
  USING (
    is_active = TRUE
    AND (expires_at IS NULL OR expires_at > NOW())
  );

CREATE POLICY "Users can create their own rooms"
  ON public.rooms FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Creators can update their rooms"
  ON public.rooms FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid());

-- Indexes
CREATE INDEX rooms_slug_idx       ON public.rooms(slug);
CREATE INDEX rooms_created_by_idx ON public.rooms(created_by);
CREATE INDEX rooms_active_idx     ON public.rooms(is_active, expires_at);
