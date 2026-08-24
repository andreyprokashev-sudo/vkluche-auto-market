import { createClient } from 'npm:@supabase/supabase-js@2'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version' }
const value = (row: Record<string, unknown>, key: string) => String(row[key] || '').trim()
const number = (input: unknown) => Number(String(input || '').replace(',', '.')) || null

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const { vin: inputVin, year: inputYear } = await request.json().catch(() => ({}))
  const vin = String(inputVin || '').trim().toUpperCase().replace(/\s/g, '')
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return Response.json({ error: 'Введите VIN из 17 символов без I, O и Q' }, { status: 400, headers: cors })

  try {
    const endpoint = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json${inputYear ? `&modelyear=${Number(inputYear)}` : ''}`
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(12000) })
    if (!response.ok) throw new Error(`VIN-сервис ответил с кодом ${response.status}`)
    const decoded = (await response.json())?.Results?.[0] || {}
    const errorCode = value(decoded, 'ErrorCode')
    const brand = value(decoded, 'Make'), model = value(decoded, 'Model'), year = number(value(decoded, 'ModelYear'))
    if (!brand || !model) return Response.json({ error: 'VIN распознан частично. Выберите марку и модель вручную.', partial: true, errorCode }, { status: 422, headers: cors })

    let catalog = admin.from('vehicle_catalog').select('*').ilike('brand', brand).ilike('model', model).limit(50)
    if (year) catalog = catalog.lte('year_from', year).gte('year_to', year)
    const { data: candidates = [] } = await catalog
    const transmission = value(decoded, 'TransmissionStyle')
    const driveRaw = value(decoded, 'DriveType')
    const fuelRaw = value(decoded, 'FuelTypePrimary')
    const result = {
      vin, brand, model, year,
      body: value(decoded, 'BodyClass'),
      doors: number(value(decoded, 'Doors')),
      seats: number(value(decoded, 'Seats')),
      volume: number(value(decoded, 'DisplacementL')),
      power: number(value(decoded, 'EngineHP')),
      engineType: /electric/i.test(fuelRaw) ? 'electric' : /diesel/i.test(fuelRaw) ? 'diesel' : /hybrid/i.test(fuelRaw) ? 'hybrid' : fuelRaw ? 'petrol' : '',
      gearbox: /manual/i.test(transmission) ? 'Механика' : /cvt|continuously/i.test(transmission) ? 'Вариатор' : /dual|automated manual/i.test(transmission) ? 'Робот' : transmission ? 'Автомат' : '',
      drive: /all|4x4|four/i.test(driveRaw) ? 'Полный' : /rear/i.test(driveRaw) ? 'Задний' : /front/i.test(driveRaw) ? 'Передний' : '',
      manufacturer: value(decoded, 'Manufacturer'),
      plantCountry: value(decoded, 'PlantCountry'),
      confidence: candidates.length ? 'catalog_match' : 'vin_only',
      candidates
    }
    return Response.json({ result }, { headers: cors })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502, headers: cors })
  }
})
