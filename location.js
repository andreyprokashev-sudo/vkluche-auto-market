(function () {
  if (!window.L) return;
  const addressInput = document.querySelector("#listingAddress"),
    latitudeInput = document.querySelector("#listingLatitude"),
    longitudeInput = document.querySelector("#listingLongitude"),
    status = document.querySelector("#locationStatus"),
    results = document.querySelector("#addressResults"),
    citySelect = document.querySelector('#listingForm [name="city"]');
  let listingMap, listingMarker, detailMap, detailLayer, requestController;

  const tiles = (map) =>
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
  const coordinates = () => ({ lat: +latitudeInput.value, lon: +longitudeInput.value });
  const hasCoordinates = () => Number.isFinite(coordinates().lat) && Number.isFinite(coordinates().lon) && latitudeInput.value !== "" && longitudeInput.value !== "";
  const setStatus = (text, error = false) => {
    status.textContent = text;
    status.style.color = error ? "#b42318" : "";
  };
  function ensureListingMap() {
    if (!listingMap) {
      listingMap = L.map("listingLocationMap", { scrollWheelZoom: false }).setView([55.751244, 37.618423], 9);
      tiles(listingMap);
      listingMap.on("click", (event) => setPoint(event.latlng.lat, event.latlng.lng, true));
    }
    setTimeout(() => listingMap.invalidateSize(), 50);
    return listingMap;
  }
  function setPoint(lat, lon, reverse = false) {
    ensureListingMap();
    latitudeInput.value = Number(lat).toFixed(6);
    longitudeInput.value = Number(lon).toFixed(6);
    if (!listingMarker) {
      listingMarker = L.marker([lat, lon], { draggable: true }).addTo(listingMap);
      listingMarker.on("dragend", () => {
        const point = listingMarker.getLatLng();
        setPoint(point.lat, point.lng, true);
      });
    } else listingMarker.setLatLng([lat, lon]);
    listingMap.setView([lat, lon], 16);
    setStatus("Точка места осмотра выбрана");
    if (reverse) reverseGeocode(lat, lon);
  }
  async function nominatim(path, params) {
    requestController?.abort();
    requestController = new AbortController();
    const query = new URLSearchParams({ format: "jsonv2", countrycodes: "ru", ...params });
    const response = await fetch(`https://nominatim.openstreetmap.org/${path}?${query}`, {
      signal: requestController.signal,
      headers: { "Accept-Language": "ru" },
    });
    if (!response.ok) throw new Error("Сервис адресов временно недоступен");
    return response.json();
  }
  function setCity(address = {}) {
    const city = address.city || address.town || address.village || address.municipality;
    if (city && [...citySelect.options].some((option) => option.value === city)) citySelect.value = city;
  }
  async function findAddress() {
    const value = addressInput.value.trim(), city = citySelect.value;
    if (!value) return addressInput.reportValidity();
    setStatus("Ищем адрес…");
    results.classList.remove("open");
    try {
      const rows = await nominatim("search", { q: [city, value].filter(Boolean).join(", "), addressdetails: "1", limit: "5" });
      if (!rows.length) return setStatus("Адрес не найден. Уточните улицу и дом или поставьте точку вручную.", true);
      results.innerHTML = "";
      rows.forEach((row) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = row.display_name;
        button.addEventListener("click", () => {
          addressInput.value = row.display_name;
          setCity(row.address);
          setPoint(+row.lat, +row.lon);
          results.classList.remove("open");
        });
        results.append(button);
      });
      results.classList.add("open");
      setStatus("Выберите подходящий адрес из списка");
    } catch (error) {
      if (error.name !== "AbortError") setStatus(error.message, true);
    }
  }
  async function reverseGeocode(lat, lon) {
    setStatus("Уточняем адрес точки…");
    try {
      const row = await nominatim("reverse", { lat: String(lat), lon: String(lon), addressdetails: "1", zoom: "18" });
      if (row.display_name) addressInput.value = row.display_name;
      setCity(row.address);
      setStatus("Адрес и точка сохранены");
    } catch (error) {
      if (error.name !== "AbortError") setStatus("Точка сохранена, адрес можно уточнить вручную", true);
    }
  }
  document.querySelector("#findAddress").addEventListener("click", findAddress);
  addressInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      findAddress();
    }
  });
  document.querySelector("#useMyLocation").addEventListener("click", () => {
    if (!navigator.geolocation) return setStatus("Геолокация не поддерживается браузером", true);
    setStatus("Определяем местоположение…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setPoint(coords.latitude, coords.longitude, true),
      () => setStatus("Не удалось получить местоположение. Проверьте разрешение браузера.", true),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
  window.addEventListener("vkluche:wizard-step", (event) => {
    if (event.detail?.step === 3) ensureListingMap();
  });
  window.vklucheLocation = {
    valid() {
      if (hasCoordinates()) return true;
      setStatus("Найдите адрес или поставьте точку на карте", true);
      ensureListingMap();
      return false;
    },
    showDetail(car) {
      const location = car?.details?.location || {}, exact = location.precision === "exact";
      document.querySelector("#mapAddress").textContent = location.address ? (exact ? location.address : `Примерный район · ${car.city}`) : "Точное место уточняйте у продавца";
      const element = document.querySelector("#detailLocationMap");
      if (!location.latitude || !location.longitude) {
        element.style.display = "none";
        return;
      }
      element.style.display = "block";
      if (!detailMap) {
        detailMap = L.map(element, { scrollWheelZoom: false, dragging: true, zoomControl: true });
        tiles(detailMap);
      }
      if (detailLayer) detailLayer.remove();
      let lat = +location.latitude, lon = +location.longitude;
      if (!exact) {
        lat = Math.round(lat * 100) / 100;
        lon = Math.round(lon * 100) / 100;
        detailLayer = L.circle([lat, lon], { radius: 900, color: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.14 }).addTo(detailMap);
        detailMap.setView([lat, lon], 13);
      } else {
        detailLayer = L.marker([lat, lon]).addTo(detailMap);
        detailMap.setView([lat, lon], 16);
      }
      setTimeout(() => detailMap.invalidateSize(), 80);
    },
  };
})();
