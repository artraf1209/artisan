-- Rebrand live, user-visible configuration without changing operational IDs.
UPDATE public.agent_configs
SET prompt_text = replace(prompt_text, 'Artisan', 'ATLAS')
WHERE prompt_text LIKE '%Artisan%';

UPDATE public.strategies
SET name = 'atlas_v2'
WHERE name = 'artisan_v2';
