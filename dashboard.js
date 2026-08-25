(function () {
  const tabs = document.querySelector("#dashboardTabs"),
    content = document.querySelector("#dashboardContent"),
    menuToggle = document.querySelector("#dashboardMenuToggle");
  if (!tabs || !content) return;
  let state = { role: "user", accountType: "private", active: "overview", listingFilter: "all", inventorySearch: "", data: {} };
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
    const unanswered=(state.data.sellerQuestions||[]).filter(q=>!q.viewed_at&&!q.answer).length,
      moderation=(state.data.adminListings||[]).filter(x=>x.verification_status==='submitted').length;
    const result = [
      ["main", "Главное", [["overview", "Главная"]]],
      ["buy", "Покупаю", [["buyer", "Ставки и сделки"],["favorites", "Избранное"],["searches", "Сохранённые поиски"]]],
      ["sell", "Продаю", [["seller", "Мои автомобили"],["seller-auctions", "Мои аукционы"],["questions", "Вопросы покупателей",unanswered]]],
    ];
    if (state.accountType === "professional" || state.role === "admin") result.push(["company", "Компания", [["business", "Обзор компании"],["business-inventory", "Склад"],["business-auctions", "Массовые торги"],["business-feeds", "Фиды"],["business-team", "Филиалы и сотрудники"],["business-analytics", "Аналитика"]]]);
    result.push(["account", "Аккаунт", [["settings", "Настройки"]]]);
    if (state.role === "admin") result.push(["administration", "Администрирование", [["moderation", "Очередь модерации",moderation],["admin", "Управление системой"]]]);
    return result;
  }
  function renderTabs() {
    const allowed = availableTabs();
    if (!allowed.some(([, ,items]) => items.some(([id])=>id===state.active))) state.active = "overview";
    tabs.innerHTML = allowed
      .map(
        ([group, label, items]) =>
          `<div class="dashboard-nav-group" data-dashboard-group="${group}"><span>${label}</span>${items.map(([id,itemLabel,badge])=>`<button type="button" data-dashboard-tab="${id}" class="${state.active === id ? "active" : ""}"><span>${itemLabel}</span>${badge?`<em class="dashboard-nav-badge">${badge}</em>`:''}</button>`).join('')}</div>`,
      )
      .join("");
  }
  const pageHead=(title,description,actions='')=>`<header class="dashboard-page-head"><div><h3>${esc(title)}</h3><p>${esc(description)}</p></div>${actions}</header>`;
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
    const recent = (d.deals || []).slice(0, 3),unanswered=(d.sellerQuestions||[]).filter(q=>!q.answer).length,rejected=listings.filter(x=>x.status==='rejected').length,feedErrors=(d.organizationFeeds||[]).filter(x=>x.last_status==='error').length,sellerChoice=auctions.filter(x=>x.status==='awaiting_seller').length,tasks=[];
    if(unanswered)tasks.push([`${unanswered} ${unanswered===1?'вопрос ждёт':'вопроса ждут'} ответа`,'Покупатели ожидают ответа по вашим аукционам','questions','urgent']);
    if(sellerChoice)tasks.push([`Выбрать победителя: ${sellerChoice}`,'Торги завершены — примите решение по предложениям','seller-auctions','urgent']);
    if(rejected)tasks.push([`Исправить объявления: ${rejected}`,'Есть замечания модерации','seller','']);
    if(feedErrors)tasks.push([`Ошибки фидов: ${feedErrors}`,'Проверьте причину последней загрузки','business-feeds','']);
    if(state.role==='admin'&&pending)tasks.push([`Проверить автомобили: ${pending}`,'Очередь ожидает решения администратора','moderation','urgent']);
    content.innerHTML = `${pageHead('Главная','Главные показатели и действия, которые требуют внимания')}<section class="dashboard-block"><div class="dashboard-block-head"><h3>Требуют внимания</h3><span>${tasks.length}</span></div>${tasks.length?tasks.map(t=>`<article class="dashboard-row dashboard-task ${t[3]}"><span><b>${esc(t[0])}</b><small>${esc(t[1])}</small></span><button type="button" data-dashboard-jump="${t[2]}">Перейти</button></article>`).join(''):empty('Сейчас обязательных действий нет.')}</section><div class="dashboard-stats">${stats}</div><div class="dashboard-quick-actions"><button type="button" data-dashboard-sell><b>+ Разместить автомобиль</b></button><button type="button" data-dashboard-jump="seller"><b>Управлять объявлениями</b></button><button type="button" data-dashboard-notifications><b>Настроить уведомления</b></button></div><section class="dashboard-block"><div class="dashboard-block-head"><h3>Последние результаты</h3></div>${recent.length ? recent.map((deal) => `<article class="dashboard-row"><span><b>${deal.status === "confirmed" ? "Покупка подтверждена" : "Предложение по аукциону"}</b><small>${rub(deal.amount)} · ${date(deal.created_at)}</small></span><em class="status ${deal.status}">${esc(deal.status === "confirmed" ? "Подтверждено" : deal.status === "awaiting_buyer" ? "Нужен ответ" : "Завершено")}</em></article>`).join("") : empty("Результаты появятся после участия в аукционе.")}</section>`;
  }
  function renderBuyer() {
    const bids = state.data.bids || [],
      deals = state.data.deals || [];
    content.innerHTML = `${pageHead('Ставки и сделки','Ваше участие в торгах и решения по результатам')}<section class="dashboard-block"><div class="dashboard-block-head"><h3>Мои ставки</h3><span>${bids.length}</span></div>${
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
    content.innerHTML = `${pageHead('Сохранённые поиски','Ваши подборки и правила уведомлений')}<section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Поиски</h3><small>Откройте подборку или удалите ненужную</small></div><span>${rows.length}</span></div>${rows.length ? rows.map((search) => `<article class="dashboard-row"><span><b>${esc(search.name)}</b><small class="saved-search-description">${esc(searchDescription(search))}</small><small>${esc(searchNotifications(search))}</small></span><div class="saved-search-actions"><button type="button" data-apply-search="${search.id}">Показать</button><button type="button" data-delete-search="${search.id}">Удалить</button></div></article>`).join("") : empty("Настройте параметры в каталоге и нажмите «Сохранить поиск».")}</section>`;
  }
  function renderFavorites() {
    const rows = state.data.favorites || [];
    content.innerHTML = `${pageHead('Избранное','Автомобили, к которым вы хотите вернуться')}<section class="dashboard-block"><div class="dashboard-block-head"><h3>Избранные автомобили</h3><span>${rows.length}</span></div>${rows.length ? rows.map((item) => `<article class="dashboard-car" data-open-listing="${item.listing_id}">${carImage(item.listings) ? `<img src="${esc(carImage(item.listings))}" alt="">` : ""}<span><b>${esc(carName(item.listings))}</b><small>${rub(item.listings?.data?.price)} · ${esc(item.listings?.data?.city || "")}</small></span><button type="button" data-remove-favorite="${item.listing_id}">Удалить</button></article>`).join("") : empty("Добавляйте автомобили сердечком в каталоге.")}</section>`;
  }
  function renderSeller() {
    const listings = state.data.listings || [],
      auctions = state.data.sellerAuctions || [],filtered=listings.filter(row=>state.listingFilter==='all'||(state.listingFilter==='active'?row.active:state.listingFilter==='moderation'?row.status==='pending'||row.verification_status==='submitted':state.listingFilter==='inactive'?!row.active&&!['draft','pending'].includes(row.status):row.status===state.listingFilter));
    content.innerHTML = `${pageHead('Мои автомобили','Публикация, редактирование и статусы объявлений','<button type="button" class="primary-btn" data-dashboard-sell>+ Разместить</button>')}<section class="dashboard-block"><div class="dashboard-status-tabs">${[['all','Все',listings.length],['active','Опубликованы',listings.filter(x=>x.active).length],['moderation','На проверке',listings.filter(x=>x.status==='pending'||x.verification_status==='submitted').length],['draft','Черновики',listings.filter(x=>x.status==='draft').length],['inactive','Снятые и архив',listings.filter(x=>!x.active&&!['draft','pending'].includes(x.status)).length]].map(x=>`<button type="button" data-listing-filter="${x[0]}" class="${state.listingFilter===x[0]?'active':''}">${x[1]} · ${x[2]}</button>`).join('')}</div>${filtered.length ? filtered.map((row) => {const feed=Boolean(row.source_id||['automatic-feed','avito-feed'].includes(row.data?.source)),lockedAuction=auctions.some(a=>a.listing_id===row.id&&['scheduled','active'].includes(a.status));return`<article class="dashboard-car" data-open-listing="${row.id}">${carImage(row) ? `<img src="${esc(carImage(row))}" alt="">` : ""}<span><b>${esc(carName(row))}</b><small>${esc(listingLabels[row.status] || row.status)} · ${esc(verifyLabels[row.verification_status] || "")}${feed?' · управляется фидом':lockedAuction?' · идут торги':''}</small></span><div class="dashboard-listing-actions">${!feed&&!lockedAuction?`<button type="button" data-listing-edit="${row.id}">Редактировать</button>`:''}${row.active?`<button type="button" data-listing-withdraw="${row.id}">Снять</button>`:row.status==='archived'?`<button type="button" data-listing-restore="${row.id}">Вернуть</button>`:`<em>${esc(listingLabels[row.status]||row.status)}</em>`}</div></article>`}).join("") : empty("В этом разделе автомобилей нет.")}</section>`;
  }
  function renderSellerAuctions(){const auctions=state.data.sellerAuctions||[],active=auctions.filter(a=>['scheduled','active','awaiting_seller','awaiting_buyer'].includes(a.status)),archive=auctions.filter(a=>!active.includes(a)),row=(a,archived=false)=>{const m=a.metrics||{},winner=m.winner_selected?`Победитель определён${m.winner_amount?` · ${rub(m.winner_amount)}`:''}`:'Победитель не определён';return`<article class="dashboard-row auction-stat-row" data-open-listing="${a.listing_id}"><span><b>${esc(carName(a.listings))}</b><small>${m.unique_views||0} уникальных просмотров · ${m.bid_count||0} ставок${archived?` · ${winner}`:''}</small><small>${rub(a.start_price)} · ${date(a.created_at)}</small></span><em>${esc(auctionLabels[a.status]||a.status)}</em></article>`};content.innerHTML=`${pageHead('Мои аукционы','Действующие торги, решения и архив результатов')}<section class="dashboard-block"><div class="dashboard-block-head"><h3>В работе</h3><span>${active.length}</span></div>${active.length?active.map(a=>row(a)).join(''):empty('Запустить аукцион можно из карточки своего автомобиля.')}</section><section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Архив</h3><small>Просмотры, ставки, победитель и результат</small></div><span>${archive.length}</span></div>${archive.length?archive.map(a=>row(a,true)).join(''):empty('Завершённые аукционы появятся здесь.')}</section>`}
  function renderQuestions() {
    const rows=[...(state.data.sellerQuestions||[])].sort((a,b)=>Number(Boolean(a.answer))-Number(Boolean(b.answer))||new Date(b.created_at)-new Date(a.created_at)),pending=rows.filter(q=>!q.answer);
    content.innerHTML=`${pageHead('Вопросы покупателей','Обращения из сайта, Telegram и MAX')}<section class="dashboard-block seller-questions"><div class="dashboard-block-head"><div><h3>Все вопросы</h3><small>Сначала показаны обращения, ожидающие ответа</small></div><span>${pending.length} без ответа</span></div>${rows.length?rows.map(q=>{const listing=q.auctions?.listings,name=carName(listing),status=q.answer?'Получен ответ':q.viewed_at?'Просмотрен продавцом':'Доставлен продавцу';return`<article class="dashboard-row question-row${!q.viewed_at&&!q.answer?' unread':''}" data-question-row="${q.id}"><span><b>${esc(name)}</b><p>${esc(q.question)}</p><small>${date(q.created_at)} · ${status}</small>${q.answer?`<blockquote><b>Ваш ответ</b><br>${esc(q.answer)}</blockquote>`:''}</span><div class="saved-search-actions"><button type="button" data-open-question="${q.id}" data-listing-id="${q.auctions?.listing_id||''}">Открыть автомобиль</button>${!q.answer?`<button type="button" data-answer-dashboard-question="${q.id}">Ответить</button>`:''}</div></article>`}).join(''):empty('Новые вопросы по вашим аукционам появятся здесь.')}</section>`;
  }
  function renderBusiness() {
    const d=state.data,organization=d.organization;
    if(!organization){content.innerHTML=`<section class="dashboard-block business-onboarding"><span class="eyebrow blue">ПРОФЕССИОНАЛЬНЫЙ КАБИНЕТ</span><h3>Создайте профиль компании</h3><p>Объедините склад, филиалы, сотрудников, фиды и аукционы в одном кабинете.</p><form data-create-organization><label>Название компании<input name="name" required minlength="2" maxlength="160" placeholder="Например, Автоцентр Самара"></label><label>ИНН<input name="inn" inputmode="numeric" maxlength="12" placeholder="Необязательно"></label><button class="primary-btn" type="submit">Создать компанию</button></form></section>`;return}
    const analytics=d.organizationAnalytics||{},branches=d.organizationBranches||[],members=d.organizationMembers||[],inventory=d.organizationListings||[],feeds=d.organizationFeeds||[],claimableFeeds=d.claimableFeeds||[],unassigned=(d.listings||[]).filter(row=>!row.organization_id);
    content.innerHTML=`${pageHead(organization.name,'Общее состояние компании и быстрый переход к рабочим разделам')}<div class="dashboard-stats">${stat(analytics.inventory||0,'автомобилей на складе')}${stat(analytics.active_listings||0,'опубликовано')}${stat(analytics.active_auctions||0,'аукционов в работе')}${stat(analytics.confirmed_deals||0,'подтверждённых сделок')}${stat(rub(analytics.revenue||0),'сумма сделок')}${stat(analytics.participants||0,'участников')}</div><div class="dashboard-settings-grid"><button type="button" data-dashboard-jump="business-inventory"><b>Склад</b><small>Автомобили и филиалы</small></button><button type="button" data-dashboard-jump="business-auctions"><b>Массовые торги</b><small>Запуск нескольких лотов</small></button><button type="button" data-dashboard-jump="business-feeds"><b>Фиды</b><small>${feeds.filter(x=>x.last_status==='error').length?`${feeds.filter(x=>x.last_status==='error').length} с ошибкой`:`${feeds.length} источников`}</small></button><button type="button" data-dashboard-jump="business-team"><b>Команда</b><small>${members.length} сотрудников · ${branches.length} филиалов</small></button><button type="button" data-dashboard-jump="business-analytics"><b>Аналитика</b><small>Сделки и показатели</small></button></div>`;return;
    content.innerHTML=`<div class="business-heading"><div><span class="eyebrow blue">КОМПАНИЯ</span><h3>${esc(organization.name)}</h3><small>${esc(organization.inn?`ИНН ${organization.inn}`:'Профессиональный профиль')}</small></div><em>${esc(d.organizationRole||'viewer')}</em></div><div class="dashboard-stats">${stat(analytics.inventory||0,'автомобилей на складе')}${stat(analytics.active_listings||0,'опубликовано')}${stat(analytics.active_auctions||0,'аукционов в работе')}${stat(analytics.confirmed_deals||0,'подтверждённых сделок')}${stat(rub(analytics.revenue||0),'сумма сделок')}${stat(analytics.participants||0,'участников')}</div><section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Филиалы</h3><small>Площадки хранения и осмотра автомобилей</small></div><span>${branches.length}</span></div><div class="business-grid">${branches.map(branch=>`<article><b>${esc(branch.name)}</b><small>${esc(branch.city)} · ${esc(branch.address||'адрес не указан')}</small></article>`).join('')||empty('Добавьте первую площадку.')}<form data-create-branch><input name="name" required placeholder="Название филиала"><input name="city" required placeholder="Город"><input name="address" required placeholder="Адрес"><button type="submit">+ Добавить филиал</button></form></div></section>${unassigned.length?`<section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Добавить свои объявления на склад</h3><small>Назначьте автомобилю филиал компании</small></div><span>${unassigned.length}</span></div>${unassigned.map(row=>`<article class="dashboard-row"><span><b>${esc(carName(row))}</b><small>${rub(row.data?.price)}</small></span><select data-assign-branch="${row.id}"><option value="">Выберите филиал</option>${branches.map(branch=>`<option value="${branch.id}">${esc(branch.name)}</option>`).join('')}</select></article>`).join('')}</section>`:''}<section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Сотрудники</h3><small>Владелец, администратор, менеджер или наблюдатель</small></div><span>${members.length}</span></div>${members.map(member=>`<article class="dashboard-row"><span><b>${esc(member.name||member.email||member.user_id)}</b><small>${esc(member.email||'')} · ${esc(member.member_role)}</small></span></article>`).join('')}<form class="business-inline-form" data-add-member><input name="email" type="email" required placeholder="Почта зарегистрированного сотрудника"><select name="role"><option value="manager">Менеджер</option><option value="administrator">Администратор</option><option value="viewer">Наблюдатель</option></select><button type="submit">Добавить</button></form></section><section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Общий склад и массовые торги</h3><small>Выберите автомобили без активного аукциона</small></div><span>${inventory.length}</span></div><form data-bulk-auctions><div class="bulk-inventory">${inventory.map(row=>`<label><input type="checkbox" name="listingIds" value="${row.id}"><img src="${esc(carImage(row))}" alt=""><span><b>${esc(carName(row))}</b><small>${rub(row.data?.price)} · ${esc(row.organization_branches?.name||'Без филиала')}</small></span><select data-assign-branch="${row.id}"><option value="">Филиал</option>${branches.map(branch=>`<option value="${branch.id}"${row.branch_id===branch.id?' selected':''}>${esc(branch.name)}</option>`).join('')}</select></label>`).join('')||empty('Добавьте автомобили компании или назначьте свои объявления филиалу.')}</div><div class="bulk-settings"><select name="duration"><option value="1440">24 часа</option><option value="720">12 часов</option><option value="2880">48 часов</option></select><select name="step"><option value="10000">Шаг 10 000 ₽</option><option value="25000">Шаг 25 000 ₽</option><option value="50000">Шаг 50 000 ₽</option></select><select name="winnerMode"><option value="highest">Максимальная ставка</option><option value="seller_choice">Выбор продавца</option></select><button type="submit">Запустить выбранные</button></div></form></section><section class="dashboard-block" data-organization-feeds><div class="dashboard-block-head"><div><h3>Автоматические фиды</h3><small>Источники общего склада организации</small></div><span>${feeds.length}</span></div>${feeds.map(feed=>`<article class="dashboard-row"><span><b>${esc(feed.name)}</b><small>${esc(feed.last_status||'Ожидает запуска')} · каждые ${feed.interval_minutes} мин.</small></span></article>`).join('')||empty('Добавление источника доступно через раздел «Загрузить фид».')}</section><section class="dashboard-block"><div class="dashboard-block-head"><h3>Результаты по филиалам</h3></div>${(analytics.branches||[]).map(branch=>`<article class="dashboard-row"><span><b>${esc(branch.name)}</b><small>${esc(branch.city)} · склад ${branch.inventory} · аукционы ${branch.auctions}</small></span><em>${branch.deals} сделок</em></article>`).join('')||empty('Данные появятся после добавления филиалов.')}</section>`;
    const feedBox=content.querySelector('[data-organization-feeds]'),canManageFeeds=state.role==='admin'||['owner','administrator','manager'].includes(d.organizationRole);if(feedBox)feedBox.innerHTML=`<div class="dashboard-block-head"><div><h3>Автоматические фиды</h3><small>Источники общего склада организации</small></div><span>${feeds.length}</span></div>${feeds.map(feed=>{const status=feed.last_status==='success'?'success':feed.last_status==='error'?'error':'pending',label=status==='success'?'Загружен успешно':status==='error'?'Ошибка загрузки':'Ожидает первого запуска',last=feed.last_run_at?new Date(feed.last_run_at).toLocaleString('ru-RU'):'ещё не запускался',next=feed.last_run_at?new Date(new Date(feed.last_run_at).getTime()+feed.interval_minutes*60000).toLocaleString('ru-RU'):`в течение ${feed.interval_minutes} мин.`;return`<article class="company-feed-card ${status}"><div><b>${esc(feed.name)}</b><span class="company-feed-status">${label}</span><small>Последняя попытка: ${last}</small><small>Следующая попытка: ${next}</small>${feed.last_error?`<p><b>Причина:</b> ${esc(feed.last_error)}</p>`:''}</div>${canManageFeeds?`<button type="button" data-dashboard-sync-feed="${feed.id}">Повторить сейчас</button>`:''}</article>`}).join('')||empty('Добавление источника доступно через раздел «Загрузить фид».')}`;
    if(claimableFeeds.length)content.querySelector('[data-organization-feeds]').insertAdjacentHTML('beforebegin',`<section class="dashboard-block feed-attach-block"><div class="dashboard-block-head"><div><h3>Привязать существующий фид</h3><small>Все уже загруженные автомобили перейдут на склад ${esc(organization.name)}</small></div></div><form data-attach-feed><label>Источник<select name="feedId" required>${claimableFeeds.map(feed=>`<option value="${feed.id}">${esc(feed.name)} · ${feed.listing_count} автомобилей</option>`).join('')}</select></label><label>Филиал<select name="branchId"><option value="">Без филиала</option>${branches.map(branch=>`<option value="${branch.id}">${esc(branch.name)}</option>`).join('')}</select></label><button type="submit">Привязать фид и автомобили</button></form></section>`);
  }
  function organizationData(){const d=state.data;return{d,organization:d.organization,analytics:d.organizationAnalytics||{},branches:d.organizationBranches||[],members:d.organizationMembers||[],inventory:d.organizationListings||[],feeds:d.organizationFeeds||[],claimableFeeds:d.claimableFeeds||[],unassigned:(d.listings||[]).filter(row=>!row.organization_id)}}
  function requireOrganization(){if(state.data.organization)return true;renderBusiness();return false}
  function renderBusinessInventory(){if(!requireOrganization())return;const{organization,branches,inventory,unassigned}=organizationData(),q=state.inventorySearch.trim().toLowerCase(),rows=inventory.filter(row=>!q||carName(row).toLowerCase().includes(q)||String(row.data?.vin||'').toLowerCase().includes(q));content.innerHTML=`${pageHead('Склад компании',`${organization.name} · все автомобили организации`,'<div class="dashboard-tools"><input data-inventory-search placeholder="Марка, модель или VIN" value="'+esc(state.inventorySearch)+'"></div>')}${unassigned.length?`<section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Добавить свои объявления</h3><small>Назначьте автомобилю филиал компании</small></div><span>${unassigned.length}</span></div>${unassigned.map(row=>`<article class="dashboard-row"><span><b>${esc(carName(row))}</b><small>${rub(row.data?.price)}</small></span><select data-assign-branch="${row.id}"><option value="">Выберите филиал</option>${branches.map(branch=>`<option value="${branch.id}">${esc(branch.name)}</option>`).join('')}</select></article>`).join('')}</section>`:''}<section class="dashboard-block"><div class="dashboard-block-head"><h3>Автомобили</h3><span>${rows.length}</span></div>${rows.map(row=>`<article class="dashboard-car" data-open-listing="${row.id}">${carImage(row)?`<img src="${esc(carImage(row))}" alt="">`:''}<span><b>${esc(carName(row))}</b><small>${rub(row.data?.price)} · ${esc(row.organization_branches?.name||'Без филиала')} · ${esc(listingLabels[row.status]||row.status)}</small></span><select data-assign-branch="${row.id}"><option value="">Филиал</option>${branches.map(branch=>`<option value="${branch.id}"${row.branch_id===branch.id?' selected':''}>${esc(branch.name)}</option>`).join('')}</select></article>`).join('')||empty('На складе пока нет автомобилей.')}</section>`}
  function renderBusinessAuctions(){if(!requireOrganization())return;const{organization,branches,inventory}=organizationData();content.innerHTML=`${pageHead('Массовые торги',`${organization.name} · запуск нескольких автомобилей на единых условиях`)}<section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Выберите автомобили</h3><small>Недоступные для запуска лоты будут пропущены с пояснением</small></div><span>${inventory.length}</span></div><form data-bulk-auctions><div class="bulk-inventory">${inventory.map(row=>`<label><input type="checkbox" name="listingIds" value="${row.id}"><img src="${esc(carImage(row))}" alt=""><span><b>${esc(carName(row))}</b><small>${rub(row.data?.price)} · ${esc(row.organization_branches?.name||'Без филиала')}</small></span><select data-assign-branch="${row.id}"><option value="">Филиал</option>${branches.map(branch=>`<option value="${branch.id}"${row.branch_id===branch.id?' selected':''}>${esc(branch.name)}</option>`).join('')}</select></label>`).join('')||empty('Добавьте автомобили на склад компании.')}</div><div class="bulk-settings"><select name="duration"><option value="1440">24 часа</option><option value="720">12 часов</option><option value="2880">48 часов</option></select><select name="step"><option value="10000">Шаг 10 000 ₽</option><option value="25000">Шаг 25 000 ₽</option><option value="50000">Шаг 50 000 ₽</option></select><select name="winnerMode"><option value="highest">Максимальная ставка</option><option value="seller_choice">Выбор продавца</option></select><button type="submit">Запустить выбранные</button></div></form></section>`}
  function renderBusinessFeeds(){if(!requireOrganization())return;const{organization,branches,feeds,claimableFeeds,d}=organizationData(),canManage=state.role==='admin'||['owner','administrator','manager'].includes(d.organizationRole);content.innerHTML=`${pageHead('Фиды',`${organization.name} · автоматические источники склада`,'<button type="button" class="primary-btn open-feed">+ Добавить фид</button>')}${claimableFeeds.length?`<section class="dashboard-block feed-attach-block"><div class="dashboard-block-head"><div><h3>Привязать существующий фид</h3><small>Доступны только подтверждённые источники</small></div></div><form data-attach-feed><label>Источник<select name="feedId" required>${claimableFeeds.map(feed=>`<option value="${feed.id}">${esc(feed.name)} · ${feed.listing_count} автомобилей</option>`).join('')}</select></label><label>Филиал<select name="branchId"><option value="">Без филиала</option>${branches.map(branch=>`<option value="${branch.id}">${esc(branch.name)}</option>`).join('')}</select></label><button type="submit">Привязать фид и автомобили</button></form></section>`:''}<section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Автоматические фиды</h3><small>Статус и расписание обновлений</small></div><span>${feeds.length}</span></div>${feeds.map(feed=>{const status=feed.last_status==='success'?'success':feed.last_status==='error'?'error':'pending',label=status==='success'?'Загружен успешно':status==='error'?'Ошибка загрузки':'Ожидает первого запуска',last=feed.last_run_at?new Date(feed.last_run_at).toLocaleString('ru-RU'):'ещё не запускался',next=feed.last_run_at?new Date(new Date(feed.last_run_at).getTime()+feed.interval_minutes*60000).toLocaleString('ru-RU'):`в течение ${feed.interval_minutes} мин.`;return`<article class="company-feed-card ${status}"><div><b>${esc(feed.name)}</b><span class="company-feed-status">${label}</span><small>Последняя попытка: ${last}</small><small>Следующая попытка: ${next}</small>${feed.last_error?`<p><b>Причина:</b> ${esc(feed.last_error)}</p>`:''}</div>${canManage?`<button type="button" data-dashboard-sync-feed="${feed.id}">Повторить сейчас</button>`:''}</article>`}).join('')||empty('Добавьте первый источник через кнопку выше.')}</section>`}
  function renderBusinessTeam(){if(!requireOrganization())return;const{organization,branches,members}=organizationData();content.innerHTML=`${pageHead('Филиалы и сотрудники',`${organization.name} · структура и права доступа`)}<section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Филиалы</h3><small>Площадки хранения и осмотра</small></div><span>${branches.length}</span></div><div class="business-grid">${branches.map(branch=>`<article><b>${esc(branch.name)}</b><small>${esc(branch.city)} · ${esc(branch.address||'адрес не указан')}</small></article>`).join('')||empty('Добавьте первую площадку.')}<form data-create-branch><input name="name" required placeholder="Название филиала"><input name="city" required placeholder="Город"><input name="address" required placeholder="Адрес"><button type="submit">+ Добавить филиал</button></form></div></section><section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Сотрудники</h3><small>Управляйте доступом к складу и торгам</small></div><span>${members.length}</span></div>${members.map(member=>`<article class="dashboard-row"><span><b>${esc(member.name||member.email||member.user_id)}</b><small>${esc(member.email||'')} · ${esc(member.member_role)}</small></span></article>`).join('')}<form class="business-inline-form" data-add-member><input name="email" type="email" required placeholder="Почта зарегистрированного сотрудника"><select name="role"><option value="manager">Менеджер</option><option value="administrator">Администратор</option><option value="viewer">Наблюдатель</option></select><button type="submit">Добавить</button></form></section>`}
  function renderBusinessAnalytics(){if(!requireOrganization())return;const{organization,analytics}=organizationData();content.innerHTML=`${pageHead('Аналитика компании',`${organization.name} · склад, торги и результаты`)}<div class="dashboard-stats">${stat(analytics.inventory||0,'автомобилей на складе')}${stat(analytics.active_listings||0,'опубликовано')}${stat(analytics.active_auctions||0,'аукционов в работе')}${stat(analytics.confirmed_deals||0,'подтверждённых сделок')}${stat(rub(analytics.revenue||0),'сумма сделок')}${stat(analytics.participants||0,'участников')}</div><section class="dashboard-block"><div class="dashboard-block-head"><h3>Результаты по филиалам</h3></div>${(analytics.branches||[]).map(branch=>`<article class="dashboard-row"><span><b>${esc(branch.name)}</b><small>${esc(branch.city)} · склад ${branch.inventory} · аукционы ${branch.auctions}</small></span><em>${branch.deals} сделок</em></article>`).join('')||empty('Данные появятся после добавления филиалов.')}</section>`}
  function renderSettings(){content.innerHTML=`${pageHead('Настройки аккаунта','Профиль, каналы связи, безопасность и помощь')}<div class="dashboard-settings-grid"><button type="button" data-dashboard-notifications><b>Уведомления</b><small>Email, Telegram, MAX и события сайта</small></button><button type="button" data-dashboard-privacy><b>Персональные данные</b><small>Согласия и запросы по данным</small></button><button type="button" data-dashboard-help><b>Помощь и поддержка</b><small>Инструкции и обращения</small></button></div>`}
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
    const organizations=d.allOrganizations||[],unassignedFeeds=d.unassignedFeeds||[];content.insertAdjacentHTML('beforeend',`<section class="dashboard-block feed-admin-assignment"><div class="dashboard-block-head"><div><h3>Принадлежность существующих фидов</h3><small>Только системный администратор может передать ранее загруженный источник организации</small></div><span>${unassignedFeeds.length}</span></div>${unassignedFeeds.length&&organizations.length?`<form data-admin-attach-feed><label>Непривязанный фид<select name="feedId">${unassignedFeeds.map(feed=>`<option value="${feed.id}">${esc(feed.name)} · ${feed.listing_count} автомобилей</option>`).join('')}</select></label><label>Организация<select name="organizationId">${organizations.map(org=>`<option value="${org.id}">${esc(org.name)}</option>`).join('')}</select></label><button type="submit">Привязать</button></form>`:empty(unassignedFeeds.length?'Сначала должна быть создана организация.':'Все существующие фиды уже распределены.')}</section>`);
    const tickets=d.supportTickets||[],events=d.helpEvents||[];content.insertAdjacentHTML('beforeend',`<section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Обращения в поддержку</h3><small>Вопросы пользователей из центра помощи</small></div><span>${tickets.filter(x=>!['closed','answered'].includes(x.status)).length}</span></div>${tickets.map(t=>`<article class="dashboard-row"><span><b>${esc(t.subject)}</b><small>${esc(t.message)} · ${date(t.created_at)}</small></span><select data-support-status="${t.id}"><option value="new"${t.status==='new'?' selected':''}>Новое</option><option value="in_progress"${t.status==='in_progress'?' selected':''}>В работе</option><option value="answered"${t.status==='answered'?' selected':''}>Ответ дан</option><option value="closed"${t.status==='closed'?' selected':''}>Закрыто</option></select></article>`).join('')||empty('Новых обращений нет.')}</section><section class="dashboard-block"><div class="dashboard-block-head"><div><h3>Использование помощи</h3><small>События за последние 30 дней</small></div><span>${events.length}</span></div>${Object.entries(events.reduce((a,x)=>(a[x.event_type]=(a[x.event_type]||0)+1,a),{})).map(([k,v])=>`<article class="dashboard-row"><span><b>${esc(k)}</b></span><em>${v}</em></article>`).join('')||empty('Справкой пока не пользовались.')}</section>`);
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
        "seller-auctions": renderSellerAuctions,
        questions: renderQuestions,
        business: renderBusiness,
        "business-inventory": renderBusinessInventory,
        "business-auctions": renderBusinessAuctions,
        "business-feeds": renderBusinessFeeds,
        "business-team": renderBusinessTeam,
        "business-analytics": renderBusinessAnalytics,
        settings: renderSettings,
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
      const questionQuery=client.from("auction_questions").select("id,auction_id,author_id,question,answer,created_at,viewed_at,answered_at,auctions!inner(id,listing_id,seller_id,listings(data))").order("created_at",{ascending:false});
      if(state.role!=="admin")questionQuery.eq("auctions.seller_id",user.id);
      const auctionQuery=client.from("auctions").select("id,status,start_price,created_at,listing_id,listings(data)").order("created_at",{ascending:false});
      if(state.role!=="admin")auctionQuery.eq("seller_id",user.id);
      const [listings, auctions, questions, metrics] = await Promise.all([
        client
          .from("listings")
          .select("id,data,status,verification_status,active,updated_at,organization_id,branch_id")
          .eq("owner_id", user.id)
          .order("updated_at", { ascending: false }),
        auctionQuery,
        questionQuery,
        client.rpc("auction_private_metrics"),
      ]);
      state.data.listings = (listings.data || []).map(row=>!row.active&&row.status==='published'?{...row,status:'archived'}:row);
      const metricMap=new Map((metrics.data||[]).map(m=>[m.auction_id,m]));state.data.sellerAuctions = (auctions.data||[]).map(a=>({...a,metrics:metricMap.get(a.id)||{}}));
      state.data.sellerQuestions = questions.data || [];
    }
    if (state.accountType === "professional" || state.role === "admin") {
      const membership=await client.from("organization_members").select("organization_id,member_role,organizations(*)").eq("user_id",user.id).eq("active",true).limit(1).maybeSingle();
      const member=membership.data;if(member?.organizations){state.data.organization=member.organizations;state.data.organizationRole=member.member_role;const orgId=member.organization_id;const[branches,members,inventory,feeds,analytics,claimable]=await Promise.all([client.from("organization_branches").select("*").eq("organization_id",orgId).order("name"),client.rpc("organization_member_directory",{p_organization_id:orgId}),client.from("listings").select("id,data,status,active,branch_id,organization_branches(name)").eq("organization_id",orgId).order("updated_at",{ascending:false}),client.from("feed_sources").select("*").eq("organization_id",orgId).order("created_at",{ascending:false}),client.rpc("organization_auction_analytics",{p_organization_id:orgId}),client.rpc("claimable_feed_sources",{p_organization_id:orgId})]);state.data.organizationBranches=branches.data||[];state.data.organizationMembers=members.data||[];state.data.organizationListings=inventory.data||[];state.data.organizationFeeds=feeds.data||[];state.data.organizationAnalytics=analytics.data||{};state.data.claimableFeeds=claimable.data||[]}}
    if (state.role === "admin") {
      const [listings, profiles, auctions, organizations, unassignedFeeds, supportTickets, helpEvents] = await Promise.all([
        client
          .from("listings")
          .select(
            "id,data,status,verification_status,verification_checks,vin,active,updated_at,owner_id",
          )
          .order("updated_at", { ascending: false }),
        client.from("profiles").select("id,role,account_type,created_at"),
        client.from("auctions").select("id,status"),
        client.from("organizations").select("id,name,inn").order("name"),
        client.rpc("admin_unassigned_feed_sources"),
        client.from("support_tickets").select("*").order("created_at",{ascending:false}).limit(50),
        client.from("help_events").select("event_type,topic,created_at").gte("created_at",new Date(Date.now()-30*86400000).toISOString()).limit(1000),
      ]);
      state.data.adminListings = listings.data || [];
      state.data.profiles = profiles.data || [];
      state.data.adminAuctions = auctions.data || [];
      state.data.allOrganizations = organizations.data || [];
      state.data.unassignedFeeds = unassignedFeeds.data || [];
      state.data.supportTickets = supportTickets.data || [];
      state.data.helpEvents = helpEvents.data || [];
    }
    render();
  }

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-dashboard-tab]");
    if (!button) return;
    state.active = button.dataset.dashboardTab;
    tabs.classList.remove('open');
    menuToggle?.setAttribute('aria-expanded','false');
    render();
  });
  menuToggle?.addEventListener('click',()=>{const open=tabs.classList.toggle('open');menuToggle.setAttribute('aria-expanded',String(open))});
  content.addEventListener("click", async (event) => {
    const auth = window.vklucheAuth,
      client = auth?.getClient();
    if (!client) return;
    const jump=event.target.closest('[data-dashboard-jump]');
    if(jump){state.active=jump.dataset.dashboardJump;return render()}
    const listingFilter=event.target.closest('[data-listing-filter]');
    if(listingFilter){state.listingFilter=listingFilter.dataset.listingFilter;return renderSeller()}
    if(event.target.closest('[data-dashboard-notifications]')){document.querySelector('#authModal [data-auth-close]')?.click();document.querySelector('#notificationBell')?.click();return}
    if(event.target.closest('[data-dashboard-privacy]')){document.querySelector('[data-open-privacy]')?.click();return}
    if(event.target.closest('[data-dashboard-help]')){document.querySelector('#authModal [data-auth-close]')?.click();window.vklucheHelp?.open?.();return}
    if(event.target.closest('.open-feed')){document.querySelector('#authModal [data-auth-close]')?.click();document.querySelector('.more-nav .open-feed')?.click();return}
    const open = event.target.closest("[data-open-listing]");
    if (open && !event.target.closest("button")) {
      window.dispatchEvent(
        new CustomEvent("vkluche:open-listing", {
          detail: { listingId: open.dataset.openListing },
        }),
      );
      return;
    }
    const openQuestion=event.target.closest("[data-open-question]");
    if(openQuestion){await client.rpc("mark_auction_question_viewed",{p_question_id:openQuestion.dataset.openQuestion});document.querySelector("#authModal [data-auth-close]")?.click();window.dispatchEvent(new CustomEvent("vkluche:open-listing",{detail:{listingId:openQuestion.dataset.listingId}}));setTimeout(()=>window.dispatchEvent(new CustomEvent("vkluche:focus-auction-question",{detail:{questionId:openQuestion.dataset.openQuestion}})),500);return}
    const answerQuestion=event.target.closest("[data-answer-dashboard-question]");
    if(answerQuestion){const answer=prompt("Ответ покупателю");if(!answer?.trim())return;answerQuestion.disabled=true;const{error}=await client.rpc("answer_auction_question",{p_question_id:answerQuestion.dataset.answerDashboardQuestion,p_answer:answer.trim()});if(error){answerQuestion.disabled=false;return window.toast?.(error.message)}window.toast?.("Ответ отправлен покупателю");return load()}
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
    const edit=event.target.closest("[data-listing-edit]");
    if(edit){document.querySelector("#authModal [data-auth-close]")?.click();window.dispatchEvent(new CustomEvent("vkluche:edit-listing",{detail:{listingId:edit.dataset.listingEdit}}));return}
    const syncFeed=event.target.closest("[data-dashboard-sync-feed]");
    if(syncFeed){syncFeed.disabled=true;syncFeed.textContent="Загружаем…";const{data,error}=await client.functions.invoke("import-feeds",{body:{sourceId:syncFeed.dataset.dashboardSyncFeed}});if(error||data?.results?.[0]?.error){syncFeed.disabled=false;syncFeed.textContent="Повторить сейчас";return window.toast?.(`Ошибка загрузки: ${data?.results?.[0]?.error||error.message}`)}window.toast?.(`Фид обновлён. Обработано автомобилей: ${data?.results?.[0]?.total||0}`);return load()}
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
  content.addEventListener('input',event=>{const input=event.target.closest('[data-inventory-search]');if(!input)return;state.inventorySearch=input.value;renderBusinessInventory();const next=content.querySelector('[data-inventory-search]');next?.focus();next?.setSelectionRange(state.inventorySearch.length,state.inventorySearch.length)});
  content.addEventListener("submit",async(event)=>{
    const client=window.vklucheAuth?.getClient();if(!client)return;
    const createOrganization=event.target.closest("[data-create-organization]");if(createOrganization){event.preventDefault();const values=new FormData(createOrganization),button=event.submitter;button.disabled=true;const{error}=await client.rpc("create_organization",{p_name:String(values.get("name")||"").trim(),p_inn:String(values.get("inn")||"").trim()});button.disabled=false;if(error)return alert(error.message);window.toast?.("Компания создана");return load()}
    const createBranch=event.target.closest("[data-create-branch]");if(createBranch){event.preventDefault();const values=new FormData(createBranch),button=event.submitter;button.disabled=true;const{error}=await client.from("organization_branches").insert({organization_id:state.data.organization.id,name:String(values.get("name")||"").trim(),city:String(values.get("city")||"").trim(),address:String(values.get("address")||"").trim()});button.disabled=false;if(error)return alert(error.message);return load()}
    const addMember=event.target.closest("[data-add-member]");if(addMember){event.preventDefault();const values=new FormData(addMember),button=event.submitter;button.disabled=true;const{error}=await client.rpc("add_organization_member",{p_organization_id:state.data.organization.id,p_email:String(values.get("email")||"").trim(),p_role:values.get("role")});button.disabled=false;if(error)return alert(error.message);window.toast?.("Сотрудник добавлен");return load()}
    const attachFeed=event.target.closest("[data-attach-feed]");if(attachFeed){event.preventDefault();const values=new FormData(attachFeed);if(!confirm('Привязать фид и все загруженные из него автомобили к этой компании?'))return;const button=event.submitter;button.disabled=true;button.textContent='Привязываем…';const{data,error}=await client.rpc("attach_feed_to_organization",{p_feed_id:values.get("feedId"),p_organization_id:state.data.organization.id,p_branch_id:values.get("branchId")||null});button.disabled=false;button.textContent='Привязать фид и автомобили';if(error)return alert(error.message);window.toast?.(`К компании добавлено автомобилей: ${data}`);return load()}
    const adminAttach=event.target.closest("[data-admin-attach-feed]");if(adminAttach){event.preventDefault();const values=new FormData(adminAttach),organization=(state.data.allOrganizations||[]).find(item=>item.id===values.get('organizationId'));if(!confirm(`Передать фид и все его автомобили организации «${organization?.name||''}»?`))return;const button=event.submitter;button.disabled=true;const{data,error}=await client.rpc("attach_feed_to_organization",{p_feed_id:values.get("feedId"),p_organization_id:values.get("organizationId"),p_branch_id:null});button.disabled=false;if(error)return alert(error.message);window.toast?.(`Привязано автомобилей: ${data}`);return load()}
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
  content.addEventListener("change",async event=>{const select=event.target.closest("[data-support-status]");if(!select)return;select.disabled=true;const{error}=await window.vklucheAuth.getClient().from("support_tickets").update({status:select.value,updated_at:new Date().toISOString()}).eq("id",select.dataset.supportStatus);select.disabled=false;if(error)return alert(error.message);window.toast?.("Статус обращения обновлён")});
  window.addEventListener("vkluche:profile", load);
  window.addEventListener("vkluche:saved-searches-changed", load);
  window.addEventListener("vkluche:listings-changed", load);
  window.addEventListener("vkluche:dashboard-open", load);
  window.addEventListener("vkluche:dashboard-tab", (event) => {
    state.active = event.detail?.tab || "overview";
    render();
  });
})();
