(function () {
  let selected = new Set(
    JSON.parse(localStorage.getItem("vkluche-compare") || "[]"),
  );
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div class="compare-bar" id="compareBar"><span><b id="compareCount">0</b> автомобиля для сравнения</span><button type="button" id="openCompare">Сравнить</button><button type="button" id="clearCompare">×</button></div><div class="modal compare-modal" id="compareModal"><div class="modal-backdrop" data-compare-close></div><div class="modal-card compare-card"><button class="modal-close" data-compare-close>×</button><h2>Сравнение автомобилей</h2><div id="compareTable"></div></div></div>',
  );
  const bar = document.querySelector("#compareBar"),
    modal = document.querySelector("#compareModal");
  function sync() {
    localStorage.setItem("vkluche-compare", JSON.stringify([...selected]));
    document.querySelector("#compareCount").textContent = selected.size;
    bar.classList.toggle("show", selected.size > 0);
    document.querySelectorAll("[data-compare-id]").forEach((button) => {
      const id = button.dataset.compareId;
      button.classList.toggle("selected", selected.has(id));
      button.textContent = selected.has(id) ? "✓ В сравнении" : "⇄ Сравнить";
    });
  }
  async function persist(car, active) {
    const client = window.vklucheAuth?.getClient(),
      user = window.vklucheAuth?.getUser();
    if (!client || !user || !car.listingId) return;
    const query = active
      ? client
          .from("comparison_items")
          .upsert({ user_id: user.id, listing_id: car.listingId })
      : client
          .from("comparison_items")
          .delete()
          .eq("listing_id", car.listingId);
    const { error } = await query;
    if (error) toast(error.message);
  }
  function toggle(car) {
    const id = String(car.id);
    if (selected.has(id)) {
      selected.delete(id);
      persist(car, false);
    } else {
      if (selected.size >= 4)
        return toast("Можно сравнить не более четырёх автомобилей");
      selected.add(id);
      persist(car, true);
    }
    sync();
  }
  function enhance() {
    [...document.querySelectorAll("#carsGrid .car-card")].forEach(
      (card, index) => {
        if (card.querySelector("[data-compare-id]")) return;
        const car = filtered()[index];
        if (!car) return;
        card
          .querySelector(".car-content")
          .insertAdjacentHTML(
            "beforeend",
            `<button class="card-compare" type="button" data-compare-id="${escapeHtml(car.id)}">⇄ Сравнить</button>`,
          );
      },
    );
    sync();
  }
  new MutationObserver(enhance).observe(document.querySelector("#carsGrid"), {
    childList: true,
  });
  document.querySelector("#carsGrid").addEventListener(
    "click",
    (event) => {
      const button = event.target.closest("[data-compare-id]");
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const car = cars.find(
        (item) => String(item.id) === button.dataset.compareId,
      );
      if (car) toggle(car);
    },
    true,
  );
  document
    .querySelector(".sticky-card .aside-fav")
    .insertAdjacentHTML(
      "afterend",
      '<button class="aside-compare" id="detailCompare" type="button">⇄ Добавить к сравнению</button>',
    );
  document
    .querySelector("#detailCompare")
    .addEventListener("click", () => toggle(currentCar));
  function open() {
    const rows = [...selected]
      .map((id) => cars.find((car) => String(car.id) === id))
      .filter(Boolean);
    if (rows.length < 2) return toast("Выберите минимум два автомобиля");
    const specs = [
      ["Цена", (c) => money(c.price)],
      ["Год", (c) => c.year],
      ["Пробег", (c) => c.km],
      ["Двигатель", (c) => c.engine],
      ["Тип двигателя", (c) => engineTypeLabels[carEngineType(c)]],
      ["Коробка", (c) => carGearbox(c)],
      ["Привод", (c) => carDrive(c)],
      ["Кузов", (c) => carBody(c)],
      ["Город", (c) => c.city],
    ];
    document.querySelector("#compareTable").innerHTML =
      `<table><thead><tr><th>Параметр</th>${rows.map((c) => `<th><img src="${c.img}" alt=""><b>${escapeHtml(c.name)}</b></th>`).join("")}</tr></thead><tbody>${specs.map(([label, get]) => `<tr><th>${label}</th>${rows.map((c) => `<td>${escapeHtml(get(c))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    modal.classList.add("open");
  }
  document.querySelector("#openCompare").addEventListener("click", open);
  document.querySelector("#clearCompare").addEventListener("click", () => {
    selected.clear();
    sync();
  });
  document
    .querySelectorAll("[data-compare-close]")
    .forEach((button) =>
      button.addEventListener("click", () => modal.classList.remove("open")),
    );
  document
    .querySelector("#detailDescription")
    .closest(".detail-section")
    .insertAdjacentHTML(
      "afterend",
      '<div class="detail-section recommendations"><h2>Похожие автомобили</h2><div id="recommendationList"></div></div>',
    );
  function recommendations() {
    if (!currentCar) return;
    const ranked = cars
      .filter((car) => car !== currentCar)
      .map((car) => ({
        car,
        score:
          (carBrand(car) === carBrand(currentCar) ? 4 : 0) +
          (carBody(car) === carBody(currentCar) ? 2 : 0) +
          (Math.abs(car.price - currentCar.price) /
            Math.max(currentCar.price, 1) <
          0.25
            ? 2
            : 0) +
          (car.city === currentCar.city ? 1 : 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    document.querySelector("#recommendationList").innerHTML = ranked
      .map(
        ({ car }) =>
          `<button type="button" data-recommendation="${escapeHtml(car.id)}"><img src="${car.img}" alt=""><span><b>${escapeHtml(car.name)}</b><small>${money(car.price)} · ${car.year}</small></span></button>`,
      )
      .join("");
  }
  new MutationObserver(() => {
    if (document.querySelector("#carDetail").classList.contains("open")) {
      recommendations();
      document.querySelector("#detailCompare").textContent = selected.has(
        String(currentCar?.id),
      )
        ? "✓ В сравнении"
        : "⇄ Добавить к сравнению";
    }
  }).observe(document.querySelector("#carDetail"), {
    attributes: true,
    attributeFilter: ["class"],
  });
  document
    .querySelector("#recommendationList")
    .addEventListener("click", (event) => {
      const button = event.target.closest("[data-recommendation]"),
        car = cars.find(
          (item) => String(item.id) === button?.dataset.recommendation,
        );
      if (car) {
        openDetail(car);
        renderAuction(car);
        recommendations();
      }
    });
  async function loadRemoteComparison() {
    const client = window.vklucheAuth?.getClient(),
      user = window.vklucheAuth?.getUser();
    if (!client || !user) return;
    const { data } = await client.from("comparison_items").select("listing_id");
    (data || []).forEach((row) => {
      const car = cars.find((item) => item.listingId === row.listing_id);
      if (car) selected.add(String(car.id));
    });
    sync();
  }
  window.addEventListener("vkluche:profile", () =>
    setTimeout(loadRemoteComparison, 400),
  );
  enhance();
  sync();
})();
