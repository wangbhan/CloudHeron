CREATE TABLE project_context_revisions (
    project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision integer NOT NULL CHECK (revision > 0),
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, revision)
);
