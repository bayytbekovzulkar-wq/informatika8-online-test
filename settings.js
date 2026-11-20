// Чтение и обновление настроек платформы из таблицы settings (Cloudflare D1)

export const DEFAULT_SETTINGS = {
  platform_name: 'Informatika 8 — Online Test',
  curriculum_authors: 'Ибирайым кызы А., Н. Н. Осипова',
  grade_5_min: 90,
  grade_4_min: 70,
  grade_3_min: 50,
  show_results_to_students: true,
  show_explanations_to_students: true,
  session_ttl_hours: 8
};

export async function getPlatformSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const map = {};
  for (const row of results || []) {
    map[row.key] = row.value;
  }

  return {
    platform_name: map.platform_name || DEFAULT_SETTINGS.platform_name,
    curriculum_authors: map.curriculum_authors || DEFAULT_SETTINGS.curriculum_authors,
    grade_5_min: Number(map.grade_5_min ?? DEFAULT_SETTINGS.grade_5_min),
    grade_4_min: Number(map.grade_4_min ?? DEFAULT_SETTINGS.grade_4_min),
    grade_3_min: Number(map.grade_3_min ?? DEFAULT_SETTINGS.grade_3_min),
    show_results_to_students: (map.show_results_to_students ?? '1') === '1',
    show_explanations_to_students: (map.show_explanations_to_students ?? '1') === '1',
    session_ttl_hours: Math.max(1, Math.min(72, Number(map.session_ttl_hours ?? DEFAULT_SETTINGS.session_ttl_hours)))
  };
}

export async function updatePlatformSettings(db, updates) {
  const allowed = [
    'platform_name',
    'grade_5_min',
    'grade_4_min',
    'grade_3_min',
    'show_results_to_students',
    'show_explanations_to_students',
    'session_ttl_hours'
  ];

  for (const key of allowed) {
    if (updates[key] === undefined) continue;
    let val = updates[key];
    if (typeof val === 'boolean') {
      val = val ? '1' : '0';
    } else {
      val = String(val);
    }
    await db
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      )
      .bind(key, val)
      .run();
  }

  return getPlatformSettings(db);
}
