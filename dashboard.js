(function () {
  const tabs = document.querySelector("#dashboardTabs"),
    content = document.querySelector("#dashboardContent");
  if (!tabs || !content) return;
  let state = { role: "user", accountType: "private", active: "overview", data: {} };
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>'"]/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[char],
    );
  const rub = (value) =>
    new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
      maximumFractionDigits: 0,
    }).format(+value || 0);
  const date = (value) =>
    value ? new Date(value).toLocaleDateString("ru-RU") : "—";
  const auctionLabels = {
    scheduled: "Запланирован",
    active: "Идут торги",
    awaiting_seller: "Выбор продавца",
    awaiting_buyer: "Ответ покупателя",
    deal_confirmed: "Сделка подтверждена",
    no_sale: "Без сделки",
    cancelled: "Отменён",
  };
  const listingLabels = {
    draft: "Черновик",
    pending: "На модерации",
    published: "Опубликовано",
    rejected: "Отклонено",
    sold: "Продано",
    archived: "В архиве",
  };
  const verifyLabels = {
    unverified: "Не проверено",
    submitted: "Ожидает проверки",
    verified: "Проверено",
    failed: "Проверка не пройдена",
  };
  const empty = (text) =>
    `<div class="dashboard-empty"><b>Здесь пока пусто</b><span>${esc(text)}</span></div>`;
  const carName = (row) => row?.data?.name || "Автомобиль";
  const carImage = (row) => row?.data?.img || "";

  function availableTabs() {
    const result = [
      ["overview", "Обзор"],
      ["buyer", "Покупки"],
      ["favorites", "Избранное"],
    ];
    result.push(["seller", "Продажи"]);
    if (state.role === "admin")
      result.push(["moderation", "Модерация"], ["admin", "Управление"]);
    return result;
  }
  function renderTabs() {
    const allowed = availableTabs();
    if (!allowed.some(([id]) => id === state.active)) state.active = "overview";
    tabs.innerHTML = allowed
      .map(
        ([id, label]) =>
          `<button type="button" data-dashboard-tab="${id}" class="${state.active === id ? "active" : ""}">${label}</button>`,
      )
      .join("");
  }
  function stat(value, label) {
    return `<div class="dashboard-stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
  }
  function renderOverview() {
    const d = state.data,
      bids = d.bids || [],
      favorites = d.favorites || [],
      listings = d.listings || [],
      auctions = d.sellerAuctions || [],
      pending =
        d.adminListings?.filter((x) => x.verification_status === "submitted")
          .length || 0;
    let stats =
      stat(bids.length, "моих ставок") + stat(favorites.length, "в избранном");
    stats +=
      stat(listings.filter((x) => x.active).length, "активных объявлений") +
      stat(
        auctions.filter((x) =>
          [
            "scheduled",
            "active",
            "awaiting_seller",
            "awaiting_buyer",
          ].includes(x.status),
        ).length,
        "аукционов в работе",
      );
    if (state.role === "admin")
      stats +=
        stat(pending, "ждут проверки") +
        stat(d.profiles?.length || 0, "пользователей");
    const recent = (d.deals || []).slice(0, 3);
    content.innerHTML = `<div class="dashboard-stats">${stats}</div><section class="dashboard-block"><div class="dashboard-block-head"><h3>Последние события</h3></div>${recent.length ? recent.map((deal) => `<article class="dashboard-row"><span><b>${deal.status === "confirmed" ? "Покупка подтверждена" : "Предложение по аукциону"}</b><small>${rub(deal.amount)} · ${date(deal.created_at)}</small></span><em class="status ${deal.status}">${esc(deal.status === "confirmed" ? "Подтверждено" : deal.status === "awaiting_buyer" ? "Нужен ответ" : "Завершено")}</em></article>`).join("") : empty("События появятся после участия в аукционе.")}</section>`;
  }
  function renderBuyer() {
    const bids = state.data.bids || [],
      deals = state.data.deals || [];
    content.innerHTML = `<section class="dashboard-block"><div class="dashboard-block-head"><h3>Мои ставки</h3><span>${bids.length}</span></div>${
      bids.length
        ? bids
            .map((bid) => {
              const listing = bid.auction?.listings;
              return `<article class="dashboard-car" data-open-listing="${esc(bid.auction?.listing_id || "")}">${carImage(listing) ? `<img src="${esc(carImage(listing))}" alt="">` : ""}<span><b>${esc(carName(listing))}</b><small>${rub(bid.amount)} · ${date(bid.created_at)}</small></span><em>${esc(auctionLabels[bid.auction?.status] || "Завершён")}</em></article>`;
            })
            .join("")
        : empty("Сделайте ставку на интересующий автомобиль.")
    }</section><section class="dashboard-block"><div class="dashboard-block-head"><h3>Результаты</h3></div>${deals.length ? deals.map((deal) => `<article class="dashboard-row"><span><b>${rub(deal.amount)}</b><small>Ответ до ${new Date(deal.response_deadline).toLocaleString("ru-RU")}</small></span><em class="status ${deal.status}">${esc(deal.status === "awaiting_buyer" ? "Нужен ответ" : deal.status === "confirmed" ? "Подтверждено" : deal.status === "declined" ? "Отказ" : "Завершено")}</em></article>`).join("") : empty("Здесь появятся выбранные продавцами предложения.")}</section><section class="dashboard-block"><div class="dashboard-block-head"><h3>Сохранённые поиски</h3></div>${(state.data.searches || []).length ? state.data.searches.map((search) => `<article class="dashboard-row"><span><b>${esc(search.name)}</b><small>Уведомления о новых автомобилях включены</small></span><button type="button" data-delete-search="${search.id}">Удалить</button></article>`).join("") : empty("Настройте фильтры в каталоге и нажмите «Сохранить поиск».")}</section>`;
  }
  function renderFavorites() {
    const rows = state.data.favorites || [];
    content.innerHTML = `<section class="dashboard-block"><div class="dashboard-block-head"><h3>Избранные автомобили</h3><span>${rows.length}</span></div>${rows.length ? rows.map((item) => `<article class="dashboard-car" data-open-listing="${item.listing_id}">${carImage(item.listings) ? `<img src="${esc(carImage(item.listings))}" alt="">` : ""}<span><b>${esc(carName(item.listings))}</b><small>${rub(item.listings?.data?.price)} · ${esc(item.listings?.data?.city || "")}</small></span><button type="button" data-remove-favorite="${item.listing_id}">Удалить</button></article>`).join("") : empty("Добавляйте автомобили сердечком в каталоге.")}</section>`;
  }
  function renderSeller() {
    const listings = state.data.listings || [],
      auctions = state.data.sellerAuctions || [];
    content.innerHTML = `<section class="dashboard-block"><div class="dashboard-block-head"><h3>Мои объявления</h3><button type="button" data-dashboard-sell>+ Разместить</button></div>${listings.length ? listings.map((row) => `<article class="dashboard-car" data-open-listing="${row.id}">${carImage(row) ? `<img src="${esc(carImage(row))}" alt="">` : ""}<span><b>${esc(carName(row))}</b><small>${esc(listingLabels[row.status] || row.status)} · ${esc(verifyLabels[row.verification_status] || "")}</small></span><button type="button" data-listing-toggle="${row.id}" data-active="${row.active}">${row.active ? "В архив" : "Вернуть"}</button></article>`).join("") : empty("Разместите первый автомобиль.")}</section><section class="dashboard-block"><div class="dashboard-block-head"><h3>Мои аукционы</h3><span>${auctions.length}</span></div>${auctions.length ? auctions.map((row) => `<article class="dashboard-row"><span><b>${esc(carName(row.listings))}</b><small>${rub(row.start_price)} · ${date(row.created_at)}</small></span><em>${esc(auctionLabels[row.status] || row.status)}</em></article>`).join("") : empty("Запустить аукцион можно из карточки своего автомобиля.")}</section>`;
  }
  function renderModeration() {
    const rows = (state.data.adminListings || []).filter(
      (row) =>
        ["submitted", "failed"].includes(row.verification_status) ||
        row.status === "rejected",
    );
    content.innerHTML = `<section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Проверка автомобилей</h3><small>Отмечайте только сведения, подтверждённые отчётом или специалистом</small></div><span>${rows.length}</span></div>${rows.length ? rows.map((row) => { const checks=row.verification_checks||{};return `<article class="moderation-card verification-card"><div class="verification-card-summary">${carImage(row)?`<img src="${esc(carImage(row))}" alt="">`:""}<span><b>${esc(carName(row))}</b><small>VIN: ${esc(row.vin || "не указан")} · ${date(row.updated_at)}</small><small>${esc(verifyLabels[row.verification_status] || row.verification_status)}</small></span></div><div class="verification-card-actions"><button class="approve" type="button" data-open-verification="${row.id}">Начать проверку</button><button type="button" data-reject-verification="${row.id}">Отклонить</button></div><form class="verification-form" data-verification-form="${row.id}" hidden><div class="verification-guide"><b>1. Сверьте VIN и материалы</b><span>Откройте объявление, изучите приложенные документы или отчёт партнёра.</span></div><fieldset><legend>2. Что подтверждено</legend><label><input type="checkbox" name="body"${checks.body?" checked":""}> Осмотр кузова</label><label><input type="checkbox" name="technical"${checks.technical?" checked":""}> Техническая диагностика</label><label><input type="checkbox" name="legal"${checks.legal?" checked":""}> Проверка документов</label><label><input type="checkbox" name="mileage"${checks.mileage?" checked":""}> Проверка пробега</label></fieldset><label>3. Источник проверки<select name="source" required><option value="">Выберите источник</option><option value="platform_specialist">Специалист ВКЛЮЧЕ</option><option value="partner_report">Отчёт партнёра</option><option value="external_registry">Внешний реестр</option><option value="provided_documents">Предоставленные документы</option></select></label><label>Комментарий администратора<textarea name="note" maxlength="500" placeholder="Номер отчёта, важные замечания или ограничения"></textarea></label><div class="verification-form-actions"><button type="button" data-preview-listing="${row.id}">Открыть карточку</button><button class="approve" type="submit">Сохранить результат</button></div></form></article>`}).join("") : empty("Новых автомобилей для проверки нет.")}</section>`;
  }
  function renderAdmin() {
    const d = state.data,
      types = (d.profiles || []).reduce(
        (acc, item) => ((acc[item.account_type || "private"] = (acc[item.account_type || "private"] || 0) + 1), acc),
        {},
      ),
      statuses = (d.adminAuctions || []).reduce(
        (acc, item) => ((acc[item.status] = (acc[item.status] || 0) + 1), acc),
        {},
      );
    content.innerHTML = `<div class="dashboard-stats">${stat(types.private || 0, "частных лиц")}${stat(types.professional || 0, "профессиональных участников")}${stat((d.profiles || []).filter((item) => item.role === "admin").length, "администраторов")}${stat(d.adminListings?.length || 0, "объявлений")}</div><section class="dashboard-block"><div class="dashboard-block-head"><h3>Состояние аукционов</h3></div>${
      Object.entries(statuses)
        .map(
          ([key, value]) =>
            `<article class="dashboard-row"><span><b>${esc(auctionLabels[key] || key)}</b></span><em>${value}</em></article>`,
        )
        .join("") || empty("Аукционов пока нет.")
    }</section>`;
  }
  function render() {
    renderTabs();
    (
      ({
        overview: renderOverview,
        buyer: renderBuyer,
        favorites: renderFavorites,
        seller: renderSeller,
        moderation: renderModeration,
        admin: renderAdmin,
      })[state.active] || renderOverview
    )();
  }

  async function load() {
    const auth = window.vklucheAuth,
      user = auth?.getUser(),
      client = auth?.getClient();
    if (!user || !client) return;
    state.role = auth.getRole() || "user";
    state.accountType = auth.getAccountType?.() || "private";
    content.innerHTML =
      '<div class="dashboard-loading">Загружаем данные кабинета…</div>';
    const [bids, deals, searches, favorites] = await Promise.all([
      client
        .from("auction_bids")
        .select(
          "id,amount,created_at,auction_id,auction:auctions!auction_bids_auction_id_fkey(status,listing_id,listings(data))",
        )
        .eq("bidder_id", user.id)
        .order("created_at", { ascending: false }),
      client
        .from("auction_deals")
        .select("*")
        .eq("buyer_id", user.id)
        .order("created_at", { ascending: false }),
      client
        .from("saved_searches")
        .select("*")
        .order("created_at", { ascending: false }),
      client
        .from("favorites")
        .select("listing_id,created_at,listings(data,status)")
        .order("created_at", { ascending: false }),
    ]);
    state.data = {
      bids: bids.data || [],
      deals: deals.data || [],
      searches: searches.data || [],
      favorites: favorites.data || [],
    };
    {
      const [listings, auctions] = await Promise.all([
        client
          .from("listings")
          .select("id,data,status,verification_status,active,updated_at")
          .eq("owner_id", user.id)
          .order("updated_at", { ascending: false }),
        client
          .from("auctions")
          .select("id,status,start_price,created_at,listing_id,listings(data)")
          .eq("seller_id", user.id)
          .order("created_at", { ascending: false }),
      ]);
      state.data.listings = listings.data || [];
      state.data.sellerAuctions = auctions.data || [];
    }
    if (state.role === "admin") {
      const [listings, profiles, auctions] = await Promise.all([
        client
          .from("listings")
          .select(
            "id,data,status,verification_status,verification_checks,vin,active,updated_at,owner_id",
          )
          .order("updated_at", { ascending: false }),
        client.from("profiles").select("id,role,account_type,created_at"),
        client.from("auctions").select("id,status"),
      ]);
      state.data.adminListings = listings.data || [];
      state.data.profiles = profiles.data || [];
      state.data.adminAuctions = auctions.data || [];
    }
    render();
  }

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-dashboard-tab]");
    if (!button) return;
    state.active = button.dataset.dashboardTab;
    render();
  });
  content.addEventListener("click", async (event) => {
    const auth = window.vklucheAuth,
      client = auth?.getClient();
    if (!client) return;
    const open = event.target.closest("[data-open-listing]");
    if (open && !event.target.closest("button")) {
      window.dispatchEvent(
        new CustomEvent("vkluche:open-listing", {
          detail: { listingId: open.dataset.openListing },
        }),
      );
      return;
    }
    const search = event.target.closest("[data-delete-search]");
    if (search) {
      await client
        .from("saved_searches")
        .delete()
        .eq("id", search.dataset.deleteSearch);
      return load();
    }
    const favorite = event.target.closest("[data-remove-favorite]");
    if (favorite) {
      await client
        .from("favorites")
        .delete()
        .eq("listing_id", favorite.dataset.removeFavorite);
      return load();
    }
    const toggle = event.target.closest("[data-listing-toggle]");
    if (toggle) {
      const active = toggle.dataset.active === "true";
      const { error } = active
        ? await client.rpc("archive_listing", {
            p_listing_id: toggle.dataset.listingToggle,
          })
        : await client
            .from("listings")
            .update({ active: true, status: "published" })
            .eq("id", toggle.dataset.listingToggle);
      if (error) return window.toast?.(error.message);
      return load();
    }
    if (event.target.closest("[data-dashboard-sell]")) {
      document.querySelector("#authModal [data-auth-close]").click();
      document.querySelector(".open-modal").click();
      return;
    }
    const openVerification = event.target.closest("[data-open-verification]");
    if (openVerification) {
      const form=content.querySelector(`[data-verification-form="${openVerification.dataset.openVerification}"]`);
      form.hidden=!form.hidden;
      openVerification.textContent=form.hidden?"Начать проверку":"Скрыть форму";
      return;
    }
    const preview = event.target.closest("[data-preview-listing]");
    if (preview) {
      window.dispatchEvent(new CustomEvent("vkluche:open-listing",{detail:{listingId:preview.dataset.previewListing}}));
      return;
    }
    const reject = event.target.closest("[data-reject-verification]");
    if (reject) {
      const note=prompt("Укажите причину отклонения:","Проверьте VIN и данные автомобиля")||"";
      if(!note)return;
      reject.disabled = true;
      const { error } = await client.rpc("moderate_listing", {
        p_listing_id: reject.dataset.rejectVerification,
        p_approve: false,
        p_note: note,
        p_checks: {},
        p_source: "provided_documents",
      });
      reject.disabled = false;
      if (error) return alert(error.message);
      return load();
    }
  });
  content.addEventListener("submit",async(event)=>{
    const form=event.target.closest("[data-verification-form]");if(!form)return;
    event.preventDefault();const auth=window.vklucheAuth,client=auth?.getClient();if(!client)return;
    const values=new FormData(form),checks={body:values.has("body"),technical:values.has("technical"),legal:values.has("legal"),mileage:values.has("mileage")};
    if(!Object.values(checks).some(Boolean)&&!confirm("Ни один пункт не подтверждён. Всё равно завершить проверку?"))return;
    const button=event.submitter;button.disabled=true;button.textContent="Сохраняем…";
    const{error}=await client.rpc("moderate_listing",{p_listing_id:form.dataset.verificationForm,p_approve:true,p_note:String(values.get("note")||"").trim(),p_checks:checks,p_source:values.get("source")});
    button.disabled=false;button.textContent="Сохранить результат";if(error)return alert(error.message);window.toast?.("Результаты проверки опубликованы");return load();
  });
  window.addEventListener("vkluche:profile", load);
  window.addEventListener("vkluche:dashboard-open", load);
  window.addEventListener("vkluche:dashboard-tab", (event) => {
    state.active = event.detail?.tab || "overview";
    render();
  });
})();
