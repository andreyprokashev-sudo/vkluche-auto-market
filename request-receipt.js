(() => {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'requestReceipt';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'requestReceiptTitle');
  modal.innerHTML = '<div class="modal-backdrop" data-receipt-close></div><div class="modal-card"><button class="modal-close" type="button" data-receipt-close aria-label="Закрыть">×</button><h2 id="requestReceiptTitle">Заявка сохранена</h2><p id="requestReceiptDetails"></p><p id="requestReceiptNext"></p><button class="primary-btn" type="button" id="requestReceiptOpen">Посмотреть заявку в личном кабинете</button></div>';
  document.body.append(modal);
  let cabinet = '';
  function close() {
    modal.classList.remove('open');
    document.body.style.overflow = document.querySelector('#carDetail.open,#authModal.open') ? 'hidden' : '';
  }
  modal.querySelectorAll('[data-receipt-close]').forEach(button => button.addEventListener('click', close));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  modal.querySelector('#requestReceiptOpen').addEventListener('click', () => {
    close();
    window.vklucheAuth.open('profile');
    window.dispatchEvent(new CustomEvent('vkluche:dashboard-tab', { detail: { tab: cabinet } }));
  });
  window.vklucheRequestReceipt = (row, tab, vehicle) => {
    cabinet = tab;
    modal.querySelector('#requestReceiptDetails').textContent = `${vehicle}. Заявка № ${row.id}. Статус: заявка получена.`;
    modal.querySelector('#requestReceiptNext').textContent = tab === 'my-credit'
      ? 'Заявка на консультацию сохранена. После обработки специалистом её статус изменится в разделе «Кредитные заявки». Решение банка пока не получено.'
      : 'Заявка на оценку сохранена. После обработки специалистом статус и предварительная стоимость появятся в разделе «Оценка и trade-in».';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    modal.querySelector('#requestReceiptOpen').focus();
  };
})();
