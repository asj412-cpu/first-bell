/**
 * Family seed from Andrew. Ages are computed from birth dates.
 * Claire’s grade is blank on purpose (kindergarten or 1st — editable).
 * Chloe’s grade starts as Pre-K and stays editable. Allergies stay blank.
 */
export function defaultProfiles() {
  return [
    {
      memberKey: 'andrew',
      name: 'Andrew',
      fullName: 'Andrew Scott Johnson',
      role: 'parent',
      birthDate: '1985-04-12',
      grade: null,
      notes: '',
    },
    {
      memberKey: 'megan',
      name: 'Megan',
      fullName: 'Megan Quiroga Johnson',
      role: 'parent',
      birthDate: '1987-02-09',
      grade: null,
      notes: '',
    },
    {
      memberKey: 'claire',
      name: 'Claire',
      fullName: 'Claire Lynn Johnson',
      role: 'kid',
      birthDate: '2020-02-10',
      grade: null,
      clothingSize: '7',
      notes: '',
    },
    {
      memberKey: 'chloe',
      name: 'Chloe',
      fullName: 'Chloe Margaret Johnson',
      role: 'kid',
      birthDate: '2021-10-13',
      grade: 'Pre-K',
      clothingSize: '5T',
      notes: '',
    },
    {
      memberKey: 'drew',
      name: 'Drew',
      fullName: 'Andrew Paul Johnson',
      role: 'kid',
      birthDate: '2026-02-10',
      grade: null,
      clothingSize: '',
      notes: '',
    },
  ]
}

export function mergeProfiles(saved) {
  const defaults = defaultProfiles()
  if (!Array.isArray(saved) || saved.length === 0) return defaults
  const extra = saved.filter((row) => !defaults.some((item) => item.memberKey === row.memberKey))
  return [
    ...defaults.map((item) => {
      const row = saved.find((candidate) => candidate.memberKey === item.memberKey)
      if (!row) return item
      return {
        ...item,
        ...row,
        name: row.name || item.name,
        fullName: row.fullName || item.fullName,
        role: row.role || item.role,
        birthDate: Object.prototype.hasOwnProperty.call(row, 'birthDate') ? row.birthDate : item.birthDate,
        grade: Object.prototype.hasOwnProperty.call(row, 'grade') ? row.grade : item.grade,
        clothingSize: Object.prototype.hasOwnProperty.call(row, 'clothingSize') ? row.clothingSize || '' : item.clothingSize || '',
        notes: row.notes ?? '',
      }
    }),
    ...extra,
  ]
}
