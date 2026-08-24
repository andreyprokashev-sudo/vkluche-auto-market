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
      ["searches", "Поиски"],
    ];
    result.push(["seller", "Продажи"]);
    if (state.accountType === "professional" || state.role === "admin") result.push(["business", "Компания"]);
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
    }</section><section class="dashboard-block"><div class="dashboard-block-head"><h3>Результаты</h3></div>${deals.length ? deals.map((deal) => `<article class="dashboard-row"><span><b>${rub(deal.amount)}</b><small>Ответ до ${new Date(deal.response_deadline).toLocaleString("ru-RU")}</small></span><em class="status ${deal.status}">${esc(deal.status === "awaiting_buyer" ? "Нужен ответ" : deal.status === "confirmed" ? "Подтверждено" : deal.status === "declined" ? "Отказ" : "Завершено")}</em></article>`).join("") : empty("Здесь появятся выбранные продавцами предложения.")}</section>`;
  }
  function searchDescription(search) {
    const f = search.filters || {}, parts = [];
    if (f.query) parts.push(f.query);
    const brands = Array.isArray(f.filterBrand) ? f.filterBrand : f.filterBrand ? [f.filterBrand] : [];
    if (brands.length) parts.push(brands.join(", "));
    if (f.city) parts.push(f.city);
    if (f.priceFrom || f.priceTo) parts.push(`цена ${f.priceFrom ? `от ${rub(f.priceFrom)}` : ""}${f.priceFrom && f.priceTo ? " " : ""}${f.priceTo ? `до ${rub(f.priceTo)}` : ""}`);
    if (f.yearFrom || f.yearTo) parts.push(`год ${f.yearFrom ? `от ${f.yearFrom}` : ""}${f.yearFrom && f.yearTo ? " " : ""}${f.yearTo ? `до ${f.yearTo}` : ""}`);
    return parts.join(" · ") || "Все автомобили";
  }
  function searchNotifications(search) {
    const channels = [search.notify_in_app && "В кабинете", search.notify_email && "По электронной почте"].filter(Boolean);
    return channels.join(" · ") || "Без уведомлений";
  }
  function renderSearches() {
    const rows = state.data.searches || [];
    content.innerHTML = `<section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Сохранённые поиски</h3><small>Здесь находятся ваши подборки и настройки уведомлений</small></div><span>${rows.length}</span></div>${rows.length ? rows.map((search) => `<article class="dashboard-row"><span><b>${esc(search.name)}</b><small class="saved-search-description">${esc(searchDescription(search))}</small><small>${esc(searchNotifications(search))}</small></span><div class="saved-search-actions"><button type="button" data-apply-search="${search.id}">Показать</button><button type="button" data-delete-search="${search.id}">Удалить</button></div></article>`).join("") : empty("Настройте параметры в каталоге и нажмите «Сохранить поиск».")}</section>`;
  }
  function renderFavorites() {
    const rows = state.data.favorites || [];
    content.innerHTML = `<section class="dashboard-block"><div class="dashboard-block-head"><h3>Избранные автомобили</h3><span>${rows.length}</span></div>${rows.length ? rows.map((item) => `<article class="dashboard-car" data-open-listing="${item.listing_id}">${carImage(item.listings) ? `<img src="${esc(carImage(item.listings))}" alt="">` : ""}<span><b>${esc(carName(item.listings))}</b><small>${rub(item.listings?.data?.price)} · ${esc(item.listings?.data?.city || "")}</small></span><button type="button" data-remove-favorite="${item.listing_id}">Удалить</button></article>`).join("") : empty("Добавляйте автомобили сердечком в каталоге.")}</section>`;
  }
  function renderSeller() {
    const listings = state.data.listings || [],
      auctions = state.data.sellerAuctions || [];
    content.innerHTML = `<section class="dashboard-block"><div class="dashboard-block-head"><h3>Мои объявления</h3><button type="button" data-dashboard-sell>+ Разместить</button></div>${listings.length ? listings.map((row) => `<article class="dashboard-car" data-open-listing="${row.id}">${carImage(row) ? `<img src="${esc(carImage(row))}" alt="">` : ""}<span><b>${esc(carName(row))}</b><small>${esc(listingLabels[row.status] || row.status)} · ${esc(verifyLabels[row.verification_status] || "")}</small></span>${row.active?`<button type="button" data-listing-withdraw="${row.id}">Снять</button>`:row.status==='archived'?`<button type="button" data-listing-restore="${row.id}">Вернуть</button>`:`<em>${esc(listingLabels[row.status]||row.status)}</em>`}</article>`).join("") : empty("Разместите первый автомобиль.")}</section><section class="dashboard-block"><div class="dashboard-block-head"><h3>Мои аукционы</h3><span>${auctions.length}</span></div>${auctions.length ? auctions.map((row) => `<article class="dashboard-row"><span><b>${esc(carName(row.listings))}</b><small>${rub(row.start_price)} · ${date(row.created_at)}</small></span><em>${esc(auctionLabels[row.status] || row.status)}</em></article>`).join("") : empty("Запустить аукцион можно из карточки своего автомобиля.")}</section>`;
  }
  function renderBusiness() {
    const d=state.data,organization=d.organization;
    if(!organization){content.innerHTML=`<section class="dashboard-block business-onboarding"><span class="eyebrow blue">ПРОФЕССИОНАЛЬНЫЙ КАБИНЕТ</span><h3>Создайте профиль компании</h3><p>Объедините склад, филиалы, сотрудников, фиды и аукционы в одном кабинете.</p><form data-create-organization><label>Название компании<input name="name" required minlength="2" maxlength="160" placeholder="Например, Автоцентр Самара"></label><label>ИНН<input name="inn" inputmode="numeric" maxlength="12" placeholder="Необязательно"></label><button class="primary-btn" type="submit">Создать компанию</button></form></section>`;return}
    const analytics=d.organizationAnalytics||{},branches=d.organizationBranches||[],members=d.organizationMembers||[],inventory=d.organizationListings||[],feeds=d.organizationFeeds||[],claimableFeeds=d.claimableFeeds||[],unassigned=(d.listings||[]).filter(row=>!row.organization_id);
    content.innerHTML=`<div class="business-heading"><div><span class="eyebrow blue">КОМПАНИЯ</span><h3>${esc(organization.name)}</h3><small>${esc(organization.inn?`ИНН ${organization.inn}`:'Профессиональный профиль')}</small></div><em>${esc(d.organizationRole||'viewer')}</em></div><div class="dashboard-stats">${stat(analytics.inventory||0,'автомобилей на складе')}${stat(analytics.active_listings||0,'опубликовано')}${stat(analytics.active_auctions||0,'аукционов в работе')}${stat(analytics.confirmed_deals||0,'подтверждённых сделок')}${stat(rub(analytics.revenue||0),'сумма сделок')}${stat(analytics.participants||0,'участников')}</div><section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Филиалы</h3><small>Площадки хранения и осмотра автомобилей</small></div><span>${branches.length}</span></div><div class="business-grid">${branches.map(branch=>`<article><b>${esc(branch.name)}</b><small>${esc(branch.city)} · ${esc(branch.address||'адрес не указан')}</small></article>`).join('')||empty('Добавьте первую площадку.')}<form data-create-branch><input name="name" required placeholder="Название филиала"><input name="city" required placeholder="Город"><input name="address" required placeholder="Адрес"><button type="submit">+ Добавить филиал</button></form></div></section>${unassigned.length?`<section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Добавить свои объявления на склад</h3><small>Назначьте автомобилю филиал компании</small></div><span>${unassigned.length}</span></div>${unassigned.map(row=>`<article class="dashboard-row"><span><b>${esc(carName(row))}</b><small>${rub(row.data?.price)}</small></span><select data-assign-branch="${row.id}"><option value="">Выберите филиал</option>${branches.map(branch=>`<option value="${branch.id}">${esc(branch.name)}</option>`).join('')}</select></article>`).join('')}</section>`:''}<section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Сотрудники</h3><small>Владелец, администратор, менеджер или наблюдатель</small></div><span>${members.length}</span></div>${members.map(member=>`<article class="dashboard-row"><span><b>${esc(member.name||member.email||member.user_id)}</b><small>${esc(member.email||'')} · ${esc(member.member_role)}</small></span></article>`).join('')}<form class="business-inline-form" data-add-member><input name="email" type="email" required placeholder="Почта зарегистрированного сотрудника"><select name="role"><option value="manager">Менеджер</option><option value="administrator">Администратор</option><option value="viewer">Наблюдатель</option></select><button type="submit">Добавить</button></form></section><section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Общий склад и массовые торги</h3><small>Выберите автомобили без активного аукциона</small></div><span>${inventory.length}</span></div><form data-bulk-auctions><div class="bulk-inventory">${inventory.map(row=>`<label><input type="checkbox" name="listingIds" value="${row.id}"><img src="${esc(carImage(row))}" alt=""><span><b>${esc(carName(row))}</b><small>${rub(row.data?.price)} · ${esc(row.organization_branches?.name||'Без филиала')}</small></span><select data-assign-branch="${row.id}"><option value="">Филиал</option>${branches.map(branch=>`<option value="${branch.id}"${row.branch_id===branch.id?' selected':''}>${esc(branch.name)}</option>`).join('')}</select></label>`).join('')||empty('Добавьте автомобили компании или назначьте свои объявления филиалу.')}</div><div class="bulk-settings"><select name="duration"><option value="1440">24 часа</option><option value="720">12 часов</option><option value="2880">48 часов</option></select><select name="step"><option value="10000">Шаг 10 000 ₽</option><option value="25000">Шаг 25 000 ₽</option><option value="50000">Шаг 50 000 ₽</option></select><select name="winnerMode"><option value="highest">Максимальная ставка</option><option value="seller_choice">Выбор продавца</option></select><button type="submit">Запустить выбранные</button></div></form></section><section class="dashboard-block" data-organization-feeds><div class="dashboard-block-head"><div><h3>Автоматические фиды</h3><small>Источники общего склада организации</small></div><span>${feeds.length}</span></div>${feeds.map(feed=>`<article class="dashboard-row"><span><b>${esc(feed.name)}</b><small>${esc(feed.last_status||'Ожидает запуска')} · каждые ${feed.interval_minutes} мин.</small></span></article>`).join('')||empty('Добавление источника доступно через раздел «Загрузить фид».')}</section><section class="dashboard-block"><div class="dashboard-block-head"><h3>Результаты по филиалам</h3></div>${(analytics.branches||[]).map(branch=>`<article class="dashboard-row"><span><b>${esc(branch.name)}</b><small>${esc(branch.city)} · склад ${branch.inventory} · аукционы ${branch.auctions}</small></span><em>${branch.deals} сделок</em></article>`).join('')||empty('Данные появятся после добавления филиалов.')}</section>`;
    if(claimableFeeds.length)content.querySelector('[data-organization-feeds]').insertAdjacentHTML('beforebegin',`<section class="dashboard-block feed-attach-block"><div class="dashboard-block-head"><div><h3>Привязать существующий фид</h3><small>Все уже загруженные автомобили перейдут на склад ${esc(organization.name)}</small></div></div><form data-attach-feed><label>Источник<select name="feedId" required>${claimableFeeds.map(feed=>`<option value="${feed.id}">${esc(feed.name)} · ${feed.listing_count} автомобилей</option>`).join('')}</select></label><label>Филиал<select name="branchId"><option value="">Без филиала</option>${branches.map(branch=>`<option value="${branch.id}">${esc(branch.name)}</option>`).join('')}</select></label><button type="submit">Привязать фид и автомобили</button></form></section>`);
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
        searches: renderSearches,
        seller: renderSeller,
        business: renderBusiness,
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
          .select("id,data,status,verification_status,active,updated_at,organization_id,branch_id")
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
    if (state.accountType === "professional" || state.role === "admin") {
      const membership=await client.from("organization_members").select("organization_id,member_role,organizations(*)").eq("user_id",user.id).eq("active",true).limit(1).maybeSingle();
      const member=membership.data;if(member?.organizations){state.data.organization=member.organizations;state.data.organizationRole=member.member_role;const orgId=member.organization_id;const[branches,members,inventory,feeds,analytics,claimable]=await Promise.all([client.from("organization_branches").select("*").eq("organization_id",orgId).order("name"),client.rpc("organization_member_directory",{p_organization_id:orgId}),client.from("listings").select("id,data,status,active,branch_id,organization_branches(name)").eq("organization_id",orgId).order("updated_at",{ascending:false}),client.from("feed_sources").select("*").eq("organization_id",orgId).order("created_at",{ascending:false}),client.rpc("organization_auction_analytics",{p_organization_id:orgId}),client.rpc("claimable_feed_sources",{p_organization_id:orgId})]);state.data.organizationBranches=branches.data||[];state.data.organizationMembers=members.data||[];state.data.organizationListings=inventory.data||[];state.data.organizationFeeds=feeds.data||[];state.data.organizationAnalytics=analytics.data||{};state.data.claimableFeeds=claimable.data||[]}}
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
    const applySearch = event.target.closest("[data-apply-search]");
    if (applySearch) {
      const row = (state.data.searches || []).find((item) => item.id === applySearch.dataset.applySearch);
      if (!row) return;
      document.querySelector("#authModal [data-auth-close]")?.click();
      window.dispatchEvent(new CustomEvent("vkluche:apply-saved-search", { detail: row.filters || {} }));
      return;
    }
    const favorite = event.target.closest("[data-remove-favorite]");
    if (favorite) {
      await client
        .from("favorites")
        .delete()
        .eq("listing_id", favorite.dataset.removeFavorite);
      return load();
    }
    const withdraw = event.target.closest("[data-listing-withdraw]");
    if (withdraw) {
      const row=(state.data.listings||[]).find(item=>item.id===withdraw.dataset.listingWithdraw);
      window.openListingWithdrawal?.({listingId:row.id,name:carName(row)},load);
      return;
    }
    const restore = event.target.closest("[data-listing-restore]");
    if (restore) {
      restore.disabled=true;
      const { error } = await client.rpc("restore_listing",{p_listing_id:restore.dataset.listingRestore});
      restore.disabled=false;
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
    const client=window.vklucheAuth?.getClient();if(!client)return;
    const createOrganization=event.target.closest("[data-create-organization]");if(createOrganization){event.preventDefault();const values=new FormData(createOrganization),button=event.submitter;button.disabled=true;const{error}=await client.rpc("create_organization",{p_name:String(values.get("name")||"").trim(),p_inn:String(values.get("inn")||"").trim()});button.disabled=false;if(error)return alert(error.message);window.toast?.("Компания создана");return load()}
    const createBranch=event.target.closest("[data-create-branch]");if(createBranch){event.preventDefault();const values=new FormData(createBranch),button=event.submitter;button.disabled=true;const{error}=await client.from("organization_branches").insert({organization_id:state.data.organization.id,name:String(values.get("name")||"").trim(),city:String(values.get("city")||"").trim(),address:String(values.get("address")||"").trim()});button.disabled=false;if(error)return alert(error.message);return load()}
    const addMember=event.target.closest("[data-add-member]");if(addMember){event.preventDefault();const values=new FormData(addMember),button=event.submitter;button.disabled=true;const{error}=await client.rpc("add_organization_member",{p_organization_id:state.data.organization.id,p_email:String(values.get("email")||"").trim(),p_role:values.get("role")});button.disabled=false;if(error)return alert(error.message);window.toast?.("Сотрудник добавлен");return load()}
    const attachFeed=event.target.closest("[data-attach-feed]");if(attachFeed){event.preventDefault();const values=new FormData(attachFeed);if(!confirm('Привязать фид и все загруженные из него автомобили к этой компании?'))return;const button=event.submitter;button.disabled=true;button.textContent='Привязываем…';const{data,error}=await client.rpc("attach_feed_to_organization",{p_feed_id:values.get("feedId"),p_organization_id:state.data.organization.id,p_branch_id:values.get("branchId")||null});button.disabled=false;button.textContent='Привязать фид и автомобили';if(error)return alert(error.message);window.toast?.(`К компании добавлено автомобилей: ${data}`);return load()}
    const bulk=event.target.closest("[data-bulk-auctions]");if(bulk){event.preventDefault();const values=new FormData(bulk),listingIds=values.getAll("listingIds");if(!listingIds.length)return alert("Выберите автомобили");const button=event.submitter;button.disabled=true;button.textContent="Запускаем…";const{data,error}=await client.rpc("bulk_start_auctions",{p_listing_ids:listingIds,p_duration_minutes:+values.get("duration"),p_bid_step:+values.get("step"),p_winner_mode:values.get("winnerMode"),p_participant_access:"all_verified"});button.disabled=false;button.textContent="Запустить выбранные";if(error)return alert(error.message);window.toast?.(`Запущено аукционов: ${data}`);return load()}
    const form=event.target.closest("[data-verification-form]");if(!form)return;
    event.preventDefault();const auth=window.vklucheAuth;
    const values=new FormData(form),checks={body:values.has("body"),technical:values.has("technical"),legal:values.has("legal"),mileage:values.has("mileage")};
    if(!Object.values(checks).some(Boolean)&&!confirm("Ни один пункт не подтверждён. Всё равно завершить проверку?"))return;
    const button=event.submitter;button.disabled=true;button.textContent="Сохраняем…";
    const{error}=await client.rpc("moderate_listing",{p_listing_id:form.dataset.verificationForm,p_approve:true,p_note:String(values.get("note")||"").trim(),p_checks:checks,p_source:values.get("source")});
    button.disabled=false;button.textContent="Сохранить результат";if(error)return alert(error.message);window.toast?.("Результаты проверки опубликованы");return load();
  });
  content.addEventListener("change",async event=>{const select=event.target.closest("[data-assign-branch]");if(!select||!select.value)return;const{error}=await window.vklucheAuth.getClient().rpc("assign_listing_to_branch",{p_listing_id:select.dataset.assignBranch,p_branch_id:select.value});if(error)return alert(error.message);window.toast?.("Филиал назначен");load()});
  window.addEventListener("vkluche:profile", load);
  window.addEventListener("vkluche:saved-searches-changed", load);
  window.addEventListener("vkluche:dashboard-open", load);
  window.addEventListener("vkluche:dashboard-tab", (event) => {
    state.active = event.detail?.tab || "overview";
    render();
  });
})();
