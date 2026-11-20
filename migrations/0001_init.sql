-- ============================================================================
-- Informatika 8 — Online Test
-- Миграция 0001: Создание структуры базы данных Cloudflare D1 (SQLite)
-- ============================================================================

PRAGMA foreign_keys = ON;

-- 1. Учителя (администраторы платформы)
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Классы
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  join_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3. Ученики (вход без регистрации по имени, фамилии и коду класса)
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  UNIQUE(class_id, normalized_key)
);

CREATE INDEX IF NOT EXISTS idx_students_class_id ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_students_name ON students(last_name, first_name);

-- 4. Темы учебной программы (8 класс, Информатика)
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  subtopics_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 5. Тесты и практические задания
CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL,
  class_id INTEGER NULL, -- NULL означает доступно для всех классов
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'test' CHECK (kind IN ('test', 'practice')),
  question_limit INTEGER NULL, -- NULL означает все вопросы теста
  duration_minutes INTEGER NOT NULL DEFAULT 20 CHECK (duration_minutes >= 1 AND duration_minutes <= 240),
  passing_score INTEGER NOT NULL DEFAULT 50 CHECK (passing_score >= 0 AND passing_score <= 100),
  starts_at TEXT NULL, -- ISO-8601 UTC или локальная строка YYYY-MM-DDTHH:MM
  ends_at TEXT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts >= 1 AND max_attempts <= 20),
  shuffle_questions INTEGER NOT NULL DEFAULT 1 CHECK (shuffle_questions IN (0, 1)),
  shuffle_answers INTEGER NOT NULL DEFAULT 1 CHECK (shuffle_answers IN (0, 1)),
  show_results INTEGER NOT NULL DEFAULT 1 CHECK (show_results IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE RESTRICT,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tests_topic_id ON tests(topic_id);
CREATE INDEX IF NOT EXISTS idx_tests_class_id ON tests(class_id);

-- 6. Вопросы теста
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('single', 'multiple', 'boolean', 'number', 'text')),
  question_text TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 1 CHECK (points > 0),
  explanation TEXT NOT NULL DEFAULT '',
  correct_value TEXT NULL, -- Используется для типов 'number' и 'text' (допускается несколько вариантов через ';')
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_questions_test_id ON questions(test_id);

-- 7. Варианты ответов (для single, multiple, boolean)
CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  answer_text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_answers_question_id ON answers(question_id);

-- 8. Попытки прохождения тестов
CREATE TABLE IF NOT EXISTS test_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'expired')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  finished_at TEXT NULL,
  time_spent_seconds INTEGER NOT NULL DEFAULT 0,
  total_questions INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  earned_points REAL NOT NULL DEFAULT 0,
  max_points REAL NOT NULL DEFAULT 0,
  percentage REAL NOT NULL DEFAULT 0,
  grade INTEGER NOT NULL DEFAULT 2 CHECK (grade BETWEEN 2 AND 5),
  passed INTEGER NOT NULL DEFAULT 0 CHECK (passed IN (0, 1)),
  question_order_json TEXT NOT NULL DEFAULT '[]', -- Сохранённый порядок вопросов и вариантов ответов
  FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attempts_test_student ON test_attempts(test_id, student_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON test_attempts(status);
CREATE INDEX IF NOT EXISTS idx_attempts_finished_at ON test_attempts(finished_at);

-- 9. Ответы учеников (промежуточное сохранение и итоговая проверка)
CREATE TABLE IF NOT EXISTS student_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  selected_answer_ids_json TEXT NOT NULL DEFAULT '[]', -- JSON массив ID выбранных вариантов
  answer_text TEXT NULL, -- Для типов number и text
  is_correct INTEGER NULL, -- Заполняется на сервере при завершении попытки
  earned_points REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (attempt_id) REFERENCES test_attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  UNIQUE(attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_student_answers_attempt ON student_answers(attempt_id);

-- 10. Настройки платформы (шкала оценок, публикация результатов, тайм-аут сессии и др.)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 11. Разрешения на повторное прохождение теста (выдаёт учитель)
CREATE TABLE IF NOT EXISTS retake_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  test_id INTEGER NOT NULL,
  extra_attempts INTEGER NOT NULL DEFAULT 1 CHECK (extra_attempts >= 1),
  granted_by_teacher_id INTEGER NULL,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by_teacher_id) REFERENCES teachers(id) ON DELETE SET NULL,
  UNIQUE(student_id, test_id)
);
