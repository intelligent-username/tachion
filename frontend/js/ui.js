// UI helper functions

// Pick the correct ordinal suffix for a day of the month (1st, 2nd, 3rd, 4th…)
const getOrdinalSuffix = (day) => {
    if (!Number.isInteger(day) || day < 1 || day > 31) return 'th'
    const lastTwo = day % 100
    // 11th–13th are the exception (not 11st/12nd/13rd)
    if (lastTwo >= 11 && lastTwo <= 13) return 'th'
    switch (day % 10) {
        case 1: return 'st'
        case 2: return 'nd'
        case 3: return 'rd'
        default: return 'th'
    }
}

// Format date for display
export const formatDate = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''

    const parts = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    }).formatToParts(date)
    const part = (type) => parts.find((p) => p.type === type)?.value ?? ''

    const day = date.getDate()
    return `${part('weekday')}, ${part('month')} ${day}${getOrdinalSuffix(day)}, ${part('year')}`
}
