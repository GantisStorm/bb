-- The default for `steerActiveThreadOnEnter` becomes true, so Enter steers a
-- running thread for new installs. An existing user chose nothing, so a bare
-- default flip would silently change the Enter key under them. Stamp the old
-- default onto every store that already holds real work. Migration 0006 seeds
-- the personal project into every store, so only a non-personal project, a
-- thread, or a saved setting proves that a person already used this store.
INSERT INTO `app_settings_values` (`key`, `value`, `updated_at`)
SELECT 'steerActiveThreadOnEnter', 'false', CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (
    SELECT 1 FROM `app_settings_values` WHERE `key` = 'steerActiveThreadOnEnter'
  )
  AND (
    EXISTS (SELECT 1 FROM `app_settings_values`)
    OR EXISTS (SELECT 1 FROM `projects` WHERE `kind` != 'personal')
    OR EXISTS (SELECT 1 FROM `threads`)
  );
