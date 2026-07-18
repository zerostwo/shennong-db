ALTER TABLE chat_messages
  ADD COLUMN reasoning_content TEXT NOT NULL DEFAULT '',
  ADD COLUMN usage JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_usage_object CHECK (jsonb_typeof(usage) = 'object');
