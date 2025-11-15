export function pageParams(q: any, max = 100) {
  const page = Math.max(1, parseInt(q?.page ?? '1', 10));
  const limit = Math.min(max, Math.max(1, parseInt(q?.limit ?? '20', 10)));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}
