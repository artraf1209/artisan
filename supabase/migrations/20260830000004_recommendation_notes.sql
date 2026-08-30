-- Per-recommendation summary fields the synthesis agent already produces
-- (engine-py/artisan/agents/prompts/synthesis.md's output_format, required
-- since REQUIRED_FIELDS in synthesis.py) but had nowhere to land: the tool
-- schema never declared them (fixed separately in agents/base.py) and
-- _write_recommendation's insert row never included them, so they were
-- silently discarded even once the model supplied them.
ALTER TABLE recommendations ADD COLUMN headline text;
ALTER TABLE recommendations ADD COLUMN sentiment_note text;
ALTER TABLE recommendations ADD COLUMN technical_note text;
ALTER TABLE recommendations ADD COLUMN fundamental_note text;
