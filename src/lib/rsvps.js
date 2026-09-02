export function fromDbStatus(status) {
  return status === 'no_response' ? 'none' : status
}

export function toDbStatus(status) {
  return status === 'none' ? 'no_response' : status
}

export function fromDbRsvp(row) {
  return {
    id: row.id,
    child: row.guest_name,
    parent: row.parent_name || 'Parent',
    status: fromDbStatus(row.status),
    note: row.note || '',
  }
}

export function chicagoParts(iso, timeZone = 'America/Chicago') {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(d)
    .slice(0, 5)
  return { date, time }
}

export function mapPartyRow(row) {
  const tz = row.timezone || 'America/Chicago'
  const start = chicagoParts(row.starts_at, tz)
  const end = row.ends_at ? chicagoParts(row.ends_at, tz) : { date: start.date, time: start.time }
  return {
    id: row.id,
    slug: row.slug,
    headline: row.title,
    honoree: row.honoree,
    age: row.age,
    theme: row.theme,
    date: start.date,
    start: start.time,
    end: end.time,
    birthday: row.birthday,
    timezone: tz,
    venue: {
      name: row.venue_name,
      campus: row.venue_campus,
      address: row.venue_address,
      package: row.venue_package,
      packageDetail: row.venue_package_detail,
      status: row.venue_status,
      phone: row.venue_phone,
      notes: row.venue_notes,
    },
    registry: {
      label: row.registry_label || 'Registry',
      url: row.registry_url,
    },
    contact: {
      name: row.contact_name,
      phone: row.contact_phone,
      email: row.contact_email,
    },
    assets: [],
  }
}

export function hostDisplayName(session) {
  if (!session) return 'Andrew'
  if (session.demo) return session.name || 'Andrew'
  const email = (session.email || '').toLowerCase()
  if (email.startsWith('asj412')) return 'Andrew'
  if (session.name) return session.name
  const local = (session.email || '').split('@')[0]
  return local || 'there'
}
