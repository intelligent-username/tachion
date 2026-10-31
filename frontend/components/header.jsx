// Header component
import { formatDate } from '../js/ui'

export default function Header() {
    const today = new Date()

    return (
        <header className="header">
            <div className="brand">
                <img src="/Logo.svg" alt="Logo" className="logo" />
                <h2>Tachion</h2>
            </div>
            <span className="date">{formatDate(today)}</span>
        </header>
    )
}
