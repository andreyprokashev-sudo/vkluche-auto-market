(() => {
  const form = document.querySelector('#tradeInForm');
  if (!form) return;
  const section = document.createElement('section');
  section.className = 'valuation-photos';
  section.innerHTML = '<h3>Фотографии автомобиля</h3><p>Добавьте общий вид спереди и сзади, оба бока, салон, пробег на приборной панели и заметные повреждения. Это поможет специалисту с предварительной оценкой.</p><label class="valuation-upload">＋ Добавить фотографии<input id="valuationPhotoInput" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><small>До 8 фотографий. JPG, PNG или WebP, до 10 МБ каждая. Можно отправить заявку без фото.</small><div class="valuation-photo-grid" id="valuationPhotoPreview"></div><p id="valuationPhotoError" role="status" aria-live="polite"></p>';
  form.querySelector('.trade-in-consent').before(section);
  const input = section.querySelector('input');
  const preview = section.querySelector('#valuationPhotoPreview');
  const status = section.querySelector('#valuationPhotoError');
  let photos = [], processing = false, generation = 0;
  function render() {
    preview.replaceChildren();
    photos.forEach((photo, index) => {
      const tile = document.createElement('div');
      const image = document.createElement('img');
      image.src = photo.url;
      image.alt = photo.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Удалить фотографию ' + (index + 1));
      remove.disabled = processing;
      remove.onclick = () => { photos.splice(index, 1); render(); status.textContent = photos.length ? 'Добавлено фотографий: ' + photos.length : ''; };
      tile.append(image, remove);
      preview.append(tile);
    });
  }
  async function compress(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
      throw new Error('Выберите фотографии в формате JPG, PNG или WebP.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Фотография должна быть не больше 10 МБ.');
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Не удалось прочитать фотографию. Выберите другой файл.'));
        image.src = objectUrl;
      });
      const canvas = document.createElement('canvas');
      let scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
      for (let attempt = 0; attempt < 5; attempt++) {
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL('image/jpeg', .78);
        if (url.length <= 300000) return {name: file.name.slice(0, 150), url};
        scale *= .75;
      }
      throw new Error('Не удалось подготовить фотографию. Выберите другой снимок.');
    } finally { URL.revokeObjectURL(objectUrl); }
  }
  input.addEventListener('change', async () => {
    const files = [...input.files], run = generation, errors = [];
    processing = true;
    input.disabled = true;
    render();
    status.textContent = 'Подготавливаем фотографии…';
    for (const file of files) {
      if (photos.length >= 8) { errors.push('Можно приложить не больше 8 фотографий.'); break; }
      try {
        const photo = await compress(file);
        if (generation !== run) break;
        photos.push(photo);
      } catch (error) { errors.push(error.message); }
    }
    processing = false;
    input.disabled = false;
    input.value = '';
    render();
    status.textContent = errors.length ? [...new Set(errors)].join(' ') : 'Добавлено фотографий: ' + photos.length;
  });
  form.addEventListener('reset', () => { generation++; photos = []; status.textContent = ''; render(); });
  window.vklucheValuationPhotos = {
    value() {
      if (processing) throw new Error('Дождитесь подготовки фотографий.');
      return photos.map(photo => ({...photo}));
    }
  };
})();
