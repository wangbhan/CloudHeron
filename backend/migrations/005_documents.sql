CREATE TABLE documents(
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id),
 chat_id text NOT NULL REFERENCES chats(id), owner_id text NOT NULL REFERENCES users(id),
 filename text NOT NULL,file text NOT NULL, content jsonb NOT NULL,
 status text NOT NULL DEFAULT 'parsed' CHECK(status IN ('parsed','analyzing','analyzed','confirmed')),
 summary text NOT NULL DEFAULT '', selected_asset_ids jsonb NOT NULL DEFAULT '[]',
 job_id text REFERENCES jobs(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_chat_created ON documents(chat_id,created_at DESC);
