// data.egov.bg — отворени данни от РОП (АОП). Допълващ източник за под-прагови BG поръчки,
// които ги няма в TED. Това са по-скоро периодични датасети (CSV/JSON), не realtime поток.
//
// TODO (Фаза 2): да се избере конкретен датасет от
//   https://data.egov.bg/organisation/e9a95e08-7759-497a-a478-55f331d59447/datasets
// и да се тегли през API спецификацията на портала.

export async function fetchRopNotices() {
  // Placeholder — връща празно, докато не добавим адаптера.
  return { notices: [], stats: [{ source: "rop", note: "не е имплементиран" }] };
}
