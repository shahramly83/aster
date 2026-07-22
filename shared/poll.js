// Availability-poll rules shared by web + mobile.

// How many slots someone must mark for their availability to be usable.
//
// A single mark can't overlap with anyone else's, so it tells the organiser
// nothing and the poll stalls. Two is the floor that produces overlap — but only
// when there are enough slots for two to be a real choice. With one or two
// proposed times, demanding two marks is demanding "I'm free at everything",
// which people answer by marking times they can't actually make.
//
//   proposed 1 → 1     proposed 2 → 1     proposed 3+ → 2
export function minAvailabilityMarks(slotCount) {
  const n = Number(slotCount) || 0;
  if (n <= 0) return 0;
  return n <= 2 ? 1 : 2;
}

// Whether a vote is started-but-unusable, which is the state worth blocking on.
// Zero marks is deliberately not blocking: someone reading the thread without
// voting yet would otherwise be trapped on the screen.
export function isAvailabilityIncomplete(marked, slotCount) {
  const min = minAvailabilityMarks(slotCount);
  return marked > 0 && marked < min;
}
