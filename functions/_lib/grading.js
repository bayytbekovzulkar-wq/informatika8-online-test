// Серверная проверка ответов, расчёт баллов и 5-балльная система оценивания

/**
 * Нормализация текстового ответа для нечувствительного к регистру сравнения.
 */
export function normalizeTextAnswer(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

/**
 * Парсинг числового ответа (поддержка запятой и точки).
 */
export function parseNumericAnswer(value) {
  const cleaned = String(value ?? '').trim().replace(',', '.').replace(/\s+/g, '');
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/**
 * Серверная проверка одного вопроса.
 * @param {object} question - { id, question_type, points, correct_value }
 * @param {Array} correctAnswerIds - массив ID правильных вариантов ответа
 * @param {object|null} studentAnswer - { selected_answer_ids: number[], answer_text: string }
 * @returns {{ isCorrect: boolean, earnedPoints: number }}
 */
export function evaluateQuestion(question, correctAnswerIds, studentAnswer) {
  const maxPoints = Number(question.points) || 1;
  if (!studentAnswer) {
    return { isCorrect: false, earnedPoints: 0 };
  }

  const type = question.question_type;
  const selectedIds = Array.isArray(studentAnswer.selected_answer_ids)
    ? [...new Set(studentAnswer.selected_answer_ids.map(Number).filter(Number.isFinite))].sort((a, b) => a - b)
    : [];
  const expectedIds = [...new Set((correctAnswerIds || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);

  if (type === 'single' || type === 'boolean') {
    const isCorrect =
      selectedIds.length === 1 &&
      expectedIds.length === 1 &&
      selectedIds[0] === expectedIds[0];
    return { isCorrect, earnedPoints: isCorrect ? maxPoints : 0 };
  }

  if (type === 'multiple') {
    const isCorrect =
      expectedIds.length > 0 &&
      selectedIds.length === expectedIds.length &&
      selectedIds.every((id, idx) => id === expectedIds[idx]);
    return { isCorrect, earnedPoints: isCorrect ? maxPoints : 0 };
  }

  if (type === 'number') {
    const expectedList = String(question.correct_value ?? '')
      .split(';')
      .map((s) => parseNumericAnswer(s))
      .filter((v) => v !== null);
    const actual = parseNumericAnswer(studentAnswer.answer_text);
    if (actual === null || expectedList.length === 0) {
      return { isCorrect: false, earnedPoints: 0 };
    }
    const isCorrect = expectedList.some((exp) => Math.abs(exp - actual) < 1e-6);
    return { isCorrect, earnedPoints: isCorrect ? maxPoints : 0 };
  }

  if (type === 'text') {
    const expectedVariants = String(question.correct_value ?? '')
      .split(';')
      .map((s) => normalizeTextAnswer(s))
      .filter(Boolean);
    const actual = normalizeTextAnswer(studentAnswer.answer_text);
    if (!actual || expectedVariants.length === 0) {
      return { isCorrect: false, earnedPoints: 0 };
    }
    const isCorrect = expectedVariants.includes(actual);
    return { isCorrect, earnedPoints: isCorrect ? maxPoints : 0 };
  }

  return { isCorrect: false, earnedPoints: 0 };
}

/**
 * Расчёт оценки по 5-балльной шкале с учётом настроек учителя.
 * По умолчанию: 90-100% -> 5, 70-89% -> 4, 50-69% -> 3, 0-49% -> 2.
 */
export function calculateGrade(percentage, scale = {}) {
  const g5 = Number.isFinite(Number(scale.grade_5_min)) ? Number(scale.grade_5_min) : 90;
  const g4 = Number.isFinite(Number(scale.grade_4_min)) ? Number(scale.grade_4_min) : 70;
  const g3 = Number.isFinite(Number(scale.grade_3_min)) ? Number(scale.grade_3_min) : 50;
  const pct = Number(percentage) || 0;

  if (pct >= g5) return 5;
  if (pct >= g4) return 4;
  if (pct >= g3) return 3;
  return 2;
}

/**
 * Перемешивание массива (алгоритм Фишера–Йетса).
 */
export function shuffleArray(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
