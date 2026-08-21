(function () {
  let matchedIds = null,
    offset = 0,
    total = 0;
  const pageSize = 24,
    localFiltered = filtered;
  filtered = function () {
    const rows = localFiltered();
    return matchedIds
      ? rows.filter((car) => !car.listingId || matchedIds.has(car.listingId))
      : rows;
  };
  const values = (name) =>
    [...document.querySelectorAll(`[name="${name}"]:checked`)].map(
      (input) => input.value,
    );
  const number = (id) => {
    const value = document.querySelector(id)?.value;
    return value === "" || value == null ? null : +value;
  };
  async function search(reset = true) {
    const client = window.vklucheAuth?.getClient();
    if (!client) return;
    if (reset) {
      offset = 0;
      matchedIds = new Set();
    }
    const models = values("filterModel").map((value) => value.split("|||")[1]);
    const cities = values("filterCity");
    if (!cities.length && document.querySelector("#cityInput").value)
      cities.push(document.querySelector("#cityInput").value);
    const params = {
      p_query: document.querySelector("#searchInput").value.trim(),
      p_brands: values("filterBrand"),
      p_models: models,
      p_cities: cities,
      p_gearboxes: values("filterGearbox"),
      p_engines: values("filterEngine"),
      p_bodies: values("filterBody"),
      p_drives: values("filterDrive"),
      p_conditions: values("filterCondition"),
      p_price_from: number("#priceInputFrom"),
      p_price_to: number("#priceInput"),
      p_year_from: number("#filterYearFrom"),
      p_year_to: number("#filterYearTo"),
      p_mileage_from: number("#filterMileageFrom"),
      p_mileage_to: number("#filterMileageTo"),
      p_sort: document.querySelector("#sortSelect").value,
      p_limit: pageSize,
      p_offset: offset,
    };
    const button = document.querySelector("#loadMore");
    button.disabled = true;
    button.textContent = "Загрузка…";
    const { data, error } = await client.rpc("search_listings", params);
    button.disabled = false;
    if (error) {
      button.textContent = "Повторить";
      return toast(error.message);
    }
    (data || []).forEach((row) => matchedIds.add(row.id));
    total = data?.[0]?.total_count || 0;
    offset += data?.length || 0;
    button.textContent =
      offset < total ? "Показать ещё автомобили" : "Все объявления показаны";
    render();
    button.style.display = offset < total ? "block" : "none";
    const visible = filtered().length;
    document.querySelector("#resultCount").textContent =
      `Показано ${visible} ${visible === 1 ? "объявление" : "объявлений"}`;
  }
  document
    .querySelector("#searchForm")
    .addEventListener("submit", () => search(true));
  document
    .querySelector("#advancedFilters")
    .addEventListener("submit", () => search(true));
  document
    .querySelector("#sortSelect")
    .addEventListener("change", () => search(true));
  document
    .querySelector("#loadMore")
    .addEventListener("click", () => search(false));
  document.querySelector("#resetBtn").addEventListener("click", () => search(true));
  document.querySelector("#filterReset").addEventListener("click", () =>
    setTimeout(() => search(true), 0),
  );
  window.addEventListener("vkluche:profile", () => search(true));
  window.vklucheServerSearch = search;
  setTimeout(() => search(true), 300);
})();
