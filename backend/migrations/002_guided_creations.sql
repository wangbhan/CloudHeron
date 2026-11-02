CREATE TABLE creations(id text PRIMARY KEY,project_id text NOT NULL REFERENCES projects(id),owner_id text NOT NULL REFERENCES users(id),name text NOT NULL,document jsonb NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX creations_project ON creations(project_id,updated_at DESC);
