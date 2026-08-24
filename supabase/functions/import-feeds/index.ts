import { createClient } from 'npm:@supabase/supabase-js@2'
import { XMLParser } from 'npm:fast-xml-parser@5'

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const cronSecret = Deno.env.get('CRON_SECRET') || ''
const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true })
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-cron-secret' }

const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value]
const text = (value: unknown): string => value === undefined || value === null ? '' : String(value).trim()
const number = (value: unknown): number => Number(String(value ?? '').replace(/[^\d.,-]/g, '').replace(',', '.')) || 0
const normalizeVehicleId = (value: unknown) => {
  const raw = text(value).toUpperCase().replace(/\s+/g, '')
  return { raw, vin: /^[A-HJ-NPR-Z0-9]{17}$/.test(raw) ? raw : '' }
}

function safeFeedUrl(value: string) {
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol)) return false
  const host = parsed.hostname.toLowerCase()
  return !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/.test(host)
}

function imageUrls(ad: Record<string, any>) {
  return array(ad.Images?.Image).map(image => text(typeof image === 'object' ? image['@_url'] || image['#text'] : image)).filter(Boolean)
}

function optionTexts(value: unknown): string[] {
  const found: string[] = []
  const walk = (node: any, key = '', parent = '') => {
    if (node === undefined || node === null) return
    if (Array.isArray(node)) return node.forEach(item => walk(item, key, parent))
    if (typeof node === 'object') return Object.entries(node).forEach(([childKey, child]) => walk(child, childKey, key))
    if (/option|equipment/i.test(key)) {
      let value = text(node)
      if (/heating/i.test(parent) && !/подогрев|обогрев/i.test(value)) value = `Подогрев: ${value}`
      if (/airbags/i.test(parent) && !/подуш/i.test(value)) value = `Подушки безопасности: ${value}`
      if (value) found.push(value)
    }
  }
  walk(value)
  return [...new Set(found)]
}

function mapAd(ad: Record<string, any>) {
  const externalId = text(ad.Id), brand = text(ad.Make), model = text(ad.Model)
  const price = number(ad.Price), year = number(ad.Year)
  if (!externalId || !brand || !model || !price || !year) throw new Error(`Объявление ${externalId || 'без Id'}: обязательны Id, Make, Model, Year и Price`)
  const mileage = number(ad.Kilometrage || ad.Mileage), power = text(ad.Power), volume = text(ad.EngineSize)
  const body = text(ad.BodyType), condition = text(ad.Condition).toLowerCase(), engineType = text(ad.EngineType || ad.FuelType), images = imageUrls(ad)
  const equipment = [...new Set([...optionTexts(ad), text(ad.ClimateControl), ad.PowerWindows ? `Электростеклоподъёмники: ${text(ad.PowerWindows)}` : '', ad.Interior ? `Салон: ${text(ad.Interior)}` : ''].filter(Boolean))], secondSetOption = equipment.find(option => /комплект.*(шин|кол[её]с)|(шин|кол[её]с).*комплект/i.test(option)) || ''
  const identification = normalizeVehicleId(ad.VIN || ad.Vin)
  const city = text(ad.City || ad.Region) || 'Город не указан', address = text(ad.Address) || city
  const latitude = number(ad.Latitude), longitude = number(ad.Longitude)
  return {
    externalId,
    car: {
      id: `feed:${externalId}`, externalId, source: 'automatic-feed', name: `${brand} ${model}`, price, year,
      km: mileage ? `${new Intl.NumberFormat('ru-RU').format(mileage)} км` : 'Новый',
      engine: volume ? `${volume} л / ${power || '—'} л.с.` : power ? `${power} л.с.` : 'Двигатель не указан',
      city, date: 'обновлено сегодня', type: [condition.includes('нов') ? 'new' : 'used', /внедорож|кроссов/i.test(body) ? 'suv' : '', /элект|electric|ev/i.test(engineType) ? 'electric' : ''].filter(Boolean),
      badge: 'В продаже', img: images[0] || 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=1000&q=85',
      details: { brand, model, generation: text(ad.Generation || ad.GenerationName || ad.GenerationId), modification: text(ad.Modification || ad.ModificationName || ad.ModificationId), trimName: text(ad.Complectation || ad.ComplectationName || ad.ComplectationId), body, doors: text(ad.Doors), seats: text(ad.Seats), steeringWheel: /прав/i.test(text(ad.SteeringWheel || ad.WheelType)) ? 'right' : text(ad.SteeringWheel || ad.WheelType) ? 'left' : '', condition, engineType, gearbox: text(ad.Transmission), drive: text(ad.DriveType), color: text(ad.Color), owners: text(ad.Owners), ptsType: text(ad.PTS || ad.PTSType || ad.PtsType), keysCount: text(ad.KeysCount), equipment, equipmentDataKnown: equipment.length > 0, equipmentSource: 'feed', secondWheelSet: secondSetOption ? { known: true, included: true, type: /только.*шин|комплект шин/i.test(secondSetOption) ? 'tires' : 'wheels', season: /зим/i.test(secondSetOption) ? 'Зимние' : /лет/i.test(secondSetOption) ? 'Летние' : '', size: '', condition: '' } : { known: false, included: false }, description: text(ad.Description), seller: text(ad.ManagerName || ad.ContactName), phone: text(ad.ContactPhone), vin: identification.vin, identificationNumber: identification.vin ? '' : identification.raw, identificationType: identification.raw && !identification.vin ? 'body_or_frame' : 'vin', images, location: { address, latitude: latitude || null, longitude: longitude || null, precision: 'exact' } }
    }
  }
}

async function authorized(req: Request) {
  if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) return { cron: true, admin: true, organizationIds: [] as string[] }
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return null
  const { data } = await admin.from('profiles').select('role,account_type').eq('id', user.id).single()
  if (data?.role === 'admin') return { cron: false, admin: true, organizationIds: [] as string[] }
  if (data?.account_type !== 'professional') return null
  const { data: memberships = [] } = await admin.from('organization_members').select('organization_id').eq('user_id', user.id).eq('active', true).in('member_role', ['owner', 'administrator', 'manager'])
  return { cron: false, admin: false, organizationIds: memberships.map((row: any) => row.organization_id) }
}

async function importSource(source: any) {
  const started = new Date().toISOString()
  const { data: run } = await admin.from('feed_import_runs').insert({ source_id: source.id, status: 'running', started_at: started }).select('id').single()
  try {
    if (!safeFeedUrl(source.url)) throw new Error('Недопустимый или локальный URL фида')
    const response = await fetch(source.url, { headers: { 'user-agent': 'VklucheFeedImporter/1.0' }, signal: AbortSignal.timeout(45000) })
    if (!response.ok) throw new Error(`Сервер фида ответил с кодом ${response.status}`)
    const xml = await response.text()
    if (xml.length > 25_000_000) throw new Error('Фид превышает ограничение 25 МБ')
    const parsed = parser.parse(xml), ads = array(parsed?.Ads?.Ad)
    if (!ads.length) throw new Error('В фиде не найдены элементы Ads → Ad')
    const errors: string[] = [], mapped: ReturnType<typeof mapAd>[] = []
    for (const ad of ads) { try { mapped.push(mapAd(ad)) } catch (error) { errors.push((error as Error).message) } }
    if (!mapped.length) throw new Error(errors[0] || 'Нет корректных объявлений')

    const { data: existing = [], error: readError } = await admin.from('listings').select('*').eq('source_id', source.id)
    if (readError) throw readError
    const previous = new Map(existing.map((item: any) => [item.external_id, item]))
    const seen = new Set(mapped.map(item => item.externalId)), now = new Date().toISOString()
    const rows = mapped.map(item => ({ source_id: source.id, external_id: item.externalId, organization_id: source.organization_id || null, branch_id: source.branch_id || null, vin: item.car.details.vin || null, data: { ...item.car, id: `feed:${source.id}:${item.externalId}` }, active: true, missing_runs: 0, last_seen_at: now, updated_at: now }))
    for (let i = 0; i < rows.length; i += 200) { const { error } = await admin.from('listings').upsert(rows.slice(i, i + 200), { onConflict: 'source_id,external_id' }); if (error) throw error }
    let hidden = 0
    const missing = existing.filter((item: any) => !seen.has(item.external_id)).map((item: any) => { const misses = item.missing_runs + 1, active = misses < source.missing_threshold; if (!active && item.active) hidden++; return { ...item, missing_runs: misses, active, updated_at: now } })
    for (let i = 0; i < missing.length; i += 200) { const { error } = await admin.from('listings').upsert(missing.slice(i, i + 200)); if (error) throw error }
    const result = { total: ads.length, added: mapped.filter(item => !previous.has(item.externalId)).length, updated: mapped.filter(item => previous.has(item.externalId)).length, hidden, errors }
    await admin.from('feed_sources').update({ last_run_at: now, last_success_at: now, last_status: 'success', last_error: null }).eq('id', source.id)
    if (run) await admin.from('feed_import_runs').update({ status: 'success', ...result, errors, finished_at: now }).eq('id', run.id)
    return { source: source.name, ...result }
  } catch (error) {
    const message = (error as Error).message, now = new Date().toISOString()
    await admin.from('feed_sources').update({ last_run_at: now, last_status: 'error', last_error: message }).eq('id', source.id)
    if (run) await admin.from('feed_import_runs').update({ status: 'error', errors: [message], finished_at: now }).eq('id', run.id)
    return { source: source.name, error: message }
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const access = await authorized(req)
  if (!access) return Response.json({ error: 'Доступ запрещён' }, { status: 401, headers: cors })
  const body = await req.json().catch(() => ({})), sourceId = body.sourceId
  let query = admin.from('feed_sources').select('*').eq('active', true)
  if (!access.admin) {
    if (!access.organizationIds.length) return Response.json({ error: 'Организация не найдена' }, { status: 403, headers: cors })
    query = query.in('organization_id', access.organizationIds)
  }
  if (sourceId) query = query.eq('id', sourceId)
  const { data: sources, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500, headers: cors })
  const due = sourceId ? sources : sources.filter((source: any) => !source.last_run_at || Date.now() - new Date(source.last_run_at).getTime() >= source.interval_minutes * 60000)
  const results = []
  for (const source of due) results.push(await importSource(source))
  return Response.json({ processed: results.length, results }, { headers: cors })
})
