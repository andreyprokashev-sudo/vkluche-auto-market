(function () {
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div class="modal chat-modal" id="chatModal" role="dialog" aria-modal="true"><div class="modal-backdrop" data-chat-close></div><div class="modal-card chat-card"><button class="modal-close" type="button" data-chat-close>×</button><aside><div class="chat-title"><b>Сообщения</b><small>Общайтесь внутри ВКЛЮЧЕ</small></div><div id="chatConversations"></div></aside><section><header><button type="button" id="chatMobileBack">←</button><div><b id="chatCarTitle">Выберите диалог</b><small id="chatStatus">Безопасный чат</small></div></header><div class="chat-messages" id="chatMessages"><div class="chat-placeholder">Выберите диалог или напишите продавцу из карточки автомобиля.</div></div><form id="chatForm"><textarea name="body" rows="1" maxlength="2000" required placeholder="Напишите сообщение"></textarea><button type="submit">Отправить</button></form></section></div></div>',
  );
  const modal = document.querySelector("#chatModal"),
    list = document.querySelector("#chatConversations"),
    messages = document.querySelector("#chatMessages"),
    form = document.querySelector("#chatForm");
  let active = null,
    channel = null;
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
  function close() {
    modal.classList.remove("open");
    document.body.style.overflow = "";
    if (channel) {
      window.vklucheAuth?.getClient()?.removeChannel(channel);
      channel = null;
    }
  }
  async function loadConversations() {
    const client = window.vklucheAuth.getClient(),
      user = window.vklucheAuth.getUser();
    const { data, error } = await client
      .from("conversations")
      .select("id,listing_id,buyer_id,seller_id,updated_at,listings(data)")
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .order("updated_at", { ascending: false });
    if (error) {
      list.innerHTML = `<p>${esc(error.message)}</p>`;
      return;
    }
    list.innerHTML = (data || []).length
      ? data
          .map(
            (row) =>
              `<button type="button" data-conversation="${row.id}" class="${active?.id === row.id ? "active" : ""}"><span>${esc(row.listings?.data?.name?.charAt(0) || "А")}</span><span><b>${esc(row.listings?.data?.name || "Автомобиль")}</b><small>${new Date(row.updated_at).toLocaleString("ru-RU")}</small></span></button>`,
          )
          .join("")
      : "<p>Диалогов пока нет</p>";
    return data || [];
  }
  async function openConversation(conversation, title) {
    if (channel) window.vklucheAuth.getClient().removeChannel(channel);
    active = conversation;
    document.querySelector("#chatCarTitle").textContent =
      title || "Обсуждение автомобиля";
    modal.querySelector(".chat-card").classList.add("conversation-open");
    await loadConversations();
    await loadMessages();
    const client = window.vklucheAuth.getClient();
    channel = client
      .channel(`chat-${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        () => loadMessages(),
      )
      .subscribe();
  }
  async function loadMessages() {
    if (!active) return;
    const client = window.vklucheAuth.getClient(),
      user = window.vklucheAuth.getUser(),
      { data, error } = await client
        .from("messages")
        .select("*")
        .eq("conversation_id", active.id)
        .order("created_at");
    if (error) {
      messages.innerHTML = `<p>${esc(error.message)}</p>`;
      return;
    }
    messages.innerHTML = (data || []).length
      ? data
          .map(
            (row) =>
              `<article class="${row.sender_id === user.id ? "mine" : ""}"><p>${esc(row.body)}</p><time>${new Date(row.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</time></article>`,
          )
          .join("")
      : '<div class="chat-placeholder">Начните разговор об автомобиле. Не переходите по подозрительным ссылкам и не отправляйте предоплату.</div>';
    messages.scrollTop = messages.scrollHeight;
    await client
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("conversation_id", active.id)
      .neq("sender_id", user.id)
      .is("read_at", null);
  }
  async function openInbox() {
    if (!window.vklucheAuth?.require(openInbox)) return;
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
    await loadConversations();
  }
  async function openForCar(car) {
    if (!window.vklucheAuth?.require(() => openForCar(car))) return;
    if (!car?.listingId)
      return toast("Это демонстрационная карточка без реального продавца");
    if (!car.ownerId)
      return toast("К объявлению не привязан аккаунт продавца");
    if (car.ownerId === window.vklucheAuth.getUser().id) {
      toast("Это ваше объявление — открываем входящие диалоги");
      return openInbox();
    }
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
    const { data, error } = await window.vklucheAuth
      .getClient()
      .rpc("open_conversation", { p_listing_id: car.listingId });
    if (error) {
      close();
      return toast(error.message);
    }
    await openConversation(data, car.name);
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!active) return;
    const body = new FormData(form).get("body").trim();
    if (!body) return;
    const button = event.submitter;
    button.disabled = true;
    const { error } = await window.vklucheAuth
      .getClient()
      .from("messages")
      .insert({
        conversation_id: active.id,
        sender_id: window.vklucheAuth.getUser().id,
        body,
      });
    button.disabled = false;
    if (error) return toast(error.message);
    form.reset();
    await loadMessages();
  });
  list.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-conversation]");
    if (!button) return;
    const rows = await loadConversations(),
      row = rows?.find((item) => item.id === button.dataset.conversation);
    if (row) openConversation(row, row.listings?.data?.name);
  });
  document
    .querySelectorAll("[data-chat-close]")
    .forEach((button) => button.addEventListener("click", close));
  document
    .querySelector("#chatMobileBack")
    .addEventListener("click", () =>
      modal.querySelector(".chat-card").classList.remove("conversation-open"),
    );
  document
    .querySelector("#sendMessage")
    .addEventListener("click", () => openForCar(currentCar));
  document
    .querySelector(".notification-center")
    .insertAdjacentHTML(
      "afterend",
      '<button class="header-icon chat-inbox-button" id="chatInboxButton" type="button" aria-label="Сообщения" title="Сообщения"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"/></svg></button>',
    );
  document
    .querySelector("#chatInboxButton")
    .addEventListener("click", openInbox);
})();
