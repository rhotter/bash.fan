ALTER TABLE video_cameras ADD COLUMN IF NOT EXISTS recording_quality text NOT NULL DEFAULT 'uhd60' CHECK (recording_quality IN ('hd30', 'hd60', 'uhd30', 'uhd60'));
