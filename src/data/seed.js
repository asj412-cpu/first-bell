export const HOUSEHOLD = {
  name: 'Johnson',
  members: [
    { id: 'andrew', name: 'Andrew', role: 'Parent' },
    { id: 'megan', name: 'Megan', role: 'Parent' },
    { id: 'claire', name: 'Claire', role: 'Kid' },
    { id: 'chloe', name: 'Chloe', role: 'Kid' },
    { id: 'drew', name: 'Drew', role: 'Kid' },
  ],
  timezone: 'America/Chicago',
  contact: {
    name: 'Andrew',
    phone: '936-355-1281',
    email: 'asj412@me.com',
  },
}

export const PARTY = {
  id: 'chloe-5',
  slug: 'princess-chloe-5',
  headline: 'Princess Chloe is turning 5!',
  honoree: 'Chloe',
  age: 5,
  theme: 'Mario-movie style · Princess Peach',
  date: '2026-10-10',
  start: '13:00',
  end: '14:30',
  birthday: '2026-10-13',
  timezone: 'America/Chicago',
  venue: {
    name: 'Cypress Academy of Gymnastics',
    campus: 'Kuykendahl',
    address: '23200 Kuykendahl Rd, Tomball, TX 77375',
    package: 'SNAP Package A',
    packageDetail: '1–10 children · 1½ hours · 1 coach · paid',
    status: 'paid',
    phone: '281-766-4899',
    notes:
      'Complimentary “Best Birthday Ever” T-shirt for the birthday child. Tables, chairs, and coaches provided. You may bring food, decorations, refreshments, and paper goods.',
  },
  registry: {
    label: 'Amazon Registry',
    url: 'https://www.amazon.com/registries/gl/guest-view/L53W1XS578SM',
  },
  assets: [
    {
      id: 'mario',
      title: 'Mario-movie invite',
      caption: 'Primary · castle terrace, mushrooms, peach roses',
      src: '/invites/chloe-mario.jpg',
      download: '/invites/chloe-mario.png',
    },
    {
      id: 'peach',
      title: 'Peach castle invite',
      caption: 'Alternate · garden terrace, peach orchard',
      src: '/invites/chloe-peach.jpg',
      download: '/invites/chloe-peach.png',
    },
  ],
}

export const GUESTS = [
  { id: 'leila', child: 'Leila', parent: "Leila's Mom", status: 'yes', note: 'Preloaded RSVP' },
  { id: 'harper', child: 'Harper', parent: "Harper's Mom", status: 'none' },
  { id: 'nora', child: 'Nora', parent: "Nora's Dad", status: 'none' },
  { id: 'isla', child: 'Isla', parent: "Isla's Mom", status: 'none' },
  { id: 'ava', child: 'Ava', parent: "Ava's Mom", status: 'none' },
  { id: 'mia', child: 'Mia', parent: "Mia's Dad", status: 'none' },
  { id: 'zoe', child: 'Zoe', parent: "Zoe's Mom", status: 'none' },
  { id: 'riley', child: 'Riley', parent: "Riley's Mom", status: 'none' },
]

export const MESSAGES = [
  {
    id: 'm1',
    folder: 'inbox',
    from: 'Cypress Academy SNAP',
    subject: 'Party booking confirmed — Package A',
    snippet:
      'Kuykendahl · Sat Oct 10, 1:00–2:30pm CT · Package A paid. Best Birthday Ever T-shirt included for the birthday child.',
    suggested: 'bills',
    when: '2026-08-28T16:12:00-05:00',
    attention: true,
  },
  {
    id: 'm2',
    folder: 'inbox',
    from: 'Amazon Registry',
    subject: 'Chloe’s birthday list is live',
    snippet: 'Guest view is on. Share the link with families who ask what to bring.',
    suggested: 'shopping',
    when: '2026-08-30T09:40:00-05:00',
    attention: true,
  },
  {
    id: 'm3',
    folder: 'inbox',
    from: 'School calendar',
    subject: 'Fall dates ready to file',
    snippet:
      'Picture day and the fall newsletter are in. First Bell will place them on Family after you confirm calendar sync.',
    suggested: 'school',
    when: '2026-09-01T07:05:00-05:00',
    attention: true,
  },
]

export const EVENTS = [
  {
    id: 'evt-chloe-party',
    title: "Princess Chloe is turning 5!",
    kind: 'party',
    date: '2026-10-10',
    start: '13:00',
    end: '14:30',
    place: 'Cypress Academy · Kuykendahl',
    partyId: 'chloe-5',
  },
  {
    id: 'evt-chloe-bday',
    title: "Chloe’s 5th birthday",
    kind: 'birthday',
    date: '2026-10-13',
    allDay: true,
    place: 'Home',
  },
]

export const FOLDERS = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'bills', label: 'Bills' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'school', label: 'School' },
  { id: 'trash', label: 'Trash' },
]

export function freshState() {
  return {
    version: 1,
    session: null,
    guests: GUESTS.map((g) => ({ ...g })),
    messages: MESSAGES.map((m) => ({ ...m })),
  }
}
