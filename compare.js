(function () {
  let selected = new Set(
    JSON.parse(localStorage.getItem("vkluche-compare") || "[]"),
  );
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div class="compare-bar" id="compareBar"><span><b id="compareCount">0</b> автомобиля для сравнения</span><div class="compare-tray" id="compareTray"></div><button type="button" id="openCompare">Сравнить</button><button type="button" id="clearCompare" aria-label="Очистить сравнение">×</button></div><div class="modal compare-modal" id="compareModal"><div class="modal-backdrop" data-compare-close></div><div class="modal-card compare-card"><button class="modal-close" data-compare-close>×</button><div class="compare-heading"><h2>Сравнение автомобилей</h2><label><input id="compareDifferences" type="checkbox"> Показывать только различия</label></div><div id="compareTable"></div></div></div><div class="modal" id="replaceCompareModal"><div class="modal-backdrop" data-replace-close></div><div class="modal-card replace-compare-card"><button class="modal-close" data-replace-close>×</button><span class="eyebrow blue">В СРАВНЕНИИ УЖЕ 4 АВТОМОБИЛЯ</span><h2>Какой автомобиль заменить?</h2><p id="replaceCompareHint"></p><div id="replaceCompareList"></div></div></div>',
  );
  const bar = document.querySelector("#compareBar"),
    modal = document.querySelector("#compareModal"),
    replaceModal = document.querySelector("#replaceCompareModal");
  let replacementCar = null;
  function sync() {
    localStorage.setItem("vkluche-compare", JSON.stringify([...selected]));
    document.querySelector("#compareCount").textContent = selected.size;
    bar.classList.toggle("show", selected.size > 0);
    document.querySelector("#compareTray").innerHTML = [...selected]
      .map((id) => cars.find((car) => String(car.id) === id))
      .filter(Boolean)
      .map((car) => `<span><img src="${car.img}" alt=""><b>${escapeHtml(car.name)}</b><button type="button" data-compare-remove="${escapeHtml(car.id)}" aria-label="Убрать ${escapeHtml(car.name)}">×</button></span>`)
      .join("");
    document.querySelectorAll("[data-compare-id]").forEach((button) => {
      const id = button.dataset.compareId;
      button.classList.toggle("selected", selected.has(id));
      button.textContent = selected.has(id)
        ? "✓ В сравнении"
        : button.id === "detailCompare"
          ? "⇄ Добавить к сравнению"
          : "⇄ Сравнить";
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
          .eq("listing_id", car.listingId)
          .eq("user_id", user.id);
    const { error } = await query;
    if (error) toast(error.message);
  }
  function toggle(car) {
    const id = String(car.id);
    if (selected.has(id)) {
      selected.delete(id);
      persist(car, false);
    } else {
      if (selected.size >= 4) return chooseReplacement(car);
      selected.add(id);
      persist(car, true);
    }
    sync();
  }
  function remove(id) {
    const car = cars.find((item) => String(item.id) === String(id));
    selected.delete(String(id));
    if (car) persist(car, false);
    sync();
    if (modal.classList.contains("open")) renderComparison();
  }
  function chooseReplacement(car) {
    replacementCar = car;
    document.querySelector("#replaceCompareHint").textContent = `Чтобы добавить ${car.name}, выберите один из текущих вариантов.`;
    document.querySelector("#replaceCompareList").innerHTML = [...selected].map((id) => cars.find((item) => String(item.id) === id)).filter(Boolean).map((item) => `<button type="button" data-compare-replace="${escapeHtml(item.id)}"><img src="${item.img}" alt=""><span><b>${escapeHtml(item.name)}</b><small>${money(item.price)} · заменить</small></span></button>`).join("");
    replaceModal.classList.add("open");
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
  function syncDetailButton() {
    const button = document.querySelector("#detailCompare");
    if (!button || !currentCar) return;
    const id = String(currentCar.id);
    button.dataset.compareId = id;
    button.classList.toggle("selected", selected.has(id));
    button.textContent = selected.has(id)
      ? "✓ В сравнении"
      : "⇄ Добавить к сравнению";
  }
  document
    .querySelector("#detailCompare")
    .addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!currentCar) return toast("Сначала откройте автомобиль");
      toggle(currentCar);
      syncDetailButton();
    });
  function renderComparison() {
    const rows = [...selected]
      .map((id) => cars.find((car) => String(car.id) === id))
      .filter(Boolean);
    const specs = [
      ["Цена", (c) => money(c.price)],
      ["Год", (c) => c.year],
      ["Поколение", (c) => c.details?.generation || "Нет данных"],
      ["Модификация", (c) => c.details?.modification || "Нет данных"],
      ["Комплектация", (c) => c.details?.trimName || "Нет данных"],
      ["Пробег", (c) => c.km],
      ["Двигатель", (c) => c.engine],
      ["Тип двигателя", (c) => engineTypeLabels[carEngineType(c)]],
      ["Коробка", (c) => carGearbox(c)],
      ["Привод", (c) => carDrive(c)],
      ["Кузов", (c) => carBody(c)],
      ["Дверей / мест", (c) => [c.details?.doors,c.details?.seats].filter(Boolean).join(" / ") || "Нет данных"],
      ["Руль", (c) => c.details?.steeringWheel === "right" ? "Правый" : c.details?.steeringWheel ? "Левый" : "Нет данных"],
      ["Владельцы", (c) => c.details?.owners || "Нет данных"],
      ["ПТС", (c) => c.details?.ptsType || "Нет данных"],
      ["Второй комплект", (c) => secondSetLabel(c)],
      ["Безопасность", (c) => equipmentGroups(c)["Безопасность"]?.join(", ") || (c.details?.equipmentDataKnown ? "—" : "Нет данных")],
      ["Комфорт", (c) => equipmentGroups(c)["Комфорт"]?.join(", ") || (c.details?.equipmentDataKnown ? "—" : "Нет данных")],
      ["Обогревы", (c) => equipmentGroups(c)["Обогревы"]?.join(", ") || (c.details?.equipmentDataKnown ? "—" : "Нет данных")],
      ["Мультимедиа", (c) => equipmentGroups(c)["Мультимедиа"]?.join(", ") || (c.details?.equipmentDataKnown ? "—" : "Нет данных")],
      ["Обзор", (c) => equipmentGroups(c)["Обзор"]?.join(", ") || (c.details?.equipmentDataKnown ? "—" : "Нет данных")],
      ["Салон и экстерьер", (c) => equipmentGroups(c)["Салон и экстерьер"]?.join(", ") || (c.details?.equipmentDataKnown ? "—" : "Нет данных")],
      ["Город", (c) => c.city],
    ];
    const visibleSpecs = document.querySelector("#compareDifferences").checked
      ? specs.filter(([, get]) => new Set(rows.map((car) => String(get(car)))).size > 1)
      : specs;
    const emptyColumn = rows.length < 4 ? '<th class="compare-empty-column"><button type="button" data-compare-add>+<span>Добавить автомобиль</span></button></th>' : '';
    document.querySelector("#compareTable").innerHTML =
      `<table><thead><tr><th>Параметр</th>${rows.map((c) => `<th><button class="compare-column-remove" type="button" data-compare-remove="${escapeHtml(c.id)}" aria-label="Убрать из сравнения">×</button><img src="${c.img}" alt=""><b>${escapeHtml(c.name)}</b></th>`).join("")}${emptyColumn}</tr></thead><tbody>${visibleSpecs.map(([label, get]) => `<tr><th>${label}</th>${rows.map((c) => `<td>${escapeHtml(get(c))}</td>`).join("")}${rows.length<4?'<td class="compare-empty-cell">—</td>':''}</tr>`).join("")}</tbody></table>${visibleSpecs.length?'':'<p class="compare-no-differences">По выбранным параметрам различий нет.</p>'}`;
  }
  function open() {
    if (selected.size < 2) return toast("Выберите минимум два автомобиля");
    renderComparison();
    modal.classList.add("open");
  }
  document.querySelector("#openCompare").addEventListener("click", open);
  document.querySelector("#clearCompare").addEventListener("click", () => {
    [...selected].forEach((id) => {
      const car = cars.find((item) => String(item.id) === id);
      if (car) persist(car, false);
    });
    selected.clear();
    sync();
    modal.classList.remove("open");
  });
  document.querySelector("#compareDifferences").addEventListener("change", renderComparison);
  document.querySelector("#compareTable").addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-compare-remove]");
    if (removeButton) return remove(removeButton.dataset.compareRemove);
    if (event.target.closest("[data-compare-add]")) {
      modal.classList.remove("open");
      document.querySelector("#catalog")?.scrollIntoView({ behavior: "smooth" });
    }
  });
  document.querySelector("#compareTray").addEventListener("click", (event) => {
    const button = event.target.closest("[data-compare-remove]");
    if (button) remove(button.dataset.compareRemove);
  });
  document.querySelector("#replaceCompareList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-compare-replace]");
    if (!button || !replacementCar) return;
    const oldCar = cars.find((item) => String(item.id) === button.dataset.compareReplace);
    if (oldCar) persist(oldCar, false);
    selected.delete(button.dataset.compareReplace);
    selected.add(String(replacementCar.id));
    persist(replacementCar, true);
    replacementCar = null;
    replaceModal.classList.remove("open");
    sync();
    open();
  });
  document.querySelectorAll("[data-replace-close]").forEach((button) => button.addEventListener("click", () => { replacementCar = null; replaceModal.classList.remove("open"); }));
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
      syncDetailButton();
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
        syncDetailButton();
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
