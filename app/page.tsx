'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Search, Shield, ShieldCheck, ShieldAlert, Filter, ExternalLink, Clock, CheckCircle } from 'lucide-react'

type Device = {
  device_id: string
  intended_use: string
  ai_ml_type: string
  accountability_tier: number
  health_status: 'Green' | 'Amber' | 'Red'
  aletia_verified: boolean
  last_automated_sync: string
  last_clinical_review: string | null
  specialty_link: string
  manufacturers: { name: string; hq_location: string }
  regional_registrations: { country: string; regulatory_body: string; clearance_type: string }[]
}

const TIER_LABELS: Record<number, string> = {
  1: 'Clinical Decision Support',
  2: 'Diagnostic Aid',
  3: 'Diagnostic Decision',
  4: 'Autonomous Screening',
  5: 'Autonomous Action',
}

export default function Home() {
  const [devices, setDevices] = useState<Device[]>([])
  const [filtered, setFiltered] = useState<Device[]>([])
  const [search, setSearch] = useState('')
  const [specialtyFilter, setSpecialtyFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Device | null>(null)
  const [specialties, setSpecialties] = useState<string[]>([])

  useEffect(() => {
    fetchDevices()
  }, [])

  useEffect(() => {
    let result = devices
    if (search) {
      result = result.filter(d =>
        d.device_id.toLowerCase().includes(search.toLowerCase()) ||
        d.intended_use.toLowerCase().includes(search.toLowerCase()) ||
        d.manufacturers?.name.toLowerCase().includes(search.toLowerCase()) ||
        d.specialty_link.toLowerCase().includes(search.toLowerCase())
      )
    }
    if (specialtyFilter !== 'All') {
      result = result.filter(d => d.specialty_link === specialtyFilter)
    }
    if (statusFilter !== 'All') {
      result = result.filter(d => d.health_status === statusFilter)
    }
    setFiltered(result)
  }, [search, specialtyFilter, statusFilter, devices])

  async function fetchDevices() {
    const { data, error } = await supabase
      .from('device_master')
      .select(`
        *,
        manufacturers (name, hq_location),
        regional_registrations (country, regulatory_body, clearance_type)
      `)
    if (error) { console.error(error); setLoading(false); return }
    setDevices(data || [])
    setFiltered(data || [])
    const specs = [...new Set((data || []).map((d: Device) => d.specialty_link))]
    setSpecialties(specs)
    setLoading(false)
  }

  const statusIcon = (status: string) => {
    if (status === 'Green') return <ShieldCheck className="w-5 h-5 text-emerald-500" />
    if (status === 'Red') return <ShieldAlert className="w-5 h-5 text-red-500" />
    return <Shield className="w-5 h-5 text-amber-500" />
  }

  const statusBadge = (status: string) => {
    if (status === 'Green') return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    if (status === 'Red') return 'bg-red-50 text-red-700 border border-red-200'
    return 'bg-amber-50 text-amber-700 border border-amber-200'
  }

  const tierColor = (tier: number) => {
    if (tier <= 2) return 'bg-blue-50 text-blue-700'
    if (tier === 3) return 'bg-purple-50 text-purple-700'
    return 'bg-orange-50 text-orange-700'
  }

  const formatDate = (d: string | null) => {
    if (!d) return 'Never'
    return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Aletia Index</h1>
              <p className="text-xs text-gray-500">AI/ML Medical Device Registry</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{filtered.length} devices</span>
            <button className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 transition">
              Submit Device
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search & Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-wrap gap-3">
          <div className="flex-1 min-w-64 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search devices, manufacturers, conditions..."
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              className="border border-gray-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={specialtyFilter}
              onChange={e => setSpecialtyFilter(e.target.value)}
            >
              <option value="All">All Specialties</option>
              {specialties.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              className="border border-gray-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="All">All Statuses</option>
              <option value="Green">Green</option>
              <option value="Amber">Amber</option>
              <option value="Red">Red</option>
            </select>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total Devices', value: devices.length, color: 'text-gray-900' },
            { label: 'Aletia Verified', value: devices.filter(d => d.aletia_verified).length, color: 'text-emerald-600' },
            { label: 'SAHPRA Registered', value: devices.filter(d => d.regional_registrations?.some(r => r.country === 'South Africa')).length, color: 'text-indigo-600' },
          ].map(stat => (
            <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Device Grid */}
        {loading ? (
          <div className="text-center py-20 text-gray-400">Loading devices...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">No devices found.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(device => (
              <div
                key={device.device_id}
                className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-indigo-200 transition cursor-pointer"
                onClick={() => setSelected(device)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {statusIcon(device.health_status)}
                      <span className="text-xs font-mono text-gray-400">{device.device_id}</span>
                    </div>
                    <h3 className="font-semibold text-gray-900 text-sm leading-tight">
                      {device.manufacturers?.name}
                    </h3>
                    <p className="text-xs text-gray-500">{device.manufacturers?.hq_location}</p>
                  </div>
                  {device.aletia_verified && (
                    <div className="flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                      <CheckCircle className="w-3 h-3 text-emerald-600" />
                      <span className="text-xs text-emerald-700 font-medium">Verified</span>
                    </div>
                  )}
                </div>

                <p className="text-xs text-gray-600 mb-3 line-clamp-2">{device.intended_use}</p>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{device.specialty_link}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${tierColor(device.accountability_tier)}`}>
                    Tier {device.accountability_tier}: {TIER_LABELS[device.accountability_tier]}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusBadge(device.health_status)}`}>
                    {device.health_status} Status
                  </span>
                  <div className="flex gap-1">
                    {device.regional_registrations?.map(r => (
                      <span key={r.regulatory_body} className="text-xs px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded">
                        {r.regulatory_body}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Device Detail Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {statusIcon(selected.health_status)}
                    <span className="font-mono text-sm text-gray-400">{selected.device_id}</span>
                    {selected.aletia_verified && (
                      <span className="flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 text-xs text-emerald-700 font-medium">
                        <CheckCircle className="w-3 h-3" /> Aletia Verified
                      </span>
                    )}
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">{selected.manufacturers?.name}</h2>
                  <p className="text-sm text-gray-500">{selected.manufacturers?.hq_location}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl font-light">✕</button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Intended Use</h3>
                <p className="text-sm text-gray-700">{selected.intended_use}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Specialty</h3>
                  <p className="text-sm text-gray-700">{selected.specialty_link}</p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">AI Type</h3>
                  <p className="text-sm text-gray-700">{selected.ai_ml_type}</p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Autonomy Level</h3>
                  <p className="text-sm text-gray-700">Tier {selected.accountability_tier}: {TIER_LABELS[selected.accountability_tier]}</p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Mode</h3>
                  <p className="text-sm text-gray-700">{selected.mode} / {selected.autonomy}</p>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Regulatory Registrations</h3>
                <div className="space-y-2">
                  {selected.regional_registrations?.map(r => (
                    <div key={r.regulatory_body} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <span className="text-sm font-medium text-gray-700">{r.country}</span>
                      <span className="text-xs text-indigo-600 font-medium">{r.regulatory_body}</span>
                      <span className="text-xs text-gray-500">{r.clearance_type}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Data Freshness
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-500">Last Automated Sync</p>
                    <p className="text-sm font-medium text-gray-700">{formatDate(selected.last_automated_sync)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Last Clinical Review</p>
                    <p className="text-sm font-medium text-gray-700">{formatDate(selected.last_clinical_review)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}