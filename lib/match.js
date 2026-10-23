'use strict';
function normalize(s) {
  return String(s)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function isCorrect(question, submitted) {
  const n = normalize(submitted);
  if (!n) return false;
  return question.accept.some((a) => normalize(a) === n);
}
module.exports = { normalize, isCorrect };
